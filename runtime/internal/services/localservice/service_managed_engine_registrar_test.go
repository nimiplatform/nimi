package localservice

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"

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

func (m *registrarTestEngineManager) EnsurePythonDependencyProfile(_ context.Context, uvPath string, _ string, consumer string, platformTuple string, acceleratorPlane string) (engine.PythonDependencyProfileStatus, error) {
	identity, err := engine.ResolvePythonDependencyProfileIdentity(consumer, platformTuple, acceleratorPlane)
	if err != nil {
		return engine.PythonDependencyProfileStatus{}, err
	}
	return engine.PythonDependencyProfileStatus{
		Identity:               identity,
		ProfileRoot:            "profile-root",
		InterpreterPath:        "profile-python.exe",
		PackageCacheRoot:       "python-package-cache",
		UVExecutable:           uvPath,
		InstalledDistributions: []string{"torch==" + identity.TorchVersion},
		ImportProbes:           []string{"torch"},
		ObservedPythonVersion:  identity.PythonVersion,
		ObservedTorchVersion:   identity.TorchVersion,
		ObservedCUDAABI:        identity.CUDAABI,
		Detail:                 "test immutable Python dependency profile ready",
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
