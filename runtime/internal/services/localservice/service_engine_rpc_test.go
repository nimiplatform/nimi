package localservice

import (
	"context"
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

func TestEngineRPCsWithMockManager(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	ctx := context.Background()

	// ListEngines should return the mock engines.
	resp, err := svc.ListEngines(ctx, &runtimev1.ListEnginesRequest{})
	if err != nil {
		t.Fatalf("ListEngines: %v", err)
	}
	if len(resp.GetEngines()) != 1 {
		t.Fatalf("expected 1 engine, got %d", len(resp.GetEngines()))
	}
	if resp.GetEngines()[0].GetEngine() != "llama" {
		t.Errorf("expected engine llama, got %s", resp.GetEngines()[0].GetEngine())
	}

	// GetEngineStatus should return the mock engine status.
	statusResp, err := svc.GetEngineStatus(ctx, &runtimev1.GetEngineStatusRequest{Engine: "llama"})
	if err != nil {
		t.Fatalf("GetEngineStatus: %v", err)
	}
	if statusResp.GetEngine().GetStatus() != runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_HEALTHY {
		t.Errorf("expected healthy status, got %s", statusResp.GetEngine().GetStatus())
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
	ensureErr                    error
	engineBinaryDependencyStatus *engine.EngineBinaryDependencyStatus
	uvToolDependencyStatus       *engine.UVToolDependencyStatus
	pythonRuntimeStatus          *engine.PythonRuntimeDependencyStatus
	pythonVenvStatus             *engine.PythonVenvDependencyStatus
	pythonPackageSetStatus       *engine.PythonPackageSetDependencyStatus
	pythonTorchWheelStatus       *engine.PythonTorchWheelDependencyStatus
	ensureManagedImageBackendErr error
	managedImageBackendStatus    *engine.ManagedImageBackendDependencyStatus
	startErr                     error
	stopErr                      error
	statusErr                    error
	status                       *EngineInfo

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
	ensureSharedAcceleratorDependencyCalls int
	sharedAcceleratorDependencyStatus      *engine.SharedAcceleratorDependencyStatus
}

func (m *mockEngineManager) ListEngines() []EngineInfo {
	return []EngineInfo{
		{Engine: "llama", Version: engine.DefaultLlamaConfig().Version, Status: "healthy", Port: 1234, Endpoint: "http://127.0.0.1:1234"},
	}
}

func (m *mockEngineManager) EnsureEngine(_ context.Context, _ string, _ string) error {
	return m.ensureErr
}

func (m *mockEngineManager) EnsureEngineBinaryDependency(_ context.Context, engineName string, _ string) (engine.EngineBinaryDependencyStatus, error) {
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

func (m *mockEngineManager) EnsureUVToolDependency(_ context.Context) (engine.UVToolDependencyStatus, error) {
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

func (m *mockEngineManager) EnsurePythonVenvDependency(_ context.Context, uvPath string, pythonRuntimePath string, engineName string, _ string) (engine.PythonVenvDependencyStatus, error) {
	if m.pythonVenvStatus != nil {
		return *m.pythonVenvStatus, m.ensureErr
	}
	return engine.PythonVenvDependencyStatus{
		VenvRoot:        "venv-root",
		InterpreterPath: "venv-python.exe",
		PythonRuntime:   pythonRuntimePath,
		UVExecutable:    uvPath,
		Detail:          "test python venv ready for " + engineName,
	}, m.ensureErr
}

func (m *mockEngineManager) EnsurePythonPackageSetDependency(_ context.Context, uvPath string, venvRoot string, consumer string) (engine.PythonPackageSetDependencyStatus, error) {
	if m.pythonPackageSetStatus != nil {
		return *m.pythonPackageSetStatus, m.ensureErr
	}
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
	}, m.ensureErr
}

func (m *mockEngineManager) EnsurePythonTorchWheelDependency(_ context.Context, uvPath string, venvRoot string, consumer string) (engine.PythonTorchWheelDependencyStatus, error) {
	if m.pythonTorchWheelStatus != nil {
		return *m.pythonTorchWheelStatus, m.ensureErr
	}
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
	}, m.ensureErr
}

func (m *mockEngineManager) EnsureManagedImageBackend(_ context.Context, cfg *engine.ManagedImageBackendConfig) error {
	m.managedImageBackendConfigs = append(m.managedImageBackendConfigs, cfg)
	return m.ensureManagedImageBackendErr
}

func (m *mockEngineManager) EnsureManagedImageBackendDependency(_ context.Context, cfg *engine.ManagedImageBackendConfig) (engine.ManagedImageBackendDependencyStatus, error) {
	m.managedImageBackendConfigs = append(m.managedImageBackendConfigs, cfg)
	if m.managedImageBackendStatus != nil {
		return *m.managedImageBackendStatus, m.ensureManagedImageBackendErr
	}
	return engine.ManagedImageBackendDependencyStatus{
		BackendName:       "stablediffusion-ggml",
		PackageSource:     "test",
		CanonicalRoot:     "test-root",
		VerifiedArtifacts: []string{"sd.exe"},
		Detail:            "test managed image backend ready",
	}, m.ensureManagedImageBackendErr
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

func (m *mockEngineManager) EnsureSharedAcceleratorDependency(_ context.Context, dependencyID string) (engine.SharedAcceleratorDependencyStatus, error) {
	m.ensureSharedAcceleratorDependencyCalls++
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
		DependencyID: engine.NormalizeSharedAcceleratorDependencyID(dependencyID),
		State:        engine.SharedAcceleratorDependencyReadyManaged,
		Source:       "runtime_managed",
		Detail:       "nvidia_cuda_user_space_runtime state=ready_managed",
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

func TestEngineRPCEnsureEngineSuccess(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.EnsureEngine(context.Background(), &runtimev1.EnsureEngineRequest{Engine: "llama"})
	if err != nil {
		t.Fatalf("EnsureEngine: %v", err)
	}
	desc := resp.GetEngine()
	if desc.GetEngine() != "llama" {
		t.Errorf("expected engine llama, got %s", desc.GetEngine())
	}
	if desc.GetVersion() != engine.DefaultLlamaConfig().Version {
		t.Errorf("expected version %s, got %s", engine.DefaultLlamaConfig().Version, desc.GetVersion())
	}
}

func TestEngineRPCStartEngineSuccess(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.StartEngine(context.Background(), &runtimev1.StartEngineRequest{
		Engine: "llama",
		Port:   5000,
	})
	if err != nil {
		t.Fatalf("StartEngine: %v", err)
	}
	desc := resp.GetEngine()
	if desc.GetEngine() != "llama" {
		t.Errorf("expected engine llama, got %s", desc.GetEngine())
	}
}

func TestEngineRPCStopEngineSuccess(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.StopEngine(context.Background(), &runtimev1.StopEngineRequest{Engine: "llama"})
	if err != nil {
		t.Fatalf("StopEngine: %v", err)
	}
	desc := resp.GetEngine()
	if desc.GetStatus() != runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_STOPPED {
		t.Errorf("expected STOPPED status, got %s", desc.GetStatus())
	}
}

func TestEngineRPCGetEngineStatusNotFound(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		statusErr: fmt.Errorf("engine missing not started"),
	})

	_, err := svc.GetEngineStatus(context.Background(), &runtimev1.GetEngineStatusRequest{Engine: "missing"})
	assertGRPCCode(t, err, "GetEngineStatus(not_found)", codes.NotFound)
}

func TestEngineRPCEnsureEngineError(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		ensureErr: fmt.Errorf("download failed"),
	})

	_, err := svc.EnsureEngine(context.Background(), &runtimev1.EnsureEngineRequest{Engine: "llama"})
	assertGRPCCode(t, err, "EnsureEngine(error)", codes.Internal)
	assertGRPCReasonCode(t, err, "EnsureEngine(error)", runtimev1.ReasonCode_AI_LOCAL_DOWNLOAD_FAILED)
}

func TestEngineRPCEnsureSpeechEngineErrorUsesSpeechEnvFailureReason(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		ensureErr: fmt.Errorf("install speech dependencies: download failed"),
	})

	_, err := svc.EnsureEngine(context.Background(), &runtimev1.EnsureEngineRequest{Engine: "speech"})
	assertGRPCCode(t, err, "EnsureEngine(speech_error)", codes.FailedPrecondition)
	assertGRPCReasonCode(t, err, "EnsureEngine(speech_error)", runtimev1.ReasonCode_AI_LOCAL_SPEECH_ENV_INIT_FAILED)
}

func TestEngineRPCStartSpeechEnginePreflightBlockedUsesSpeechReason(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		startErr: fmt.Errorf("speech-backed supervised mode is unavailable on this host; configure an attached endpoint instead"),
	})

	_, err := svc.StartEngine(context.Background(), &runtimev1.StartEngineRequest{Engine: "speech"})
	assertGRPCCode(t, err, "StartEngine(speech_preflight_blocked)", codes.FailedPrecondition)
	assertGRPCReasonCode(t, err, "StartEngine(speech_preflight_blocked)", runtimev1.ReasonCode_AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED)
}

func TestEngineRPCStartSpeechEngineHostFailureUsesSpeechReason(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		startErr: fmt.Errorf("probe request failed: connect: connection refused"),
	})

	_, err := svc.StartEngine(context.Background(), &runtimev1.StartEngineRequest{Engine: "speech"})
	assertGRPCCode(t, err, "StartEngine(speech_host_failure)", codes.FailedPrecondition)
	assertGRPCReasonCode(t, err, "StartEngine(speech_host_failure)", runtimev1.ReasonCode_AI_LOCAL_SPEECH_HOST_INIT_FAILED)
}

func TestEngineRPCEnsureEngineHashMismatch(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		ensureErr: fmt.Errorf("engine binary hash mismatch"),
	})

	_, err := svc.EnsureEngine(context.Background(), &runtimev1.EnsureEngineRequest{Engine: "llama"})
	assertGRPCCode(t, err, "EnsureEngine(hash_mismatch)", codes.DataLoss)
	assertGRPCReasonCode(t, err, "EnsureEngine(hash_mismatch)", runtimev1.ReasonCode_AI_LOCAL_DOWNLOAD_HASH_MISMATCH)
}

func TestLocalManagementRPCsReturnStructuredModelIDErrors(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	_, err := svc.StartLocalAsset(ctx, &runtimev1.StartLocalAssetRequest{LocalAssetId: ""})
	assertGRPCCode(t, err, "StartLocalModel(empty_id)", codes.InvalidArgument)
	assertGRPCReasonCode(t, err, "StartLocalModel(empty_id)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)

	_, err = svc.StopLocalAsset(ctx, &runtimev1.StopLocalAssetRequest{LocalAssetId: ""})
	assertGRPCCode(t, err, "StopLocalModel(empty_id)", codes.InvalidArgument)
	assertGRPCReasonCode(t, err, "StopLocalModel(empty_id)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)

	_, err = svc.RemoveLocalAsset(ctx, &runtimev1.RemoveLocalAssetRequest{LocalAssetId: ""})
	assertGRPCCode(t, err, "RemoveLocalModel(empty_id)", codes.InvalidArgument)
	assertGRPCReasonCode(t, err, "RemoveLocalModel(empty_id)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)

	_, err = svc.StartLocalAsset(ctx, &runtimev1.StartLocalAssetRequest{LocalAssetId: "model_missing"})
	assertGRPCCode(t, err, "StartLocalModel(not_found)", codes.NotFound)
	assertGRPCReasonCode(t, err, "StartLocalModel(not_found)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)

	_, err = svc.StopLocalAsset(ctx, &runtimev1.StopLocalAssetRequest{LocalAssetId: "model_missing"})
	assertGRPCCode(t, err, "StopLocalModel(not_found)", codes.NotFound)
	assertGRPCReasonCode(t, err, "StopLocalModel(not_found)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)

	_, err = svc.RemoveLocalAsset(ctx, &runtimev1.RemoveLocalAssetRequest{LocalAssetId: "model_missing"})
	assertGRPCCode(t, err, "RemoveLocalModel(not_found)", codes.NotFound)
	assertGRPCReasonCode(t, err, "RemoveLocalModel(not_found)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func TestLocalManagementRPCsUseReasonCodesForServiceIDs(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	_, err := svc.StartLocalService(ctx, &runtimev1.StartLocalServiceRequest{ServiceId: ""})
	assertGRPCCode(t, err, "StartLocalService(empty_id)", codes.InvalidArgument)
	assertGRPCReasonCode(t, err, "StartLocalService(empty_id)", runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)

	_, err = svc.StopLocalService(ctx, &runtimev1.StopLocalServiceRequest{ServiceId: ""})
	assertGRPCCode(t, err, "StopLocalService(empty_id)", codes.InvalidArgument)
	assertGRPCReasonCode(t, err, "StopLocalService(empty_id)", runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)

	_, err = svc.RemoveLocalService(ctx, &runtimev1.RemoveLocalServiceRequest{ServiceId: ""})
	assertGRPCCode(t, err, "RemoveLocalService(empty_id)", codes.InvalidArgument)
	assertGRPCReasonCode(t, err, "RemoveLocalService(empty_id)", runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)

	_, err = svc.StartLocalService(ctx, &runtimev1.StartLocalServiceRequest{ServiceId: "svc_missing"})
	assertGRPCCode(t, err, "StartLocalService(not_found)", codes.NotFound)
	assertGRPCReasonCode(t, err, "StartLocalService(not_found)", runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)

	_, err = svc.StopLocalService(ctx, &runtimev1.StopLocalServiceRequest{ServiceId: "svc_missing"})
	assertGRPCCode(t, err, "StopLocalService(not_found)", codes.NotFound)
	assertGRPCReasonCode(t, err, "StopLocalService(not_found)", runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)

	_, err = svc.RemoveLocalService(ctx, &runtimev1.RemoveLocalServiceRequest{ServiceId: "svc_missing"})
	assertGRPCCode(t, err, "RemoveLocalService(not_found)", codes.NotFound)
	assertGRPCReasonCode(t, err, "RemoveLocalService(not_found)", runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
}

func TestEngineRPCStartEngineAlreadyRunning(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		startErr: fmt.Errorf("engine llama already running"),
	})

	_, err := svc.StartEngine(context.Background(), &runtimev1.StartEngineRequest{Engine: "llama"})
	assertGRPCCode(t, err, "StartEngine(already_running)", codes.AlreadyExists)
	assertGRPCReasonCode(t, err, "StartEngine(already_running)", runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
}

func TestEngineRPCStopEngineNotStarted(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		stopErr: fmt.Errorf("engine llama not started"),
	})

	_, err := svc.StopEngine(context.Background(), &runtimev1.StopEngineRequest{Engine: "llama"})
	assertGRPCCode(t, err, "StopEngine(not_started)", codes.NotFound)
	assertGRPCReasonCode(t, err, "StopEngine(not_started)", runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
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

func TestManagedEngineAlreadyBound(t *testing.T) {
	mgr := &mockEngineManager{
		status: &EngineInfo{
			Engine:   "media",
			Status:   "unhealthy",
			Port:     8321,
			PID:      999,
			Endpoint: "http://127.0.0.1:8321/v1",
		},
	}
	if !managedEngineAlreadyBound(mgr, "media", 8321) {
		t.Fatal("expected unhealthy managed engine with matching pid/port to be treated as already bound")
	}
	if managedEngineAlreadyBound(mgr, "media", 1234) {
		t.Fatal("expected mismatched port to return false")
	}
	if managedEngineAlreadyBound(&mockEngineManager{status: &EngineInfo{Engine: "media", Status: "stopped", Port: 8321, PID: 999}}, "media", 8321) {
		t.Fatal("expected stopped engine to return false")
	}
}

func TestBootstrapSelectionAwareManagedMediaEngineSkipsRestartWhenMediaAlreadyOwnsPort(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{
		status: &EngineInfo{
			Engine:   "media",
			Status:   "unhealthy",
			Port:     8321,
			PID:      999,
			Endpoint: "http://127.0.0.1:8321/v1",
		},
	}
	svc.SetEngineManager(mgr)

	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "image-local-id",
		AssetId:      "local-import/z_image_turbo-Q4_K",
		Engine:       "media",
		Endpoint:     "http://127.0.0.1:8321/v1",
		Capabilities: []string{"image"},
	}
	selection := engine.ImageSupervisedMatrixSelection{
		Matched:        true,
		EntryID:        "macos-apple-silicon-gguf",
		ProductState:   engine.ImageProductStateSupported,
		BackendClass:   engine.ImageBackendClassNativeBinary,
		BackendFamily:  engine.ImageBackendFamilyStableDiffusionGGML,
		ControlPlane:   engine.ImageControlPlaneRuntime,
		ExecutionPlane: engine.EngineMedia,
		Entry: &engine.ImageSupervisedMatrixEntry{
			EntryID:        "macos-apple-silicon-gguf",
			ProductState:   engine.ImageProductStateSupported,
			BackendClass:   engine.ImageBackendClassNativeBinary,
			BackendFamily:  engine.ImageBackendFamilyStableDiffusionGGML,
			ControlPlane:   engine.ImageControlPlaneRuntime,
			ExecutionPlane: engine.EngineMedia,
		},
	}

	if err := svc.bootstrapSelectionAwareManagedMediaEngine(context.Background(), model, selection); err != nil {
		t.Fatalf("expected already-bound managed media engine to skip restart, got %v", err)
	}
	if mgr.startConfigCalls != 0 {
		t.Fatalf("expected no media restart when manager already owns port, got %d start calls", mgr.startConfigCalls)
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

func TestLocalModelLifecycleTransitionsMatchSpec(t *testing.T) {
	installed := runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED
	active := runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	unhealthy := runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY
	removed := runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED

	allStates := []runtimev1.LocalAssetStatus{installed, active, unhealthy, removed}

	// Spec: local_model_lifecycle — 9 valid transitions.
	tests := []struct {
		name string
		from runtimev1.LocalAssetStatus
		to   runtimev1.LocalAssetStatus
		want bool
	}{
		// Positive: all 9 spec transitions
		{"INSTALLED->ACTIVE (start_or_health_recovered)", installed, active, true},
		{"INSTALLED->UNHEALTHY (warm_or_runtime_failure)", installed, unhealthy, true},
		{"ACTIVE->UNHEALTHY (health_probe_failed)", active, unhealthy, true},
		{"UNHEALTHY->ACTIVE (recovery_probe_passed)", unhealthy, active, true},
		{"ACTIVE->REMOVED (remove_model)", active, removed, true},
		{"UNHEALTHY->REMOVED (force_remove_model)", unhealthy, removed, true},
		{"ACTIVE->INSTALLED (stop_model)", active, installed, true},
		{"UNHEALTHY->INSTALLED (stop_model_from_unhealthy)", unhealthy, installed, true},
		{"INSTALLED->REMOVED (remove_model_from_installed)", installed, removed, true},

		// Negative: invalid transitions
		{"INSTALLED->INSTALLED (self-loop)", installed, installed, false},
		{"ACTIVE->ACTIVE (self-loop)", active, active, false},
		{"UNHEALTHY->UNHEALTHY (self-loop)", unhealthy, unhealthy, false},
		{"REMOVED->INSTALLED (terminal)", removed, installed, false},
		{"REMOVED->ACTIVE (terminal)", removed, active, false},
		{"REMOVED->UNHEALTHY (terminal)", removed, unhealthy, false},
		{"REMOVED->REMOVED (terminal self-loop)", removed, removed, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidModelTransition(tt.from, tt.to)
			if got != tt.want {
				t.Errorf("isValidModelTransition(%s, %s) = %v, want %v", tt.from, tt.to, got, tt.want)
			}
		})
	}

	// Verify cardinality: 4 states, 9 valid transitions total.
	if len(allStates) != 4 {
		t.Fatalf("expected 4 model states, got %d", len(allStates))
	}
	validCount := 0
	for _, from := range allStates {
		for _, to := range allStates {
			if isValidModelTransition(from, to) {
				validCount++
			}
		}
	}
	if validCount != 9 {
		t.Errorf("expected exactly 9 valid model transitions, got %d", validCount)
	}
}

func TestLocalServiceLifecycleTransitionsMatchSpec(t *testing.T) {
	installed := runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED
	active := runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE
	unhealthy := runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY
	removed := runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED

	allStates := []runtimev1.LocalServiceStatus{installed, active, unhealthy, removed}

	// Spec: local_service_lifecycle — 8 valid transitions.
	tests := []struct {
		name string
		from runtimev1.LocalServiceStatus
		to   runtimev1.LocalServiceStatus
		want bool
	}{
		// Positive: all 8 spec transitions
		{"INSTALLED->ACTIVE (spawn_and_probe_ok)", installed, active, true},
		{"ACTIVE->UNHEALTHY (health_probe_failed)", active, unhealthy, true},
		{"UNHEALTHY->ACTIVE (restart_and_probe_ok)", unhealthy, active, true},
		{"ACTIVE->REMOVED (stop_and_cleanup)", active, removed, true},
		{"UNHEALTHY->REMOVED (force_stop_and_cleanup)", unhealthy, removed, true},
		{"ACTIVE->INSTALLED (stop_service)", active, installed, true},
		{"UNHEALTHY->INSTALLED (stop_service_from_unhealthy)", unhealthy, installed, true},
		{"INSTALLED->REMOVED (remove_service_from_installed)", installed, removed, true},

		// Negative: invalid transitions
		{"INSTALLED->UNHEALTHY (invalid)", installed, unhealthy, false},
		{"INSTALLED->INSTALLED (self-loop)", installed, installed, false},
		{"ACTIVE->ACTIVE (self-loop)", active, active, false},
		{"UNHEALTHY->UNHEALTHY (self-loop)", unhealthy, unhealthy, false},
		{"REMOVED->INSTALLED (terminal)", removed, installed, false},
		{"REMOVED->ACTIVE (terminal)", removed, active, false},
		{"REMOVED->UNHEALTHY (terminal)", removed, unhealthy, false},
		{"REMOVED->REMOVED (terminal self-loop)", removed, removed, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidServiceTransition(tt.from, tt.to)
			if got != tt.want {
				t.Errorf("isValidServiceTransition(%s, %s) = %v, want %v", tt.from, tt.to, got, tt.want)
			}
		})
	}

	// Verify cardinality: 4 states, 8 valid transitions total.
	if len(allStates) != 4 {
		t.Fatalf("expected 4 service states, got %d", len(allStates))
	}
	validCount := 0
	for _, from := range allStates {
		for _, to := range allStates {
			if isValidServiceTransition(from, to) {
				validCount++
			}
		}
	}
	if validCount != 8 {
		t.Errorf("expected exactly 8 valid service transitions, got %d", validCount)
	}
}
