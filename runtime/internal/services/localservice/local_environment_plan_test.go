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

func TestResolveLocalEnvironmentRuntimeDataRootDoesNotInferFromModelsPath(t *testing.T) {
	dataRoot := filepath.Join(t.TempDir(), "Nimi")
	cases := []struct {
		name       string
		configured string
		want       string
	}{
		{
			name:       "configured data root is retained",
			configured: dataRoot,
			want:       dataRoot,
		},
		{
			name:       "missing Product Control root remains missing",
			configured: "",
			want:       "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveLocalEnvironmentRuntimeDataRoot(tc.configured); got != tc.want {
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

	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           "local-image-python",
		ConsumerScope:    "media.diffusers.cuda",
		HostProfile:      localEnvironmentNvidiaProfile(),
		RuntimeDataRoot:  runtimeDataRoot,
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
	imageVenv := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonVenv)
	imagePackages := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonPackageSet)
	if imageVenv.DependencyID != imagePackages.DependencyID || !strings.HasPrefix(imagePackages.DependencyID, "python-profile.") {
		t.Fatalf("media venv/package-set do not project one complete dependency profile: venv=%+v package=%+v", imageVenv, imagePackages)
	}
	videoPlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-video-python",
		ConsumerScope:   "media.video-python.cuda",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "video/test-python",
	})
	videoPackages := findLocalEnvironmentDependency(t, videoPlan, localEnvironmentFamilyPythonPackageSet)
	if videoPackages.DependencyID != imagePackages.DependencyID || videoPackages.EnvironmentKey != imagePackages.EnvironmentKey {
		t.Fatalf("equal image/video dependency inputs did not reuse one media profile: image=%+v video=%+v", imagePackages, videoPackages)
	}
}

func TestResolveLocalSpeechPlanIncludesHostAppropriateTorchWheel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name              string
		profile           *runtimev1.LocalDeviceProfile
		wantTorchID       string
		wantTorchConsumer string
		wantCUDARequired  bool
	}{
		{
			name:              "nvidia",
			profile:           localEnvironmentNvidiaProfile(),
			wantTorchID:       "torch-2.11.0.cuda-cu128.torch-wheel",
			wantTorchConsumer: "speech.qwen3-tts.python.cuda",
			wantCUDARequired:  true,
		},
		{
			name:              "cpu",
			profile:           localEnvironmentCPUProfileForTest(),
			wantTorchID:       "torch-2.11.0.cpu-none.torch-wheel",
			wantTorchConsumer: "speech.qwen3-tts.python.cpu",
			wantCUDARequired:  false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			svc := newLocalEnvironmentTestService(t)
			defer func() { svc.Close() }()
			svc.SetEngineManager(&mockEngineManager{})

			plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
				PackID:          "local-speech",
				ConsumerScope:   "speech.qwen3-tts.python",
				HostProfile:     test.profile,
				RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
				AssetID:         "speech/test-tts-model",
			})
			torchDep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonTorchWheel)
			if torchDep.DependencyID != test.wantTorchID || torchDep.ConsumerScope != test.wantTorchConsumer || !torchDep.Required {
				t.Fatalf("Torch dependency = %+v, want id=%q consumer=%q required", torchDep, test.wantTorchID, test.wantTorchConsumer)
			}
			cudaDep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyCUDA)
			if cudaDep.Required != test.wantCUDARequired {
				t.Fatalf("CUDA dependency required = %t, want %t: %+v", cudaDep.Required, test.wantCUDARequired, cudaDep)
			}
			if test.wantCUDARequired && cudaDep.ConsumerScope != "speech.qwen3-tts.python.cuda" {
				t.Fatalf("CUDA consumer = %q, want exact TTS CUDA consumer", cudaDep.ConsumerScope)
			}
		})
	}
}

func TestResolveLocalSpeechPlanProjectsRuntimeOwnedCapabilityConfirmation(t *testing.T) {
	t.Parallel()

	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.SetEngineManager(&mockEngineManager{})

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "speech.qwen3-tts.python",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		AssetID:         "speech/test-tts-model",
	})

	wantFamilies := []string{
		localEnvironmentFamilyPythonUV,
		localEnvironmentFamilyPythonRuntime,
		localEnvironmentFamilyPythonVenv,
		localEnvironmentFamilyPythonPackageSet,
		localEnvironmentFamilyPythonTorchWheel,
		localEnvironmentFamilyModelAsset,
		localEnvironmentFamilyCUDA,
	}
	if strings.Join(plan.RequiredDependencyFamilies, "|") != strings.Join(wantFamilies, "|") {
		t.Fatalf("required dependency families = %v, want %v", plan.RequiredDependencyFamilies, wantFamilies)
	}
	if plan.AggregateSizeKnown || plan.AggregateSizeBytes != 0 {
		t.Fatalf("unmaterialized plan aggregate size = known:%t bytes:%d, want explicitly unknown", plan.AggregateSizeKnown, plan.AggregateSizeBytes)
	}
	wantCategories := []string{"dependencies", "environments", "models"}
	if strings.Join(plan.StorageCategories, "|") != strings.Join(wantCategories, "|") {
		t.Fatalf("storage categories = %v, want %v", plan.StorageCategories, wantCategories)
	}
	if strings.Join(plan.SourceOwners, "|") != "RuntimeLocalService" {
		t.Fatalf("source owners = %v, want RuntimeLocalService", plan.SourceOwners)
	}
	if !plan.NoSystemMutation {
		t.Fatal("Runtime confirmation projection must prohibit system mutation")
	}
	_, readyAggregateKnown, readyAggregateBytes, _, _ := localEnvironmentPlanConfirmationProjection([]localEnvironmentPlanDependency{{
		DependencyFamily: localEnvironmentFamilyPythonUV,
		Required:         true,
		State:            localEnvironmentStateReadyManaged,
	}})
	if readyAggregateKnown || readyAggregateBytes != 0 {
		t.Fatalf("ready dependency without positive size source projected known aggregate: known:%t bytes:%d", readyAggregateKnown, readyAggregateBytes)
	}

	protoPlan := localEnvironmentPlanToProto(plan)
	if strings.Join(protoPlan.GetRequiredDependencyFamilies(), "|") != strings.Join(wantFamilies, "|") ||
		strings.Join(protoPlan.GetStorageCategories(), "|") != strings.Join(wantCategories, "|") ||
		strings.Join(protoPlan.GetSourceOwners(), "|") != "RuntimeLocalService" ||
		protoPlan.GetAggregateSizeKnown() || protoPlan.GetAggregateSizeBytes() != 0 || !protoPlan.GetNoSystemMutation() {
		t.Fatalf("proto confirmation projection does not preserve plan facts: %+v", protoPlan)
	}
}

func TestResolveLocalSpeechTorchWheelIdentityUsesExactWheelSourceAndExcludesConsumerAndHostProfile(t *testing.T) {
	t.Parallel()

	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	ttsProfile := localEnvironmentNvidiaProfile()
	asrProfile := localEnvironmentNvidiaProfile()
	asrProfile.Gpu.Model = "different-card-same-plane"

	resolveTorch := func(t *testing.T, consumer string, profile *runtimev1.LocalDeviceProfile) localEnvironmentPlanDependency {
		t.Helper()
		svc := newLocalEnvironmentTestService(t)
		defer func() { svc.Close() }()
		svc.SetEngineManager(&mockEngineManager{})
		plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
			PackID:          "local-speech",
			ConsumerScope:   consumer,
			HostProfile:     profile,
			RuntimeDataRoot: runtimeDataRoot,
			AssetID:         "speech/test-model",
		})
		return findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonTorchWheel)
	}

	nativeASRTorch := resolveTorch(t, "speech.qwen3-asr.python", ttsProfile)
	transformersASRTorch := resolveTorch(t, "speech.qwen3-asr-transformers.python", asrProfile)
	if nativeASRTorch.DependencyID != transformersASRTorch.DependencyID {
		t.Fatalf("Torch dependency id varies for identical wheel inputs: native=%q transformers=%q", nativeASRTorch.DependencyID, transformersASRTorch.DependencyID)
	}
	if nativeASRTorch.EnvironmentKey != transformersASRTorch.EnvironmentKey {
		t.Fatalf("Torch environment key varies by consumer or host profile for identical wheel inputs: native=%q transformers=%q", nativeASRTorch.EnvironmentKey, transformersASRTorch.EnvironmentKey)
	}
	ttsTorch := resolveTorch(t, "speech.qwen3-tts.python", ttsProfile)
	if ttsTorch.EnvironmentKey == nativeASRTorch.EnvironmentKey {
		t.Fatalf("Torch environment key ignored the distinct TTS wheel lock/source: TTS=%q ASR=%q", ttsTorch.EnvironmentKey, nativeASRTorch.EnvironmentKey)
	}
}

func TestResolvePythonProfileKeepsConsumptionEvidenceOutsideCanonicalTorchSource(t *testing.T) {
	t.Parallel()

	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.SetEngineManager(&mockEngineManager{})
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := localEnvironmentNvidiaProfile()
	profileRoot := filepath.Join(runtimeDataRoot, "environments", "python-profiles", "shared-media")
	packageCacheRoot := filepath.Join(runtimeDataRoot, "dependencies", "python-package-cache")
	writtenProfileDigest := ""

	requestFor := func(packID string, consumer string) localEnvironmentPlanRequest {
		return localEnvironmentPlanRequest{
			PackID:          packID,
			ConsumerScope:   consumer,
			HostProfile:     profile,
			RuntimeDataRoot: runtimeDataRoot,
			AssetID:         "media/test-model",
		}
	}
	installProfileEvidence := func(t *testing.T, packID string, consumer string, activationArtifact string) (localEnvironmentPlanDependency, localEnvironmentPlanDependency) {
		t.Helper()
		plan := svc.resolveLocalEnvironmentPlan(requestFor(packID, consumer))
		packageDep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonPackageSet)
		profileIdentity, err := engine.ResolvePythonDependencyProfileIdentity(consumer, plan.PlatformTuple, "cuda")
		if err != nil {
			t.Fatalf("resolve dependency profile for %q: %v", consumer, err)
		}
		profileRecord := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
			DependencyFamily:      packageDep.DependencyFamily,
			DependencyID:          packageDep.DependencyID,
			EnvironmentKey:        packageDep.EnvironmentKey,
			CanonicalRoot:         profileRoot,
			Version:               profileIdentity.ProfileDigest,
			CompatibilityEvidence: []string{"accelerator_plane=cuda", "import_probe=torch"},
			VerifiedArtifacts:     []string{filepath.Join(profileRoot, activationArtifact)},
			SelectedConsumers:     []string{consumer},
			Hashes:                pythonDependencyProfileHashes(profileIdentity),
		})
		writeSelectedSourceLocalArtifactsForTest(t, profileRecord)
		if writtenProfileDigest == "" {
			writePythonDependencyProfileStaticFilesForTest(t, profileRoot, consumer, profileIdentity)
			writtenProfileDigest = profileIdentity.ProfileDigest
		} else if writtenProfileDigest != profileIdentity.ProfileDigest {
			t.Fatalf("shared profile fixture received distinct profile digests: first=%s %s=%s", writtenProfileDigest, consumer, profileIdentity.ProfileDigest)
		}
		promotedProfile := svc.upsertLocalEnvironmentSelectedSourceRecord(profileRecord)
		recordReadyPythonPackageSetConsumptionJobForTest(svc, promotedProfile, consumer)

		torchDep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonTorchWheel)
		torchIdentity, err := engine.ResolvePythonTorchWheelDependencyIdentity(torchDep.ConsumerScope)
		if err != nil {
			t.Fatalf("resolve Torch identity for %q: %v", torchDep.ConsumerScope, err)
		}
		torchRecord := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
			DependencyFamily:      torchDep.DependencyFamily,
			DependencyID:          torchDep.DependencyID,
			EnvironmentKey:        torchDep.EnvironmentKey,
			CanonicalRoot:         packageCacheRoot,
			Version:               torchIdentity.TorchVersion,
			CompatibilityEvidence: []string{"accelerator_plane=cuda", "cuda_abi=cu126"},
			VerifiedArtifacts:     []string{filepath.Join(packageCacheRoot, "torch-wheel.lock")},
			SelectedConsumers:     []string{torchDep.ConsumerScope},
			Hashes:                map[string]string{"wheel_lock_hash": torchIdentity.WheelLockHash},
		})
		writeSelectedSourceLocalArtifactsForTest(t, torchRecord)
		svc.upsertLocalEnvironmentSelectedSourceRecord(torchRecord)
		return packageDep, torchDep
	}

	imageArtifact := "image-activation.ok"
	imageProfileDep, imageTorchDep := installProfileEvidence(t, "local-image-python", "media.diffusers.cuda", imageArtifact)
	videoArtifact := "video-activation.ok"
	videoProfileDep, videoTorchDep := installProfileEvidence(t, "local-video-python", "media.video-python.cuda", videoArtifact)
	if imageProfileDep.EnvironmentKey != videoProfileDep.EnvironmentKey || imageProfileDep.DependencyID != videoProfileDep.DependencyID {
		t.Fatalf("equal media profile inputs did not share one profile identity: image=%+v video=%+v", imageProfileDep, videoProfileDep)
	}
	if imageTorchDep.EnvironmentKey != videoTorchDep.EnvironmentKey || imageTorchDep.DependencyID != videoTorchDep.DependencyID {
		t.Fatalf("equal media wheel inputs did not share one canonical Torch source: image=%+v video=%+v", imageTorchDep, videoTorchDep)
	}
	statePath := svc.stateStorePath
	modelsPath := svc.localModelsPath
	serviceRuntimeDataRoot := svc.runtimeDataRoot
	svc.Close()
	var err error
	svc, err = NewWithProductControlDataRoot(slog.Default(), nil, statePath, 10, modelsPath, serviceRuntimeDataRoot)
	if err != nil {
		t.Fatalf("restore service with shared Torch evidence: %v", err)
	}
	svc.SetEngineManager(&mockEngineManager{})
	imageRepairJob, err := svc.startLocalEnvironmentDependencyJob(context.Background(), localEnvironmentDependencyJobRequest{
		EnvironmentKey:   imageProfileDep.EnvironmentKey,
		DependencyFamily: imageProfileDep.DependencyFamily,
		DependencyID:     imageProfileDep.DependencyID,
		ConsumerScope:    "media.diffusers.cuda",
		SourceKind:       localEnvironmentSourceManaged,
	}, nil)
	if err != nil {
		t.Fatalf("start image profile repair projection: %v", err)
	}
	if _, ok := svc.transitionLocalEnvironmentDependencyJob(imageRepairJob.JobID, localEnvironmentStateRepairRequired, "image profile consumption requires repair", true); !ok {
		t.Fatal("transition image profile consumption to repair_required")
	}

	imageAfterLoss := findLocalEnvironmentDependency(t, svc.resolveLocalEnvironmentPlan(requestFor("local-image-python", "media.diffusers.cuda")), localEnvironmentFamilyPythonPackageSet)
	if imageAfterLoss.State != localEnvironmentStateRepairRequired {
		t.Fatalf("image profile consumption = %+v, want repair_required after its own evidence is removed", imageAfterLoss)
	}
	videoStillReady := findLocalEnvironmentDependency(t, svc.resolveLocalEnvironmentPlan(requestFor("local-video-python", "media.video-python.cuda")), localEnvironmentFamilyPythonPackageSet)
	if videoStillReady.State != localEnvironmentStateReadyManaged || videoStillReady.CanonicalRoot != profileRoot {
		t.Fatalf("video profile consumption = %+v, want ready evidence at shared root %q", videoStillReady, profileRoot)
	}
	videoTorchStillReady := findLocalEnvironmentDependency(t, svc.resolveLocalEnvironmentPlan(requestFor("local-video-python", "media.video-python.cuda")), localEnvironmentFamilyPythonTorchWheel)
	if videoTorchStillReady.State != localEnvironmentStateReadyManaged || videoTorchStillReady.CanonicalRoot != packageCacheRoot {
		t.Fatalf("canonical Torch source = %+v, want ready shared package cache %q", videoTorchStillReady, packageCacheRoot)
	}
}

func TestResolveLocalSpeechTorchWheelRejectsStaleWheelLock(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.SetEngineManager(&mockEngineManager{})
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	request := localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "speech.qwen3-tts.python",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "speech/test-tts-model",
	}
	plan := svc.resolveLocalEnvironmentPlan(request)
	torchDep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonTorchWheel)
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  torchDep.DependencyFamily,
		DependencyID:      torchDep.DependencyID,
		EnvironmentKey:    torchDep.EnvironmentKey,
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     t.TempDir(),
		Version:           "2.11.0+cu128",
		SelectedConsumers: []string{torchDep.ConsumerScope},
		Hashes:            map[string]string{"wheel_lock_hash": "stale"},
	})
	writeSelectedSourceLocalArtifactsForTest(t, record)
	svc.upsertLocalEnvironmentSelectedSourceRecord(record)

	torchDep = findLocalEnvironmentDependency(t, svc.resolveLocalEnvironmentPlan(request), localEnvironmentFamilyPythonTorchWheel)
	if torchDep.State != localEnvironmentStateRepairRequired || torchDep.Detail != "LOCAL_ENVIRONMENT_TORCH_WHEEL_LOCK_DRIFT" {
		t.Fatalf("Torch dependency = %+v, want repair_required lock drift", torchDep)
	}
}

func TestResolveLocalEnvironmentPlanNativeImageExcludesPythonManagedFamilies(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.SetEngineManager(&mockEngineManager{})

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           "local-image-native",
		ConsumerScope:    stableDiffusionCUDAConsumerID,
		HostProfile:      localEnvironmentNvidiaProfile(),
		RuntimeDataRoot:  filepath.Join(t.TempDir(), "runtime-data"),
		AssetID:          "image/test-native",
		CompanionAssetID: "image/test-companion",
		ParentAssetID:    "image/test-native",
	})

	for _, family := range []string{
		localEnvironmentFamilyPythonUV,
		localEnvironmentFamilyPythonRuntime,
		localEnvironmentFamilyPythonVenv,
		localEnvironmentFamilyPythonPackageSet,
		localEnvironmentFamilyPythonTorchWheel,
	} {
		if deps := planDependenciesByFamily(localEnvironmentPlan{Dependencies: plan.Dependencies}, family); len(deps) != 0 {
			t.Fatalf("local-image-native must not include Python family %s, got %+v", family, deps)
		}
	}
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyNativeSDCPP)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyModelAsset)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyModelCompanion)
	assertLocalEnvironmentFamily(t, plan, localEnvironmentFamilyCUDA)
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

func TestResolveLocalEnvironmentPlanUsesEngineCUDASelectionWhenDetailedFirstRunProbeFails(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.SetEngineManager(&mockEngineManager{
		sharedAcceleratorDependencyStatus: &engine.SharedAcceleratorDependencyStatus{
			DependencyID: cudaUserSpaceRuntimeDependencyID,
			State:        engine.SharedAcceleratorDependencyMaterializableRequiresConfirmation,
			Source:       "runtime_managed",
			Detail:       "nvidia_cuda_user_space_runtime state=materializable_requires_confirmation",
		},
	})

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:        "local-text",
		ConsumerScope: "first-run",
		HostProfile: &runtimev1.LocalDeviceProfile{
			Os:     "windows",
			Arch:   "amd64",
			Gpu:    &runtimev1.LocalGpuProfile{Available: false},
			Python: &runtimev1.LocalPythonProfile{Available: false},
		},
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		AssetID:         "text/test-model",
	})

	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyCUDA)
	if !dep.Required {
		t.Fatalf("Engine-selected first-run CUDA package must require its shared dependency even when the detailed GPU probe is unavailable: %+v", dep)
	}
	if dep.ConsumerScope != "llama.cpp.cuda" {
		t.Fatalf("CUDA dependency consumer scope = %q, want llama.cpp.cuda: %+v", dep.ConsumerScope, dep)
	}
	if dep.State != localEnvironmentStateNeedsConfirmation || !dep.ConfirmationRequired {
		t.Fatalf("CUDA dependency must remain an explicit first-materialization confirmation: %+v", dep)
	}
}

func TestResolveLocalEnvironmentPlanKeepsFirstRunCUDAOptionalWhenEngineSelectionIsUnsupported(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.SetEngineManager(&mockEngineManager{
		sharedAcceleratorDependencyStatus: &engine.SharedAcceleratorDependencyStatus{
			DependencyID: cudaUserSpaceRuntimeDependencyID,
			State:        engine.SharedAcceleratorDependencyUnsupported,
			Source:       "unavailable",
			Detail:       "host accelerator profile does not admit Windows NVIDIA CUDA dependency",
		},
	})

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:        "local-text",
		ConsumerScope: "first-run",
		HostProfile: &runtimev1.LocalDeviceProfile{
			Os:     "windows",
			Arch:   "amd64",
			Gpu:    &runtimev1.LocalGpuProfile{Available: false},
			Python: &runtimev1.LocalPythonProfile{Available: false},
		},
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
		AssetID:         "text/test-model",
	})

	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyCUDA)
	if dep.Required {
		t.Fatalf("Engine-unsupported first-run CUDA dependency must remain optional: %+v", dep)
	}
	if dep.State != localEnvironmentStateUnsupported {
		t.Fatalf("Engine-unsupported first-run CUDA dependency state = %q, want unsupported: %+v", dep.State, dep)
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

func TestResolveLocalEnvironmentPlanRejectsLinuxTTSPythonProfile(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := localEnvironmentCPUProfileForTest()
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "speech.qwen3-tts.python",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "speech/test-tts-model",
	})
	assertUnsupportedLinuxPythonProfileDependency(t, plan, localEnvironmentFamilyPythonPackageSet, "speech.qwen3-tts.python", runtimeDataRoot)
}

func TestResolveLocalEnvironmentPlanRejectsLinuxTransformersASRPythonProfile(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := localEnvironmentCPUProfileForTest()
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   "speech.qwen3-asr-transformers.python",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "speech/test-transformers-asr-model",
	})
	assertUnsupportedLinuxPythonProfileDependency(t, plan, localEnvironmentFamilyPythonPackageSet, "speech.qwen3-asr-transformers.python", runtimeDataRoot)
}

func TestResolveLocalEnvironmentPlanRejectsAllLinuxSpeechPythonProfiles(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	consumer := "speech.qwen3-tts.python"
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-speech",
		ConsumerScope:   consumer,
		HostProfile:     localEnvironmentCPUProfileForTest(),
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "speech/test-tts-model",
	})
	for _, family := range []string{localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet} {
		assertUnsupportedLinuxPythonProfileDependency(t, plan, family, consumer, runtimeDataRoot)
	}
}

func assertUnsupportedLinuxPythonProfileDependency(t *testing.T, plan localEnvironmentPlan, family string, consumer string, runtimeDataRoot string) {
	t.Helper()
	if plan.PlatformTuple != "linux/amd64" {
		t.Fatalf("plan platform = %q, want linux/amd64", plan.PlatformTuple)
	}
	dep := findLocalEnvironmentDependency(t, plan, family)
	if dep.DependencyID != "python-profile.unavailable" || dep.ConsumerScope != consumer {
		t.Fatalf("unsupported Python profile identity = %q/%q, want python-profile.unavailable/%s", dep.DependencyID, dep.ConsumerScope, consumer)
	}
	if dep.State != localEnvironmentStateUnsupported || dep.SourceKind != localEnvironmentSourceUnavailable || !dep.Required || dep.ConfirmationRequired {
		t.Fatalf("Linux Python dependency admission = %+v, want required unsupported/unavailable without confirmation", dep)
	}
	if dep.EnvironmentKey != localEnvironmentPythonProfileKey(family, "python-profile.unavailable", runtimeDataRoot) {
		t.Fatalf("unsupported Python profile environment key = %q", dep.EnvironmentKey)
	}
	if dep.SelectedSourceRecordID != "" || dep.CanonicalRoot != "" {
		t.Fatalf("unsupported Linux Python profile projected selected source: %+v", dep)
	}
	if dep.ReasonCode != "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED" || !strings.Contains(dep.Detail, "not admitted for platform linux/amd64 and accelerator cpu") {
		t.Fatalf("unsupported Linux Python profile reason = %q/%q", dep.ReasonCode, dep.Detail)
	}
	if plan.State != localEnvironmentStateUnsupported || plan.ReasonCode != "LOCAL_ENVIRONMENT_PLAN_UNSUPPORTED" {
		t.Fatalf("Linux Python plan state = %q/%q, want unsupported", plan.State, plan.ReasonCode)
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

func TestResolveLocalImageNativePlanInfersConsumerForExplicitInstalledAsset(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := localEnvironmentNvidiaProfile()
	model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/local-import/z_image_turbo-Q4_K",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K.gguf",
	})

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-image-native",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         model.GetAssetId(),
		LocalAssetID:    model.GetLocalAssetId(),
	})

	if plan.ConsumerScope != stableDiffusionCUDAConsumerID {
		t.Fatalf("plan consumer scope = %q, want %q", plan.ConsumerScope, stableDiffusionCUDAConsumerID)
	}
	for _, dep := range plan.Dependencies {
		if dep.ConsumerScope != stableDiffusionCUDAConsumerID {
			t.Fatalf("dependency %s/%s consumer scope = %q, want %q", dep.DependencyFamily, dep.DependencyID, dep.ConsumerScope, stableDiffusionCUDAConsumerID)
		}
	}
	modelDep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyModelAsset)
	if modelDep.DependencyID != model.GetAssetId() {
		t.Fatalf("explicit installed image model dependency id = %q, want semantic asset id %q", modelDep.DependencyID, model.GetAssetId())
	}
	if strings.Contains(modelDep.DependencyID, model.GetLocalAssetId()) {
		t.Fatalf("model.asset dependency id must not contain local_asset_id %q: %q", model.GetLocalAssetId(), modelDep.DependencyID)
	}
	nativeDep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyNativeSDCPP)
	if nativeDep.State != localEnvironmentStateNeedsConfirmation {
		t.Fatalf("native dependency state = %q, want needs_confirmation: %+v", nativeDep.State, nativeDep)
	}
	cudaDep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyCUDA)
	if !cudaDep.Required {
		t.Fatalf("cuda dependency should be required for inferred CUDA image consumer: %+v", cudaDep)
	}
}

func TestResolveLocalImageNativePlanAcceptsAssetIDLocalAssetIdentity(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := localEnvironmentNvidiaProfile()
	model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/local-import/z_image_turbo-Q4_K",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "z_image_turbo-Q4_K.gguf",
	})

	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-image-native",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         "local/" + model.GetAssetId(),
	})

	if plan.ConsumerScope != stableDiffusionCUDAConsumerID {
		t.Fatalf("plan consumer scope = %q, want %q", plan.ConsumerScope, stableDiffusionCUDAConsumerID)
	}
	modelDep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyModelAsset)
	if modelDep.DependencyID != model.GetAssetId() {
		t.Fatalf("explicit local identity dependency id = %q, want semantic asset id %q", modelDep.DependencyID, model.GetAssetId())
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
	svc, err := NewWithProductControlDataRoot(
		slog.Default(),
		nil,
		filepath.Join(dir, "local-state.json"),
		10,
		filepath.Join(dir, "models"),
		dir,
	)
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
