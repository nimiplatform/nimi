package localservice

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// --- Engine RPC tests ---

func TestEngineRPCsReturnFailedPreconditionWithoutManager(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	// ListEngines
	_, err := svc.ListEngines(ctx, &runtimev1.ListEnginesRequest{})
	assertGRPCCode(t, err, "ListEngines", codes.FailedPrecondition)

	// EnsureEngine
	_, err = svc.EnsureEngine(ctx, &runtimev1.EnsureEngineRequest{Engine: "llama"})
	assertGRPCCode(t, err, "EnsureEngine", codes.FailedPrecondition)

	// StartEngine
	_, err = svc.StartEngine(ctx, &runtimev1.StartEngineRequest{Engine: "llama"})
	assertGRPCCode(t, err, "StartEngine", codes.FailedPrecondition)

	// StopEngine
	_, err = svc.StopEngine(ctx, &runtimev1.StopEngineRequest{Engine: "llama"})
	assertGRPCCode(t, err, "StopEngine", codes.FailedPrecondition)

	// GetEngineStatus
	_, err = svc.GetEngineStatus(ctx, &runtimev1.GetEngineStatusRequest{Engine: "llama"})
	assertGRPCCode(t, err, "GetEngineStatus", codes.FailedPrecondition)
}

func TestEngineRPCsKeepLlamaHostPrivate(t *testing.T) {
	mgr := &mockEngineManager{}
	svc := newTestService(t)
	svc.SetEngineManager(mgr)
	ctx := context.Background()

	resp, err := svc.ListEngines(ctx, &runtimev1.ListEnginesRequest{})
	if err != nil || len(resp.GetEngines()) != 0 {
		t.Fatalf("ListEngines leaked private llama Host: %+v, %v", resp, err)
	}
	for operation, err := range map[string]error{
		"start": func() error {
			_, err := svc.StartEngine(ctx, &runtimev1.StartEngineRequest{Engine: "llama"})
			return err
		}(),
		"stop": func() error { _, err := svc.StopEngine(ctx, &runtimev1.StopEngineRequest{Engine: "llama"}); return err }(),
		"status": func() error {
			_, err := svc.GetEngineStatus(ctx, &runtimev1.GetEngineStatusRequest{Engine: "llama"})
			return err
		}(),
	} {
		assertGRPCCode(t, err, operation, codes.FailedPrecondition)
		assertGRPCReasonCode(t, err, operation, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if mgr.startCalls != 0 || mgr.stopCalls != 0 {
		t.Fatalf("private llama RPC touched Host manager: start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}
}

func TestEngineRPCsRequireEngineName(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	ctx := context.Background()

	// Empty engine name should return INVALID_ARGUMENT.
	_, err := svc.EnsureEngine(ctx, &runtimev1.EnsureEngineRequest{Engine: ""})
	assertGRPCCode(t, err, "EnsureEngine(empty)", codes.InvalidArgument)

	_, err = svc.StartEngine(ctx, &runtimev1.StartEngineRequest{Engine: ""})
	assertGRPCCode(t, err, "StartEngine(empty)", codes.InvalidArgument)

	_, err = svc.StopEngine(ctx, &runtimev1.StopEngineRequest{Engine: ""})
	assertGRPCCode(t, err, "StopEngine(empty)", codes.InvalidArgument)

	_, err = svc.GetEngineStatus(ctx, &runtimev1.GetEngineStatusRequest{Engine: ""})
	assertGRPCCode(t, err, "GetEngineStatus(empty)", codes.InvalidArgument)
}

// mockEngineManager implements EngineManager for testing with configurable errors.
type mockEngineManager struct {
	ensureErr                      error
	engineBinaryDependencyStatus   *engine.EngineBinaryDependencyStatus
	uvToolDependencyStatus         *engine.UVToolDependencyStatus
	pythonRuntimeStatus            *engine.PythonRuntimeDependencyStatus
	pythonDependencyProfileStatus  *engine.PythonDependencyProfileStatus
	pythonRuntimeDependencyRelease <-chan struct{}
	ensureManagedImageBackendErr   error
	managedImageBackendStatus      *engine.ManagedImageBackendDependencyStatus
	startErr                       error
	stopErr                        error
	statusErr                      error
	status                         *EngineInfo

	startCalls                             int
	startConfigCalls                       int
	stopCalls                              int
	lastStartEngine                        string
	lastStartPort                          int
	lastStartVersion                       string
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

func (m *mockEngineManager) EnsureEngineBinaryDependency(ctx context.Context, engineName string, _ string) (engine.EngineBinaryDependencyStatus, error) {
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
		PackageSource:     "canonical_localai_derived",
		PackageFormat:     "oci_payload",
		LaunchMode:        "package_entrypoint",
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

func assertGRPCCode(t *testing.T, err error, rpc string, wantCode codes.Code) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected error, got nil", rpc)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("%s: expected gRPC status error, got %T: %v", rpc, err, err)
	}
	if st.Code() != wantCode {
		t.Errorf("%s: expected code %s, got %s (msg: %s)", rpc, wantCode, st.Code(), st.Message())
	}
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

func assertNoGRPCReasonCode(t *testing.T, err error, rpc string) {
	t.Helper()
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		t.Fatalf("%s: expected no reason code, got %s", rpc, reason)
	}
}

// --- Engine RPC success/error tests ---

func TestEngineRPCEnsureEngineFailsClosedToLocalEnvironmentJobControl(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	_, err := svc.EnsureEngine(context.Background(), &runtimev1.EnsureEngineRequest{Engine: "llama"})
	assertGRPCCode(t, err, "EnsureEngine", codes.FailedPrecondition)
	assertGRPCReasonCode(t, err, "EnsureEngine", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func TestEngineRPCGetEngineStatusNotFound(t *testing.T) {
	svc := newTestService(t)
	upstreamErr := errors.New(`engine missing not started at C:\private\models\secret.gguf`)
	svc.SetEngineManager(&mockEngineManager{
		statusErr: upstreamErr,
	})

	_, err := svc.GetEngineStatus(context.Background(), &runtimev1.GetEngineStatusRequest{Engine: "missing"})
	assertGRPCCode(t, err, "GetEngineStatus(not_found)", codes.NotFound)
	assertGRPCReasonCode(t, err, "GetEngineStatus(not_found)", runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	if !errors.Is(err, upstreamErr) {
		t.Fatalf("expected engine manager cause to remain available: %v", err)
	}
	st := status.Convert(err)
	if strings.Contains(st.Message(), upstreamErr.Error()) || strings.Contains(st.Message(), `C:\private`) {
		t.Fatalf("public status leaked engine manager error: %q", st.Message())
	}
	metadata, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok {
		t.Fatal("expected ErrorInfo metadata")
	}
	if _, exists := metadata["detail"]; exists {
		t.Fatalf("public metadata exposed raw engine detail: %#v", metadata)
	}
}

func TestEngineRPCsKeepManagedSpeechHostPrivate(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)
	ctx := context.Background()
	for operation, err := range map[string]error{
		"start": func() error {
			_, err := svc.StartEngine(ctx, &runtimev1.StartEngineRequest{Engine: "speech"})
			return err
		}(),
		"stop": func() error {
			_, err := svc.StopEngine(ctx, &runtimev1.StopEngineRequest{Engine: "speech"})
			return err
		}(),
		"status": func() error {
			_, err := svc.GetEngineStatus(ctx, &runtimev1.GetEngineStatusRequest{Engine: "speech"})
			return err
		}(),
	} {
		assertGRPCCode(t, err, operation, codes.FailedPrecondition)
		assertGRPCReasonCode(t, err, operation, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if mgr.startCalls != 0 || mgr.stopCalls != 0 {
		t.Fatalf("private speech RPC touched Host manager: start=%d stop=%d", mgr.startCalls, mgr.stopCalls)
	}
}

func TestEngineRPCGetEngineStatusUnknownEngine(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		statusErr: fmt.Errorf("unknown engine kind: \"mystery\""),
	})

	_, err := svc.GetEngineStatus(context.Background(), &runtimev1.GetEngineStatusRequest{Engine: "mystery"})
	assertGRPCCode(t, err, "GetEngineStatus(unknown_engine)", codes.InvalidArgument)
	assertGRPCReasonCode(t, err, "GetEngineStatus(unknown_engine)", runtimev1.ReasonCode_AI_INPUT_INVALID)
}

func TestMapEngineManagerErrorReturnsNilForNilInput(t *testing.T) {
	if err := mapEngineManagerError("llama", "status", nil); err != nil {
		t.Fatalf("expected nil passthrough for nil engine error, got %v", err)
	}
}

// --- Enum mapping test ---

func TestEngineStatusToProtoMapping(t *testing.T) {
	tests := []struct {
		input string
		want  runtimev1.LocalEngineStatus
	}{
		{"stopped", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_STOPPED},
		{"starting", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_STARTING},
		{"healthy", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_HEALTHY},
		{"unhealthy", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_UNHEALTHY},
		{"unknown", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_UNSPECIFIED},
		{"", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_UNSPECIFIED},
	}
	for _, tt := range tests {
		got := engineStatusToProto(tt.input)
		if got != tt.want {
			t.Errorf("engineStatusToProto(%q) = %s, want %s", tt.input, got, tt.want)
		}
	}
}

// --- State machine exhaustive verification ---
