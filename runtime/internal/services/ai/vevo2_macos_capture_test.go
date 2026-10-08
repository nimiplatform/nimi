package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"path/filepath"
	"strings"
	"testing"
)

func TestMacVeVo2AssemblySurvivesCaptureIdentityAndReconstruction(t *testing.T) {
	root := t.TempDir()
	driver := capabilitydriver.VeVo2AudioCppDriver{}
	requirements, reason := driver.ProjectRecipe(capabilitydriver.VeVo2RecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	selected := &localexecution.SelectedLocalExecution{Configured: true, LoadoutID: "mac-vevo2", RecipeID: capabilitydriver.VeVo2RecipeID,
		RecipeRevision: "test-revision", CapabilityContract: capabilitydriver.VoiceConvertCapabilityContract, Requirements: requirements,
		DriverIdentity: (&capabilitydriver.Identity{ImplementationID: capabilitydriver.VeVo2ImplementationID, DriverID: capabilitydriver.VeVo2DriverID, DriverDialect: capabilitydriver.VeVo2DriverDialect}).Proto(),
		ExactBindings: []localexecution.ExactBinding{{RequirementID: capabilitydriver.VeVo2RequirementID,
			RequirementRole: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, ModelAssetID: "exact-vevo2",
			VerifiedContentID: capabilitydriver.VeVo2VerifiedContentID, EntrySHA256: strings.TrimPrefix(capabilitydriver.VeVo2VerifiedContentID, "sha256:"),
			AbsolutePath: filepath.Join(root, "vevo2.gguf"), DeclaredFiles: []string{"vevo2.gguf"}}},
		ExactDependencySources: []localexecution.ExactDependencySource{{DependencyFamily: "native-engine-package.audio-cpp", DependencyID: "audio.cpp.package",
			ConsumerScope: "audio.cpp.vevo2.cpu", Version: "release-0.8.1@f2b4937306daa25f5c78520f3c626ed31495a37a", SelectedSourceRecordID: "mac-native",
			CanonicalRoot: root, VerifiedArtifacts: []string{filepath.Join(root, "audiocpp_cli")}}}}
	pkg, err := audioCppRuntimePackageInput(selected)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := driver.PlanVoiceConvertInvocation(capabilitydriver.VoiceConvertInvocationInput{LoadoutID: selected.LoadoutID, RecipeID: selected.RecipeID,
		ExactBindings: projectInvocationExactBindings(selected.ExactBindings), Package: pkg,
		Request: &runtimev1.AudioVoiceConvertScenarioSpec{SourceKind: runtimev1.VoiceConvertSourceKind_VOICE_CONVERT_SOURCE_KIND_SINGING,
			SourceVocal: &runtimev1.MusicAudioInput{ArtifactId: "owned-singing"}, TargetVoice: &runtimev1.VoiceConvertTargetVoice{Target: &runtimev1.VoiceConvertTargetVoice_ReferenceAudio{ReferenceAudio: &runtimev1.MusicAudioInput{ArtifactId: "owned-reference"}}}},
		SourceInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 44100, Channels: 2, FrameCount: 352800},
		TargetInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 24000, Channels: 1, FrameCount: 67200},
		StagingDir: root, SourcePath: filepath.Join(root, "source.wav"), TargetPath: filepath.Join(root, "target.wav")})
	if err != nil {
		t.Fatal(err)
	}
	assembly, err := localResolvedAssemblyForVoiceConvert(selected, plan)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := projectResolvedAssemblyEffectiveInputIdentity(assembly); err != nil {
		t.Fatalf("real CPU plan failed submission identity: %v", err)
	}
	persisted, err := cloneLocalResolvedAssembly(assembly)
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{capabilityDrivers: capabilitydriver.NewProductionRegistry()}
	restored, err := s.localVoiceConvertFromResolvedAssembly(persisted)
	if err != nil || restored.plan.AudioCppPackageID() != capabilitydriver.AudioCppMacOSPackageID || restored.plan.CUDA13SelectedSourceRecordID() != "" {
		t.Fatalf("CPU capture did not reconstruct: %+v %v", restored, err)
	}
	for _, mutate := range []func(*localResolvedAssembly){
		func(a *localResolvedAssembly) { a.LoadPlan.Music.CUDA13SelectedSourceRecordID = "substituted-cuda" },
		func(a *localResolvedAssembly) { a.LoadPlan.Music.AudioCppExecutablePath += ".exe" },
		func(a *localResolvedAssembly) { a.LoadPlan.Music.AudioCppSelectedSourceRecordID = "another-source" },
		func(a *localResolvedAssembly) { a.DriverIdentity.DriverID = capabilitydriver.SeedVCDriverID },
		func(a *localResolvedAssembly) { a.LoadPlan.Kind = "music" },
		func(a *localResolvedAssembly) { a.DependencySources = nil },
	} {
		copy, err := cloneLocalResolvedAssembly(assembly)
		if err != nil {
			t.Fatal(err)
		}
		mutate(copy)
		if _, err := s.localVoiceConvertFromResolvedAssembly(copy); err == nil {
			t.Fatal("substituted CPU assembly reconstructed")
		}
	}
}

func TestMacAudioCppCaptureRequiresExactVeVo2SourceAndNoCUDA(t *testing.T) {
	root := t.TempDir()
	selected := &localexecution.SelectedLocalExecution{CapabilityContract: capabilitydriver.VoiceConvertCapabilityContract, DriverIdentity: (&capabilitydriver.Identity{ImplementationID: capabilitydriver.VeVo2ImplementationID, DriverID: capabilitydriver.VeVo2DriverID, DriverDialect: capabilitydriver.VeVo2DriverDialect}).Proto(), ExactDependencySources: []localexecution.ExactDependencySource{{DependencyFamily: "native-engine-package.audio-cpp", DependencyID: "audio.cpp.package", ConsumerScope: "audio.cpp.vevo2.cpu", Version: "release-0.8.1@f2b4937306daa25f5c78520f3c626ed31495a37a", SelectedSourceRecordID: "mac-native", CanonicalRoot: root, VerifiedArtifacts: []string{filepath.Join(root, "audiocpp_cli")}}}}
	pkg, err := audioCppRuntimePackageInput(selected)
	if err != nil || pkg.AudioCppPackageID != capabilitydriver.AudioCppMacOSPackageID || pkg.CUDA13Root != "" {
		t.Fatalf("capture=%+v err=%v", pkg, err)
	}
	selected.DriverIdentity.DriverId = capabilitydriver.SeedVCDriverID
	if _, err := audioCppRuntimePackageInput(selected); err == nil {
		t.Fatal("Mac native package widened to another Driver")
	}
	selected.DriverIdentity.DriverId = capabilitydriver.VeVo2DriverID
	selected.ExactDependencySources = append(selected.ExactDependencySources, localexecution.ExactDependencySource{DependencyFamily: "accelerator.cuda.runtime", DependencyID: capabilitydriver.AudioCppCUDA13RuntimeDependencyID, SelectedSourceRecordID: "cuda", CanonicalRoot: root})
	if _, err := audioCppRuntimePackageInput(selected); err == nil {
		t.Fatal("CPU capture silently discarded CUDA source")
	}
}
