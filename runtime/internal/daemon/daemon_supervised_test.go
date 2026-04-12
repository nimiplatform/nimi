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
	"slices"
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
	t.Setenv("NIMI_RUNTIME_CONNECTOR_STORE_PATH", filepath.Join(homeDir, ".nimi-connectors"))
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

func newHealthyEngineManager(t *testing.T, kind engine.EngineKind, port int) *engine.Manager {
	t.Helper()
	manager, err := engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir(), nil)
	if err != nil {
		t.Fatalf("create engine manager: %v", err)
	}
	supervisor := engine.NewSupervisor(engine.EngineConfig{Kind: kind, Port: port}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	supervisor.SetStateForTesting(engine.StatusHealthy, time.Now())
	manager.SetSupervisorForTesting(kind, supervisor)
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

func TestOnEngineStateChangeImageFailureHintIncludesMatrixAttribution(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	daemon := newTestDaemon(t, logger)
	store := auditlog.New(32, 32)
	daemon.auditStore = store
	daemon.state.SetStatus(health.StatusReady, "ready")
	daemon.resolvedImageMatrix = &engine.ImageSupervisedMatrixSelection{
		Entry: &engine.ImageSupervisedMatrixEntry{
			EntryID:       "linux-x64-nvidia-safetensors-native",
			BackendFamily: engine.ImageBackendFamilyStableDiffusionGGML,
			BackendClass:  engine.ImageBackendClassNativeBinary,
			ProductState:  engine.ImageProductStateUnsupported,
		},
	}

	daemon.onEngineStateChange("media", "unhealthy", "bootstrap failed")

	hint := daemon.providerFailureHint("local-media")
	if !strings.Contains(hint, "entry_id=linux-x64-nvidia-safetensors-native") {
		t.Fatalf("expected entry_id in provider failure hint, got %q", hint)
	}
	if !strings.Contains(hint, "backend_family=stablediffusion-ggml") {
		t.Fatalf("expected backend_family in provider failure hint, got %q", hint)
	}
	if !strings.Contains(hint, "backend_class=native_binary") {
		t.Fatalf("expected backend_class in provider failure hint, got %q", hint)
	}
	if !strings.Contains(hint, "product_state=unsupported") {
		t.Fatalf("expected product_state in provider failure hint, got %q", hint)
	}
	if !strings.Contains(hint, "internal_reason_key=bootstrap_failure") {
		t.Fatalf("expected internal_reason_key in provider failure hint, got %q", hint)
	}

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.engine"}).GetEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 runtime.engine event, got=%d", len(events))
	}
	payload := events[0].GetPayload().GetFields()
	if payload["entry_id"].GetStringValue() != "linux-x64-nvidia-safetensors-native" {
		t.Fatalf("unexpected entry_id: %q", payload["entry_id"].GetStringValue())
	}
	if payload["backend_family"].GetStringValue() != string(engine.ImageBackendFamilyStableDiffusionGGML) {
		t.Fatalf("unexpected backend_family: %q", payload["backend_family"].GetStringValue())
	}
	if payload["backend_class"].GetStringValue() != string(engine.ImageBackendClassNativeBinary) {
		t.Fatalf("unexpected backend_class: %q", payload["backend_class"].GetStringValue())
	}
	if payload["product_state"].GetStringValue() != string(engine.ImageProductStateUnsupported) {
		t.Fatalf("unexpected product_state: %q", payload["product_state"].GetStringValue())
	}
	if payload["internal_reason_key"].GetStringValue() != "bootstrap_failure" {
		t.Fatalf("unexpected internal_reason_key: %q", payload["internal_reason_key"].GetStringValue())
	}
}

func TestOnEngineStateChangeImageRecoveryAuditIncludesMatrixAttribution(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	daemon := newTestDaemon(t, logger)
	store := auditlog.New(32, 32)
	daemon.auditStore = store
	daemon.engineMgr = newHealthyEngineManager(t, engine.EngineMedia, 8321)
	daemon.state.SetStatus(health.StatusDegraded, "engine:media unhealthy (bootstrap failed)")
	daemon.setProviderFailureHint("local-media", "seed hint")
	daemon.resolvedImageMatrix = &engine.ImageSupervisedMatrixSelection{
		Entry: &engine.ImageSupervisedMatrixEntry{
			EntryID:       "linux-x64-nvidia-safetensors-native",
			BackendFamily: engine.ImageBackendFamilyStableDiffusionGGML,
			BackendClass:  engine.ImageBackendClassNativeBinary,
			ProductState:  engine.ImageProductStateUnsupported,
		},
	}

	daemon.onEngineStateChange("media", "healthy", "recovered")

	if hint := daemon.providerFailureHint("local-media"); hint != "" {
		t.Fatalf("expected local-media provider failure hint to clear, got %q", hint)
	}
	if got := daemon.state.Snapshot().Status; got != health.StatusReady {
		t.Fatalf("expected daemon to recover to ready, got %s", got)
	}

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.engine"}).GetEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 runtime.engine event, got=%d", len(events))
	}
	if events[0].GetOperation() != "engine.repair_resolved" {
		t.Fatalf("unexpected operation: %s", events[0].GetOperation())
	}
	payload := events[0].GetPayload().GetFields()
	if payload["entry_id"].GetStringValue() != "linux-x64-nvidia-safetensors-native" {
		t.Fatalf("unexpected entry_id: %q", payload["entry_id"].GetStringValue())
	}
	if payload["backend_family"].GetStringValue() != string(engine.ImageBackendFamilyStableDiffusionGGML) {
		t.Fatalf("unexpected backend_family: %q", payload["backend_family"].GetStringValue())
	}
	if payload["backend_class"].GetStringValue() != string(engine.ImageBackendClassNativeBinary) {
		t.Fatalf("unexpected backend_class: %q", payload["backend_class"].GetStringValue())
	}
	if payload["product_state"].GetStringValue() != string(engine.ImageProductStateUnsupported) {
		t.Fatalf("unexpected product_state: %q", payload["product_state"].GetStringValue())
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
		EngineLlamaVersion:   "b8575",
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

	daemon.detectMediaHostSupportFn = func() (engine.MediaHostSupport, string) {
		return engine.MediaHostSupportAttachedOnly, "attached only"
	}

	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir(), nil)
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
	if daemon.engineMgr == nil {
		t.Fatal("expected engine manager to initialize when only media is enabled")
	}
	if len(startCalls) != 0 {
		t.Fatalf("expected attached-only host without managed image support to skip media bootstrap, got=%v", startCalls)
	}

	if svc := daemon.grpc.LocalService(); svc != nil {
		if managedEndpoint := svc.ManagedMediaEndpoint(); managedEndpoint != "" {
			t.Fatalf("managed media endpoint should stay empty on attached-only host, got %q", managedEndpoint)
		}
		listed, err := svc.ListLocalServices(context.Background(), &runtimev1.ListLocalServicesRequest{})
		if err != nil {
			t.Fatalf("list local services: %v", err)
		}
		if len(listed.GetServices()) != 0 {
			t.Fatalf("attached-only host must not expose managed image backend service, got %d services", len(listed.GetServices()))
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

	daemon.detectMediaHostSupportFn = func() (engine.MediaHostSupport, string) {
		return engine.MediaHostSupportSupportedSupervised, "supported"
	}

	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir(), nil)
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
	if !slices.Equal(startCalls, []engine.EngineKind{engine.EngineMedia}) {
		t.Fatalf("expected supported host to bootstrap media engine, got=%v", startCalls)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		if managedEndpoint := svc.ManagedMediaEndpoint(); managedEndpoint != "http://127.0.0.1:8321/v1" {
			t.Fatalf("expected managed media endpoint to be exposed on supported host, got %q", managedEndpoint)
		}
	}
}

func TestStartSupervisedEnginesEnablesManagedImageBackendOnImageSupportedAttachedHost(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	homeDir := t.TempDir()
	setDaemonTestHome(t, homeDir)
	if err := os.MkdirAll(filepath.Join(homeDir, ".nimi", "runtime"), 0o755); err != nil {
		t.Fatalf("create test runtime dir: %v", err)
	}
	managedBackendDir := filepath.Join(homeDir, ".nimi", "runtime", "managed-image-backends", "metal-stablediffusion-ggml")
	if err := os.MkdirAll(managedBackendDir, 0o755); err != nil {
		t.Fatalf("create managed image backend dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(managedBackendDir, "run.sh"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write managed image backend run.sh: %v", err)
	}
	if err := os.WriteFile(filepath.Join(managedBackendDir, "metadata.json"), []byte(`{"name":"metal-stablediffusion-ggml","alias":"stablediffusion-ggml"}`), 0o644); err != nil {
		t.Fatalf("write managed image backend metadata: %v", err)
	}

	localStatePath := filepath.Join(homeDir, ".nimi", "runtime", "local-state.json")
	localModelsPath := filepath.Join(homeDir, ".nimi", "data", "models")
	stateRaw, err := json.Marshal(map[string]any{
		"schemaVersion": 2,
		"savedAt":       time.Now().UTC().Format(time.RFC3339Nano),
		"assets": []map[string]any{{
			"localAssetId":      "01KNAIMAGEASSET0000000001",
			"assetId":           "local/local-import/z_image_turbo-Q4_K",
			"kind":              int32(runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE),
			"capabilities":      []string{"image"},
			"engine":            "media",
			"preferredEngine":   "llama",
			"entry":             "z_image_turbo-Q4_K.gguf",
			"sourceRepo":        "local-import/z_image_turbo-Q4_K",
			"sourceRevision":    "local",
			"endpoint":          "http://127.0.0.1:8321/v1",
			"status":            1,
			"installedAt":       time.Now().UTC().Format(time.RFC3339Nano),
			"updatedAt":         time.Now().UTC().Format(time.RFC3339Nano),
			"healthDetail":      "managed local model ready (not started)",
			"engineRuntimeMode": 1,
			"logicalModelId":    "nimi/local-import-z-image-turbo-q4-k",
			"engineConfig": map[string]any{
				"backend": "stablediffusion-ggml",
			},
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
		LocalModelsPath:      localModelsPath,
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   false,
		EngineLlamaPort:      1234,
		EngineLlamaVersion:   "b8575",
		EngineMediaEnabled:   false,
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

	daemon.detectMediaHostSupportFn = func() (engine.MediaHostSupport, string) {
		return engine.MediaHostSupportAttachedOnly, "attached only"
	}
	daemon.imageBootstrapSelectionFn = func() (engine.ImageSupervisedMatrixSelection, bool) {
		return engine.ImageSupervisedMatrixSelection{
			Matched:        true,
			EntryID:        "gguf_image_metal_metal_single_binary",
			ProductState:   engine.ImageProductStateSupported,
			BackendFamily:  engine.ImageBackendFamilyStableDiffusionGGML,
			BackendClass:   engine.ImageBackendClassNativeBinary,
			ControlPlane:   engine.ImageControlPlaneRuntime,
			ExecutionPlane: engine.EngineMedia,
			Entry: &engine.ImageSupervisedMatrixEntry{
				EntryID:      "gguf_image_metal_metal_single_binary",
				ProductState: engine.ImageProductStateSupported,
			},
		}, true
	}
	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		manager, err := engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir(), nil)
		if err != nil {
			return nil, err
		}
		supervisor := engine.NewSupervisor(
			engine.EngineConfig{Kind: engine.EngineKind("managed-image-backend"), Port: 50052},
			slog.New(slog.NewTextHandler(io.Discard, nil)),
			nil,
		)
		supervisor.SetStateForTesting(engine.StatusHealthy, time.Now())
		manager.SetSupervisorForTesting(engine.EngineKind("managed-image-backend"), supervisor)
		return manager, nil
	}

	startCalls := make([]engine.EngineKind, 0, 2)
	var startCallsMu sync.Mutex
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		startCallsMu.Lock()
		startCalls = append(startCalls, kind)
		startCallsMu.Unlock()
		return nil
	}

	daemon.startSupervisedEngines(context.Background())
	if len(startCalls) != 1 || !slices.Contains(startCalls, engine.EngineMedia) {
		t.Fatalf("expected runtime-owned image path to bootstrap media only, got=%v", startCalls)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		if managedEndpoint := svc.ManagedMediaEndpoint(); managedEndpoint != "http://127.0.0.1:8321/v1" {
			t.Fatalf("expected managed media endpoint to be exposed for image-supported host, got %q", managedEndpoint)
		}
		listed, err := svc.ListLocalServices(context.Background(), &runtimev1.ListLocalServicesRequest{})
		if err != nil {
			t.Fatalf("list local services: %v", err)
		}
		if len(listed.GetServices()) != 1 {
			t.Fatalf("expected synthetic managed image backend service when backend bootstrap is configured, got %d", len(listed.GetServices()))
		}
		service := listed.GetServices()[0]
		if service.GetServiceId() != "svc_managed_image_backend" {
			t.Fatalf("expected managed image backend synthetic service id, got %q", service.GetServiceId())
		}
		if service.GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED {
			t.Fatalf("expected managed image backend synthetic service to remain installed before health activation, got %s", service.GetStatus())
		}
		if service.GetEngine() != "media" {
			t.Fatalf("expected managed image backend synthetic service engine=media, got %q", service.GetEngine())
		}
		if service.GetEndpoint() != "grpc://127.0.0.1:50052" {
			t.Fatalf("expected managed image backend synthetic service endpoint, got %q", service.GetEndpoint())
		}
	}
}

func TestStartSupervisedEnginesFailsClosedOnManagedImageBootstrapConflict(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	stateRaw, err := json.Marshal(map[string]any{
		"schemaVersion": 2,
		"savedAt":       time.Now().UTC().Format(time.RFC3339Nano),
		"assets": []map[string]any{{
			"localAssetId":      "01KNCONFLICTIMAGE000000001",
			"assetId":           "local/conflict-image",
			"kind":              int32(runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE),
			"capabilities":      []string{"image"},
			"engine":            "media",
			"entry":             "conflict.gguf",
			"status":            1,
			"engineRuntimeMode": 1,
			"logicalModelId":    "nimi/conflict-image",
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
		EngineLlamaEnabled:   true,
		EngineLlamaPort:      1234,
		EngineLlamaVersion:   "b8575",
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
	daemon.detectMediaHostSupportFn = func() (engine.MediaHostSupport, string) {
		return engine.MediaHostSupportAttachedOnly, "attached only"
	}
	daemon.imageBootstrapSelectionFn = func() (engine.ImageSupervisedMatrixSelection, bool) {
		return engine.ImageSupervisedMatrixSelection{
			Matched:             true,
			Conflict:            true,
			ConflictEntryIDs:    []string{"entry-a", "entry-b"},
			CompatibilityDetail: "multiple managed image topology entries are active: entry-a, entry-b; runtime cannot arbitrate",
		}, true
	}
	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir(), nil)
	}

	startCalls := make([]engine.EngineKind, 0, 2)
	var startCallsMu sync.Mutex
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		startCallsMu.Lock()
		startCalls = append(startCalls, kind)
		startCallsMu.Unlock()
		return nil
	}

	daemon.startSupervisedEngines(context.Background())
	if slices.Contains(startCalls, engine.EngineMedia) {
		t.Fatalf("bootstrap conflict must fail-close without starting media engine, got=%v", startCalls)
	}
	snapshot := daemon.state.Snapshot()
	if snapshot.Status != health.StatusDegraded {
		t.Fatalf("expected degraded runtime state after managed image bootstrap conflict, got %v", snapshot.Status)
	}
	if !strings.Contains(snapshot.Reason, "multiple managed image topology entries are active") {
		t.Fatalf("expected degraded reason to surface managed image bootstrap conflict, got %q", snapshot.Reason)
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
	daemon, err := New(cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
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
	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir(), nil)
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
		EngineLlamaVersion:     "b8575",
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
	var callsMu sync.Mutex
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		callsMu.Lock()
		calls = append(calls, kind)
		callsMu.Unlock()
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

func TestStartSupervisedEnginesBootstrapsManagedLlamaControlPlaneFromState(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	homeDir := t.TempDir()
	setDaemonTestHome(t, homeDir)
	if err := os.MkdirAll(filepath.Join(homeDir, ".nimi", "runtime"), 0o755); err != nil {
		t.Fatalf("create test runtime dir: %v", err)
	}

	localStatePath := filepath.Join(homeDir, ".nimi", "runtime", "local-state.json")
	localModelsPath := filepath.Join(homeDir, ".nimi", "data", "models")
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
	stateRaw, err := json.Marshal(map[string]any{
		"schemaVersion": 2,
		"savedAt":       time.Now().UTC().Format(time.RFC3339Nano),
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
			"installedAt":       time.Now().UTC().Format(time.RFC3339Nano),
			"updatedAt":         time.Now().UTC().Format(time.RFC3339Nano),
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
	daemon, err := New(cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	svc := daemon.grpc.LocalService()
	if svc == nil {
		t.Fatalf("expected local service")
	}
	t.Cleanup(func() { svc.Close() })
	store := auditlog.New(64, 64)
	daemon.auditStore = store
	daemon.aiHealth = providerhealth.New()
	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
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

	if !slices.Equal(calls, []engine.EngineKind{engine.EngineLlama}) {
		t.Fatalf("expected managed local state to bootstrap llama, got=%v", calls)
	}
	configPath := filepath.Join(homeDir, ".nimi", "runtime", "llama-models.yaml")
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("expected managed llama config to be generated: %v", err)
	}
	if managedEndpoint := svc.ManagedLlamaEndpoint(); managedEndpoint != "http://127.0.0.1:1234/v1" {
		t.Fatalf("expected managed llama endpoint to be exposed, got %q", managedEndpoint)
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
		"schemaVersion": 2,
		"savedAt":       now,
		"assets": []map[string]any{
			{
				"localAssetId":      localModelID,
				"assetId":           "local/bootstrap-sync-fail",
				"kind":              int32(runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT),
				"capabilities":      []string{"chat"},
				"engine":            "llama",
				"entry":             "./weights/model.gguf",
				"license":           "unknown",
				"sourceRepo":        "",
				"sourceRevision":    "main",
				"hashes":            map[string]string{},
				"endpoint":          "",
				"status":            int32(runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED),
				"installedAt":       now,
				"updatedAt":         now,
				"engineRuntimeMode": int32(runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED),
			},
		},
		"services": []map[string]any{},
		"audits":   []map[string]any{},
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
		EngineLlamaVersion:   "b8575",
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
	manifestPath := filepath.Join(localModelsPath, "resolved", "nimi", modelSlug, "asset.manifest.json")
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
	daemon, err := New(cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.auditStore = auditlog.New(32, 32)
	daemon.aiHealth = providerhealth.New()
	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
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
