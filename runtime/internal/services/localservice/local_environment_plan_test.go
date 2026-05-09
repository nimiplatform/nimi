package localservice

import (
	"log/slog"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestLocalEnvironmentServiceConstructionDoesNotResolveLocalCompute(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()

	if got := len(svc.localEnvironmentHostProfiles); got != 0 {
		t.Fatalf("expected no host profile snapshots on construction, got %d", got)
	}
	if got := len(svc.localEnvironmentSelectedSources); got != 0 {
		t.Fatalf("expected no selected source records on construction, got %d", got)
	}
}

func TestResolveLocalEnvironmentPlanIncludesPythonManagedFamilies(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()

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
	defer svc.Close()

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
	defer svc.Close()

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

func TestResolveLocalEnvironmentPlanRequiresMaterializerForReadyManagedCUDAProjection(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()
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
	defer svc.Close()
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
	svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: dep.DependencyFamily,
		DependencyID:     dep.DependencyID,
		EnvironmentKey:   dep.EnvironmentKey,
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    filepath.Join(runtimeDataRoot, "engines", "llama"),
	}))
	svc.Close()

	restored, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer restored.Close()
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

func TestResolveLocalEnvironmentPlanRejectsSelectedSourceWithoutVerificationEvidence(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()
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
	defer svc.Close()
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

func TestResolveLocalEnvironmentPlanUnknownPackUnsupported(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()

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
