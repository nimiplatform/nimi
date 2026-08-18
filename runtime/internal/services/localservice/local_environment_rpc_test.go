package localservice

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/types/known/structpb"
)

func selectEnvironmentLoadoutForTest(t *testing.T, svc *Service, capabilityContract string, recipeID string, identity capabilitydriver.Identity) {
	t.Helper()
	loadoutID := "environment-loadout-" + strings.ReplaceAll(capabilityContract, ".", "-")
	loadout := &runtimev1.Loadout{
		LoadoutId:          loadoutID,
		CapabilityContract: capabilityContract,
		RecipeId:           recipeID,
		Implementation:     identity.Proto(),
		Options:            &structpb.Struct{},
	}
	if _, _, err := svc.projectStoredLoadout(loadout); err != nil {
		t.Fatalf("project environment test Loadout: %v", err)
	}
	svc.mu.Lock()
	svc.loadouts[loadoutID] = loadout
	svc.loadoutSelections[capabilityContract] = &runtimev1.LoadoutSelection{CapabilityContract: capabilityContract, LoadoutId: loadoutID}
	svc.mu.Unlock()
}

func TestLocalEnvironmentTargetForDriverUsesRuntimeDriverContract(t *testing.T) {
	tests := []struct {
		name         string
		driver       capabilitydriver.Driver
		host         localEnvironmentHostProfileState
		wantPack     string
		wantConsumer string
	}{
		{name: "llama CUDA", driver: capabilitydriver.LlamaTextDriver{}, host: localEnvironmentHostProfileState{OS: "windows", GPUAvailable: true, GPUVendor: "nvidia"}, wantPack: "local-text", wantConsumer: "llama.cpp.cuda"},
		{name: "stable diffusion Metal", driver: capabilitydriver.StableDiffusionImageDriver{}, host: localEnvironmentHostProfileState{OS: "darwin", Arch: "arm64"}, wantPack: "local-image-native", wantConsumer: "stable-diffusion.cpp.metal"},
		{name: "stable diffusion video CUDA", driver: capabilitydriver.StableDiffusionVideoDriver{}, host: localEnvironmentHostProfileState{OS: "windows", GPUAvailable: true, GPUVendor: "nvidia"}, wantPack: "local-image-native", wantConsumer: stableDiffusionCUDAConsumerID},
		{name: "qwen tts", driver: capabilitydriver.Qwen3TTSDriver{}, wantPack: "local-speech", wantConsumer: "speech.qwen3-tts.python"},
		{name: "qwen voice create", driver: capabilitydriver.Qwen3VoiceCreateDriver{}, wantPack: "local-speech", wantConsumer: "speech.qwen3-tts.python"},
		{name: "voxcpm", driver: capabilitydriver.VoxCPMDriver{}, wantPack: "local-speech", wantConsumer: "speech.voxcpm.python"},
		{name: "qwen asr", driver: capabilitydriver.Qwen3ASRDriver{}, wantPack: "local-speech", wantConsumer: "speech.qwen3-asr.python"},
		{name: "qwen transformers asr", driver: capabilitydriver.Qwen3ASRTransformersDriver{}, wantPack: "local-speech", wantConsumer: "speech.qwen3-asr-transformers.python"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pack, consumer, ok := localEnvironmentTargetForDriver(test.driver, test.host)
			if !ok || pack != test.wantPack || consumer != test.wantConsumer {
				t.Fatalf("environment target = %q/%q/%v, want %q/%q/true", pack, consumer, ok, test.wantPack, test.wantConsumer)
			}
		})
	}
}

func TestResolveLocalEnvironmentPlanProjectsSetupRequired(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	selectEnvironmentLoadoutForTest(t, svc, capabilitydriver.AudioSynthesizeContract, capabilitydriver.Qwen3TTSCustomVoiceRecipeID, capabilitydriver.Identity{
		ImplementationID: capabilitydriver.Qwen3TTSImplementationID,
		DriverID:         capabilitydriver.Qwen3TTSDriverID,
		DriverDialect:    capabilitydriver.Qwen3TTSDriverDialect,
	})

	resp, err := svc.ResolveLocalEnvironmentPlan(context.Background(), &runtimev1.ResolveLocalEnvironmentPlanRequest{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
	})
	if err != nil {
		t.Fatalf("ResolveLocalEnvironmentPlan: %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetState() != localEnvironmentStateNeedsConfirmation {
		t.Fatalf("plan state = %q, want needs_confirmation", plan.GetState())
	}
	if len(plan.GetDependencies()) == 0 {
		t.Fatal("expected dependencies")
	}
	if plan.GetRuntimeDataRoot() != svc.localEnvironmentRuntimeDataRoot() {
		t.Fatalf("plan data root = %q, want Product Control-derived %q", plan.GetRuntimeDataRoot(), svc.localEnvironmentRuntimeDataRoot())
	}
	if !plan.GetDependencies()[0].GetConfirmationRequired() {
		t.Fatal("expected missing selected source record to require confirmation")
	}
}

func TestLocalEnvironmentRPCRejectsRootDifferentFromProductControl(t *testing.T) {
	svc := newTestService(t)
	divergent := filepath.Join(t.TempDir(), "caller-selected-root")
	cases := []struct {
		name string
		call func() error
	}{
		{
			name: "plan",
			call: func() error {
				_, err := svc.ResolveLocalEnvironmentPlan(context.Background(), &runtimev1.ResolveLocalEnvironmentPlanRequest{
					CapabilityContract: capabilitydriver.LlamaCapabilityContract,
					RuntimeDataRoot:    divergent,
				})
				return err
			},
		},
		{
			name: "activation gate",
			call: func() error {
				_, err := svc.ResolveLocalEnvironmentActivationGate(context.Background(), &runtimev1.ResolveLocalEnvironmentActivationGateRequest{
					ConsumerId:      "llama.cpp.cpu",
					RuntimeDataRoot: divergent,
				})
				return err
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.call()
			if err == nil || !strings.Contains(err.Error(), "does not match Product Control dataRoot.path") {
				t.Fatalf("divergent root error = %v", err)
			}
		})
	}
}

func TestLocalEnvironmentRPCProjectsReadySourcesAndGate(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	selectEnvironmentLoadoutForTest(t, svc, capabilitydriver.AudioSynthesizeContract, capabilitydriver.Qwen3TTSCustomVoiceRecipeID, capabilitydriver.Identity{
		ImplementationID: capabilitydriver.Qwen3TTSImplementationID,
		DriverID:         capabilitydriver.Qwen3TTSDriverID,
		DriverDialect:    capabilitydriver.Qwen3TTSDriverDialect,
	})
	req := localEnvironmentConsumerActivationGateRequest{
		ConsumerID: "speech.qwen3-tts.python",
		PackID:     "local-speech",
	}
	markLocalEnvironmentPlanReadyForTest(t, svc, req)

	planResp, err := svc.ResolveLocalEnvironmentPlan(context.Background(), &runtimev1.ResolveLocalEnvironmentPlanRequest{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
	})
	if err != nil {
		t.Fatalf("ResolveLocalEnvironmentPlan: %v", err)
	}
	if planResp.GetPlan().GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("plan state = %q, want ready_managed", planResp.GetPlan().GetState())
	}

	sourceResp, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		ConsumerScope: req.ConsumerID,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	expectedSourceIDs := map[string]bool{}
	for _, dep := range planResp.GetPlan().GetDependencies() {
		if dep.GetConsumerScope() == req.ConsumerID {
			expectedSourceIDs[dep.GetSelectedSourceRecordId()] = true
		}
	}
	if len(sourceResp.GetSources()) != len(expectedSourceIDs) {
		t.Fatalf("exact consumer source count = %d, want %d", len(sourceResp.GetSources()), len(expectedSourceIDs))
	}
	pythonSources := 0
	for _, source := range sourceResp.GetSources() {
		if !expectedSourceIDs[source.GetRecordId()] {
			t.Fatalf("consumer-filtered RPC returned source without an exact ready consumer projection: %+v", source)
		}
		if localEnvironmentPythonSelectedSourceFamily(source.GetDependencyFamily()) {
			pythonSources++
			if len(source.GetSelectedConsumers()) != 0 {
				t.Fatalf("canonical Python source projected consumer ownership: %+v", source)
			}
		}
	}
	if pythonSources == 0 {
		t.Fatal("consumer-filtered RPC omitted exact ready Python source projections")
	}

	gateResp, err := svc.ResolveLocalEnvironmentActivationGate(context.Background(), &runtimev1.ResolveLocalEnvironmentActivationGateRequest{
		ConsumerId: req.ConsumerID,
		PackId:     req.PackID,
	})
	if err != nil {
		t.Fatalf("ResolveLocalEnvironmentActivationGate: %v", err)
	}
	if gateResp.GetGate().GetState() != localEnvironmentActivationStateReady {
		t.Fatalf("gate state = %q, want ready", gateResp.GetGate().GetState())
	}
	if len(gateResp.GetGate().GetBlockingDependencies()) != 0 {
		t.Fatalf("unexpected blocking dependencies: %#v", gateResp.GetGate().GetBlockingDependencies())
	}
}

func TestListLocalEnvironmentDependencyJobsProjectsTerminalStates(t *testing.T) {
	svc := newTestService(t)
	environmentKey := "python.runtime|python.runtime|host-test|windows/amd64|" + filepath.Join(t.TempDir(), "runtime") + "|media.diffusers.cpu"
	svc.mu.Lock()
	svc.localEnvironmentDependencyJobs["job-cancelled"] = localEnvironmentDependencyJobState{
		JobID:               "job-cancelled",
		EnvironmentKey:      environmentKey,
		DependencyFamily:    localEnvironmentFamilyPythonRuntime,
		DependencyID:        "python.runtime",
		State:               localEnvironmentStateCancelled,
		SourceKind:          localEnvironmentSourceManaged,
		FailureDetail:       "cancelled by user",
		Retryable:           false,
		ReasonCode:          "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_CANCELLED",
		RecoveryDisposition: localEnvironmentJobRecoveryNotRetryable,
		CreatedAt:           "2026-04-30T00:00:00Z",
		UpdatedAt:           "2026-04-30T00:00:01Z",
	}
	svc.localEnvironmentDependencyJobs["job-failed"] = localEnvironmentDependencyJobState{
		JobID:               "job-failed",
		EnvironmentKey:      environmentKey,
		DependencyFamily:    localEnvironmentFamilyPythonRuntime,
		DependencyID:        "python.runtime",
		State:               localEnvironmentStateFailed,
		SourceKind:          localEnvironmentSourceManaged,
		FailureDetail:       "download failed",
		Retryable:           true,
		ReasonCode:          "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_FAILED",
		RecoveryDisposition: localEnvironmentJobRecoveryManualRetry,
		CreatedAt:           "2026-04-30T00:00:02Z",
		UpdatedAt:           "2026-04-30T00:00:03Z",
	}
	svc.mu.Unlock()

	resp, err := svc.ListLocalEnvironmentDependencyJobs(context.Background(), &runtimev1.ListLocalEnvironmentDependencyJobsRequest{
		EnvironmentKey: environmentKey,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentDependencyJobs: %v", err)
	}
	if len(resp.GetJobs()) != 2 {
		t.Fatalf("job count = %d, want 2", len(resp.GetJobs()))
	}
	if resp.GetJobs()[0].GetState() != localEnvironmentStateFailed {
		t.Fatalf("first job state = %q, want failed by updated_at desc", resp.GetJobs()[0].GetState())
	}
	if resp.GetJobs()[0].GetReasonCode() != "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_FAILED" {
		t.Fatalf("first job reason = %q", resp.GetJobs()[0].GetReasonCode())
	}
	if resp.GetJobs()[0].GetRecoveryDisposition() != localEnvironmentJobRecoveryManualRetry {
		t.Fatalf("first job recovery = %q", resp.GetJobs()[0].GetRecoveryDisposition())
	}
	if resp.GetJobs()[1].GetState() != localEnvironmentStateCancelled {
		t.Fatalf("second job state = %q, want cancelled", resp.GetJobs()[1].GetState())
	}
}

func TestResolveLocalEnvironmentActivationGateRejectsUnsupportedConsumer(t *testing.T) {
	svc := newTestService(t)

	resp, err := svc.ResolveLocalEnvironmentActivationGate(context.Background(), &runtimev1.ResolveLocalEnvironmentActivationGateRequest{
		ConsumerId: "unknown.consumer",
	})
	if err != nil {
		t.Fatalf("ResolveLocalEnvironmentActivationGate: %v", err)
	}
	if resp.GetGate().GetState() != localEnvironmentActivationStateUnsupported {
		t.Fatalf("gate state = %q, want unsupported", resp.GetGate().GetState())
	}
}
