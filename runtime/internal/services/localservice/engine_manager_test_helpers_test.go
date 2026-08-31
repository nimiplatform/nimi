package localservice

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// mockEngineManager implements EngineManager for testing with configurable errors.
type mockEngineManager struct {
	ensureErr                         error
	verifyEngineBinaryDependencyErr   error
	verifyEngineBinaryDependencyCalls int
	lastVerifyEngineBinaryPath        string
	engineBinaryDependencyStatus      *engine.EngineBinaryDependencyStatus
	uvToolDependencyStatus            *engine.UVToolDependencyStatus
	pythonRuntimeStatus               *engine.PythonRuntimeDependencyStatus
	pythonDependencyProfileStatus     *engine.PythonDependencyProfileStatus
	pythonRuntimeDependencyRelease    <-chan struct{}
	ensureManagedImageBackendErr      error
	managedImageBackendStatus         *engine.ManagedImageBackendDependencyStatus
	startErr                          error
	stopErr                           error
	statusErr                         error
	status                            *EngineInfo

	startCalls                             int
	startConfigCalls                       int
	stopCalls                              int
	lastStartEngine                        string
	lastStartPort                          int
	lastStartVersion                       string
	lastEnsureEngineBinaryVersion          string
	lastStartConfig                        engine.EngineConfig
	startEngines                           []string
	startConfigs                           []engine.EngineConfig
	stopEngines                            []string
	managedImageBackendConfigs             []*engine.ManagedImageBackendConfig
	engineBinaryDependencyRelease          <-chan struct{}
	uvToolDependencyRelease                <-chan struct{}
	managedImageBackendDependencyRelease   <-chan struct{}
	ensureSharedAcceleratorDependencyCalls int
	sharedAcceleratorDependencyStatus      *engine.SharedAcceleratorDependencyStatus
	sharedAcceleratorDependencyRelease     <-chan struct{}
}

func (m *mockEngineManager) ListEngines() []EngineInfo {
	return []EngineInfo{
		{Engine: "llama", Version: engine.DefaultLlamaConfig().Version, Status: "healthy", Port: 1234, Endpoint: "http://127.0.0.1:1234"},
		{Engine: "speech", Version: engine.DefaultSpeechConfig().Version, Status: "healthy", Port: 8330, Endpoint: "http://127.0.0.1:8330"},
	}
}

func (m *mockEngineManager) EnsureEngine(_ context.Context, _ string, _ string) error {
	return m.ensureErr
}

func (m *mockEngineManager) EnsureEngineBinaryDependency(ctx context.Context, engineName string, version string) (engine.EngineBinaryDependencyStatus, error) {
	m.lastEnsureEngineBinaryVersion = version
	engine.ReportDownloadProgress(ctx, 300, 1200)
	if m.engineBinaryDependencyRelease != nil {
		<-m.engineBinaryDependencyRelease
	}
	if m.engineBinaryDependencyStatus != nil {
		return *m.engineBinaryDependencyStatus, m.ensureErr
	}
	return engine.EngineBinaryDependencyStatus{
		Engine:           engineName,
		Version:          engine.DefaultLlamaConfig().Version,
		BinaryPath:       "test-llama",
		SHA256:           "abc123",
		Platform:         engine.PlatformString(),
		AssetName:        "test-asset",
		AcceleratorPlane: "cpu",
		Detail:           "test engine package ready",
	}, m.ensureErr
}

func (m *mockEngineManager) VerifyEngineBinaryDependency(_ string, _ string, expectedBinaryPath string) error {
	m.verifyEngineBinaryDependencyCalls++
	m.lastVerifyEngineBinaryPath = expectedBinaryPath
	return m.verifyEngineBinaryDependencyErr
}

func (m *mockEngineManager) EnsureESpeakNGDependency(context.Context) (engine.ESpeakNGDependencyStatus, error) {
	return engine.ESpeakNGDependencyStatus{}, nil
}

func (m *mockEngineManager) EnsureUVToolDependency(ctx context.Context) (engine.UVToolDependencyStatus, error) {
	engine.ReportDownloadProgress(ctx, 128, 512)
	if m.uvToolDependencyRelease != nil {
		<-m.uvToolDependencyRelease
	}
	if m.uvToolDependencyStatus != nil {
		return *m.uvToolDependencyStatus, m.ensureErr
	}
	return engine.UVToolDependencyStatus{
		Version:          "0.11.8",
		ExecutablePath:   "uv.exe",
		SourceRoot:       "uv-root",
		ArchiveSHA256:    "abc123",
		ArchiveAssetName: "uv-x86_64-pc-windows-msvc.zip",
		Platform:         "windows/amd64",
		Detail:           "test uv ready",
	}, m.ensureErr
}

func (m *mockEngineManager) EnsurePythonRuntimeDependency(_ context.Context, uvPath string, engineName string, _ string, _ string) (engine.PythonRuntimeDependencyStatus, error) {
	if m.pythonRuntimeDependencyRelease != nil {
		<-m.pythonRuntimeDependencyRelease
	}
	if m.pythonRuntimeStatus != nil {
		return *m.pythonRuntimeStatus, m.ensureErr
	}
	return engine.PythonRuntimeDependencyStatus{
		PythonVersion:   "Python 3.12.0",
		InterpreterPath: "python.exe",
		RuntimeRoot:     "python-root",
		UVExecutable:    uvPath,
		Detail:          "test python runtime ready for " + engineName,
	}, m.ensureErr
}

func (m *mockEngineManager) EnsurePythonDependencyProfile(_ context.Context, uvPath string, _ string, consumer string, platformTuple string, acceleratorPlane string) (engine.PythonDependencyProfileStatus, error) {
	if m.pythonDependencyProfileStatus != nil {
		return *m.pythonDependencyProfileStatus, m.ensureErr
	}
	identity, err := engine.ResolvePythonDependencyProfileIdentity(consumer, platformTuple, acceleratorPlane)
	if err != nil {
		return engine.PythonDependencyProfileStatus{}, err
	}
	root := "profile-root"
	driverCommands := map[string]string{}
	driverScripts := []string{}
	switch consumer {
	case "speech.qwen3-tts.python":
		driverCommands["NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"] = "python " + engine.SpeechQwen3TTSDriverPath(root)
		driverScripts = append(driverScripts, engine.SpeechQwen3TTSDriverPath(root))
	case "speech.qwen3-asr.python":
		driverCommands["NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"] = "python " + engine.SpeechQwen3ASRDriverPath(root)
		driverScripts = append(driverScripts, engine.SpeechQwen3ASRDriverPath(root))
	case "speech.qwen3-asr-transformers.python":
		driverCommands["NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_CMD"] = "python " + engine.SpeechQwen3ASRTransformersDriverPath(root)
		driverScripts = append(driverScripts, engine.SpeechQwen3ASRTransformersDriverPath(root))
	}
	return engine.PythonDependencyProfileStatus{
		Identity:               identity,
		ProfileRoot:            root,
		InterpreterPath:        "profile-python.exe",
		PackageCacheRoot:       "python-package-cache",
		UVExecutable:           uvPath,
		InstalledDistributions: []string{"torch==" + identity.TorchVersion},
		ImportProbes:           []string{"torch"},
		DriverCommands:         driverCommands,
		DriverScripts:          driverScripts,
		ObservedPythonVersion:  identity.PythonVersion,
		ObservedTorchVersion:   identity.TorchVersion,
		ObservedCUDAABI:        identity.CUDAABI,
		Detail:                 "test immutable Python dependency profile ready",
	}, m.ensureErr
}

func (m *mockEngineManager) EnsureManagedImageBackend(_ context.Context, cfg *engine.ManagedImageBackendConfig) error {
	m.managedImageBackendConfigs = append(m.managedImageBackendConfigs, cfg)
	return m.ensureManagedImageBackendErr
}

func (m *mockEngineManager) EnsureManagedImageBackendDependency(_ context.Context, cfg *engine.ManagedImageBackendConfig) (engine.ManagedImageBackendDependencyStatus, error) {
	m.managedImageBackendConfigs = append(m.managedImageBackendConfigs, cfg)
	if cfg != nil && cfg.DownloadProgress != nil {
		cfg.DownloadProgress(256, 1024)
	}
	if m.managedImageBackendDependencyRelease != nil {
		<-m.managedImageBackendDependencyRelease
	}
	if m.managedImageBackendStatus != nil {
		return *m.managedImageBackendStatus, m.ensureManagedImageBackendErr
	}
	return engine.ManagedImageBackendDependencyStatus{
		BackendName:       "stablediffusion-ggml",
		PackageSource:     "canonical_runtime_wrapper",
		PackageFormat:     "direct_archive",
		LaunchMode:        "runtime_wrapper",
		ReleaseTag:        "test-release",
		SourceCommit:      strings.Repeat("0", 40),
		ArchiveURL:        "https://example.invalid/sd.zip",
		ArchiveSHA256:     "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		CanonicalRoot:     "test-root",
		VerifiedArtifacts: []string{"sd.exe"},
		Detail:            "test managed image backend ready",
	}, m.ensureManagedImageBackendErr
}

func (m *mockEngineManager) StartInstalledManagedImageBackend(_ context.Context, cfg *engine.ManagedImageBackendConfig) error {
	m.managedImageBackendConfigs = append(m.managedImageBackendConfigs, cfg)
	return m.startErr
}

func (m *mockEngineManager) ResolveSharedAcceleratorDependency(dependencyID string, consumerID string) engine.SharedAcceleratorDependencyStatus {
	if m.sharedAcceleratorDependencyStatus != nil {
		status := *m.sharedAcceleratorDependencyStatus
		if strings.TrimSpace(status.DependencyID) == "" {
			status.DependencyID = engine.NormalizeSharedAcceleratorDependencyID(dependencyID)
		}
		status.ConsumerID = strings.TrimSpace(consumerID)
		return status
	}
	return engine.SharedAcceleratorDependencyStatus{
		DependencyID: engine.NormalizeSharedAcceleratorDependencyID(dependencyID),
		ConsumerID:   strings.TrimSpace(consumerID),
		State:        engine.SharedAcceleratorDependencyMaterializableRequiresConfirmation,
		Source:       "runtime_managed",
		Detail:       "nvidia_cuda_user_space_runtime state=materializable_requires_confirmation; system_path_mutation=false",
	}
}

func (m *mockEngineManager) EnsureSharedAcceleratorDependency(ctx context.Context, dependencyID string) (engine.SharedAcceleratorDependencyStatus, error) {
	m.ensureSharedAcceleratorDependencyCalls++
	engine.ReportDownloadProgress(ctx, 384, 1536)
	if m.sharedAcceleratorDependencyRelease != nil {
		<-m.sharedAcceleratorDependencyRelease
	}
	if m.sharedAcceleratorDependencyStatus != nil {
		status := *m.sharedAcceleratorDependencyStatus
		if strings.TrimSpace(status.DependencyID) == "" {
			status.DependencyID = engine.NormalizeSharedAcceleratorDependencyID(dependencyID)
		}
		if m.ensureManagedImageBackendErr == nil {
			status.State = engine.SharedAcceleratorDependencyReadyManaged
			status.Source = "runtime_managed"
		}
		return status, m.ensureManagedImageBackendErr
	}
	status := engine.SharedAcceleratorDependencyStatus{
		DependencyID:      engine.NormalizeSharedAcceleratorDependencyID(dependencyID),
		State:             engine.SharedAcceleratorDependencyReadyManaged,
		Source:            "runtime_managed",
		CanonicalRoot:     `C:\nimi\runtime\dependencies\cuda`,
		Detail:            "nvidia_cuda_user_space_runtime state=ready_managed source=runtime_managed driver_compatible=true cuda_major=12",
		RequiredArtifacts: []string{"cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"},
	}
	return status, m.ensureManagedImageBackendErr
}

func (m *mockEngineManager) StartEngine(_ context.Context, engine string, port int, version string) error {
	m.startCalls++
	m.lastStartEngine = engine
	m.lastStartPort = port
	m.lastStartVersion = version
	m.startEngines = append(m.startEngines, engine)
	return m.startErr
}

func (m *mockEngineManager) StartEngineWithConfig(_ context.Context, cfg engine.EngineConfig) error {
	m.startConfigCalls++
	m.lastStartConfig = cfg
	m.startConfigs = append(m.startConfigs, cfg)
	return m.startErr
}

func (m *mockEngineManager) StopEngine(engine string) error {
	m.stopCalls++
	m.stopEngines = append(m.stopEngines, engine)
	return m.stopErr
}

func (m *mockEngineManager) EngineStatus(engineName string) (EngineInfo, error) {
	if m.statusErr != nil {
		return EngineInfo{}, m.statusErr
	}
	if m.status != nil {
		info := *m.status
		if strings.TrimSpace(info.Engine) == "" {
			info.Engine = engineName
		}
		return info, nil
	}
	return EngineInfo{
		Engine:   engineName,
		Version:  engine.DefaultLlamaConfig().Version,
		Status:   "healthy",
		Port:     1234,
		Endpoint: "http://127.0.0.1:1234",
	}, nil
}

func assertGRPCReasonCode(t *testing.T, err error, rpc string, want runtimev1.ReasonCode) {
	t.Helper()
	got, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("%s: expected reason code %s, got none", rpc, want)
	}
	if got != want {
		t.Fatalf("%s: expected reason code %s, got %s", rpc, want, got)
	}
}
