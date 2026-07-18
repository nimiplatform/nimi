package entrypoint

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/daemon"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeinstance"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// RunProductionDaemonFromArgs never promotes argv, environment, or user-writable
// configuration into production startup authority. The platform-specific
// bootstrap accepts only its fixed OS service definition.
func RunProductionDaemonFromArgs(_ string, args []string, version ...string) error {
	if len(args) != 0 {
		return fmt.Errorf(
			"%s: production Runtime startup does not accept argv controls",
			protectedlocal.ReasonProtectedLocalRuntimePrincipalRequired,
		)
	}
	runtimeVersion := "0.0.0-dev"
	if len(version) > 0 && strings.TrimSpace(version[0]) != "" {
		runtimeVersion = strings.TrimSpace(version[0])
	}
	return runProductionDaemon(runtimeVersion)
}

func runNonProductionDaemonFromArgs(program string, args []string, version ...string) error {
	runtimeVersion := "0.0.0-dev"
	if len(version) > 0 && version[0] != "" {
		runtimeVersion = version[0]
	}
	baseCfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet(program, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	grpcAddr := fs.String("grpc-addr", baseCfg.GRPCAddr, "gRPC listen address")
	httpAddr := fs.String("http-addr", baseCfg.HTTPAddr, "HTTP listen address")
	shutdownTimeoutRaw := fs.String("shutdown-timeout", baseCfg.ShutdownTimeout.String(), "graceful shutdown timeout")
	localStatePath := fs.String("local-state-path", baseCfg.LocalStatePath, "local runtime state persistence path")
	logLevel := fs.String("log-level", baseCfg.LogLevel, "log level (debug, info, warn, error)")

	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("parse flags: %w", err)
	}

	shutdownTimeout, err := time.ParseDuration(*shutdownTimeoutRaw)
	if err != nil {
		return fmt.Errorf("parse shutdown-timeout: %w", err)
	}

	// Preserve all Config fields from Load(), only override flags that were explicitly set.
	cfg := baseCfg
	cfg.GRPCAddr = *grpcAddr
	cfg.HTTPAddr = *httpAddr
	cfg.ShutdownTimeout = shutdownTimeout
	cfg.LocalStatePath = *localStatePath
	cfg.LogLevel = *logLevel
	if err := cfg.Validate(); err != nil {
		return err
	}
	unlock, err := acquireRuntimeInstanceLock()
	if err != nil {
		return err
	}
	defer unlock()

	slogLevel, err := config.ParseLogLevel(cfg.LogLevel)
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slogLevel}))
	d, err := daemon.New(cfg, logger, runtimeVersion)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	signalCh := make(chan os.Signal, 2)
	signal.Notify(signalCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signalCh)
	go func() {
		signalCount := 0
		for sig := range signalCh {
			signalCount++
			if signalCount == 1 {
				logger.Info("runtime shutdown signal received", "signal", sig.String())
				cancel()
				continue
			}
			logger.Warn("runtime repeated shutdown signal received; forcing supervised engine cleanup", "signal", sig.String())
			d.EmergencyStopSupervisedEngines()
			cancel()
		}
	}()
	return d.Run(ctx)
}

func acquireRuntimeInstanceLock() (func(), error) {
	release, err := runtimeinstance.AcquireLock()
	if err != nil {
		return nil, err
	}
	return func() { _ = release() }, nil
}

func runtimeInstanceLockPath() (string, error) {
	return runtimeinstance.LockPath()
}

// RuntimeInstanceLockPath returns the singleton runtime lock file path.
func RuntimeInstanceLockPath() (string, error) {
	return runtimeInstanceLockPath()
}

// FetchHealth requests runtime health JSON from daemon HTTP endpoint.
func FetchHealth(httpAddr string, timeout time.Duration) (map[string]any, error) {
	if httpAddr == "" {
		return nil, errors.New("http address is required")
	}

	client := &http.Client{Timeout: timeout}
	url := fmt.Sprintf("http://%s/v1/runtime/health", httpAddr)
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("request %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4096))
		if readErr != nil {
			return nil, fmt.Errorf("health endpoint returned HTTP %d and error body could not be read: %w", resp.StatusCode, readErr)
		}
		detail := strings.TrimSpace(string(body))
		if detail == "" {
			detail = http.StatusText(resp.StatusCode)
		}
		return nil, fmt.Errorf("health endpoint returned HTTP %d: %s", resp.StatusCode, detail)
	}

	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode health response: %w", err)
	}

	payload["http_status"] = resp.StatusCode
	return payload, nil
}

// ProviderHealthSnapshot is a transport-neutral view for runtime provider health.
type ProviderHealthSnapshot struct {
	Name                string
	State               string
	Reason              string
	ConsecutiveFailures int32
	LastChangedAt       string
	LastCheckedAt       string
}

// ProviderHealthEvent is a streamed provider health record.
type ProviderHealthEvent struct {
	Sequence uint64
	Snapshot ProviderHealthSnapshot
}

// RuntimeHealthSnapshot is a transport-neutral runtime health record.
type RuntimeHealthSnapshot struct {
	Status              string
	StatusCode          int32
	Reason              string
	QueueDepth          int32
	ActiveWorkflows     int32
	ActiveInferenceJobs int32
	CPUMilli            int64
	MemoryBytes         int64
	VRAMBytes           int64
	SampledAt           string
}

// RuntimeHealthEvent is a streamed runtime health record.
type RuntimeHealthEvent struct {
	Sequence uint64
	Snapshot RuntimeHealthSnapshot
}

// ArtifactResult is a collected view from ArtifactChunk streaming RPCs.
type ArtifactResult struct {
	ArtifactID    string
	MimeType      string
	RouteDecision runtimev1.RoutePolicy
	ModelResolved string
	TraceID       string
	Usage         *runtimev1.UsageStats
	Payload       []byte
}

// AuditExportResult is a collected view from AuditExportChunk streaming RPC.
type AuditExportResult struct {
	ExportID string
	MimeType string
	Payload  []byte
}

// ClientMetadata carries optional call attribution metadata for runtime gRPC.
type ClientMetadata struct {
	ProtocolVersion            string
	ParticipantProtocolVersion string
	ParticipantID              string
	Domain                     string
	IdempotencyKey             string
	CallerKind                 string
	CallerID                   string
	SurfaceID                  string
	TraceID                    string
	CredentialSource           string
	ProviderType               string
	ProviderEndpoint           string
	ProviderAPIKey             string
	SessionID                  string
	SessionToken               string
}

const (
	cliCallerKind = "third-party-service"
	cliCallerID   = "nimi-cli"
	cliSurfaceID  = "runtime-cli"
)

// FetchAIProviderHealthGRPC requests provider health snapshots from RuntimeAuditService.
