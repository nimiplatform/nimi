package localservice

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
)

// localEnvironmentAppleSilicon128GBProfile is a capable Apple-Silicon host:
// 128 GiB unified memory, Metal GPU, Python available. It fits every minimal
// preset chat/speech variant.
func localEnvironmentAppleSilicon128GBProfile() *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{
		Os:            "darwin",
		Arch:          "arm64",
		TotalRamBytes: int64(128) << 30,
		Gpu: &runtimev1.LocalGpuProfile{
			Available:   true,
			Vendor:      "apple",
			Model:       "Apple M4 Max",
			MemoryModel: runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED,
		},
		Python: &runtimev1.LocalPythonProfile{Available: true, Version: "3.11.6"},
	}
}

// localEnvironmentTooWeakProfile is a 2 GiB CPU-only host: no minimal preset
// model variant is runnable, so the resolver fails closed.
func localEnvironmentTooWeakProfile() *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{
		Os:            "linux",
		Arch:          "amd64",
		TotalRamBytes: int64(2) << 30,
	}
}

func planDependenciesByFamily(plan localEnvironmentPlan, family string) []localEnvironmentPlanDependency {
	out := make([]localEnvironmentPlanDependency, 0, 2)
	for _, dep := range plan.Dependencies {
		if dep.DependencyFamily == family {
			out = append(out, dep)
		}
	}
	return out
}

func TestPlanResolvedSlotConsumerScopeMapsNativeImageAccelerator(t *testing.T) {
	def := localComputePackDefinition{PackID: "local-image-native"}
	req := localEnvironmentPlanRequest{ConsumerScope: "desktop.first-run"}
	for _, tc := range []struct {
		accelerator string
		want        string
	}{
		{accelerator: "cuda", want: stableDiffusionCUDAConsumerID},
		{accelerator: "metal", want: "stable-diffusion.cpp.metal"},
		{accelerator: "cpu", want: "stable-diffusion.cpp.cpu"},
	} {
		slot := catalog.ResolvedSlot{
			Capability:  localResolverCapabilityImageGenerate,
			Accelerator: tc.accelerator,
		}
		if got := planResolvedSlotConsumerScope(def, slot, req); got != tc.want {
			t.Fatalf("image slot accelerator %q consumer scope = %q, want %q", tc.accelerator, got, tc.want)
		}
	}
}

// TestResolveLocalEnvironmentPlanInstallLevelResolvesTextModelAsset verifies the
// design/05 §2-3 materialization seam: a local-text plan with install_level and
// no explicit assetId resolves the single model.asset dependency to a concrete
// resolver-filled asset id on a capable host — closing the empty-DependencyID
// fail-close that the desktop first-run install-level screen previously hit.
func TestResolveLocalEnvironmentPlanInstallLevelResolvesTextModelAsset(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "desktop.first-run",
		HostProfile:     localEnvironmentAppleSilicon128GBProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		InstallLevel:    localEnvironmentInstallLevelMinimal,
	})

	modelDeps := planDependenciesByFamily(plan, localEnvironmentFamilyModelAsset)
	if len(modelDeps) != 1 {
		t.Fatalf("local-text hosts one slot; want 1 model.asset dependency, got %d", len(modelDeps))
	}
	dep := modelDeps[0]
	if strings.TrimSpace(dep.DependencyID) == "" {
		t.Fatalf("install-level resolution produced an empty model.asset DependencyID: %+v", dep)
	}
	if strings.HasPrefix(dep.DependencyID, "asset-id:") || strings.HasPrefix(dep.DependencyID, "asset:") {
		t.Fatalf("model.asset DependencyID = %q, want canonical semantic asset_id without namespace prefix", dep.DependencyID)
	}
	if dep.State == localEnvironmentStateUnsupported {
		t.Fatalf("capable host model.asset must not be unsupported: %+v", dep)
	}
	if dep.ReasonCode == "LOCAL_ENVIRONMENT_ASSET_ID_REQUIRED" {
		t.Fatalf("install-level resolution must not leave model.asset on LOCAL_ENVIRONMENT_ASSET_ID_REQUIRED: %+v", dep)
	}
	if dep.ConsumerScope != "llama.cpp.cpu" {
		t.Fatalf("first-run local-text model.asset consumer_scope = %q, want llama.cpp.cpu", dep.ConsumerScope)
	}
	nativeDep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyNativeLlama)
	if nativeDep.ConsumerScope != "llama.cpp.cpu" {
		t.Fatalf("first-run local-text native llama consumer_scope = %q, want llama.cpp.cpu", nativeDep.ConsumerScope)
	}
}

// TestResolveLocalEnvironmentPlanInstallLevelResolvesSpeechModelAssetsOnePerSlot
// verifies the 1:N change: the local-speech pack hosts the audio.transcribe and
// audio.synthesize slots, so install-level resolution emits TWO model.asset
// dependencies, each with its own distinct resolver-filled asset id.
func TestResolveLocalEnvironmentPlanInstallLevelResolvesSpeechModelAssetsOnePerSlot(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "desktop.first-run",
		HostProfile:     localEnvironmentAppleSilicon128GBProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		InstallLevel:    localEnvironmentInstallLevelMinimal,
	})

	modelDeps := planDependenciesByFamily(plan, localEnvironmentFamilyModelAsset)
	if len(modelDeps) != 2 {
		t.Fatalf("local-speech hosts stt + tts; want 2 model.asset dependencies, got %d: %+v", len(modelDeps), modelDeps)
	}
	seen := make(map[string]struct{}, 2)
	for _, dep := range modelDeps {
		if strings.TrimSpace(dep.DependencyID) == "" {
			t.Fatalf("speech model.asset dependency has an empty DependencyID: %+v", dep)
		}
		if dep.State == localEnvironmentStateUnsupported {
			t.Fatalf("capable host speech model.asset must not be unsupported: %+v", dep)
		}
		if _, dup := seen[dep.DependencyID]; dup {
			t.Fatalf("the two speech model.asset dependencies collide on DependencyID %q", dep.DependencyID)
		}
		seen[dep.DependencyID] = struct{}{}
		if dep.EnvironmentKey == "" {
			t.Fatalf("speech model.asset dependency has an empty EnvironmentKey: %+v", dep)
		}
	}
	consumerScopes := map[string]bool{}
	for _, dep := range modelDeps {
		consumerScopes[dep.ConsumerScope] = true
	}
	for _, want := range []string{"speech.qwen3-asr.python", "speech.qwen3-tts.python"} {
		if !consumerScopes[want] {
			t.Fatalf("speech model.asset deps missing consumer_scope %s in %v", want, consumerScopes)
		}
	}
	// The two rows must also carry distinct environment keys (keyed by asset_id).
	if modelDeps[0].EnvironmentKey == modelDeps[1].EnvironmentKey {
		t.Fatal("the two speech model.asset dependencies collide on EnvironmentKey")
	}
}

func TestResolveLocalEnvironmentPlanKeysSpeechPythonProfilesByCompleteInputs(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "desktop.first-run",
		HostProfile:     localEnvironmentAppleSilicon128GBProfile(),
		RuntimeDataRoot: runtimeDataRoot,
		InstallLevel:    localEnvironmentInstallLevelMinimal,
	})

	uvDeps := planDependenciesByFamily(plan, localEnvironmentFamilyPythonUV)
	if len(uvDeps) != 2 {
		t.Fatalf("local-speech uv projections = %d, want one per speech consumer: %+v", len(uvDeps), uvDeps)
	}
	if uvDeps[0].DependencyID != uvDeps[1].DependencyID || uvDeps[0].EnvironmentKey != uvDeps[1].EnvironmentKey {
		t.Fatalf("speech consumers must share managed uv identity: %+v", uvDeps)
	}
	runtimeDeps := planDependenciesByFamily(plan, localEnvironmentFamilyPythonRuntime)
	if len(runtimeDeps) != 2 {
		t.Fatalf("local-speech python.runtime projections = %d, want one per speech consumer: %+v", len(runtimeDeps), runtimeDeps)
	}
	if runtimeDeps[0].DependencyID != runtimeDeps[1].DependencyID || runtimeDeps[0].EnvironmentKey != runtimeDeps[1].EnvironmentKey {
		t.Fatalf("speech consumers must share exact managed Python runtime identity: %+v", runtimeDeps)
	}
	venvDeps := planDependenciesByFamily(plan, localEnvironmentFamilyPythonVenv)
	if len(venvDeps) != 2 {
		t.Fatalf("local-speech venv profile projections = %d, want one per speech consumer: %+v", len(venvDeps), venvDeps)
	}
	packageDeps := planDependenciesByFamily(plan, localEnvironmentFamilyPythonPackageSet)
	if len(packageDeps) != 2 {
		t.Fatalf("local-speech package-set profile projections = %d, want one per speech consumer: %+v", len(packageDeps), packageDeps)
	}
	venvByConsumer := make(map[string]localEnvironmentPlanDependency, len(venvDeps))
	for _, dep := range venvDeps {
		venvByConsumer[dep.ConsumerScope] = dep
	}
	packageByConsumer := make(map[string]localEnvironmentPlanDependency, len(packageDeps))
	for _, dep := range packageDeps {
		packageByConsumer[dep.ConsumerScope] = dep
		if !strings.HasPrefix(dep.DependencyID, "python-profile.") {
			t.Fatalf("speech profile dependency id %q is not derived from the complete profile fingerprint", dep.DependencyID)
		}
		if strings.Contains(dep.DependencyID, "qwen3") || strings.Contains(dep.DependencyID, dep.ConsumerScope) {
			t.Fatalf("speech profile dependency id contains consumer identity: %+v", dep)
		}
	}
	for _, want := range []string{"speech.qwen3-asr.python", "speech.qwen3-tts.python"} {
		venvDep, hasVenv := venvByConsumer[want]
		packageDep, hasPackage := packageByConsumer[want]
		if !hasVenv || !hasPackage {
			t.Fatalf("speech profile projections missing consumer %s: venv=%v package=%v", want, venvByConsumer, packageByConsumer)
		}
		if venvDep.DependencyID != packageDep.DependencyID {
			t.Fatalf("speech venv/package projections disagree on profile identity for %s: venv=%q package=%q", want, venvDep.DependencyID, packageDep.DependencyID)
		}
	}
	if packageByConsumer["speech.qwen3-asr.python"].DependencyID == packageByConsumer["speech.qwen3-tts.python"].DependencyID {
		t.Fatal("Qwen3 ASR and TTS have different exact locks and Driver bundles and must resolve isolated profiles")
	}

	asrPlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "speech.qwen3-asr.python",
		HostProfile:     localEnvironmentAppleSilicon128GBProfile(),
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "qwen3-asr-0.6b-local",
	})
	asrPackageDeps := planDependenciesByFamily(asrPlan, localEnvironmentFamilyPythonPackageSet)
	if len(asrPackageDeps) != 1 || asrPackageDeps[0].DependencyID != packageByConsumer["speech.qwen3-asr.python"].DependencyID {
		t.Fatalf("ASR activation plan profile = %+v, want first-run profile %q", asrPackageDeps, packageByConsumer["speech.qwen3-asr.python"].DependencyID)
	}

	transformersPlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "speech.qwen3-asr-transformers.python",
		HostProfile:     localEnvironmentAppleSilicon128GBProfile(),
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "qwen3-asr-transformers-0.6b-local",
	})
	transformersPackageDeps := planDependenciesByFamily(transformersPlan, localEnvironmentFamilyPythonPackageSet)
	if len(transformersPackageDeps) != 1 || transformersPackageDeps[0].DependencyID == asrPackageDeps[0].DependencyID {
		t.Fatalf("Transformers ASR must resolve its own exact-lock profile: native=%+v transformers=%+v", asrPackageDeps, transformersPackageDeps)
	}

	volatileHostProfile := localEnvironmentAppleSilicon128GBProfile()
	volatileHostProfile.Gpu.Model = "Apple M5 Ultra"
	volatileHostProfile.TotalRamBytes = int64(256) << 30
	volatilePlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "speech.qwen3-asr.python",
		HostProfile:     volatileHostProfile,
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "another-qwen3-asr-model",
	})
	volatilePackageDeps := planDependenciesByFamily(volatilePlan, localEnvironmentFamilyPythonPackageSet)
	if len(volatilePackageDeps) != 1 || volatilePackageDeps[0].DependencyID != asrPackageDeps[0].DependencyID || volatilePackageDeps[0].EnvironmentKey != asrPackageDeps[0].EnvironmentKey {
		t.Fatalf("model and host-profile labels changed profile identity: before=%+v after=%+v", asrPackageDeps, volatilePackageDeps)
	}
}

// TestResolveLocalEnvironmentPlanInstallLevelFailsClosedOnWeakHost verifies the
// fail-close discipline (design/05 §5, K-MCAT-037): on a host too weak to run
// any minimal variant the model.asset dependency stays `unsupported` carrying
// the typed resolver reason — and never an empty DependencyID.
func TestResolveLocalEnvironmentPlanInstallLevelFailsClosedOnWeakHost(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "desktop.first-run",
		HostProfile:     localEnvironmentTooWeakProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		InstallLevel:    localEnvironmentInstallLevelMinimal,
	})

	modelDeps := planDependenciesByFamily(plan, localEnvironmentFamilyModelAsset)
	if len(modelDeps) != 1 {
		t.Fatalf("fail-close emits one typed model.asset dependency, got %d", len(modelDeps))
	}
	dep := modelDeps[0]
	if dep.State != localEnvironmentStateUnsupported {
		t.Fatalf("weak-host model.asset state = %q, want unsupported", dep.State)
	}
	if strings.TrimSpace(dep.DependencyID) == "" {
		t.Fatalf("fail-close must keep a non-empty DependencyID, got empty: %+v", dep)
	}
	if dep.ReasonCode != catalog.ReasonLocalModelResolveHostUnsupported {
		t.Fatalf("fail-close reason = %q, want %q", dep.ReasonCode, catalog.ReasonLocalModelResolveHostUnsupported)
	}
	if plan.State != localEnvironmentStateUnsupported {
		t.Fatalf("plan with an unsupported required dependency state = %q, want unsupported", plan.State)
	}
}

// TestResolveLocalEnvironmentPlanExplicitAssetIDWinsOverInstallLevel verifies an
// explicit AssetID always wins: install-level resolution is skipped, the plan
// keeps the prior single explicit-identity model.asset dependency.
func TestResolveLocalEnvironmentPlanExplicitAssetIDWinsOverInstallLevel(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "desktop.first-run",
		HostProfile:     localEnvironmentAppleSilicon128GBProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		AssetID:         "explicit/caller-asset",
		InstallLevel:    localEnvironmentInstallLevelMinimal,
	})

	modelDeps := planDependenciesByFamily(plan, localEnvironmentFamilyModelAsset)
	if len(modelDeps) != 1 {
		t.Fatalf("explicit AssetID keeps exactly-1 model.asset dependency, got %d", len(modelDeps))
	}
	if modelDeps[0].DependencyID != "explicit/caller-asset" {
		t.Fatalf("explicit AssetID DependencyID = %q, want the caller-supplied identity", modelDeps[0].DependencyID)
	}
}

// TestResolveLocalEnvironmentPlanInstallLevelOmittedHostProfileSelfCollects is
// the e2e regression for the desktop first-run `blocked` defect: the desktop
// ResolveLocalEnvironmentPlan call carries no host_profile, so req.HostProfile
// is nil. The install-level resolver MUST run against the host posture this
// plan self-collects — not the nil request profile, which would zero the RAM
// budget and fail-close every cpu variant even on a capable host. The CI host
// running this test always satisfies the 4-9 GiB minimal text variants, so a
// resolved (non-unsupported) model.asset proves the host posture reached the
// resolver.
func TestResolveLocalEnvironmentPlanInstallLevelOmittedHostProfileSelfCollects(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "desktop.first-run",
		HostProfile:     nil, // desktop sends no host_profile on this RPC
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		InstallLevel:    localEnvironmentInstallLevelMinimal,
	})

	modelDeps := planDependenciesByFamily(plan, localEnvironmentFamilyModelAsset)
	if len(modelDeps) != 1 {
		t.Fatalf("local-text hosts one slot; want 1 model.asset dependency, got %d", len(modelDeps))
	}
	dep := modelDeps[0]
	if dep.State == localEnvironmentStateUnsupported {
		t.Fatalf("a nil request host_profile must self-collect the host posture, not fail-close the resolver; got unsupported dep %+v", dep)
	}
	if dep.ReasonCode == catalog.ReasonLocalModelResolveHostUnsupported {
		t.Fatalf("nil host_profile must not project local_model_resolve_host_unsupported on a capable host: %+v", dep)
	}
	if strings.TrimSpace(dep.DependencyID) == "" {
		t.Fatalf("self-collected install-level resolution produced an empty model.asset DependencyID: %+v", dep)
	}
}

// TestResolveLocalEnvironmentPlanRPCThreadsInstallLevel verifies the
// ResolveLocalEnvironmentPlan RPC passes install_level into plan resolution so
// the desktop materialization seam reaches the resolver.
func TestResolveLocalEnvironmentPlanRPCThreadsInstallLevel(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	resp, err := svc.ResolveLocalEnvironmentPlan(context.Background(), &runtimev1.ResolveLocalEnvironmentPlanRequest{
		PackId:          "local-text",
		ConsumerScope:   "desktop.first-run",
		HostProfile:     localEnvironmentAppleSilicon128GBProfile(),
		RuntimeDataRoot: svc.localEnvironmentRuntimeDataRoot(),
		InstallLevel:    localEnvironmentInstallLevelMinimal,
	})
	if err != nil {
		t.Fatalf("ResolveLocalEnvironmentPlan RPC transport error: %v", err)
	}
	var modelDep *runtimev1.LocalEnvironmentPlanDependency
	for _, dep := range resp.GetPlan().GetDependencies() {
		if dep.GetDependencyFamily() == localEnvironmentFamilyModelAsset {
			modelDep = dep
			break
		}
	}
	if modelDep == nil {
		t.Fatal("RPC plan has no model.asset dependency")
	}
	if strings.TrimSpace(modelDep.GetDependencyId()) == "" {
		t.Fatalf("RPC-driven install-level resolution produced an empty model.asset dependency_id: %+v", modelDep)
	}
}
