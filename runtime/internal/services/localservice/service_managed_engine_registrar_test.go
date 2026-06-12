package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/protobuf/types/known/structpb"
)

type registrarTestEngineManager struct {
	statusErr error
	stopErr   error
	startErr  error

	startCalls int
	stopCalls  int
}

func (m *registrarTestEngineManager) ListEngines() []EngineInfo {
	return []EngineInfo{}
}

func (m *registrarTestEngineManager) EnsureEngine(_ context.Context, _ string, _ string) error {
	return nil
}

func (m *registrarTestEngineManager) EnsureEngineBinaryDependency(_ context.Context, _ string, _ string) (engine.EngineBinaryDependencyStatus, error) {
	return engine.EngineBinaryDependencyStatus{
		Engine:           "llama",
		Version:          engine.DefaultLlamaConfig().Version,
		BinaryPath:       "test-llama",
		SHA256:           "abc123",
		Platform:         engine.PlatformString(),
		AssetName:        "test-asset",
		AcceleratorPlane: "cpu",
		Detail:           "test llama package ready",
	}, nil
}

func (m *registrarTestEngineManager) EnsureUVToolDependency(_ context.Context) (engine.UVToolDependencyStatus, error) {
	return engine.UVToolDependencyStatus{
		Version:          "0.11.8",
		ExecutablePath:   "uv.exe",
		SourceRoot:       "uv-root",
		ArchiveSHA256:    "abc123",
		ArchiveAssetName: "uv-x86_64-pc-windows-msvc.zip",
		Platform:         "windows/amd64",
		Detail:           "test uv ready",
	}, nil
}

func (m *registrarTestEngineManager) EnsurePythonRuntimeDependency(_ context.Context, uvPath string, engineName string, _ string, _ string) (engine.PythonRuntimeDependencyStatus, error) {
	return engine.PythonRuntimeDependencyStatus{
		PythonVersion:   "Python 3.12.0",
		InterpreterPath: "python.exe",
		RuntimeRoot:     "python-root",
		UVExecutable:    uvPath,
		Detail:          "test python runtime ready for " + engineName,
	}, nil
}

func (m *registrarTestEngineManager) EnsurePythonVenvDependency(_ context.Context, uvPath string, pythonRuntimePath string, engineName string, _ string) (engine.PythonVenvDependencyStatus, error) {
	return engine.PythonVenvDependencyStatus{
		VenvRoot:        "venv-root",
		InterpreterPath: "venv-python.exe",
		PythonRuntime:   pythonRuntimePath,
		UVExecutable:    uvPath,
		Detail:          "test python venv ready for " + engineName,
	}, nil
}

func (m *registrarTestEngineManager) EnsurePythonPackageSetDependency(_ context.Context, uvPath string, venvRoot string, consumer string) (engine.PythonPackageSetDependencyStatus, error) {
	return engine.PythonPackageSetDependencyStatus{
		PackageSetID:           "test-python-package-set",
		LockHash:               "lock123",
		VenvRoot:               venvRoot,
		InterpreterPath:        "venv-python.exe",
		UVExecutable:           uvPath,
		Packages:               []string{"fastapi==0.121.1"},
		InstalledDistributions: []string{"fastapi==0.121.1"},
		ImportProbes:           []string{"fastapi"},
		Detail:                 "test python package set ready for " + consumer,
	}, nil
}

func (m *registrarTestEngineManager) EnsurePythonTorchWheelDependency(_ context.Context, uvPath string, venvRoot string, consumer string) (engine.PythonTorchWheelDependencyStatus, error) {
	return engine.PythonTorchWheelDependencyStatus{
		TorchVersion:     "2.7.1+cu126",
		TorchvisionSpec:  "torchvision==0.22.1",
		AcceleratorPlane: "cuda",
		CUDAABI:          "cu126",
		WheelIndex:       "https://download.pytorch.org/whl/cu126",
		WheelLockHash:    "torchlock123",
		VenvRoot:         venvRoot,
		InterpreterPath:  "venv-python.exe",
		UVExecutable:     uvPath,
		ImportProbes:     []string{"torch", "torchvision"},
		Detail:           "test torch wheel ready for " + consumer,
	}, nil
}

func (m *registrarTestEngineManager) EnsureManagedImageBackend(_ context.Context, _ *engine.ManagedImageBackendConfig) error {
	return nil
}

func (m *registrarTestEngineManager) EnsureManagedImageBackendDependency(_ context.Context, _ *engine.ManagedImageBackendConfig) (engine.ManagedImageBackendDependencyStatus, error) {
	return engine.ManagedImageBackendDependencyStatus{
		BackendName:       "stablediffusion-ggml",
		PackageSource:     "test",
		CanonicalRoot:     "test-root",
		VerifiedArtifacts: []string{"sd.exe"},
		Detail:            "test managed image backend ready",
	}, nil
}

func (m *registrarTestEngineManager) ResolveSharedAcceleratorDependency(dependencyID string, consumerID string) engine.SharedAcceleratorDependencyStatus {
	return engine.SharedAcceleratorDependencyStatus{
		DependencyID: engine.NormalizeSharedAcceleratorDependencyID(dependencyID),
		ConsumerID:   strings.TrimSpace(consumerID),
		State:        engine.SharedAcceleratorDependencyMaterializableRequiresConfirmation,
		Source:       "runtime_managed",
		Detail:       "nvidia_cuda_user_space_runtime state=materializable_requires_confirmation",
	}
}

func (m *registrarTestEngineManager) EnsureSharedAcceleratorDependency(_ context.Context, dependencyID string) (engine.SharedAcceleratorDependencyStatus, error) {
	return engine.SharedAcceleratorDependencyStatus{
		DependencyID: engine.NormalizeSharedAcceleratorDependencyID(dependencyID),
		State:        engine.SharedAcceleratorDependencyReadyManaged,
		Source:       "runtime_managed",
		Detail:       "nvidia_cuda_user_space_runtime state=ready_managed",
	}, nil
}

func (m *registrarTestEngineManager) StartEngine(_ context.Context, _ string, _ int, _ string) error {
	m.startCalls++
	return m.startErr
}

func (m *registrarTestEngineManager) StartEngineWithConfig(_ context.Context, _ engine.EngineConfig) error {
	m.startCalls++
	return m.startErr
}

func (m *registrarTestEngineManager) StopEngine(_ string) error {
	m.stopCalls++
	return m.stopErr
}

func (m *registrarTestEngineManager) EngineStatus(_ string) (EngineInfo, error) {
	if m.statusErr != nil {
		return EngineInfo{}, m.statusErr
	}
	return EngineInfo{
		Engine:   "llama",
		Version:  engine.DefaultLlamaConfig().Version,
		Status:   "healthy",
		Port:     1234,
		Endpoint: "http://127.0.0.1:1234",
	}, nil
}

func TestLocalStartLocalModelRequiresExactManagedLlamaModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"other-model"}]}`))
	}))
	defer func() { server.Close() }()

	svc := newTestServiceWithProbe(t, nil)
	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/expected-model",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected UNHEALTHY, got %s", started.GetAsset().GetStatus())
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), `missing expected model "expected-model"`) {
		t.Fatalf("expected exact-model mismatch detail, got %q", started.GetAsset().GetHealthDetail())
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), "available_models=other-model") {
		t.Fatalf("expected available model listing, got %q", started.GetAsset().GetHealthDetail())
	}
}

func TestWaitForManagedEnginePortReleaseWaitsUntilLoopbackPortIsFree(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	time.AfterFunc(200*time.Millisecond, func() {
		_ = ln.Close()
	})

	startedAt := time.Now()
	if err := waitForManagedEnginePortRelease(context.Background(), port, 2*time.Second); err != nil {
		t.Fatalf("waitForManagedEnginePortRelease: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed < 150*time.Millisecond {
		t.Fatalf("expected wait to observe delayed release, elapsed=%s", elapsed)
	}
}

func TestWaitForManagedEnginePortReleaseTimesOutWhenPortStaysOccupied(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = ln.Close() }()

	port := ln.Addr().(*net.TCPAddr).Port
	err = waitForManagedEnginePortRelease(context.Background(), port, 250*time.Millisecond)
	if err == nil {
		t.Fatal("expected occupied port to time out")
	}
	if !strings.Contains(err.Error(), "remained unavailable") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSyncManagedLlamaAssetsWritesConfigAndRestartsOnlyOnChange(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	mgr := &registrarTestEngineManager{statusErr: errors.New("engine llama not started")}
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetEngineManager(mgr)

	writeManagedLlamaManifest(t, modelsPath, "local/test-chat", "./weights/model.gguf", []string{"chat"})
	first := installManagedLlamaModelForRegistrarTest(t, svc, "local/test-chat", "./weights/model.gguf", []string{"chat"}, "", nil)

	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read generated config: %v", err)
	}
	configText := string(raw)
	for _, want := range []string{
		"version = 1",
		"[test-chat]",
		"model = " + filepath.Join(modelsPath, "resolved", "nimi", "local-test-chat", "weights", "model.gguf"),
		"load-on-startup = true",
	} {
		if !strings.Contains(configText, want) {
			t.Fatalf("expected managed llama preset to contain %q, got:\n%s", want, configText)
		}
	}
	if mgr.startCalls != 0 || mgr.stopCalls != 0 {
		t.Fatalf("expected no restart while engine is not started, got start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}

	mgr.statusErr = nil
	writeManagedLlamaManifest(t, modelsPath, "local/second-chat", "./weights/model-2.gguf", []string{"chat"})
	second := installManagedLlamaModelForRegistrarTest(t, svc, "local/second-chat", "./weights/model-2.gguf", []string{"chat"}, "", nil)
	if mgr.startCalls != 1 || mgr.stopCalls != 1 {
		t.Fatalf("expected one controlled restart on config change, got start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}

	if err := svc.SyncManagedLlamaAssets(context.Background()); err != nil {
		t.Fatalf("sync llama assets without changes: %v", err)
	}
	if mgr.startCalls != 1 || mgr.stopCalls != 1 {
		t.Fatalf("expected no restart when config fingerprint is unchanged, got start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}

	if _, err := svc.RemoveLocalAsset(context.Background(), &runtimev1.RemoveLocalAssetRequest{
		LocalAssetId: second.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("remove managed local model: %v", err)
	}
	if mgr.startCalls != 2 || mgr.stopCalls != 2 {
		t.Fatalf("expected second controlled restart after removal, got start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}

	remainingRaw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read generated config after removal: %v", err)
	}
	remainingText := string(remainingRaw)
	if !strings.Contains(remainingText, "[test-chat]") || strings.Contains(remainingText, "[second-chat]") {
		t.Fatalf("expected only first model to remain after removal, got:\n%s", remainingText)
	}

	if first.GetLocalAssetId() == "" {
		t.Fatalf("expected non-empty first local model id")
	}
}

func TestSetManagedSpeechEndpointSyncsSupervisedSpeechProjection(t *testing.T) {
	svc := newTestService(t)

	supervised := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-managed",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
	})
	attached := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-attached",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		endpoint:     "https://speech.example.com/v1",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-speech-supervised",
		Engine:       "speech",
		Capabilities: []string{"audio.synthesize"},
		LocalModelId: supervised.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install supervised speech service: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-speech-attached",
		Engine:       "speech",
		Capabilities: []string{"audio.synthesize"},
		LocalModelId: attached.GetLocalAssetId(),
		Endpoint:     "https://speech.example.com/v1",
	}); err != nil {
		t.Fatalf("install attached speech service: %v", err)
	}

	svc.SetManagedSpeechEndpoint("http://127.0.0.1:18330/v1")

	supervisedModel := svc.modelByID(supervised.GetLocalAssetId())
	if supervisedModel == nil {
		t.Fatal("expected supervised speech model to exist")
	}
	if got := supervisedModel.GetEndpoint(); got != "http://127.0.0.1:18330/v1" {
		t.Fatalf("supervised speech model endpoint = %q", got)
	}

	attachedModel := svc.modelByID(attached.GetLocalAssetId())
	if attachedModel == nil {
		t.Fatal("expected attached speech model to exist")
	}
	if got := attachedModel.GetEndpoint(); got != "https://speech.example.com/v1" {
		t.Fatalf("attached speech model endpoint must stay explicit, got %q", got)
	}

	supervisedService := svc.serviceByID("svc-speech-supervised")
	if supervisedService == nil {
		t.Fatal("expected supervised speech service to exist")
	}
	if got := supervisedService.GetEndpoint(); got != "http://127.0.0.1:18330/v1" {
		t.Fatalf("supervised speech service endpoint = %q", got)
	}

	attachedService := svc.serviceByID("svc-speech-attached")
	if attachedService == nil {
		t.Fatal("expected attached speech service to exist")
	}
	if got := attachedService.GetEndpoint(); got != "https://speech.example.com/v1" {
		t.Fatalf("attached speech service endpoint must stay explicit, got %q", got)
	}
}

func TestSyncManagedLlamaAssetsSkipsExternalEndpointOnlyModels(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	mgr := &registrarTestEngineManager{}
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetEngineManager(mgr)

	if _, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/external-only",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     "https://example.com/v1",
	}); err != nil {
		t.Fatalf("install external llama model: %v", err)
	}

	if _, err := os.Stat(configPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected no generated config for external endpoint model, stat err=%v", err)
	}
	if mgr.startCalls != 0 || mgr.stopCalls != 0 {
		t.Fatalf("expected no restart for external endpoint model, got start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}
}

func TestBuildManagedLlamaRegistrationsRejectsManagedNameConflicts(t *testing.T) {
	svc := newTestService(t)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)

	writeManagedLlamaManifest(t, modelsPath, "local/conflict-model", "./weights/model-a.gguf", []string{"chat"})
	writeManagedLlamaManifest(t, modelsPath, "llama/conflict-model", "./weights/model-b.gguf", []string{"chat"})
	firstManifestPath := filepath.Join(modelsPath, "resolved", "nimi", slugifyLocalModelID("local/conflict-model"), "asset.manifest.json")
	secondManifestPath := filepath.Join(modelsPath, "resolved", "nimi", slugifyLocalModelID("llama/conflict-model"), "asset.manifest.json")
	first := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "local-conflict-a",
		AssetId:        "local/conflict-model",
		LogicalModelId: "nimi/" + slugifyLocalModelID("local/conflict-model"),
		Capabilities:   []string{"chat"},
		Engine:         "llama",
		Entry:          "./weights/model-a.gguf",
		License:        "apache-2.0",
		Source:         &runtimev1.LocalAssetSource{Repo: "file://" + filepath.ToSlash(firstManifestPath), Revision: "local"},
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		InstalledAt:    nowISO(),
		UpdatedAt:      nowISO(),
	}
	second := &runtimev1.LocalAssetRecord{
		LocalAssetId:   "local-conflict-b",
		AssetId:        "llama/conflict-model",
		LogicalModelId: "nimi/" + slugifyLocalModelID("llama/conflict-model"),
		Capabilities:   []string{"chat"},
		Engine:         "llama",
		Entry:          "./weights/model-b.gguf",
		License:        "apache-2.0",
		Source:         &runtimev1.LocalAssetSource{Repo: "file://" + filepath.ToSlash(secondManifestPath), Revision: "local"},
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		InstalledAt:    nowISO(),
		UpdatedAt:      nowISO(),
	}
	svc.assets[first.GetLocalAssetId()] = first
	svc.assets[second.GetLocalAssetId()] = second
	svc.setModelRuntimeModeLocked(first.GetLocalAssetId(), runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)
	svc.setModelRuntimeModeLocked(second.GetLocalAssetId(), runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)

	registrations, rendered, err := svc.buildManagedLlamaRegistrations()
	if err != nil {
		t.Fatalf("build llama registrations: %v", err)
	}
	if !strings.Contains(registrations[first.GetLocalAssetId()].Problem, "name conflict") {
		t.Fatalf("expected first registration conflict problem, got %+v", registrations[first.GetLocalAssetId()])
	}
	if !strings.Contains(registrations[second.GetLocalAssetId()].Problem, "name conflict") {
		t.Fatalf("expected second registration conflict problem, got %+v", registrations[second.GetLocalAssetId()])
	}

	if strings.TrimSpace(string(rendered)) != "" {
		t.Fatalf("expected no rendered config entries after name conflict, got %q", string(rendered))
	}
}

func TestManagedImageBackendPlatformSupport(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setNvidiaGPUProbeForTest(t, true)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "daemon-managed image backend active")

	modelID := "local/image-model"
	writeManagedLlamaManifest(t, modelsPath, modelID, "./weights/image-model.gguf", []string{"image"})
	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      modelID,
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "./weights/image-model.gguf",
		repo:         "file://" + filepath.ToSlash(filepath.Join(modelsPath, "resolved", "nimi", slugifyLocalModelID(modelID), "asset.manifest.json")),
		revision:     "local",
	})
	svc.mu.Lock()
	stored := cloneLocalAsset(svc.assets[installed.GetLocalAssetId()])
	stored.LogicalModelId = "nimi/" + slugifyLocalModelID(modelID)
	svc.assets[installed.GetLocalAssetId()] = stored
	svc.mu.Unlock()

	registration := svc.managedLlamaRegistrationForModel(installed)
	if registration.Managed {
		t.Fatalf("image assets must not register with llama control plane anymore: %+v", registration)
	}
}

func TestBuildManagedLlamaRegistrationsExcludesManagedMediaImageAssets(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setNvidiaGPUProbeForTest(t, true)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "daemon-managed image backend active")

	modelID := "local/image-media-model"
	writeManagedLlamaManifest(t, modelsPath, modelID, "./weights/image-model.gguf", []string{"image"})
	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}
	record := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      modelID,
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "./weights/image-model.gguf",
		repo:         "file://" + filepath.ToSlash(filepath.Join(modelsPath, "resolved", "nimi", slugifyLocalModelID(modelID), "asset.manifest.json")),
		revision:     "local",
		engineConfig: engineConfig,
	})
	svc.mu.Lock()
	stored := cloneLocalAsset(svc.assets[record.GetLocalAssetId()])
	stored.LogicalModelId = "nimi/" + slugifyLocalModelID(modelID)
	stored.PreferredEngine = "llama"
	svc.assets[record.GetLocalAssetId()] = stored
	svc.mu.Unlock()

	registrations, rendered, err := svc.buildManagedLlamaRegistrations()
	if err != nil {
		t.Fatalf("build managed llama registrations: %v", err)
	}
	if _, ok := registrations[record.GetLocalAssetId()]; ok {
		t.Fatalf("image asset must not appear in managed llama registrations: %+v", registrations[record.GetLocalAssetId()])
	}
	if len(rendered) != 0 {
		t.Fatalf("image assets should not be rendered into static llama config")
	}
}

func TestManagedLlamaModelProbeSucceededForDynamicProfileRequiresHealthyModelEvidence(t *testing.T) {
	registration := managedLlamaRegistration{
		Backend:        "stablediffusion-ggml",
		DynamicProfile: true,
	}
	probe := endpointProbeResult{
		healthy:   false,
		responded: true,
		detail:    "probe response missing valid models",
	}
	if managedLlamaModelProbeSucceeded(probe, registration) {
		t.Fatalf("dynamic profile must not be considered healthy from endpoint response alone")
	}
	probe = endpointProbeResult{
		healthy:   true,
		responded: true,
		models:    []string{"stablediffusion-ggml"},
	}
	if !managedLlamaModelProbeSucceeded(probe, registration) {
		t.Fatalf("dynamic profile should be healthy with model evidence")
	}
}

func TestManagedLlamaRegistrationForManagedImageStaysDetachedFromLlama(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setNvidiaGPUProbeForTest(t, true)
	modelsPath := filepath.Join(t.TempDir(), "models")
	configPath := filepath.Join(t.TempDir(), "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsPath, configPath, true)
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")

	modelID := "local/image-model"
	writeManagedLlamaManifest(t, modelsPath, modelID, "./weights/image-model.gguf", []string{"image"})
	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      modelID,
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "./weights/image-model.gguf",
		repo:         "file://" + filepath.ToSlash(filepath.Join(modelsPath, "resolved", "nimi", slugifyLocalModelID(modelID), "asset.manifest.json")),
		revision:     "local",
	})
	svc.mu.Lock()
	stored := cloneLocalAsset(svc.assets[installed.GetLocalAssetId()])
	stored.LogicalModelId = "nimi/" + slugifyLocalModelID(modelID)
	svc.assets[installed.GetLocalAssetId()] = stored
	svc.mu.Unlock()

	if err := svc.SyncManagedLlamaAssets(context.Background()); err != nil {
		t.Fatalf("sync managed llama assets: %v", err)
	}
	stale := svc.managedLlamaRegistrations[installed.GetLocalAssetId()]
	if stale.Managed {
		t.Fatalf("managed image should not be cached as llama registration, got %+v", stale)
	}

	svc.SetManagedImageBackendHealth(true, "daemon-managed image backend active")

	registration := svc.managedLlamaRegistrationForModel(installed)
	if registration.Managed {
		t.Fatalf("managed image should remain detached from llama after backend recovery, got %+v", registration)
	}
}

func installManagedLlamaModelForRegistrarTest(t *testing.T, svc *Service, modelID string, entry string, capabilities []string, endpoint string, engineConfig *structpb.Struct) *runtimev1.LocalAssetRecord {
	t.Helper()
	req := installLocalAssetParams{
		assetID:      modelID,
		capabilities: capabilities,
		engine:       "llama",
		entry:        entry,
		endpoint:     endpoint,
		engineConfig: engineConfig,
	}
	if strings.TrimSpace(endpoint) == "" {
		record := mustInstallSupervisedLocalModel(t, svc, req)
		manifestPath := filepath.Join(modelsPathForRegistrarTest(svc), "resolved", "nimi", slugifyLocalModelID(modelID), "asset.manifest.json")
		svc.mu.Lock()
		stored := cloneLocalAsset(svc.assets[record.GetLocalAssetId()])
		stored.LogicalModelId = "nimi/" + slugifyLocalModelID(modelID)
		if stored.Source == nil {
			stored.Source = &runtimev1.LocalAssetSource{}
		}
		stored.Source.Repo = "file://" + filepath.ToSlash(manifestPath)
		if strings.TrimSpace(stored.Source.GetRevision()) == "" {
			stored.Source.Revision = "local"
		}
		svc.assets[record.GetLocalAssetId()] = stored
		svc.mu.Unlock()
		if err := svc.SyncManagedLlamaAssets(context.Background()); err != nil {
			t.Fatalf("sync managed llama assets after manifest rewrite: %v", err)
		}
		return cloneLocalAsset(stored)
	}
	return mustInstallAttachedLocalModel(t, svc, req)
}

func modelsPathForRegistrarTest(svc *Service) string {
	svc.mu.RLock()
	defer svc.mu.RUnlock()
	return resolveLocalModelsPath(svc.localModelsPath)
}

func writeManagedLlamaManifest(t *testing.T, modelsPath string, modelID string, entry string, capabilities []string) {
	t.Helper()
	modelSlug := slugifyLocalModelID(modelID)
	cleanEntry := strings.TrimPrefix(filepath.Clean(strings.TrimSpace(entry)), "."+string(filepath.Separator))
	if cleanEntry == "" || cleanEntry == "." {
		cleanEntry = "weights/model.gguf"
	}

	entryPath := filepath.Join(modelsPath, "resolved", "nimi", modelSlug, cleanEntry)
	if err := os.MkdirAll(filepath.Dir(entryPath), 0o755); err != nil {
		t.Fatalf("create manifest entry dir: %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("test-model"), 0o644); err != nil {
		t.Fatalf("write manifest entry: %v", err)
	}

	manifestPath := filepath.Join(modelsPath, "resolved", "nimi", modelSlug, "asset.manifest.json")
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	manifest := map[string]any{
		"asset_id":         modelID,
		"kind":             "chat",
		"logical_model_id": "nimi/" + modelSlug,
		"entry":            entry,
		"engine":           "llama",
		"capabilities":     capabilities,
		"files":            []string{cleanEntry},
		"hashes":           map[string]string{"sha256": "deadbeef"},
		"source":           map[string]string{"repo": "test/repo", "revision": "main"},
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, raw, 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
}
