package grpcserver

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/idempotency"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/scopecatalog"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	appservice "github.com/nimiplatform/nimi/runtime/internal/services/app"
	auditservice "github.com/nimiplatform/nimi/runtime/internal/services/audit"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	grantservice "github.com/nimiplatform/nimi/runtime/internal/services/grant"
	knowledgeservice "github.com/nimiplatform/nimi/runtime/internal/services/knowledge"
	localruntimeservice "github.com/nimiplatform/nimi/runtime/internal/services/localruntime"
	modelservice "github.com/nimiplatform/nimi/runtime/internal/services/model"
	workflowservice "github.com/nimiplatform/nimi/runtime/internal/services/workflow"
	"github.com/nimiplatform/nimi/runtime/internal/workerproxy"
	"github.com/nimiplatform/nimi/runtime/internal/workers"
	"google.golang.org/grpc"
	grpcHealth "google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

// Server wraps the gRPC serving stack for the runtime daemon.
type Server struct {
	addr         string
	state        *health.State
	logger       *slog.Logger
	grpcServer   *grpc.Server
	healthServer *grpcHealth.Server
	aiHealth     *providerhealth.Tracker
	auditStore   *auditlog.Store
	workerPool   *workerproxy.ConnPool
}

func New(cfg config.Config, state *health.State, logger *slog.Logger) *Server {
	addr := cfg.GRPCAddr
	auditStore := auditlog.New(20_000, 50_000)
	idempotencyStore := idempotency.New(24 * time.Hour)
	appRegistry := appregistry.New()
	scopeCatalog := scopecatalog.New(func(operation string, version string, code runtimev1.ReasonCode) {
		appendAuditEvent(auditStore, auditEventInput{
			Domain:              "runtime.scope",
			Operation:           operation,
			ReasonCode:          code,
			ScopeCatalogVersion: version,
			CallerKind:          runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
			CallerID:            "scope-catalog",
		})
	})
	registryPath := modelregistry.ResolvePersistencePath()
	modelRegistry, err := modelregistry.NewFromFile(registryPath)
	if err != nil {
		logger.Warn("load model registry failed; fallback to empty registry", "path", registryPath, "error", err)
		modelRegistry = modelregistry.New()
	}
	if registryPath != "" {
		logger.Info("model registry persistence enabled", "path", registryPath)
	}
	aiHealth := providerhealth.New()

	h := grpcHealth.NewServer()
	grantSvc := grantservice.NewWithDependencies(logger, appRegistry, scopeCatalog)
	g := grpc.NewServer(
		grpc.ChainUnaryInterceptor(
			newUnaryLifecycleInterceptor(state),
			newUnaryProtocolInterceptor(idempotencyStore),
			newUnaryAuthzInterceptor(grantSvc),
			newUnaryAuditInterceptor(auditStore),
		),
		grpc.ChainStreamInterceptor(
			newStreamLifecycleInterceptor(state),
			newStreamProtocolInterceptor(),
			newStreamAuthzInterceptor(grantSvc),
			newStreamAuditInterceptor(auditStore),
		),
	)
	healthpb.RegisterHealthServer(g, h)
	runtimev1.RegisterRuntimeAuditServiceServer(g, auditservice.New(state, logger, aiHealth, auditStore))

	var workerPool *workerproxy.ConnPool
	if workers.Enabled() {
		workerPool = workerproxy.NewConnPool(logger)
		runtimev1.RegisterRuntimeAiServiceServer(g, workerproxy.NewAIProxy(workerPool))
		runtimev1.RegisterRuntimeWorkflowServiceServer(g, workerproxy.NewWorkflowProxy(workerPool))
		runtimev1.RegisterRuntimeModelServiceServer(g, workerproxy.NewModelProxy(workerPool))
		runtimev1.RegisterRuntimeLocalRuntimeServiceServer(g, workerproxy.NewLocalRuntimeProxy(workerPool))
		logger.Info("runtime worker proxy mode enabled")
	} else {
		aiSvc := aiservice.NewWithDependencies(logger, modelRegistry, aiHealth, auditStore)
		aiSvc.SetModelRegistryPersistencePath(registryPath)
		runtimev1.RegisterRuntimeAiServiceServer(g, aiSvc)
		runtimev1.RegisterRuntimeWorkflowServiceServer(g, workflowservice.New(logger))
		modelSvc := modelservice.New(logger, modelRegistry)
		modelSvc.SetPersistencePath(registryPath)
		runtimev1.RegisterRuntimeModelServiceServer(g, modelSvc)
		runtimev1.RegisterRuntimeLocalRuntimeServiceServer(g, localruntimeservice.New(logger, auditStore, cfg.LocalRuntimeStatePath))
		logger.Info("runtime in-process mode enabled")
	}

	runtimev1.RegisterRuntimeGrantServiceServer(g, grantSvc)
	runtimev1.RegisterRuntimeAuthServiceServer(g, authservice.NewWithRegistry(logger, appRegistry))
	runtimev1.RegisterRuntimeKnowledgeServiceServer(g, knowledgeservice.New(logger))
	runtimev1.RegisterRuntimeAppServiceServer(g, appservice.New(logger))

	s := &Server{
		addr:         addr,
		state:        state,
		logger:       logger,
		grpcServer:   g,
		healthServer: h,
		aiHealth:     aiHealth,
		auditStore:   auditStore,
		workerPool:   workerPool,
	}
	s.SyncServingState()
	return s
}

func (s *Server) AIHealthTracker() *providerhealth.Tracker {
	return s.aiHealth
}

func (s *Server) AuditStore() *auditlog.Store {
	return s.auditStore
}

func (s *Server) Serve() error {
	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("listen grpc %s: %w", s.addr, err)
	}

	s.logger.Info("grpc server listening", "addr", s.addr)
	if err := s.grpcServer.Serve(listener); err != nil {
		return fmt.Errorf("serve grpc: %w", err)
	}
	return nil
}

func (s *Server) Stop(ctx context.Context) error {
	done := make(chan struct{})
	go func() {
		s.grpcServer.GracefulStop()
		close(done)
	}()

	select {
	case <-done:
		if s.workerPool != nil {
			if err := s.workerPool.Close(); err != nil {
				return err
			}
		}
		return nil
	case <-ctx.Done():
		s.grpcServer.Stop()
		if s.workerPool != nil {
			_ = s.workerPool.Close()
		}
		return ctx.Err()
	}
}

// SyncServingState maps runtime health status to grpc health checks.
func (s *Server) SyncServingState() {
	snapshot := s.state.Snapshot()
	servingStatus := healthpb.HealthCheckResponse_NOT_SERVING
	if snapshot.Status.Ready() {
		servingStatus = healthpb.HealthCheckResponse_SERVING
	}

	s.healthServer.SetServingStatus("", servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAuditService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAiService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeWorkflowService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeModelService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeLocalRuntimeService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeGrantService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAuthService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeKnowledgeService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAppService_ServiceDesc.ServiceName, servingStatus)
}
