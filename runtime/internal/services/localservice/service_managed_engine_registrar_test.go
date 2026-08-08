package localservice

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
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

func (m *registrarTestEngineManager) StartInstalledManagedImageBackend(_ context.Context, _ *engine.ManagedImageBackendConfig) error {
	m.startCalls++
	return m.startErr
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

func TestManagedImageBackendPlatformSupport(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setNvidiaGPUProbeForTest(t, true)
	modelsPath := filepath.Join(t.TempDir(), "models")
	setLocalModelsPathForTest(t, svc, modelsPath)
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "daemon-managed image backend active")

	modelID := "local/image-model"
	writeManagedGGUFManifestForRegistrarTest(t, modelsPath, modelID, "./weights/image-model.gguf", []string{"image"})
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

	if isLlamaLocalAsset(installed) {
		t.Fatalf("managed image asset entered the private llama execution plane: %+v", installed)
	}
}

func writeManagedGGUFManifestForRegistrarTest(t *testing.T, modelsPath string, modelID string, entry string, capabilities []string) {
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
