package localservice

import (
	"context"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestLocalEnvironmentServiceConstructionDoesNotResolveLocalCompute(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	if got := len(svc.localEnvironmentHostProfiles); got != 0 {
		t.Fatalf("expected no host profile snapshots on construction, got %d", got)
	}
	if got := len(svc.localEnvironmentSelectedSources); got != 0 {
		t.Fatalf("expected no selected source records on construction, got %d", got)
	}
}

func TestResolveLocalEnvironmentRuntimeDataRootIdentity(t *testing.T) {
	dataRoot := filepath.Join(t.TempDir(), "Nimi")
	customModelsRoot := filepath.Join(t.TempDir(), "custom-model-store")
	cases := []struct {
		name               string
		configuredDataRoot string
		configuredModels   string
		want               string
	}{
		{
			name:               "configured data root wins",
			configuredDataRoot: dataRoot,
			configuredModels:   customModelsRoot,
			want:               dataRoot,
		},
		{
			name:             "default models child maps to data root",
			configuredModels: filepath.Join(dataRoot, "models"),
			want:             dataRoot,
		},
		{
			name:             "data root caller remains data root",
			configuredModels: dataRoot,
			want:             dataRoot,
		},
		{
			name:             "custom models root without models suffix remains itself",
			configuredModels: customModelsRoot,
			want:             customModelsRoot,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveLocalEnvironmentRuntimeDataRoot(tc.configuredDataRoot, tc.configuredModels); got != tc.want {
				t.Fatalf("runtime data root = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestResolveLocalEnvironmentPlanDefaultRuntimeDataRootUsesServiceDataRootIdentity(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	modelsRoot := svc.resolvedLocalModelsPath()
	dataRoot := filepath.Dir(modelsRoot)
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:        "local-text",
		ConsumerScope: "llama.cpp.cuda",
		HostProfile:   localEnvironmentNvidiaProfile(),
		AssetID:       "text/test-model",
	})
	if plan.RuntimeDataRoot != dataRoot {
		t.Fatalf("default runtime data root = %q, want data root %q", plan.RuntimeDataRoot, dataRoot)
	}
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyNativeLlama)
	wantKey := localEnvironmentKey(dep.DependencyFamily, dep.DependencyID, plan.HostProfileID, plan.PlatformTuple, dataRoot)
	if dep.EnvironmentKey != wantKey {
		t.Fatalf("dependency environment key = %q, want %q", dep.EnvironmentKey, wantKey)
	}
}

func TestResolveLocalEnvironmentPlanIncludesPythonManagedFamilies(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.SetEngineManager(&mockEngineManager{})

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           "local-image-python",
		ConsumerScope:    "media.diffusers.cuda",
		HostProfile:      localEnvironmentNvidiaProfile(),
		RuntimeDataRoot:  filepath.Join(t.TempDir(), "runtime-data"),
		AssetID:          "image/test-python",
		CompanionAssetID: "image/test-companion",
		ParentAssetID:    "image/test-python",
	})

	if plan.State != localEnvironmentStateNeedsConfirmation {
		t.Fatalf("expected setup-required plan, got %s", plan.State)
	}
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyPythonUV)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyPythonRuntime)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyPythonVenv)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyPythonPackageSet)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyPythonTorchWheel)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyModelAsset)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyModelCompanion)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyCUDA)
	for _, dep := range plan.Dependencies {
		if dep.State == localEnvironmentStateReadyManaged || dep.State == localEnvironmentStateReadySystem {
			t.Fatalf("dependency without selected source record projected ready: %+v", dep)
		}
	}
}

func TestResolveLocalEnvironmentPlanRequiresAssetSpecificModelDependency(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-image-python",
		ConsumerScope:   "media.diffusers.cpu",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
	})

	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyModelAsset)
	if dep.State != localEnvironmentStateUnsupported {
		t.Fatalf("model asset dep state = %q, want unsupported", dep.State)
	}
	if dep.ReasonCode != "LOCAL_ENVIRONMENT_ASSET_ID_REQUIRED" {
		t.Fatalf("reason = %q, want asset id required", dep.ReasonCode)
	}
	if dep.DependencyID != "" {
		t.Fatalf("dependency id = %q, want empty without explicit asset identity", dep.DependencyID)
	}
}

func TestResolveLocalEnvironmentPlanIncludesTextAndOptionalCUDA(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		AssetID:         "text/test-model",
	})

	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyNativeLlama)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyModelAsset)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyCUDA)
}

func TestResolveLocalEnvironmentPlanPromotesFirstRunNvidiaCUDAToRequired(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.SetEngineManager(&mockEngineManager{})

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "first-run",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		AssetID:         "text/test-model",
	})

	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyCUDA)
	if !dep.Required {
		t.Fatalf("Windows NVIDIA first-run llama plan must require CUDA runtime dependency: %+v", dep)
	}
	if dep.State != localEnvironmentStateNeedsConfirmation {
		t.Fatalf("CUDA dependency state = %q, want needs_confirmation: %+v", dep.State, dep)
	}
	if !dep.ConfirmationRequired {
		t.Fatalf("CUDA dependency must require first-run materialization confirmation: %+v", dep)
	}
}

func TestResolveLocalEnvironmentPlanKeepsCPUConsumerCUDAOptional(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.SetEngineManager(&mockEngineManager{})

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cpu",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		AssetID:         "text/test-model",
	})

	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyCUDA)
	if dep.Required {
		t.Fatalf("explicit CPU llama consumer must not require CUDA runtime dependency: %+v", dep)
	}
}

func TestResolveLocalEnvironmentPlanRequiresCUDAForCUDAConsumer(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.SetEngineManager(&mockEngineManager{})

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		AssetID:         "text/test-model",
	})

	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyCUDA)
	if !dep.Required {
		t.Fatalf("CUDA llama consumer must require CUDA runtime dependency: %+v", dep)
	}
}

func TestResolveLocalEnvironmentPlanRequiresMaterializerForReadyManagedCUDAProjection(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
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

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-gpu-support",
		ConsumerScope:   "desktop.local-model-center",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
	})

	if plan.State != localEnvironmentStateNeedsConfirmation {
		t.Fatalf("plan state = %q, want needs_confirmation", plan.State)
	}
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyCUDA)
	if dep.State != localEnvironmentStateNeedsConfirmation {
		t.Fatalf("CUDA dependency state = %q, want needs_confirmation: %+v", dep.State, dep)
	}
	if !dep.ConfirmationRequired {
		t.Fatalf("ready managed CUDA projection must still require materializer confirmation: %+v", dep)
	}
	if dep.SelectedSourceRecordID != "" {
		t.Fatalf("CUDA projection must not promote selected source record outside materializer job: %+v", dep)
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecord(dep.EnvironmentKey); ok {
		t.Fatalf("expected no selected source record from plan projection for %q", dep.EnvironmentKey)
	}
}

func TestResolveLocalEnvironmentPlanProjectsCUDARepairRequired(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.SetEngineManager(&mockEngineManager{
		sharedAcceleratorDependencyStatus: &engine.SharedAcceleratorDependencyStatus{
			DependencyID:  cudaUserSpaceRuntimeDependencyID,
			State:         engine.SharedAcceleratorDependencyRepairRequired,
			Source:        "runtime_managed",
			CanonicalRoot: `C:\Users\admin\.nimi\runtime\accelerator-dependencies\nvidia-cuda-user-space-runtime`,
			Detail:        "managed CUDA dependency artifact missing: cublasLt64_12.dll",
		},
	})

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-gpu-support",
		ConsumerScope:   "desktop.local-model-center",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
	})

	if plan.State != localEnvironmentStateRepairRequired {
		t.Fatalf("plan state = %q, want repair_required", plan.State)
	}
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyCUDA)
	if dep.State != localEnvironmentStateRepairRequired {
		t.Fatalf("CUDA dependency state = %q, want repair_required: %+v", dep.State, dep)
	}
	if dep.ConfirmationRequired {
		t.Fatalf("repair-required CUDA dependency must not be projected as first-confirmation setup: %+v", dep)
	}
}

func TestResolveLocalEnvironmentPlanRestoresReadySelectedSourceRecord(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "local-state.json")
	runtimeDataRoot := filepath.Join(dir, "runtime-data")
	profile := localEnvironmentNvidiaProfile()

	svc, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
	})
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyNativeLlama)
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: dep.DependencyFamily,
		DependencyID:     dep.DependencyID,
		EnvironmentKey:   dep.EnvironmentKey,
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    filepath.Join(runtimeDataRoot, "engines", "llama"),
		SelectedConsumers: []string{
			"llama.cpp.cuda",
		},
	})
	writeSelectedSourceLocalArtifactsForTest(t, record)
	svc.upsertLocalEnvironmentSelectedSourceRecord(record)
	svc.Close()

	restored, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer func() { restored.Close() }()
	restoredPlan := restored.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
	})
	restoredDep := findLocalEnvironmentDependency(t, restoredPlan, localEnvironmentFamilyNativeLlama)
	if restoredDep.State != localEnvironmentStateReadyManaged {
		t.Fatalf("expected restored selected source to project ready_managed, got %+v", restoredDep)
	}
	if restoredDep.SelectedSourceRecordID == "" {
		t.Fatalf("expected selected source record id in restored projection")
	}
}

func TestResolveLocalEnvironmentPlanDemotesSelectedSourceWithMissingLocalArtifact(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := runtimeBaselineCPUProfile()
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "speech.qwen3-tts.python",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "speech/test-tts-model",
	})
	var packageDep localEnvironmentPlanDependency
	for _, dep := range plan.Dependencies {
		if dep.DependencyFamily == localEnvironmentFamilyPythonPackageSet && dep.DependencyID == "local-speech-qwen3-tts.package-set" {
			packageDep = dep
			break
		}
	}
	if packageDep.DependencyID == "" {
		t.Fatalf("missing split tts package-set dependency in plan: %+v", plan)
	}
	root := filepath.Join(runtimeDataRoot, "speech", "0.1.0-qwen3-tts")
	driverScript := engine.SpeechQwen3TTSDriverPath(root)
	svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: packageDep.DependencyFamily,
		DependencyID:     packageDep.DependencyID,
		EnvironmentKey:   packageDep.EnvironmentKey,
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    root,
		SelectedConsumers: []string{
			"speech.qwen3-tts.python",
		},
		VerifiedArtifacts: []string{
			filepath.Join(root, "bin", "python"),
			driverScript,
		},
		ActivationEnvDelta: []string{
			"NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD='python' '" + driverScript + "'",
		},
	}))

	repairPlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "speech.qwen3-tts.python",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "speech/test-tts-model",
	})
	repairDep := findLocalEnvironmentDependency(t, repairPlan, localEnvironmentFamilyPythonPackageSet)
	if repairDep.State != localEnvironmentStateRepairRequired {
		t.Fatalf("package-set state = %q, want repair_required: %+v", repairDep.State, repairDep)
	}
	if !strings.Contains(repairDep.Detail, "LOCAL_ENVIRONMENT_SELECTED_SOURCE_ARTIFACT_MISSING") {
		t.Fatalf("repair detail = %q, want missing artifact reason", repairDep.Detail)
	}
	if repairPlan.State != localEnvironmentStateRepairRequired {
		t.Fatalf("plan state = %q, want repair_required", repairPlan.State)
	}
}

func TestResolveLocalEnvironmentPlanRejectsSelectedSourceWithoutVerificationEvidence(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := localEnvironmentNvidiaProfile()

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
	})
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyNativeLlama)
	svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: dep.DependencyFamily,
		DependencyID:     dep.DependencyID,
		EnvironmentKey:   dep.EnvironmentKey,
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    filepath.Join(runtimeDataRoot, "engines", "llama"),
		SelectedConsumers: []string{
			"llama.cpp.cuda",
		},
	})

	stalePlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
	})
	staleDep := findLocalEnvironmentDependency(t, stalePlan, localEnvironmentFamilyNativeLlama)
	if staleDep.State != localEnvironmentStateRepairRequired {
		t.Fatalf("expected unverified selected source to fail closed, got %+v", staleDep)
	}
	if stalePlan.State != localEnvironmentStateRepairRequired {
		t.Fatalf("expected plan repair_required, got %s", stalePlan.State)
	}
}

func TestResolveLocalEnvironmentPlanRepairRecordBlocksDependency(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := localEnvironmentNvidiaProfile()

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
	})
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyNativeLlama)
	svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: dep.DependencyFamily,
		DependencyID:     dep.DependencyID,
		EnvironmentKey:   dep.EnvironmentKey,
		SourceKind:       localEnvironmentSourceManaged,
		RepairState:      localEnvironmentRepairRequired,
		SelectedConsumers: []string{
			"llama.cpp.cuda",
		},
	}))

	repairPlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
	})
	repairDep := findLocalEnvironmentDependency(t, repairPlan, localEnvironmentFamilyNativeLlama)
	if repairDep.State != localEnvironmentStateRepairRequired {
		t.Fatalf("expected repair_required, got %+v", repairDep)
	}
	if repairPlan.State != localEnvironmentStateRepairRequired {
		t.Fatalf("expected plan repair_required, got %s", repairPlan.State)
	}
}

func TestResolveLocalEnvironmentPlanProjectsLatestFailedJob(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := localEnvironmentNvidiaProfile()

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "text/test-model",
	})
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyNativeLlama)
	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), localEnvironmentDependencyJobRequest{
		EnvironmentKey:   dep.EnvironmentKey,
		DependencyFamily: dep.DependencyFamily,
		DependencyID:     dep.DependencyID,
		ConsumerScope:    dep.ConsumerScope,
		SourceKind:       localEnvironmentSourceManaged,
	}, nil)
	if err != nil {
		t.Fatalf("start failed job seed: %v", err)
	}
	if _, ok := svc.transitionLocalEnvironmentDependencyJob(job.JobID, localEnvironmentStateFailed, "backend archive verification failed", true); !ok {
		t.Fatalf("failed to transition job")
	}

	failedPlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "text/test-model",
	})
	failedDep := findLocalEnvironmentDependency(t, failedPlan, localEnvironmentFamilyNativeLlama)
	if failedDep.State != localEnvironmentStateFailed {
		t.Fatalf("dependency state = %q, want failed: %+v", failedDep.State, failedDep)
	}
	if !strings.Contains(failedDep.Detail, "backend archive verification failed") {
		t.Fatalf("dependency detail = %q, want job failure detail", failedDep.Detail)
	}
	if failedPlan.State != localEnvironmentStateFailed {
		t.Fatalf("plan state = %q, want failed", failedPlan.State)
	}
}

func TestResolveLocalEnvironmentPlanDoesNotReuseSelectedSourceAcrossConsumers(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := localEnvironmentAppleSilicon128GBProfile()

	metalPlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           "local-image-native",
		ConsumerScope:    "stable-diffusion.cpp.metal",
		HostProfile:      profile,
		RuntimeDataRoot:  runtimeDataRoot,
		AssetID:          "image/test-sd",
		CompanionAssetID: "image/test-lora",
		ParentAssetID:    "image/test-sd",
	})
	metalDep := findLocalEnvironmentDependency(t, metalPlan, localEnvironmentFamilyNativeSDCPP)
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  metalDep.DependencyFamily,
		DependencyID:      metalDep.DependencyID,
		EnvironmentKey:    metalDep.EnvironmentKey,
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     filepath.Join(runtimeDataRoot, "native-sdcpp-metal"),
		SelectedConsumers: []string{"stable-diffusion.cpp.metal"},
	})
	writeSelectedSourceLocalArtifactsForTest(t, record)
	svc.upsertLocalEnvironmentSelectedSourceRecord(record)

	unknownPlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           "local-image-native",
		ConsumerScope:    "stable-diffusion.cpp.unknown",
		HostProfile:      profile,
		RuntimeDataRoot:  runtimeDataRoot,
		AssetID:          "image/test-sd",
		CompanionAssetID: "image/test-lora",
		ParentAssetID:    "image/test-sd",
	})
	unknownDep := findLocalEnvironmentDependency(t, unknownPlan, localEnvironmentFamilyNativeSDCPP)
	if unknownDep.EnvironmentKey != metalDep.EnvironmentKey {
		t.Fatalf("test requires shared five-part EnvironmentKey, got metal=%q unknown=%q", metalDep.EnvironmentKey, unknownDep.EnvironmentKey)
	}
	if unknownDep.State == localEnvironmentStateReadyManaged || unknownDep.State == localEnvironmentStateReadySystem {
		t.Fatalf("unknown consumer reused metal selected source: %+v", unknownDep)
	}
	if unknownDep.State != localEnvironmentStateUnsupported {
		t.Fatalf("unknown consumer state = %q, want unsupported: %+v", unknownDep.State, unknownDep)
	}
}

func TestResolveLocalEnvironmentPlanDoesNotProjectLatestJobAcrossConsumers(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := localEnvironmentAppleSilicon128GBProfile()

	metalPlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           "local-image-native",
		ConsumerScope:    "stable-diffusion.cpp.metal",
		HostProfile:      profile,
		RuntimeDataRoot:  runtimeDataRoot,
		AssetID:          "image/test-sd",
		CompanionAssetID: "image/test-lora",
		ParentAssetID:    "image/test-sd",
	})
	metalDep := findLocalEnvironmentDependency(t, metalPlan, localEnvironmentFamilyNativeSDCPP)
	unknownJob, err := svc.startLocalEnvironmentDependencyJob(context.Background(), localEnvironmentDependencyJobRequest{
		EnvironmentKey:   metalDep.EnvironmentKey,
		DependencyFamily: metalDep.DependencyFamily,
		DependencyID:     metalDep.DependencyID,
		ConsumerScope:    "stable-diffusion.cpp.unknown",
		SourceKind:       localEnvironmentSourceManaged,
	}, nil)
	if err != nil {
		t.Fatalf("start unknown failed job seed: %v", err)
	}
	if _, ok := svc.transitionLocalEnvironmentDependencyJob(unknownJob.JobID, localEnvironmentStateFailed, "unknown consumer package failed", true); !ok {
		t.Fatalf("failed to transition unknown job")
	}

	nextMetalPlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           "local-image-native",
		ConsumerScope:    "stable-diffusion.cpp.metal",
		HostProfile:      profile,
		RuntimeDataRoot:  runtimeDataRoot,
		AssetID:          "image/test-sd",
		CompanionAssetID: "image/test-lora",
		ParentAssetID:    "image/test-sd",
	})
	nextMetalDep := findLocalEnvironmentDependency(t, nextMetalPlan, localEnvironmentFamilyNativeSDCPP)
	if nextMetalDep.State == localEnvironmentStateFailed || strings.Contains(nextMetalDep.Detail, "unknown consumer package failed") {
		t.Fatalf("metal plan consumed unknown consumer failed job: %+v", nextMetalDep)
	}
}

func TestResolveLocalEnvironmentPlanUnknownPackUnsupported(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:      "missing-pack",
		HostProfile: localEnvironmentNvidiaProfile(),
	})
	if plan.State != localEnvironmentStateUnsupported {
		t.Fatalf("expected unsupported, got %s", plan.State)
	}
	if len(plan.Dependencies) != 0 {
		t.Fatalf("expected no dependencies for unsupported pack, got %d", len(plan.Dependencies))
	}
}

func newLocalEnvironmentTestService(t *testing.T) *Service {
	t.Helper()
	dir := t.TempDir()
	svc, err := New(slog.Default(), nil, filepath.Join(dir, "local-state.json"), 10, filepath.Join(dir, "models"))
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	return svc
}

func localEnvironmentNvidiaProfile() *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{
		Os:   "windows",
		Arch: "amd64",
		Gpu: &runtimev1.LocalGpuProfile{
			Available: true,
			Vendor:    "nvidia",
			Model:     "test gpu",
		},
		Python: &runtimev1.LocalPythonProfile{Available: false},
	}
}

func assertLocalEnvironmentFamily(t *testing.T, plan localEnvironmentPlan, family string) {
	t.Helper()
	_ = findLocalEnvironmentDependency(t, plan, family)
}

func findLocalEnvironmentDependency(t *testing.T, plan localEnvironmentPlan, family string) localEnvironmentPlanDependency {
	t.Helper()
	for _, dep := range plan.Dependencies {
		if dep.DependencyFamily == family {
			return dep
		}
	}
	t.Fatalf("missing dependency family %s in plan %+v", family, plan)
	return localEnvironmentPlanDependency{}
}
