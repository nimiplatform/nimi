package capabilitydriver

import (
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestQwen3TTSAudioCppProductionRegistryAndExactPlan(t *testing.T) {
	driverValue, reason := NewProductionRegistry().Resolve(AudioSynthesizeContract, Identity{ImplementationID: Qwen3TTSAudioCppImplementationID, DriverID: Qwen3TTSAudioCppDriverID, DriverDialect: Qwen3TTSAudioCppDriverDialect})
	driver, ok := driverValue.(Qwen3TTSAudioCppInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		t.Fatalf("resolve Qwen audio.cpp Driver reason=%v type=%T", reason, driverValue)
	}
	root := t.TempDir()
	binding := InvocationExactBinding{RequirementID: Qwen3TTSAudioCppModelRequirementID, ModelAssetID: "model-qwen-audio-cpp", AbsolutePath: filepath.Join(root, Qwen3TTSAudioCppModelRelativePath), BundleDir: root, DeclaredFiles: []string{Qwen3TTSAudioCppModelRelativePath}, VerifiedContentID: Qwen3TTSAudioCppVerifiedContentID, EntrySHA256: Qwen3TTSAudioCppVerifiedContentID}
	plan, err := driver.PlanQwen3TTSAudioCppInvocation(Qwen3TTSAudioCppInvocationInput{LoadoutID: "loadout-qwen-audio-cpp", RecipeID: Qwen3TTSAudioCppRecipeID, ExactBindings: []InvocationExactBinding{binding}, Package: AudioCppRuntimePackageInput{AudioCppPackageID: AudioCppWindowsCUDA13PackageID, AudioCppSelectedSourceRecordID: "src-package", AudioCppRoot: filepath.Join(root, "package"), AudioCppExecutablePath: filepath.Join(root, "package", "audiocpp_cli.exe"), CUDA13DependencyID: AudioCppCUDA13RuntimeDependencyID, CUDA13SelectedSourceRecordID: "src-cuda", CUDA13Root: filepath.Join(root, "cuda")}, Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello from Nimi.", VoiceRef: presetVoiceReference(Qwen3TTSAudioCppPresetVoiceVivian), Language: "en", AudioFormat: "wav"}, StagingWAVPath: filepath.Join(root, "staging.wav")})
	if err != nil {
		t.Fatal(err)
	}
	if plan.DriverID() != Qwen3TTSAudioCppDriverID || plan.ModelAssetID() != binding.ModelAssetID || plan.Speaker() != Qwen3TTSAudioCppPresetVoiceVivian || plan.Text() != "Hello from Nimi." || plan.Language() != "en" || plan.AudioCppSelectedSourceRecordID() != "src-package" || plan.CUDA13SelectedSourceRecordID() != "src-cuda" {
		t.Fatalf("unexpected Qwen audio.cpp plan: %+v", plan)
	}
	if rate, channels, bits := plan.ExpectedWAVFormat(); rate != 24000 || channels != 1 || bits != 16 {
		t.Fatalf("WAV contract=%d/%d/%d", rate, channels, bits)
	}
	if doSample, temperature, topK, topP, repetition := plan.Sampling(); !doSample || temperature != 0.9 || topK != 50 || topP != 1 || repetition != 1.05 {
		t.Fatalf("sampling=%v/%v/%v/%v/%v", doSample, temperature, topK, topP, repetition)
	}
	voices, err := driver.ListPresetVoices([]InvocationExactBinding{binding})
	if err != nil || len(voices) != 1 || voices[0].VoiceID != Qwen3TTSAudioCppPresetVoiceVivian {
		t.Fatalf("voices=%+v err=%v", voices, err)
	}
}

func TestQwen3TTSAudioCppFailsClosedOnUnsupportedVoiceAndOptions(t *testing.T) {
	driver := Qwen3TTSAudioCppDriver{}
	root := t.TempDir()
	base := Qwen3TTSAudioCppInvocationInput{LoadoutID: "loadout", RecipeID: Qwen3TTSAudioCppRecipeID, ExactBindings: []InvocationExactBinding{{RequirementID: Qwen3TTSAudioCppModelRequirementID, ModelAssetID: "model", AbsolutePath: filepath.Join(root, Qwen3TTSAudioCppModelRelativePath), BundleDir: root, DeclaredFiles: []string{Qwen3TTSAudioCppModelRelativePath}, VerifiedContentID: Qwen3TTSAudioCppVerifiedContentID, EntrySHA256: Qwen3TTSAudioCppVerifiedContentID}}, Package: AudioCppRuntimePackageInput{AudioCppPackageID: AudioCppWindowsCUDA13PackageID, AudioCppSelectedSourceRecordID: "package", AudioCppRoot: filepath.Join(root, "package"), AudioCppExecutablePath: filepath.Join(root, "package", "audiocpp_cli.exe"), CUDA13DependencyID: AudioCppCUDA13RuntimeDependencyID, CUDA13SelectedSourceRecordID: "cuda", CUDA13Root: filepath.Join(root, "cuda")}, StagingWAVPath: filepath.Join(root, "out.wav")}
	for _, request := range []*runtimev1.SpeechSynthesizeScenarioSpec{
		{Text: "hello", VoiceRef: presetVoiceReference("Ryan")},
		{Text: "hello", VoiceRef: presetVoiceReference(Qwen3TTSAudioCppPresetVoiceVivian), Speed: floatPtr(1)},
		{Text: "hello", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF, Reference: &runtimev1.VoiceReference_ProviderVoiceRef{ProviderVoiceRef: "Vivian"}}},
	} {
		base.Request = request
		if _, err := driver.PlanQwen3TTSAudioCppInvocation(base); err == nil {
			t.Fatalf("unsupported request admitted: %+v", request)
		}
	}
}

func TestQwen3TTSAudioCppModelContractRequiresExactSingleGGUF(t *testing.T) {
	driver := Qwen3TTSAudioCppDriver{}
	requirements, reason := driver.ProjectRecipe(Qwen3TTSAudioCppRecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("requirements=%+v reason=%v", requirements, reason)
	}
	binding := &runtimev1.ModelAssetExactBinding{RequirementId: Qwen3TTSAudioCppModelRequirementID, ModelAssetId: "model", VerifiedContentId: Qwen3TTSAudioCppVerifiedContentID}
	projection, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{Requirement: requirements[0], Binding: binding, Files: []ModelAssetFileFact{{RelativePath: Qwen3TTSAudioCppModelRelativePath, SizeBytes: Qwen3TTSAudioCppModelSizeBytes, FormatProbe: []byte("GGUF")}}})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || projection.Descriptor.Family != "qwen3-tts-customvoice" || projection.Descriptor.Engine != "audio-cpp" {
		t.Fatalf("projection=%+v reason=%v", projection, reason)
	}
}

func floatPtr(value float32) *float32 { return &value }

func presetVoiceReference(value string) *runtimev1.VoiceReference {
	return &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: value}}
}
