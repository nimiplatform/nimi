package localservice

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"path/filepath"
	"testing"
)

func TestVeVo2MacCatalogRecipeProjectsCPUOfferWithoutWindowsCPUAdmission(t *testing.T) {
	previousOS, previousArch := localRuntimeGOOS, localRuntimeGOARCH
	t.Cleanup(func() { localRuntimeGOOS, localRuntimeGOARCH = previousOS, previousArch })
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()
	localRuntimeGOOS, localRuntimeGOARCH = "darwin", "arm64"
	listed, err := svc.ListLoadoutRecipes(context.Background(), &runtimev1.ListLoadoutRecipesRequest{CapabilityContract: capabilitydriver.VoiceConvertCapabilityContract})
	if err != nil {
		t.Fatal(err)
	}
	var vevo *runtimev1.LoadoutRecipeDescriptor
	for _, recipe := range listed.GetRecipes() {
		if recipe.GetRecipeId() == capabilitydriver.VeVo2RecipeID {
			vevo = recipe
		}
	}
	if vevo == nil || vevo.GetApplicability() == runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNSUPPORTED {
		t.Fatalf("Mac CPU offer remained blocked: %+v", vevo)
	}
	if len(vevo.GetSlots()) != 1 {
		t.Fatal("changed VeVo2 slot count")
	}
	if _, _, supported := localEnvironmentTargetForDriver(capabilitydriver.VeVo2AudioCppDriver{}, localEnvironmentHostProfileState{OS: "windows", Arch: "amd64"}); supported {
		t.Fatal("Windows CPU execution plane was admitted")
	}
	if _, _, supported := localEnvironmentTargetForDriver(capabilitydriver.VeVo2AudioCppDriver{}, localEnvironmentHostProfileState{OS: "windows", Arch: "amd64", GPUAvailable: true, GPUVendor: "nvidia"}); !supported {
		t.Fatal("existing Windows CUDA plane was removed")
	}
	variants := vevo.GetSlots()[0].GetRecommendedVariantIds()
	if len(variants) != 1 || variants[0] != "local.audio.voice.convert.vevo2.audio-cpp.q8.cpu" {
		t.Fatalf("Mac chose CUDA variant: %v", variants)
	}
}

func TestVeVo2MacPlanAndCaptureHaveOnlyVerifiedNativeSource(t *testing.T) {
	previousOS, previousArch := localRuntimeGOOS, localRuntimeGOARCH
	localRuntimeGOOS, localRuntimeGOARCH = "darwin", "arm64"
	t.Cleanup(func() { localRuntimeGOOS, localRuntimeGOARCH = previousOS, previousArch })
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()
	manager := &mockEngineManager{}
	svc.SetEngineManager(manager)
	pack, consumer, ok := localEnvironmentTargetForDriver(capabilitydriver.VeVo2AudioCppDriver{}, localEnvironmentHostProfileFromDeviceProfile(localEnvironmentAppleSilicon128GBProfile()))
	if !ok || consumer != audioCppVeVo2CPUConsumerID {
		t.Fatal("Mac conversion target is not CPU")
	}
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{PackID: pack, ConsumerScope: consumer, HostProfile: localEnvironmentAppleSilicon128GBProfile(), RuntimeDataRoot: t.TempDir()})
	if len(plan.Dependencies) != 1 || plan.Dependencies[0].DependencyFamily != localEnvironmentFamilyNativeAudioCPP || plan.Dependencies[0].State == localEnvironmentStateUnsupported {
		t.Fatalf("CPU plan has wrong dependencies: %+v", plan)
	}
	root := filepath.Join(t.TempDir(), "audio-cpp")
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{RecordID: "mac-audio", EnvironmentKey: plan.Dependencies[0].EnvironmentKey, DependencyFamily: localEnvironmentFamilyNativeAudioCPP, DependencyID: "audio.cpp.package", CanonicalRoot: root, Version: engine.AudioCppSelectedSourceVersion, VerifiedArtifacts: []string{"audiocpp_cli"}, SelectedConsumers: []string{audioCppVeVo2CPUConsumerID}})
	writeSelectedSourceLocalArtifactsForTest(t, record)
	svc.upsertLocalEnvironmentSelectedSourceRecord(record)
	identity := (&capabilitydriver.Identity{ImplementationID: capabilitydriver.VeVo2ImplementationID, DriverID: capabilitydriver.VeVo2DriverID, DriverDialect: capabilitydriver.VeVo2DriverDialect}).Proto()
	sources, err := svc.resolveSelectedLocalExecutionDependencySources(capabilitydriver.VoiceConvertCapabilityContract, capabilitydriver.VeVo2AudioCppDriver{}, identity)
	if err != nil || len(sources) != 1 || sources[0].ConsumerScope != consumer || sources[0].SelectedSourceRecordID != "mac-audio" || manager.verifyEngineBinaryDependencyCalls != 1 {
		t.Fatalf("capture=%+v err=%v", sources, err)
	}
	wrong := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{PackID: "local-music-native", ConsumerScope: audioCppCUDAConsumerID, HostProfile: localEnvironmentAppleSilicon128GBProfile(), RuntimeDataRoot: t.TempDir()})
	if wrong.State != localEnvironmentStateUnsupported {
		t.Fatal("Mac package admitted a CUDA route")
	}
}
