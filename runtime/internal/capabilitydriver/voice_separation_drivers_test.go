package capabilitydriver

import (
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func nativeAudioCppPackageForTest(root string) AudioCppRuntimePackageInput {
	return AudioCppRuntimePackageInput{AudioCppVersion: AudioCppMusicPackageVersion, AudioCppPackageID: AudioCppWindowsCUDA13PackageID,
		AudioCppSelectedSourceRecordID: "package-source", AudioCppRoot: root, AudioCppExecutablePath: filepath.Join(root, "audiocpp_cli.exe"),
		CUDA13DependencyID: AudioCppCUDA13RuntimeDependencyID, CUDA13SelectedSourceRecordID: "cuda-source", CUDA13Root: root}
}

func argValue(args []string, key string) (string, bool) {
	for index := 0; index+1 < len(args); index++ {
		if args[index] == key {
			return args[index+1], true
		}
	}
	return "", false
}

func TestHTDemucsPlanRequestsCanonicalFloatStemsFromStereoSource(t *testing.T) {
	root := t.TempDir()
	input := AudioSeparateInvocationInput{
		ExactBindings: []InvocationExactBinding{{RequirementID: HTDemucsModelRequirementID, VerifiedContentID: HTDemucsVerifiedContentID,
			AbsolutePath: filepath.Join(root, "htdemucs-q8_0.gguf"), DeclaredFiles: []string{"htdemucs-q8_0.gguf"}}},
		Package: nativeAudioCppPackageForTest(root), Request: &runtimev1.AudioSeparateScenarioSpec{IncludeInstrumentParts: true},
		SourcePath: filepath.Join(root, "source.wav"), StagingDir: root,
		SourceInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 44100, Channels: 2, FrameCount: 1102511, DurationMs: 25000},
	}
	plan, err := (HTDemucsAudioCppDriver{}).PlanAudioSeparateInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	args := plan.NativeCLIArgs()
	if format, ok := argValue(args, "--out-format"); !ok || format != "float32" {
		t.Fatalf("HTDemucs stems would not be canonical float32: %v", args)
	}
	if out, _ := argValue(args, "--out-dir"); out != filepath.Join(root, "stems") || !plan.IsNative() || !plan.IncludeInstrumentParts() {
		t.Fatalf("unexpected native separation plan: %v", args)
	}
	if info := plan.NativeSourceInfo(); info.GetFrameCount() != 1102511 || info.GetChannels() != 2 {
		t.Fatalf("plan lost the submitted source facts: %+v", info)
	}
	for _, info := range []*runtimev1.LocalAppAudioInfo{
		{SampleRateHz: 48000, Channels: 2, FrameCount: 48000},
		{SampleRateHz: 44100, Channels: 1, FrameCount: 44100},
		nil,
	} {
		input.SourceInfo = info
		if _, err := (HTDemucsAudioCppDriver{}).PlanAudioSeparateInvocation(input); err == nil {
			t.Fatalf("source outside the native 44100 Hz stereo domain was admitted: %+v", info)
		}
	}
}

func TestVeVo2ProjectsAndPlansOnlyReferenceAudioTargets(t *testing.T) {
	profiles := (VeVo2AudioCppDriver{}).MusicInputCapabilities().GetVoiceConvert()
	if len(profiles) != 1 || len(profiles[0].GetTargetKinds()) != 1 || profiles[0].GetTargetKinds()[0] != "reference-audio" {
		t.Fatalf("VeVo2 must project only its implemented reference-audio carrier: %+v", profiles)
	}
	root := t.TempDir()
	reference := &runtimev1.VoiceConvertTargetVoice{Target: &runtimev1.VoiceConvertTargetVoice_ReferenceAudio{ReferenceAudio: &runtimev1.MusicAudioInput{
		ArtifactId: "target-artifact", Range: &runtimev1.AudioFrameRange{StartFrame: 88200, EndFrame: 352800}}}}
	input := VoiceConvertInvocationInput{LoadoutID: "loadout", RecipeID: VeVo2RecipeID, Package: nativeAudioCppPackageForTest(root),
		ExactBindings: []InvocationExactBinding{{RequirementID: VeVo2RequirementID, VerifiedContentID: VeVo2VerifiedContentID,
			AbsolutePath: filepath.Join(root, "vevo2-q8_0.gguf"), DeclaredFiles: []string{"vevo2-q8_0.gguf"}}},
		Request: &runtimev1.AudioVoiceConvertScenarioSpec{SourceVocal: &runtimev1.MusicAudioInput{ArtifactId: "source-artifact",
			Range: &runtimev1.AudioFrameRange{StartFrame: 1323000, EndFrame: 1764000}},
			SourceKind: runtimev1.VoiceConvertSourceKind_VOICE_CONVERT_SOURCE_KIND_SINGING, TargetVoice: reference},
		SourceInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 44100, Channels: 2, FrameCount: 8450000},
		TargetInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 44100, Channels: 1, FrameCount: 335865},
		SourcePath: filepath.Join(root, "source.wav"), TargetPath: filepath.Join(root, "target.wav"), StagingDir: root}
	plan, err := (VeVo2AudioCppDriver{}).PlanVoiceConvertInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	args := plan.CLIArgs()
	for key, want := range map[string]string{"--task-route": "style_preserved_svc", "--target-voice": filepath.Join(root, "target.wav"),
		"--source-audio": filepath.Join(root, "source.wav"), "--out-format": "float32", "--backend": "cuda"} {
		if got, ok := argValue(args, key); !ok || got != want {
			t.Fatalf("%s = %q, want %q in %v", key, got, want, args)
		}
	}
	pitch := map[string]bool{}
	for index := 0; index+1 < len(args); index++ {
		if args[index] == "--request-option" {
			pitch[args[index+1]] = true
		}
	}
	if !pitch["use_pitch_shift=false"] || !pitch["source_shift_steps=0"] || !pitch["audio_chunk_duration_sec=20"] || !pitch["cross_fade_duration_sec=0.25"] {
		t.Fatalf("absent semitone shift must disable automatic pitch migration and keep native chunking: %v", args)
	}
	if got := plan.VoiceConvertRequest().GetTargetVoice().GetReferenceAudio().GetRange(); got.GetStartFrame() != 88200 || got.GetEndFrame() != 352800 {
		t.Fatalf("captured request lost the target reference range: %+v", got)
	}
	for _, target := range []*runtimev1.VoiceConvertTargetVoice{
		{Target: &runtimev1.VoiceConvertTargetVoice_PresetVoiceId{PresetVoiceId: "preset"}},
		{Target: &runtimev1.VoiceConvertTargetVoice_VoiceAssetId{VoiceAssetId: "voice"}},
	} {
		input.Request.TargetVoice = target
		if _, err := (VeVo2AudioCppDriver{}).PlanVoiceConvertInvocation(input); err == nil {
			t.Fatalf("unimplemented target carrier was admitted: %+v", target)
		}
	}
}
