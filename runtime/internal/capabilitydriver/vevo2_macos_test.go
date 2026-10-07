package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"path/filepath"
	"testing"
)

func TestVeVo2MacCPUPlanRejectsOtherCohortsAndRetainsNativeRoute(t *testing.T) {
	root := t.TempDir()
	input := VoiceConvertInvocationInput{RecipeID: VeVo2RecipeID,
		Package:       AudioCppRuntimePackageInput{AudioCppVersion: AudioCppMusicPackageVersion, AudioCppPackageID: AudioCppMacOSPackageID, AudioCppSelectedSourceRecordID: "selected-mac-cohort", AudioCppRoot: root, AudioCppExecutablePath: filepath.Join(root, "audiocpp_cli")},
		ExactBindings: []InvocationExactBinding{{RequirementID: VeVo2RequirementID, VerifiedContentID: VeVo2VerifiedContentID, AbsolutePath: filepath.Join(root, "vevo2.gguf"), DeclaredFiles: []string{"vevo2.gguf"}}},
		Request:       &runtimev1.AudioVoiceConvertScenarioSpec{SourceKind: runtimev1.VoiceConvertSourceKind_VOICE_CONVERT_SOURCE_KIND_SINGING, SourceVocal: &runtimev1.MusicAudioInput{ArtifactId: "source"}, TargetVoice: &runtimev1.VoiceConvertTargetVoice{Target: &runtimev1.VoiceConvertTargetVoice_ReferenceAudio{ReferenceAudio: &runtimev1.MusicAudioInput{ArtifactId: "target"}}}},
		SourceInfo:    &runtimev1.LocalAppAudioInfo{SampleRateHz: 24000, Channels: 1, FrameCount: 240000}, TargetInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 24000, Channels: 1, FrameCount: 72000},
		StagingDir: root, SourcePath: filepath.Join(root, "source.wav"), TargetPath: filepath.Join(root, "target.wav")}
	plan, err := (VeVo2AudioCppDriver{}).PlanVoiceConvertInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{"--backend": "cpu", "--task": "svc", "--task-route": "style_preserved_svc", "--out-format": "float32"} {
		if got, ok := argValue(plan.CLIArgs(), key); !ok || got != want {
			t.Fatalf("%s=%s, want %s", key, got, want)
		}
	}
	if plan.CUDA13Root() != "" || plan.CUDA13SelectedSourceRecordID() != "" || plan.VoiceConvertRequest().GetSourceVocal().GetRange().GetEndFrame() != 240000 {
		t.Fatal("CPU capture contains CUDA or lost source range")
	}
	for _, mutate := range []func(*VoiceConvertInvocationInput){
		func(i *VoiceConvertInvocationInput) { i.Package.CUDA13DependencyID = AudioCppCUDA13RuntimeDependencyID },
		func(i *VoiceConvertInvocationInput) { i.Package.CUDA13Root = root },
		func(i *VoiceConvertInvocationInput) { i.Package.CUDA13SelectedSourceRecordID = "cuda-source" },
		func(i *VoiceConvertInvocationInput) { i.Package.AudioCppExecutablePath += ".exe" },
		func(i *VoiceConvertInvocationInput) { i.Package.AudioCppPackageID = "other-cohort" },
	} {
		copy := input
		mutate(&copy)
		if _, err := (VeVo2AudioCppDriver{}).PlanVoiceConvertInvocation(copy); err == nil {
			t.Fatal("substituted native cohort admitted")
		}
	}
	input.RecipeID = SeedVCRecipeID
	if _, _, _, err := validateNativeVoiceConvertInput(input, 600); err == nil {
		t.Fatal("Mac cohort widened to SeedVC")
	}
	for _, platform := range []string{"darwin/amd64", "linux/arm64"} {
		if _, reason := (VeVo2AudioCppDriver{}).ProjectRecipeForHost(VeVo2RecipeID, nil, nil, platform); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			t.Fatal("unsupported host admitted")
		}
	}
}
