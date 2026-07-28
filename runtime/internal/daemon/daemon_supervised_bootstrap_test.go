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
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
)

func TestResolveManagedLlamaModelsConfigPathUsesRuntimeState(t *testing.T) {
	stateRoot := t.TempDir()
	statePath := filepath.Join(stateRoot, "local-state.json")
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", t.TempDir())
	want := filepath.Join(stateRoot, "llama-models.yaml")
	if got := resolveManagedLlamaModelsConfigPath(statePath); got != want {
		t.Fatalf("managed llama config path = %q, want %q", got, want)
	}
	if got := resolveManagedLlamaModelsConfigPath(""); got != "" {
		t.Fatalf("empty Runtime state path must fail closed, got %q", got)
	}
	if got := resolveManagedLlamaModelsConfigPath("relative/local-state.json"); got != "" {
		t.Fatalf("relative Runtime state path must fail closed, got %q", got)
	}
}

func TestStartSupervisedEnginesCachesUnsupportedImageSelectionWithoutBootstrappingMedia(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	stateRaw, err := json.Marshal(map[string]any{
		"schemaVersion": 2,
		"savedAt":       time.Now().UTC().Format(time.RFC3339Nano),
		"assets": []map[string]any{{
			"localAssetId":      "01KNSAFETENSORS0000000001",
			"assetId":           "local/safetensors-native",
			"kind":              int32(runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE),
			"capabilities":      []string{"image"},
			"engine":            "media",
			"entry":             "model.safetensors",
			"status":            1,
			"engineRuntimeMode": 1,
			"logicalModelId":    "nimi/safetensors-native",
			"installedAt":       time.Now().UTC().Format(time.RFC3339Nano),
			"updatedAt":         time.Now().UTC().Format(time.RFC3339Nano),
		}},
		"services":  []map[string]any{},
		"transfers": []map[string]any{},
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
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   false,
		EngineMediaEnabled:   false,
		EngineMediaPort:      8321,
		EngineMediaVersion:   "0.1.0",
	}
	daemon, err := newDaemonForTest(t, cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.detectMediaHostSupportFn = func() (engine.MediaHostSupport, string) {
		return engine.MediaHostSupportAttachedOnly, "attached only"
	}
	daemon.imageBootstrapSelectionFn = func() (engine.ImageSupervisedMatrixSelection, bool) {
		return engine.ImageSupervisedMatrixSelection{
			Matched:             true,
			EntryID:             "linux-x64-nvidia-safetensors-native",
			ProductState:        engine.ImageProductStateUnsupported,
			BackendFamily:       engine.ImageBackendFamilyStableDiffusionGGML,
			BackendClass:        engine.ImageBackendClassNativeBinary,
			ControlPlane:        engine.ImageControlPlaneRuntime,
			ExecutionPlane:      engine.EngineMedia,
			CompatibilityDetail: "defined topology for single-file safetensors image assets consumed by native binary backend; not yet validated on this host tuple",
			Entry: &engine.ImageSupervisedMatrixEntry{
				EntryID:        "linux-x64-nvidia-safetensors-native",
				ProductState:   engine.ImageProductStateUnsupported,
				BackendFamily:  engine.ImageBackendFamilyStableDiffusionGGML,
				BackendClass:   engine.ImageBackendClassNativeBinary,
				ControlPlane:   engine.ImageControlPlaneRuntime,
				ExecutionPlane: engine.EngineMedia,
			},
		}, true
	}
	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), engine.ManagedRoots{Environments: t.TempDir(), Dependencies: t.TempDir()}, nil)
	}

	startCalls := make([]engine.EngineKind, 0, 1)
	var startCallsMu sync.Mutex
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		startCallsMu.Lock()
		startCalls = append(startCalls, kind)
		startCallsMu.Unlock()
		return nil
	}

	daemon.startSupervisedEngines(context.Background())

	if len(startCalls) != 0 {
		t.Fatalf("unsupported safetensors native selection must not bootstrap media engine, got=%v", startCalls)
	}
	if daemon.resolvedImageMatrix == nil {
		t.Fatal("expected unsupported image selection to be cached for attribution")
	}
	if daemon.resolvedImageMatrix.EntryID != "linux-x64-nvidia-safetensors-native" {
		t.Fatalf("unexpected cached image selection: %q", daemon.resolvedImageMatrix.EntryID)
	}
	snapshot := daemon.state.Snapshot()
	if snapshot.Status != health.StatusDegraded {
		t.Fatalf("expected degraded runtime state after unsupported image selection, got %v", snapshot.Status)
	}
	if !strings.Contains(snapshot.Reason, "single-file safetensors image assets") {
		t.Fatalf("expected degraded reason to surface compatibility detail, got %q", snapshot.Reason)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		if managedEndpoint := svc.ManagedMediaEndpoint(); managedEndpoint != "" {
			t.Fatalf("unsupported safetensors native selection must not expose managed media endpoint, got %q", managedEndpoint)
		}
	}
}

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

func writeManagedLlamaBootstrapState(t *testing.T, localStatePath string, localModelsPath string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(localModelsPath, "resolved", "nimi", "local-import-qwen3-4b-q4-k-m"), 0o755); err != nil {
		t.Fatalf("create model dir: %v", err)
	}
	entryPath := filepath.Join(localModelsPath, "resolved", "nimi", "local-import-qwen3-4b-q4-k-m", "Qwen3-4B-Q4_K_M.gguf")
	if err := os.WriteFile(entryPath, []byte("GGUFtest"), 0o644); err != nil {
		t.Fatalf("write model entry: %v", err)
	}
	manifestPath := filepath.Join(localModelsPath, "resolved", "nimi", "local-import-qwen3-4b-q4-k-m", "asset.manifest.json")
	manifestRaw, err := json.Marshal(map[string]any{
		"model_id":         "local-import/Qwen3-4B-Q4_K_M",
		"logical_model_id": "nimi/local-import-qwen3-4b-q4-k-m",
		"engine":           "llama",
		"entry":            "Qwen3-4B-Q4_K_M.gguf",
		"capabilities":     []string{"chat"},
		"integrity_mode":   "local_unverified",
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, manifestRaw, 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	stateRaw, err := json.Marshal(map[string]any{
		"schemaVersion": 2,
		"savedAt":       now,
		"assets": []map[string]any{{
			"localAssetId":      "01KMWJ7Z76YY5QA4QJ35M5ECXM",
			"assetId":           "local/local-import/Qwen3-4B-Q4_K_M",
			"kind":              int32(runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT),
			"capabilities":      []string{"chat"},
			"engine":            "llama",
			"entry":             "Qwen3-4B-Q4_K_M.gguf",
			"sourceRepo":        "file://" + filepath.ToSlash(manifestPath),
			"sourceRevision":    "local",
			"endpoint":          "http://127.0.0.1:1234/v1",
			"status":            1,
			"installedAt":       now,
			"updatedAt":         now,
			"healthDetail":      "managed local model ready (not started)",
			"engineRuntimeMode": 1,
			"logicalModelId":    "nimi/local-import-qwen3-4b-q4-k-m",
		}},
		"services":  []map[string]any{},
		"transfers": []map[string]any{},
		"audits":    []map[string]any{},
	})
	if err != nil {
		t.Fatalf("marshal local state: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(localStatePath), 0o755); err != nil {
		t.Fatalf("create local state dir: %v", err)
	}
	if err := os.WriteFile(localStatePath, stateRaw, 0o600); err != nil {
		t.Fatalf("write local state: %v", err)
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

func TestStartSupervisedEnginesDefersAutoManagedLlamaWithoutRuntimePreset(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	homeDir := t.TempDir()
	setDaemonTestHome(t, homeDir)
	configPath := filepath.Join(homeDir, ".nimi", "runtime", "llama-models.yaml")
	cfg := config.Config{
		GRPCAddr:               "127.0.0.1:0",
		HTTPAddr:               "127.0.0.1:0",
		LocalStatePath:         filepath.Join(homeDir, ".nimi", "runtime", "local-state.json"),
		AuditRingBufferSize:    64,
		UsageStatsBufferSize:   64,
		IdempotencyCapacity:    32,
		EngineLlamaEnabled:     true,
		EngineLlamaAutoManaged: true,
		EngineLlamaPort:        1234,
		EngineLlamaVersion:     "b8575",
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
	daemon.aiHealth = providerhealth.New()
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
		t.Fatalf("empty Runtime state must not bootstrap llama without a generated preset, got=%v", calls)
	}
	snapshot := daemon.state.Snapshot()
	if snapshot.Status == health.StatusDegraded {
		t.Fatalf("deferring empty managed llama bootstrap must not degrade Runtime core readiness: %s", snapshot.Reason)
	}
	if _, err := os.Stat(configPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("empty Runtime state must not leave a generated llama preset, stat err=%v", err)
	}
	if managedEndpoint := daemon.grpc.LocalService().ManagedLlamaEndpoint(); managedEndpoint != "" {
		t.Fatalf("empty Runtime state must not expose managed llama endpoint, got %q", managedEndpoint)
	}
}

func TestStartSupervisedEnginesDefersManagedLlamaWhenEnginePackageMissing(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	homeDir := t.TempDir()
	setDaemonTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "none")
	if err := os.MkdirAll(filepath.Join(homeDir, ".nimi", "runtime"), 0o755); err != nil {
		t.Fatalf("create test runtime dir: %v", err)
	}

	localStatePath := filepath.Join(homeDir, ".nimi", "runtime", "local-state.json")
	localModelsPath := filepath.Join(homeDir, "selected-nimi-data", "models")
	writeManagedLlamaBootstrapState(t, localStatePath, localModelsPath)

	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		LocalStatePath:       localStatePath,
		LocalModelsPath:      localModelsPath,
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   false,
		EngineLlamaPort:      1234,
		EngineLlamaVersion:   "b8575",
	}
	daemon, err := newDaemonForTest(t, cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	svc := daemon.grpc.LocalService()
	if svc == nil {
		t.Fatalf("expected local service")
	}
	t.Cleanup(func() { svc.Close() })
	daemon.auditStore = auditlog.New(64, 64)
	daemon.aiHealth = providerhealth.New()
	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), engine.ManagedRoots{
			Environments: filepath.Join(homeDir, "selected-nimi-data", "environments"),
			Dependencies: filepath.Join(homeDir, "selected-nimi-data", "dependencies"),
		}, nil)
	}
	calls := make([]engine.EngineKind, 0, 1)
	var callsMu sync.Mutex
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		callsMu.Lock()
		calls = append(calls, kind)
		callsMu.Unlock()
		return nil
	}

	daemon.startSupervisedEngines(context.Background())

	if len(calls) != 0 {
		t.Fatalf("missing llama.cpp package must defer daemon bootstrap, got calls=%v", calls)
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status == health.StatusDegraded {
		t.Fatalf("missing first-run engine package must not degrade Runtime core readiness: %s", snapshot.Reason)
	}
	if managedEndpoint := svc.ManagedLlamaEndpoint(); managedEndpoint != "" {
		t.Fatalf("missing first-run engine package must not expose managed llama endpoint, got %q", managedEndpoint)
	}
	configPath := filepath.Join(homeDir, ".nimi", "runtime", "llama-models.yaml")
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("expected managed llama router config to be generated for later setup state: %v", err)
	}
}

func TestStartSupervisedEnginesRegistersManagedLlamaFromStateWithoutBootstrapping(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	homeDir := t.TempDir()
	setDaemonTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "none")
	if err := os.MkdirAll(filepath.Join(homeDir, ".nimi", "runtime"), 0o755); err != nil {
		t.Fatalf("create test runtime dir: %v", err)
	}

	localStatePath := filepath.Join(homeDir, ".nimi", "runtime", "local-state.json")
	localModelsPath := filepath.Join(homeDir, "selected-nimi-data", "models")
	writeManagedLlamaBootstrapState(t, localStatePath, localModelsPath)
	engineRoots := engine.ManagedRoots{
		Environments: filepath.Join(homeDir, "selected-nimi-data", "environments"),
		Dependencies: filepath.Join(homeDir, "selected-nimi-data", "dependencies"),
	}
	writeEngineRegistryEntry(t, engineRoots.Environments, "llama", "b8575")

	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		LocalStatePath:       localStatePath,
		LocalModelsPath:      localModelsPath,
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   false,
		EngineLlamaPort:      1234,
		EngineLlamaVersion:   "b8575",
	}
	daemon, err := newDaemonForTest(t, cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	svc := daemon.grpc.LocalService()
	if svc == nil {
		t.Fatalf("expected local service")
	}
	t.Cleanup(func() { svc.Close() })
	store := auditlog.New(64, 64)
	daemon.auditStore = store
	daemon.aiHealth = providerhealth.New()
	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), engineRoots, nil)
	}
	calls := make([]engine.EngineKind, 0, 1)
	var callsMu sync.Mutex
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		callsMu.Lock()
		calls = append(calls, kind)
		callsMu.Unlock()
		return nil
	}

	daemon.startSupervisedEngines(context.Background())

	if len(calls) != 0 {
		t.Fatalf("managed local state must register llama without daemon bootstrap, got=%v", calls)
	}
	configPath := filepath.Join(homeDir, ".nimi", "runtime", "llama-models.yaml")
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("expected managed llama config to be generated: %v", err)
	}
	if managedEndpoint := svc.ManagedLlamaEndpoint(); managedEndpoint != "" {
		t.Fatalf("managed llama endpoint must stay cold until a lease starts the worker, got %q", managedEndpoint)
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
	if svc := daemon.grpc.LocalService(); svc != nil {
		if _, err := svc.ListEngines(context.Background(), &runtimev1.ListEnginesRequest{}); err != nil {
			t.Fatalf("expected local service engine manager injection: %v", err)
		}
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status == health.StatusDegraded {
		t.Fatalf("did not expect degraded state when only supervised bootstrap is skipped: %s", snapshot.Reason)
	}
}

func TestStartSupervisedEnginesSkipsManagedLlamaBootstrapWhenAssetSyncFails(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	t.Setenv("NIMI_RUNTIME_MODEL_REGISTRY_PATH", filepath.Join(t.TempDir(), "model-registry.json"))

	localModelsPath := filepath.Join(t.TempDir(), "models")
	localStateRoot := t.TempDir()
	localStatePath := filepath.Join(localStateRoot, "local-state.json")
	writeManagedLlamaBootstrapState(t, localStatePath, localModelsPath)
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
		EngineLlamaVersion:   "b8575",
	}
	if err := os.Mkdir(filepath.Join(localStateRoot, "llama-models.yaml"), 0o755); err != nil {
		t.Fatalf("block Runtime state-derived llama config path: %v", err)
	}
	daemon, err := newDaemonForTest(t, cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	svc := daemon.grpc.LocalService()
	if svc == nil {
		t.Fatalf("expected local service")
	}
	t.Cleanup(func() { svc.Close() })

	store := auditlog.New(64, 64)
	daemon.auditStore = store
	daemon.aiHealth = providerhealth.New()
	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return &engine.Manager{}, nil
	}
	calls := make([]engine.EngineKind, 0, 1)
	var callsMu sync.Mutex
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		callsMu.Lock()
		calls = append(calls, kind)
		callsMu.Unlock()
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
	daemon.aiHealth = providerhealth.New()
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

	sidecarProvider := daemon.aiHealth.SnapshotOf("local-sidecar")
	if sidecarProvider.State != providerhealth.StateUnhealthy {
		t.Fatalf("expected local-sidecar unhealthy, got=%s", sidecarProvider.State)
	}
	if !strings.Contains(sidecarProvider.LastReason, "sidecar") {
		t.Fatalf("unexpected sidecar provider reason: %s", sidecarProvider.LastReason)
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
