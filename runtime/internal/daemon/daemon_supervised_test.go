package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
	"unsafe"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
)

func newTestDaemon(t *testing.T, logger *slog.Logger) *Daemon {
	t.Helper()
	daemon, err := New(config.Config{
		GRPCAddr:            "127.0.0.1:0",
		HTTPAddr:            "127.0.0.1:0",
		LocalStatePath:      filepath.Join(t.TempDir(), "local-state.json"),
		IdempotencyCapacity: 32,
	}, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	return daemon
}

func setDaemonTestHome(t *testing.T, homeDir string) {
	t.Helper()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	volume := filepath.VolumeName(homeDir)
	if volume == "" {
		volume = "C:"
	}
	homePath := strings.TrimPrefix(homeDir, volume)
	if homePath == "" {
		homePath = string(os.PathSeparator)
	}
	t.Setenv("HOMEDRIVE", volume)
	t.Setenv("HOMEPATH", homePath)
}

func setUnexportedField[T any](t *testing.T, target any, fieldName string, value T) {
	t.Helper()
	field := reflect.ValueOf(target).Elem().FieldByName(fieldName)
	if !field.IsValid() {
		t.Fatalf("field %s not found", fieldName)
	}
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(value))
}

func getUnexportedStringField(t *testing.T, target any, fieldName string) string {
	t.Helper()
	field := reflect.ValueOf(target).Elem().FieldByName(fieldName)
	if !field.IsValid() {
		t.Fatalf("field %s not found", fieldName)
	}
	return reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().String()
}

func newHealthyEngineManager(t *testing.T, kind engine.EngineKind, port int) *engine.Manager {
	t.Helper()
	manager, err := engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir(), nil)
	if err != nil {
		t.Fatalf("create engine manager: %v", err)
	}
	supervisor := engine.NewSupervisor(engine.EngineConfig{Kind: kind, Port: port}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	setUnexportedField(t, supervisor, "status", engine.StatusHealthy)
	setUnexportedField(t, supervisor, "lastHealthyAt", time.Now())
	setUnexportedField(t, manager, "supervisors", map[engine.EngineKind]*engine.Supervisor{
		kind: supervisor,
	})
	return manager
}

func TestOnEngineStateChangeHealthyDoesNotReinjectAfterCleanBootstrap(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	daemon := newTestDaemon(t, logger)
	daemon.engineMgr = newHealthyEngineManager(t, engine.EngineLlama, 1234)

	daemon.injectEngineEndpointEnv(engine.EngineLlama, "NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "bootstrap")
	daemon.onEngineStateChange("llama", "healthy", "ready")

	logs := logBuf.String()
	if count := strings.Count(logs, "msg=\"engine endpoint env injected\""); count != 1 {
		t.Fatalf("expected exactly one endpoint injection log on clean boot, got %d logs:\n%s", count, logs)
	}
	if !strings.Contains(logs, "source=bootstrap") {
		t.Fatalf("expected bootstrap injection log, got:\n%s", logs)
	}
	if strings.Contains(logs, "source=recovered") {
		t.Fatalf("did not expect recovered injection on clean boot, got:\n%s", logs)
	}
}

func TestOnEngineStateChangeHealthyReinjectsOnlyForSameEngineRecovery(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	daemon := newTestDaemon(t, logger)
	daemon.engineMgr = newHealthyEngineManager(t, engine.EngineLlama, 1234)
	daemon.state.SetStatus(health.StatusDegraded, "engine:llama unhealthy (probe failed)")
	daemon.setProviderFailureHint("local", "engine unhealthy (llama: probe failed)")

	daemon.onEngineStateChange("llama", "healthy", "probe recovered")

	logs := logBuf.String()
	if count := strings.Count(logs, "msg=\"engine endpoint env injected\""); count != 1 {
		t.Fatalf("expected one recovered injection log, got %d logs:\n%s", count, logs)
	}
	if !strings.Contains(logs, "source=recovered") {
		t.Fatalf("expected recovered injection log, got:\n%s", logs)
	}
	if got := daemon.state.Snapshot().Status; got != health.StatusReady {
		t.Fatalf("expected daemon to recover to ready, got %s", got)
	}
	if hint := daemon.providerFailureHint("local"); hint != "" {
		t.Fatalf("expected local provider failure hint to clear on same-engine recovery, got %q", hint)
	}
}

func TestOnEngineStateChangeHealthyDoesNotRecoverDifferentEngineFailure(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	daemon := newTestDaemon(t, logger)
	daemon.engineMgr = newHealthyEngineManager(t, engine.EngineLlama, 1234)
	daemon.state.SetStatus(health.StatusDegraded, "engine:media unhealthy (probe failed)")
	daemon.setProviderFailureHint("local", "keep-local-hint")

	daemon.onEngineStateChange("llama", "healthy", "ready")

	logs := logBuf.String()
	if strings.Contains(logs, "msg=\"engine endpoint env injected\"") {
		t.Fatalf("did not expect endpoint reinjection while another engine is degraded, got:\n%s", logs)
	}
	snapshot := daemon.state.Snapshot()
	if snapshot.Status != health.StatusDegraded || snapshot.Reason != "engine:media unhealthy (probe failed)" {
		t.Fatalf("expected unrelated degraded state to remain untouched, got %s (%s)", snapshot.Status, snapshot.Reason)
	}
	if hint := daemon.providerFailureHint("local"); hint != "keep-local-hint" {
		t.Fatalf("expected local provider hint to remain untouched, got %q", hint)
	}
}

func TestStartSupervisedEnginesManagerInitFailureDegradesAndAudits(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   true,
		EngineLlamaPort:      1234,
		EngineLlamaVersion:   "3.12.1",
	}
	daemon, err := New(cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	store := auditlog.New(32, 32)
	daemon.auditStore = store

	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return nil, errors.New("engine manager unavailable")
	}

	daemon.startSupervisedEngines(context.Background())

	snapshot := daemon.state.Snapshot()
	if snapshot.Status != health.StatusDegraded {
		t.Fatalf("expected degraded state when engine manager init fails, got %s (%s)", snapshot.Status, snapshot.Reason)
	}
	if !strings.Contains(snapshot.Reason, "engine manager init failed") {
		t.Fatalf("unexpected degraded reason: %s", snapshot.Reason)
	}

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{
		Domain: "runtime.lifecycle",
	})
	startupFailures := make([]*runtimev1.AuditEventRecord, 0, len(events.GetEvents()))
	for _, event := range events.GetEvents() {
		if event.GetOperation() == "startup.failed" {
			startupFailures = append(startupFailures, event)
		}
	}
	if len(startupFailures) != 1 {
		t.Fatalf("expected 1 startup failure audit event, got %d", len(startupFailures))
	}
	if startupFailures[0].GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("unexpected startup failure reason code: %v", startupFailures[0].GetReasonCode())
	}
}

func TestStartSupervisedEnginesDoesNotExposeManagedMediaLoopbackOnAttachedOnlyHost(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineMediaEnabled:   true,
		EngineMediaPort:      8321,
		EngineMediaVersion:   "0.1.0",
	}
	daemon, err := New(cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}

	originalDetect := detectMediaHostSupport
	detectMediaHostSupport = func() (engine.MediaHostSupport, string) {
		return engine.MediaHostSupportAttachedOnly, "attached only"
	}
	t.Cleanup(func() {
		detectMediaHostSupport = originalDetect
	})

	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir(), nil)
	}

	startCalls := make([]engine.EngineKind, 0, 1)
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		startCalls = append(startCalls, kind)
		return nil
	}

	daemon.startSupervisedEngines(context.Background())
	if daemon.engineMgr == nil {
		t.Fatal("expected engine manager to initialize when only media is enabled")
	}
	if !slices.Equal(startCalls, []engine.EngineKind{engine.EngineMedia}) {
		t.Fatalf("expected attached-only host to still bootstrap media engine, got=%v", startCalls)
	}

	if svc := daemon.grpc.LocalService(); svc != nil {
		if managedEndpoint := getUnexportedStringField(t, svc, "managedMediaEndpointValue"); managedEndpoint != "" {
			t.Fatalf("managed media endpoint should stay empty on attached-only host, got %q", managedEndpoint)
		}
	}
}

func TestStartSupervisedEnginesExposesManagedMediaLoopbackOnSupportedHost(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineMediaEnabled:   true,
		EngineMediaPort:      8321,
		EngineMediaVersion:   "0.1.0",
	}
	daemon, err := New(cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}

	originalDetect := detectMediaHostSupport
	detectMediaHostSupport = func() (engine.MediaHostSupport, string) {
		return engine.MediaHostSupportSupportedSupervised, "supported"
	}
	t.Cleanup(func() {
		detectMediaHostSupport = originalDetect
	})

	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir(), nil)
	}

	startCalls := make([]engine.EngineKind, 0, 1)
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		startCalls = append(startCalls, kind)
		return nil
	}

	daemon.startSupervisedEngines(context.Background())
	if !slices.Equal(startCalls, []engine.EngineKind{engine.EngineMedia}) {
		t.Fatalf("expected supported host to bootstrap media engine, got=%v", startCalls)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		if managedEndpoint := getUnexportedStringField(t, svc, "managedMediaEndpointValue"); managedEndpoint != "http://127.0.0.1:8321/v1" {
			t.Fatalf("expected managed media endpoint to be exposed on supported host, got %q", managedEndpoint)
		}
	}
}

func TestAppendEngineCrashAuditIncludesStructuredFields(t *testing.T) {
	store := auditlog.New(32, 32)
	appendEngineCrashAudit(store, "llama", "crash=exit status 7 attempt=2/5 restarting")

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

func TestStartSupervisedEnginesAutoManagedLlamaEntersLocalBootstrapBranch(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		GRPCAddr:               "127.0.0.1:0",
		HTTPAddr:               "127.0.0.1:0",
		LocalStatePath:         filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:    64,
		UsageStatsBufferSize:   64,
		IdempotencyCapacity:    32,
		EngineLlamaEnabled:     true,
		EngineLlamaAutoManaged: true,
		EngineLlamaPort:        1234,
		EngineLlamaVersion:     "3.12.1",
	}
	daemon, err := New(cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	store := auditlog.New(64, 64)
	daemon.auditStore = store
	daemon.aiHealth = providerhealth.New()
	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return &engine.Manager{}, nil
	}
	calls := make([]engine.EngineKind, 0, 1)
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		calls = append(calls, kind)
		return errors.New("mock bootstrap failure")
	}

	daemon.startSupervisedEngines(context.Background())

	if !slices.Equal(calls, []engine.EngineKind{engine.EngineLlama}) {
		t.Fatalf("expected llama bootstrap call, got=%v", calls)
	}
	snapshot := daemon.state.Snapshot()
	if snapshot.Status != health.StatusDegraded {
		t.Fatalf("expected degraded on bootstrap failure, got=%s (%s)", snapshot.Status, snapshot.Reason)
	}
	if !strings.Contains(snapshot.Reason, "engine bootstrap failed (llama: mock bootstrap failure)") {
		t.Fatalf("unexpected degraded reason: %s", snapshot.Reason)
	}

	localProvider := daemon.aiHealth.SnapshotOf("local")
	if localProvider.State != providerhealth.StateUnhealthy {
		t.Fatalf("expected local provider unhealthy after bootstrap failure, got=%s", localProvider.State)
	}
	if !strings.Contains(localProvider.LastReason, "engine bootstrap failed (llama: mock bootstrap failure)") {
		t.Fatalf("unexpected local provider reason: %s", localProvider.LastReason)
	}

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.engine"}).GetEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 runtime.engine event, got=%d", len(events))
	}
	record := events[0]
	if record.GetOperation() != "engine.bootstrap_failed" {
		t.Fatalf("unexpected operation: %s", record.GetOperation())
	}
	payload := record.GetPayload().GetFields()
	if payload["engine"].GetStringValue() != "llama" {
		t.Fatalf("unexpected engine payload: %q", payload["engine"].GetStringValue())
	}
	if payload["provider"].GetStringValue() != "local" {
		t.Fatalf("unexpected provider payload: %q", payload["provider"].GetStringValue())
	}
	if payload["detail"].GetStringValue() != "mock bootstrap failure" {
		t.Fatalf("unexpected detail payload: %q", payload["detail"].GetStringValue())
	}
}

func TestStartSupervisedEnginesSkipsBootstrapWhenNoManagedEnginesEnabled(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "http://127.0.0.1:2234/v1")

	cfg := config.Config{
		GRPCAddr:            "127.0.0.1:0",
		HTTPAddr:            "127.0.0.1:0",
		LocalStatePath:      filepath.Join(t.TempDir(), "local-state.json"),
		IdempotencyCapacity: 32,
	}
	daemon, err := New(cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}

	managerCreated := false
	startCalls := 0
	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		managerCreated = true
		return &engine.Manager{}, nil
	}
	daemon.startEngineFn = func(_ context.Context, _ engine.EngineKind, _ string, _ int, _ string) error {
		startCalls++
		return nil
	}

	daemon.startSupervisedEngines(context.Background())

	if managerCreated {
		t.Fatalf("did not expect engine manager creation when supervised engines are disabled")
	}
	if startCalls != 0 {
		t.Fatalf("did not expect supervised bootstrap calls, got %d", startCalls)
	}
	if daemon.engineMgr != nil {
		t.Fatalf("expected daemon engine manager to stay nil when supervised engines are disabled")
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status == health.StatusDegraded {
		t.Fatalf("did not expect degraded state when supervised bootstrap is skipped: %s", snapshot.Reason)
	}
}

func TestStartSupervisedEnginesSkipsManagedLlamaBootstrapWhenAssetSyncFails(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	homeDir := t.TempDir()
	setDaemonTestHome(t, homeDir)
	if err := os.WriteFile(filepath.Join(homeDir, ".nimi"), []byte("blocked"), 0o644); err != nil {
		t.Fatalf("seed blocked home path: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_MODEL_REGISTRY_PATH", filepath.Join(t.TempDir(), "model-registry.json"))

	localModelsPath := filepath.Join(t.TempDir(), "models")
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "model_bootstrap_sync_fail"
	now := time.Now().UTC().Format(time.RFC3339)
	stateRaw, err := json.Marshal(map[string]any{
		"schemaVersion": 1,
		"savedAt":       now,
		"models": []map[string]any{
			{
				"localModelId":      localModelID,
				"modelId":           "local/bootstrap-sync-fail",
				"capabilities":      []string{"chat"},
				"engine":            "llama",
				"entry":             "./weights/model.gguf",
				"license":           "unknown",
				"sourceRepo":        "",
				"sourceRevision":    "main",
				"hashes":            map[string]string{},
				"endpoint":          "",
				"status":            int32(runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED),
				"installedAt":       now,
				"updatedAt":         now,
				"engineRuntimeMode": int32(runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED),
			},
		},
		"artifacts": []map[string]any{},
		"services":  []map[string]any{},
		"audits":    []map[string]any{},
	})
	if err != nil {
		t.Fatalf("marshal local state: %v", err)
	}
	if err := os.WriteFile(localStatePath, stateRaw, 0o600); err != nil {
		t.Fatalf("write local state: %v", err)
	}
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		LocalStatePath:       localStatePath,
		LocalModelsPath:      localModelsPath,
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   true,
		EngineLlamaPort:      1234,
		EngineLlamaVersion:   "3.12.1",
	}
	daemon, err := New(cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	svc := daemon.grpc.LocalService()
	if svc == nil {
		t.Fatalf("expected local service")
	}
	t.Cleanup(func() { svc.Close() })

	manifestModelID := "local/bootstrap-sync-fail"
	manifestEntry := "./weights/model.gguf"
	modelSlug := "local-bootstrap-sync-fail"
	entryPath := filepath.Join(localModelsPath, modelSlug, "weights", "model.gguf")
	if err := os.MkdirAll(filepath.Dir(entryPath), 0o755); err != nil {
		t.Fatalf("create entry dir: %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("test-model"), 0o644); err != nil {
		t.Fatalf("write entry file: %v", err)
	}
	manifestPath := filepath.Join(localModelsPath, "resolved", "nimi", modelSlug, "manifest.json")
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	manifestRaw, err := json.Marshal(map[string]any{
		"model_id":         manifestModelID,
		"logical_model_id": "nimi/" + modelSlug,
		"entry":            manifestEntry,
		"engine":           "llama",
		"capabilities":     []string{"chat"},
		"files":            []string{"weights/model.gguf"},
		"hashes":           map[string]string{"sha256": "deadbeef"},
		"source":           map[string]string{"repo": "test/repo", "revision": "main"},
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, manifestRaw, 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	store := auditlog.New(64, 64)
	daemon.auditStore = store
	daemon.aiHealth = providerhealth.New()
	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return &engine.Manager{}, nil
	}
	calls := make([]engine.EngineKind, 0, 1)
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		calls = append(calls, kind)
		return nil
	}

	daemon.startSupervisedEngines(context.Background())

	if len(calls) != 0 {
		t.Fatalf("expected llama bootstrap to be skipped after asset sync failure, got calls=%v", calls)
	}
	snapshot := daemon.state.Snapshot()
	if snapshot.Status != health.StatusDegraded {
		t.Fatalf("expected degraded on llama asset sync failure, got=%s (%s)", snapshot.Status, snapshot.Reason)
	}
	if !strings.Contains(snapshot.Reason, "sync managed llama assets") {
		t.Fatalf("unexpected degraded reason: %s", snapshot.Reason)
	}

	localProvider := daemon.aiHealth.SnapshotOf("local")
	if localProvider.State != providerhealth.StateUnhealthy {
		t.Fatalf("expected local provider unhealthy after asset sync failure, got=%s", localProvider.State)
	}
	if !strings.Contains(localProvider.LastReason, "sync managed llama assets") {
		t.Fatalf("unexpected local provider reason: %s", localProvider.LastReason)
	}

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.engine"}).GetEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 runtime.engine event, got=%d", len(events))
	}
	record := events[0]
	if record.GetOperation() != "engine.bootstrap_failed" {
		t.Fatalf("unexpected operation: %s", record.GetOperation())
	}
	if !strings.Contains(record.GetPayload().GetFields()["detail"].GetStringValue(), "sync managed llama assets") {
		t.Fatalf("unexpected bootstrap failure detail: %q", record.GetPayload().GetFields()["detail"].GetStringValue())
	}
}
