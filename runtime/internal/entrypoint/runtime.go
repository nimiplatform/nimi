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
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func RunDaemonFromArgs(program string, args []string, version ...string) error {
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
	localModelsPath := fs.String("local-models-path", baseCfg.LocalModelsPath, "local models root path")
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
	cfg.LocalModelsPath = *localModelsPath
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

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		stop() // restore default signal behavior: second Ctrl+C kills the process immediately
	}()

	d, err := daemon.New(cfg, logger, runtimeVersion)
	if err != nil {
		return err
	}
	return d.Run(ctx)
}

func acquireRuntimeInstanceLock() (func(), error) {
	lockPath, err := runtimeInstanceLockPath()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		return nil, fmt.Errorf("create runtime lock directory: %w", err)
	}
	for {
		lockFile, openErr := os.OpenFile(lockPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if openErr == nil {
			if _, err := lockFile.WriteString(strconv.Itoa(os.Getpid())); err != nil {
				_ = lockFile.Close()
				_ = os.Remove(lockPath)
				return nil, fmt.Errorf("write runtime instance lock: %w", err)
			}
			return func() {
				_ = lockFile.Close()
				_ = os.Remove(lockPath)
			}, nil
		}
		if !errors.Is(openErr, os.ErrExist) {
			return nil, fmt.Errorf("acquire runtime instance lock: %w", openErr)
		}
		stale, staleErr := runtimeLockIsStale(lockPath)
		if staleErr != nil {
			return nil, staleErr
		}
		if !stale {
			return nil, fmt.Errorf("runtime instance lock already held: %s", lockPath)
		}
		if err := os.Remove(lockPath); err != nil && !os.IsNotExist(err) {
			return nil, fmt.Errorf("remove stale runtime lock: %w", err)
		}
	}
}

func runtimeLockIsStale(lockPath string) (bool, error) {
	content, err := os.ReadFile(lockPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("read runtime instance lock: %w", err)
	}
	pidText := strings.TrimSpace(string(content))
	if pidText == "" {
		return true, nil
	}
	pid, err := strconv.Atoi(pidText)
	if err != nil {
		return false, fmt.Errorf("parse runtime instance lock pid: %w", err)
	}
	return !runtimeProcessAlive(pid), nil
}

func runtimeInstanceLockPath() (string, error) {
	if override := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCK_PATH")); override != "" {
		return override, nil
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve user home for runtime lock: %w", err)
	}
	return filepath.Join(homeDir, ".nimi", "runtime", "runtime.lock"), nil
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
	defer resp.Body.Close()

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
	AccessTokenID              string
	AccessTokenSecret          string
	SessionID                  string
	SessionToken               string
}

const (
	cliCallerKind = "third-party-service"
	cliCallerID   = "nimi-cli"
	cliSurfaceID  = "runtime-cli"
)

// FetchAIProviderHealthGRPC requests provider health snapshots from RuntimeAuditService.
