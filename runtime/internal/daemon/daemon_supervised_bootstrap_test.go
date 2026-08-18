package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/health"
)

func TestAppendEngineCrashAuditIncludesStructuredFields(t *testing.T) {
	store := auditlog.New(32, 32)
	appendEngineCrashAudit(store, "llama", "crash=exit status 7 attempt=2/5 restarting", nil, "execution_failure")

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{
		Domain: "runtime.engine",
	})
	if len(events.GetEvents()) != 1 {
		t.Fatalf("expected 1 runtime.engine event, got %d", len(events.GetEvents()))
	}
	record := events.GetEvents()[0]
	if record.GetOperation() != "engine.unhealthy" {
		t.Fatalf("unexpected operation: %s", record.GetOperation())
	}
	if record.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("unexpected reason code: %v", record.GetReasonCode())
	}
	payload := record.GetPayload().GetFields()
	if payload["engine"].GetStringValue() != "llama" {
		t.Fatalf("unexpected engine: %q", payload["engine"].GetStringValue())
	}
	if payload["detail"].GetStringValue() != "crash=exit status 7 attempt=2/5 restarting" {
		t.Fatalf("unexpected detail: %q", payload["detail"].GetStringValue())
	}
	if payload["attempt"].GetNumberValue() != 2 {
		t.Fatalf("unexpected attempt: %v", payload["attempt"].GetNumberValue())
	}
	if payload["max_attempt"].GetNumberValue() != 5 {
		t.Fatalf("unexpected max_attempt: %v", payload["max_attempt"].GetNumberValue())
	}
	if payload["exit_code"].GetNumberValue() != 7 {
		t.Fatalf("unexpected exit_code: %v", payload["exit_code"].GetNumberValue())
	}
}

func writeEngineRegistryEntry(t *testing.T, environmentsRoot string, engineName string, version string) {
	t.Helper()
	binaryPath := filepath.Join(environmentsRoot, engineName, version, "test-engine-binary")
	if err := os.MkdirAll(filepath.Dir(binaryPath), 0o755); err != nil {
		t.Fatalf("create engine binary dir: %v", err)
	}
	if err := os.WriteFile(binaryPath, []byte("engine-binary"), 0o755); err != nil {
		t.Fatalf("write engine binary: %v", err)
	}
	registryRaw, err := json.Marshal([]map[string]any{{
		"engine":       engineName,
		"version":      version,
		"binary_path":  binaryPath,
		"sha256":       "test-sha256",
		"platform":     "test",
		"installed_at": time.Now().UTC().Format(time.RFC3339),
	}})
	if err != nil {
		t.Fatalf("marshal engine registry: %v", err)
	}
	if err := os.MkdirAll(environmentsRoot, 0o755); err != nil {
		t.Fatalf("create environments root: %v", err)
	}
	if err := os.WriteFile(filepath.Join(environmentsRoot, "registry.json"), registryRaw, 0o600); err != nil {
		t.Fatalf("write engine registry: %v", err)
	}
}

func TestStartSupervisedEnginesNeverBootstrapsLlama(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	homeDir := t.TempDir()
	setDaemonTestHome(t, homeDir)
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		LocalStatePath:       filepath.Join(homeDir, ".nimi", "runtime", "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   true,
		EngineLlamaPort:      1234,
		EngineLlamaVersion:   "b8575",
	}
	daemon, err := newDaemonForTest(t, cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	store := auditlog.New(64, 64)
	daemon.auditStore = store
	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return &engine.Manager{}, nil
	}
	calls := make([]engine.EngineKind, 0, 1)
	var callsMu sync.Mutex
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		callsMu.Lock()
		calls = append(calls, kind)
		callsMu.Unlock()
		return errors.New("mock bootstrap failure")
	}

	daemon.startSupervisedEngines(context.Background())

	if len(calls) != 0 {
		t.Fatalf("daemon startup must not bootstrap the private llama worker, got=%v", calls)
	}
	snapshot := daemon.state.Snapshot()
	if snapshot.Status == health.StatusDegraded {
		t.Fatalf("deferring empty managed llama bootstrap must not degrade Runtime core readiness: %s", snapshot.Reason)
	}
}

func TestStartSupervisedEnginesInjectsManagerWithoutBootstrappingWhenNoManagedEnginesEnabled(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "http://127.0.0.1:2234/v1")

	cfg := config.Config{
		GRPCAddr:            "127.0.0.1:0",
		HTTPAddr:            "127.0.0.1:0",
		LocalStatePath:      filepath.Join(t.TempDir(), "local-state.json"),
		IdempotencyCapacity: 32,
	}
	daemon, err := newDaemonForTest(t, cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}

	managerCreated := false
	startCalls := 0
	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		managerCreated = true
		return engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), engine.ManagedRoots{Environments: t.TempDir(), Dependencies: t.TempDir()}, nil)
	}
	daemon.startEngineFn = func(_ context.Context, _ engine.EngineKind, _ string, _ int, _ string) error {
		startCalls++
		return nil
	}

	daemon.startSupervisedEngines(context.Background())

	if !managerCreated {
		t.Fatalf("expected engine manager creation for local environment materializers")
	}
	if startCalls != 0 {
		t.Fatalf("did not expect supervised bootstrap calls, got %d", startCalls)
	}
	if daemon.engineMgr == nil {
		t.Fatalf("expected daemon engine manager to be available for materializers")
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status == health.StatusDegraded {
		t.Fatalf("did not expect degraded state when only supervised bootstrap is skipped: %s", snapshot.Reason)
	}
}

func TestStartSupervisedEnginesFailsClosedForUnsupportedSidecar(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineSidecarEnabled: true,
		EngineSidecarPort:    9331,
		EngineSidecarVersion: "test",
	}
	daemon, err := newDaemonForTest(t, cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.auditStore = auditlog.New(32, 32)
	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return &engine.Manager{}, nil
	}

	daemon.startSupervisedEngines(context.Background())

	snapshot := daemon.state.Snapshot()
	if snapshot.Status != health.StatusDegraded {
		t.Fatalf("expected degraded state, got=%s (%s)", snapshot.Status, snapshot.Reason)
	}
	if !strings.Contains(snapshot.Reason, "sidecar: engine sidecar is not yet supported for supervised lifecycle") {
		t.Fatalf("unexpected degraded reason: %s", snapshot.Reason)
	}

	events := mustListAuditEvents(t, daemon.auditStore, &runtimev1.ListAuditEventsRequest{Domain: "runtime.engine"}).GetEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 runtime.engine event, got=%d", len(events))
	}
	record := events[0]
	if record.GetOperation() != "engine.bootstrap_failed" {
		t.Fatalf("unexpected operation: %s", record.GetOperation())
	}
	if got := record.GetPayload().GetFields()["provider"].GetStringValue(); got != "local-sidecar" {
		t.Fatalf("unexpected provider payload: %q", got)
	}
}

func TestRuntimeSetenvRejectsInvalidKeys(t *testing.T) {
	if err := runtimeSetenv("invalid=key", "value"); err == nil {
		t.Fatal("expected invalid env key to fail")
	}
}
