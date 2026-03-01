package workerentry

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	localruntimeservice "github.com/nimiplatform/nimi/runtime/internal/services/localruntime"
	modelservice "github.com/nimiplatform/nimi/runtime/internal/services/model"
	scriptworkerservice "github.com/nimiplatform/nimi/runtime/internal/services/scriptworker"
	workflowservice "github.com/nimiplatform/nimi/runtime/internal/services/workflow"
	"github.com/nimiplatform/nimi/runtime/internal/workeripc"
	"google.golang.org/grpc"
)

// Run boots one runtime worker role and blocks until shutdown.
func Run(role string) error {
	switch role {
	case "ai", "model", "workflow", "script", "localruntime":
	default:
		return fmt.Errorf("unsupported worker role %q", role)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	socketPath := os.Getenv("NIMI_RUNTIME_WORKER_SOCKET")
	if socketPath == "" {
		preparedPath, err := workeripc.PrepareSocket(role)
		if err != nil {
			return err
		}
		socketPath = preparedPath
	}
	if err := os.Remove(socketPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return fmt.Errorf("listen worker socket %s: %w", socketPath, err)
	}
	defer os.Remove(socketPath)

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	server := grpc.NewServer()
	switch role {
	case "ai":
		registryPath := modelregistry.ResolvePersistencePath()
		registry, loadErr := modelregistry.NewFromFile(registryPath)
		if loadErr != nil {
			registry = modelregistry.New()
		}
		svc := aiservice.New(logger, registry, providerhealth.New(), nil, nil, config.Config{})
		svc.SetModelRegistryPersistencePath(registryPath)
		runtimev1.RegisterRuntimeAiServiceServer(server, svc)
	case "model":
		registryPath := modelregistry.ResolvePersistencePath()
		registry, loadErr := modelregistry.NewFromFile(registryPath)
		if loadErr != nil {
			registry = modelregistry.New()
		}
		svc := modelservice.New(logger, registry)
		svc.SetPersistencePath(registryPath)
		runtimev1.RegisterRuntimeModelServiceServer(server, svc)
	case "workflow":
		runtimev1.RegisterRuntimeWorkflowServiceServer(server, workflowservice.New(logger))
	case "script":
		runtimev1.RegisterScriptWorkerServiceServer(server, scriptworkerservice.New(logger))
	case "localruntime":
		runtimev1.RegisterRuntimeLocalRuntimeServiceServer(server, localruntimeservice.New(logger, nil, "", 0))
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- server.Serve(listener)
	}()

	select {
	case <-ctx.Done():
		server.GracefulStop()
		if errors.Is(ctx.Err(), context.Canceled) {
			return nil
		}
		return nil
	case serveErr := <-errCh:
		if serveErr != nil {
			return fmt.Errorf("serve worker %s: %w", role, serveErr)
		}
		return nil
	}
}
