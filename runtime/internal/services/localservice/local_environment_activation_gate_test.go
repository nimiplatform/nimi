package localservice

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestLocalEnvironmentActivationGateBlocksMissingSourceRecords(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	gate := svc.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
		ConsumerID: "speech.qwen3-tts.python",
		PackID:     "local-speech",
	})

	if gate.State != localEnvironmentActivationStateSetupRequired {
		t.Fatalf("gate state = %q, want setup_required", gate.State)
	}
	if len(gate.BlockingDependencies) == 0 {
		t.Fatal("expected missing selected source records to block activation")
	}
	if !strings.Contains(gate.Detail, "selected") && !strings.Contains(gate.Detail, "state=needs_confirmation") {
		t.Fatalf("expected setup detail, got %q", gate.Detail)
	}
}

func TestLocalEnvironmentActivationGateAdmitsReadyRecords(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	req := localEnvironmentConsumerActivationGateRequest{
		ConsumerID: "speech.qwen3-tts.python",
		PackID:     "local-speech",
	}
	markLocalEnvironmentPlanReadyForTest(t, svc, req)

	gate := svc.resolveLocalEnvironmentConsumerActivationGate(req)

	if gate.State != localEnvironmentActivationStateReady {
		t.Fatalf("gate state = %q, want ready; detail=%q", gate.State, gate.Detail)
	}
	if len(gate.BlockingDependencies) != 0 {
		t.Fatalf("unexpected blocking dependencies: %#v", gate.BlockingDependencies)
	}
}

func TestLocalEnvironmentActivationGateUsesConsumerPackOverCallerPackProjection(t *testing.T) {
	svc := newTestService(t)

	gate := svc.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
		ConsumerID: "speech.qwen3-tts.python",
		PackID:     "local-gpu-support",
	})

	if gate.PackID != "local-speech" {
		t.Fatalf("gate pack id = %q, want consumer-required local-speech", gate.PackID)
	}
	if len(gate.Dependencies) == 0 {
		t.Fatal("expected consumer-required local-speech dependencies")
	}
	if len(gate.Dependencies) == 1 && gate.Dependencies[0].DependencyFamily == localEnvironmentFamilyCUDA {
		t.Fatalf("caller pack projection weakened consumer dependencies: %#v", gate.Dependencies)
	}
}

func TestLocalEnvironmentActivationGateBlocksRepairRequiredSourceRecord(t *testing.T) {
	svc := newTestService(t)
	req := localEnvironmentConsumerActivationGateRequest{
		ConsumerID: "speech.qwen3-tts.python",
		PackID:     "local-speech",
	}
	deps := markLocalEnvironmentPlanReadyForTest(t, svc, req)
	if len(deps) == 0 {
		t.Fatal("expected dependencies")
	}
	svc.markLocalEnvironmentDependencyRepairRequired(deps[0].EnvironmentKey, "repair required for test")

	gate := svc.resolveLocalEnvironmentConsumerActivationGate(req)

	if gate.State != localEnvironmentActivationStateRepairRequired {
		t.Fatalf("gate state = %q, want repair_required; detail=%q", gate.State, gate.Detail)
	}
}

func TestLocalEnvironmentActivationGateBlocksUnsupportedCUDA(t *testing.T) {
	svc := newTestService(t)

	gate := svc.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
		ConsumerID: stableDiffusionCUDAConsumerID,
		PackID:     "local-gpu-support",
	})

	if gate.State != localEnvironmentActivationStateUnsupported {
		t.Fatalf("gate state = %q, want unsupported; detail=%q", gate.State, gate.Detail)
	}
}

func TestLocalEnvironmentActivationDependencyRequiresMaterializerForReadyCUDAProjection(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		sharedAcceleratorDependencyStatus: &engine.SharedAcceleratorDependencyStatus{
			DependencyID:      cudaUserSpaceRuntimeDependencyID,
			State:             engine.SharedAcceleratorDependencyReadyManaged,
			Source:            "runtime_managed",
			CanonicalRoot:     `C:\Users\admin\.nimi\runtime\accelerator-dependencies\nvidia-cuda-user-space-runtime`,
			Detail:            "nvidia_cuda_user_space_runtime state=ready_managed source=runtime_managed",
			RequiredArtifacts: []string{"cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"},
		},
	})

	dep := svc.resolveLocalEnvironmentActivationDependency(localEnvironmentPlanDependency{
		DependencyFamily:     localEnvironmentFamilyCUDA,
		DependencyID:         cudaUserSpaceRuntimeDependencyID,
		Required:             true,
		State:                localEnvironmentStateNeedsConfirmation,
		SourceKind:           localEnvironmentSourceManaged,
		ConfirmationRequired: true,
		EnvironmentKey:       "accelerator.cuda.runtime|nvidia-cuda-user-space-runtime|host|windows/amd64|root|stable-diffusion.cpp.cuda",
	}, stableDiffusionCUDAConsumerID)

	if dep.State != localEnvironmentStateNeedsConfirmation || !dep.ConfirmationRequired {
		t.Fatalf("ready CUDA projection must require confirmed materializer job: %+v", dep)
	}
	if dep.SelectedSourceRecordID != "" {
		t.Fatalf("activation projection must not promote selected source record: %+v", dep)
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecord(dep.EnvironmentKey); ok {
		t.Fatalf("expected no selected source record from activation projection for %q", dep.EnvironmentKey)
	}
}

func TestLocalEnvironmentActivationGatePreservesCancelledAndFailedJobs(t *testing.T) {
	for _, tc := range []struct {
		name      string
		jobState  string
		wantState string
	}{
		{name: "cancelled", jobState: localEnvironmentStateCancelled, wantState: localEnvironmentActivationStateCancelled},
		{name: "failed", jobState: localEnvironmentStateFailed, wantState: localEnvironmentActivationStateFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestService(t)
			req := localEnvironmentConsumerActivationGateRequest{
				ConsumerID: "speech.qwen3-tts.python",
				PackID:     "local-speech",
			}
			plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
				PackID:        req.PackID,
				ConsumerScope: req.ConsumerID,
			})
			if len(plan.Dependencies) == 0 {
				t.Fatal("expected plan dependencies")
			}
			dep := plan.Dependencies[0]
			svc.mu.Lock()
			svc.localEnvironmentDependencyJobs["job-"+tc.name] = localEnvironmentDependencyJobState{
				JobID:            "job-" + tc.name,
				EnvironmentKey:   dep.EnvironmentKey,
				DependencyFamily: dep.DependencyFamily,
				DependencyID:     dep.DependencyID,
				ConsumerScope:    dep.ConsumerScope,
				State:            tc.jobState,
				SourceKind:       localEnvironmentSourceManaged,
				UpdatedAt:        nowISO(),
			}
			svc.mu.Unlock()

			gate := svc.resolveLocalEnvironmentConsumerActivationGate(req)

			if gate.State != tc.wantState {
				t.Fatalf("gate state = %q, want %q; detail=%q", gate.State, tc.wantState, gate.Detail)
			}
		})
	}
}

func markLocalEnvironmentPlanReadyForTest(t *testing.T, svc *Service, req localEnvironmentConsumerActivationGateRequest) []localEnvironmentPlanDependency {
	t.Helper()
	requirement, ok := localEnvironmentConsumerRequirementByID(req.ConsumerID)
	if !ok {
		t.Fatalf("unknown test consumer %q", req.ConsumerID)
	}
	packID := req.PackID
	if packID == "" {
		packID = requirement.PackID
	}
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          packID,
		ConsumerScope:   req.ConsumerID,
		HostProfile:     req.HostProfile,
		RuntimeDataRoot: req.RuntimeDataRoot,
	})
	acceleratorPlane := "cpu"
	if strings.Contains(req.ConsumerID, ".cuda") || localEnvironmentHostSupportsCUDA(localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(req.HostProfile))) {
		acceleratorPlane = "cuda"
	}
	for _, dep := range plan.Dependencies {
		if dep.State == localEnvironmentStateUnsupported {
			continue
		}
		var pythonProfileIdentity engine.PythonDependencyProfileIdentity
		sourceKind := localEnvironmentSourceManaged
		if dep.DependencyFamily == localEnvironmentFamilyPythonRuntime || dep.DependencyFamily == localEnvironmentFamilyPythonUV {
			sourceKind = localEnvironmentSourceSystem
		}
		canonicalName := strings.NewReplacer(".", "-", ":", "-", "/", "-", "\\", "-").Replace(dep.DependencyID)
		record := localEnvironmentSelectedSourceRecordState{
			DependencyFamily:  dep.DependencyFamily,
			DependencyID:      dep.DependencyID,
			EnvironmentKey:    dep.EnvironmentKey,
			SourceKind:        sourceKind,
			CanonicalRoot:     filepath.Join(t.TempDir(), canonicalName),
			SelectedConsumers: []string{dep.ConsumerScope},
			AuditReasonCode:   "test_ready",
		}
		if dep.DependencyFamily == localEnvironmentFamilyPythonPackageSet {
			switch req.ConsumerID {
			case "speech.qwen3-tts.python":
				driverScript := engine.SpeechQwen3TTSDriverPath(record.CanonicalRoot)
				record.VerifiedArtifacts = []string{filepath.Join(record.CanonicalRoot, "bin", "python"), driverScript}
			case "speech.qwen3-asr.python":
				driverScript := engine.SpeechQwen3ASRDriverPath(record.CanonicalRoot)
				record.VerifiedArtifacts = []string{filepath.Join(record.CanonicalRoot, "bin", "python"), driverScript}
			case "speech.qwen3-asr-transformers.python":
				driverScript := engine.SpeechQwen3ASRTransformersDriverPath(record.CanonicalRoot)
				record.VerifiedArtifacts = []string{filepath.Join(record.CanonicalRoot, "bin", "python"), driverScript}
			}
			identity, err := engine.ResolvePythonDependencyProfileIdentity(req.ConsumerID, plan.PlatformTuple, acceleratorPlane)
			if err != nil {
				t.Fatalf("resolve Python dependency profile for %q: %v", req.ConsumerID, err)
			}
			record.Version = identity.ProfileDigest
			record.Hashes = pythonDependencyProfileHashes(identity)
			pythonProfileIdentity = identity
		}
		if dep.DependencyFamily == localEnvironmentFamilyPythonTorchWheel {
			identity, err := engine.ResolvePythonTorchWheelDependencyIdentity(dep.ConsumerScope)
			if err != nil {
				t.Fatalf("resolve Python Torch wheel identity for %q: %v", dep.ConsumerScope, err)
			}
			record.Version = identity.TorchVersion
			record.Hashes = map[string]string{"wheel_lock_hash": identity.WheelLockHash}
		}
		record = verifiedSelectedSourceRecordForTest(record)
		writeSelectedSourceLocalArtifactsForTest(t, record)
		if dep.DependencyFamily == localEnvironmentFamilyPythonPackageSet {
			writePythonDependencyProfileStaticFilesForTest(t, record.CanonicalRoot, req.ConsumerID, pythonProfileIdentity)
		}
		promoted := svc.upsertLocalEnvironmentSelectedSourceRecord(record)
		if localEnvironmentPythonSelectedSourceFamily(dep.DependencyFamily) {
			recordReadyPythonSelectedSourceConsumptionJobForTest(svc, promoted, dep.ConsumerScope)
		}
	}
	return plan.Dependencies
}
