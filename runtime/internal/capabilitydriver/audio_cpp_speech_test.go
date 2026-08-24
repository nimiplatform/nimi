package capabilitydriver

import (
	"bytes"
	"encoding/binary"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAudioCppSpeechProductionRegistryHasExactReleaseFamilies(t *testing.T) {
	registrations := AudioCppSpeechRegistrations()
	ttsCount, asrCount := 0, 0
	seen := map[RegistrationKey]bool{}
	registry := NewProductionRegistry()
	for _, registration := range registrations {
		key := RegistrationKey{CapabilityContract: registration.CapabilityContract, Identity: registration.Identity}
		if seen[key] {
			t.Fatalf("duplicate audio.cpp registration: %+v", registration)
		}
		seen[key] = true
		driver, reason := registry.Resolve(registration.CapabilityContract, registration.Identity)
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
			t.Fatalf("resolve %s/%s: driver=%T reason=%v", registration.CapabilityContract, registration.Family, driver, reason)
		}
		if requirements, wrongReason := driver.Interpret(InterpretInput{RecipeID: "wrong.recipe"}); len(requirements) != 0 || wrongReason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
			t.Fatalf("%s accepted a foreign recipe: requirements=%+v reason=%v", registration.Family, requirements, wrongReason)
		}
		consumer, ok := AudioCppSpeechConsumerID(registration.CapabilityContract, registration.Identity)
		if !ok || consumer != registration.ConsumerID || consumer == "" {
			t.Fatalf("consumer %s/%s = %q ok=%v", registration.CapabilityContract, registration.Family, consumer, ok)
		}
		switch registration.CapabilityContract {
		case AudioSynthesizeContract:
			ttsCount++
		case AudioTranscribeContract:
			asrCount++
		default:
			t.Fatalf("unexpected contract %q", registration.CapabilityContract)
		}
	}
	if ttsCount != 24 || asrCount != 11 {
		t.Fatalf("release family counts tts=%d asr=%d", ttsCount, asrCount)
	}
	qwenBase := audioCppRegistrationForTest(t, AudioSynthesizeContract, "qwen3_tts")
	if qwenBase.Identity.ImplementationID != AudioCppQwen3TTSBaseImplementationID || qwenBase.Identity.ImplementationID == Qwen3TTSAudioCppImplementationID {
		t.Fatalf("Qwen3-TTS Base implementation_id=%q, existing CustomVoice=%q", qwenBase.Identity.ImplementationID, Qwen3TTSAudioCppImplementationID)
	}
	if references := AudioCppReferenceVoiceRegistrations(); len(references) != 20 {
		t.Fatalf("reference voice registrations=%d", len(references))
	} else {
		for _, registration := range references {
			if driver, reason := registry.Resolve(VoiceCreateContract, registration.Identity); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
				t.Fatalf("resolve reference voice %s: driver=%T reason=%v", registration.Family, driver, reason)
			} else if requirements, wrongReason := driver.Interpret(InterpretInput{RecipeID: "wrong.recipe", SupportedFeatures: []string{"input.audio"}}); len(requirements) != 0 || wrongReason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
				t.Fatalf("reference voice %s accepted a foreign recipe", registration.Family)
			}
		}
	}
}

func TestAudioCppPocketTTSPlanUsesClosedPresetAndCLI(t *testing.T) {
	registration := audioCppRegistrationForTest(t, AudioSynthesizeContract, "pocket_tts")
	driverValue, reason := NewProductionRegistry().Resolve(registration.CapabilityContract, registration.Identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	driver, ok := driverValue.(AudioCppTTSSynthesizeInvocationDriver)
	if !ok {
		t.Fatalf("driver=%T", driverValue)
	}
	root := t.TempDir()
	binding := audioCppBindingForTest(root, AudioCppTTSModelRequirementID, "pocket_tts")
	plan, err := driver.PlanAudioCppTTSSynthesis(AudioCppTTSSynthesizeInvocationInput{
		LoadoutID:      "loadout-pocket",
		RecipeID:       registration.RecipeID,
		ExactBindings:  []InvocationExactBinding{binding},
		Runtime:        audioCppRuntimeForTest(root),
		Request:        &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello from Nimi.", Language: "en", AudioFormat: "wav"},
		StagingWAVPath: filepath.Join(root, "speech.wav"),
	})
	if err != nil {
		t.Fatalf("PlanAudioCppTTSSynthesis: %v", err)
	}
	args := plan.CLIArgs()
	for _, pair := range [][2]string{{"--task", "tts"}, {"--family", "pocket_tts"}, {"--voice-id", "alba"}, {"--out", plan.StagingWAVPath()}} {
		if !audioCppArgsContainPair(args, pair[0], pair[1]) {
			t.Fatalf("args missing %q %q: %q", pair[0], pair[1], args)
		}
	}
	voices, err := driver.ListPresetVoices([]InvocationExactBinding{binding})
	if err != nil || len(voices) != 1 || voices[0].VoiceID != "alba" {
		t.Fatalf("PocketTTS voices=%+v err=%v", voices, err)
	}
}

func TestAudioCppCitrinetASRPlanCapturesWAVAndTextOutput(t *testing.T) {
	registration := audioCppRegistrationForTest(t, AudioTranscribeContract, "citrinet_asr")
	driverValue, reason := NewProductionRegistry().Resolve(registration.CapabilityContract, registration.Identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	driver, ok := driverValue.(AudioCppASRTranscribeInvocationDriver)
	if !ok {
		t.Fatalf("driver=%T", driverValue)
	}
	root := t.TempDir()
	binding := audioCppBindingForTest(root, AudioCppASRModelRequirementID, "citrinet_asr")
	wav := audioCppPCM16WAVForTest()
	plan, err := driver.PlanAudioCppASRTranscription(AudioCppASRTranscribeInvocationInput{
		LoadoutID:          "loadout-citrinet",
		RecipeID:           registration.RecipeID,
		ExactBindings:      []InvocationExactBinding{binding},
		Runtime:            audioCppRuntimeForTest(root),
		Request:            &runtimev1.SpeechTranscribeScenarioSpec{Language: "en", ResponseFormat: "text"},
		AudioBytes:         wav,
		MIMEType:           "audio/wav",
		StagingAudioPath:   filepath.Join(root, "input.wav"),
		StagingTextOutPath: filepath.Join(root, "output.txt"),
	})
	if err != nil {
		t.Fatalf("PlanAudioCppASRTranscription: %v", err)
	}
	if !bytes.Equal(plan.AudioBytes(), wav) || plan.MIMEType() != "audio/wav" {
		t.Fatalf("captured ASR input mismatch")
	}
	args := plan.CLIArgs()
	for _, pair := range [][2]string{{"--task", "asr"}, {"--family", "citrinet_asr"}, {"--audio", plan.StagingAudioPath()}, {"--text-out", plan.StagingTextOutPath()}} {
		if !audioCppArgsContainPair(args, pair[0], pair[1]) {
			t.Fatalf("args missing %q %q: %q", pair[0], pair[1], args)
		}
	}
}

func TestAudioCppFamilyContractsRejectMismatchedGGUFAndMissingAxes(t *testing.T) {
	registration := audioCppRegistrationForTest(t, AudioSynthesizeContract, "miotts")
	driverValue, _ := NewProductionRegistry().Resolve(registration.CapabilityContract, registration.Identity)
	driver := driverValue.(AudioCppTTSSynthesizeInvocationDriver)
	requirements, reason := driver.Interpret(InterpretInput{RecipeID: registration.RecipeID})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 2 || requirements[1].GetRequirementId() != AudioCppTTSCodecRequirementID {
		t.Fatalf("MioTTS requirements=%+v reason=%v", requirements, reason)
	}
	binding := &runtimev1.ModelAssetExactBinding{RequirementId: AudioCppTTSModelRequirementID, ModelAssetId: "model", VerifiedContentId: "content", EntrySha256: "entry"}
	projection, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{
		RecipeID: registration.RecipeID, Requirement: requirements[0], Binding: binding,
		Entry: ModelAssetFileFact{RelativePath: "wrong.gguf", SizeBytes: 128, FormatProbe: audioCppGGUFProbeForTest("qwen3_tts")},
	})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE || projection.Descriptor.Family != "" {
		t.Fatalf("mismatched projection=%+v reason=%v", projection, reason)
	}
}

func TestAudioCppReferenceRequiredTTSFailsClosed(t *testing.T) {
	registration := audioCppRegistrationForTest(t, AudioSynthesizeContract, "glm_tts")
	driverValue, _ := NewProductionRegistry().Resolve(registration.CapabilityContract, registration.Identity)
	driver := driverValue.(AudioCppTTSSynthesizeInvocationDriver)
	root := t.TempDir()
	_, err := driver.PlanAudioCppTTSSynthesis(AudioCppTTSSynthesizeInvocationInput{
		LoadoutID: "loadout", RecipeID: registration.RecipeID,
		ExactBindings: []InvocationExactBinding{audioCppBindingForTest(root, AudioCppTTSModelRequirementID, "glm_tts")},
		Runtime:       audioCppRuntimeForTest(root), Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello"},
		StagingWAVPath: filepath.Join(root, "out.wav"),
	})
	if err == nil {
		t.Fatal("GLM-TTS accepted a missing reference voice")
	}
}

func TestAudioCppSpeakingRateUsesFamilyRequestOptions(t *testing.T) {
	tests := []struct {
		family string
		option string
	}{
		{family: "inflect_v2", option: "speaking_rate"},
		{family: "supertonic", option: "speaking_rate"},
		{family: "omnivoice", option: "speed"},
	}
	for _, test := range tests {
		t.Run(test.family, func(t *testing.T) {
			registration := audioCppRegistrationForTest(t, AudioSynthesizeContract, test.family)
			driverValue, reason := NewProductionRegistry().Resolve(registration.CapabilityContract, registration.Identity)
			if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
				t.Fatal(reason)
			}
			driver := driverValue.(AudioCppTTSSynthesizeInvocationDriver)
			root := t.TempDir()
			runtimeInput := audioCppRuntimeForTest(root)
			if test.family == "inflect_v2" {
				runtimeInput.ESpeakSelectedSourceRecordID = "espeak-source"
				runtimeInput.ESpeakLibraryPath = filepath.Join(root, "espeak-ng.dll")
				runtimeInput.ESpeakDataPath = filepath.Join(root, "espeak-ng-data")
			}
			request := &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello.", Speed: testFloat32(1.25)}
			var reference *AudioCppReferenceVoiceInput
			if test.family == "omnivoice" {
				providerRef := "omnivoice-reference"
				request.VoiceRef = &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF, Reference: &runtimev1.VoiceReference_ProviderVoiceRef{ProviderVoiceRef: providerRef}}
				reference = &AudioCppReferenceVoiceInput{ProviderVoiceRef: providerRef, WAVPath: filepath.Join(root, "reference.wav"), WAVBytes: audioCppPCM16WAVForTest(), MIMEType: "audio/wav", ReferenceText: "Reference words."}
			}
			plan, err := driver.PlanAudioCppTTSSynthesis(AudioCppTTSSynthesizeInvocationInput{
				LoadoutID: "loadout-" + test.family, RecipeID: registration.RecipeID,
				ExactBindings: []InvocationExactBinding{audioCppBindingForTest(root, AudioCppTTSModelRequirementID, test.family)},
				Runtime:       runtimeInput, Request: request, ReferenceVoice: reference,
				StagingWAVPath: filepath.Join(root, "out.wav"),
			})
			if err != nil {
				t.Fatalf("PlanAudioCppTTSSynthesis: %v", err)
			}
			want := test.option + "=1.25"
			if !audioCppArgsContainPair(plan.CLIArgs(), "--request-option", want) {
				t.Fatalf("%s args do not carry %q as a request option: %q", test.family, want, plan.CLIArgs())
			}
			if audioCppArgsContainPair(plan.CLIArgs(), "--speaking-rate", "1.25") {
				t.Fatalf("%s args incorrectly use the generic style flag: %q", test.family, plan.CLIArgs())
			}
		})
	}
}

func TestAudioCppInflectSpeakingRateFailsClosed(t *testing.T) {
	root := t.TempDir()
	inflectRegistration := audioCppRegistrationForTest(t, AudioSynthesizeContract, "inflect_v2")
	inflectValue, _ := NewProductionRegistry().Resolve(inflectRegistration.CapabilityContract, inflectRegistration.Identity)
	inflect := inflectValue.(AudioCppTTSSynthesizeInvocationDriver)
	runtimeInput := audioCppRuntimeForTest(root)
	runtimeInput.ESpeakSelectedSourceRecordID = "espeak-source"
	runtimeInput.ESpeakLibraryPath = filepath.Join(root, "espeak-ng.dll")
	runtimeInput.ESpeakDataPath = filepath.Join(root, "espeak-ng-data")
	for _, speed := range []float32{0.49, 2.01} {
		_, err := inflect.PlanAudioCppTTSSynthesis(AudioCppTTSSynthesizeInvocationInput{
			LoadoutID: "inflect", RecipeID: inflectRegistration.RecipeID,
			ExactBindings: []InvocationExactBinding{audioCppBindingForTest(root, AudioCppTTSModelRequirementID, "inflect_v2")},
			Runtime:       runtimeInput, Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello.", Speed: testFloat32(speed)},
			StagingWAVPath: filepath.Join(root, "inflect.wav"),
		})
		if err == nil {
			t.Fatalf("Inflect accepted out-of-range speaking rate %g", speed)
		}
	}
	for _, boundary := range []struct {
		name    string
		speed   float32
		encoded string
	}{{name: "minimum", speed: 0.5, encoded: "0.5"}, {name: "maximum", speed: 2.0, encoded: "2"}} {
		plan, err := inflect.PlanAudioCppTTSSynthesis(AudioCppTTSSynthesizeInvocationInput{
			LoadoutID: "inflect", RecipeID: inflectRegistration.RecipeID,
			ExactBindings: []InvocationExactBinding{audioCppBindingForTest(root, AudioCppTTSModelRequirementID, "inflect_v2")},
			Runtime:       runtimeInput, Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello.", Speed: testFloat32(boundary.speed)},
			StagingWAVPath: filepath.Join(root, "inflect-"+boundary.name+".wav"),
		})
		if err != nil || !audioCppArgsContainPair(plan.CLIArgs(), "--request-option", "speaking_rate="+boundary.encoded) {
			t.Fatalf("Inflect rejected boundary %s=%g: plan=%v err=%v", boundary.name, boundary.speed, plan, err)
		}
	}
}

func TestAudioCppNeuTTSEmotionFailsClosedOnUnknownEnum(t *testing.T) {
	root := t.TempDir()
	neuttsRegistration := audioCppRegistrationForTest(t, AudioSynthesizeContract, "neutts")
	neuttsValue, _ := NewProductionRegistry().Resolve(neuttsRegistration.CapabilityContract, neuttsRegistration.Identity)
	neutts := neuttsValue.(AudioCppTTSSynthesizeInvocationDriver)
	_, err := neutts.PlanAudioCppTTSSynthesis(AudioCppTTSSynthesizeInvocationInput{
		LoadoutID: "neutts", RecipeID: neuttsRegistration.RecipeID,
		ExactBindings: []InvocationExactBinding{audioCppBindingForTest(root, AudioCppTTSModelRequirementID, "neutts")},
		Runtime:       audioCppRuntimeForTest(root), Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello.", Emotion: "excited"},
		StagingWAVPath: filepath.Join(root, "neutts.wav"),
	})
	if err == nil {
		t.Fatal("NeuTTS accepted an emotion outside the release enum")
	}
	plan, err := neutts.PlanAudioCppTTSSynthesis(AudioCppTTSSynthesizeInvocationInput{
		LoadoutID: "neutts", RecipeID: neuttsRegistration.RecipeID,
		ExactBindings: []InvocationExactBinding{audioCppBindingForTest(root, AudioCppTTSModelRequirementID, "neutts")},
		Runtime:       audioCppRuntimeForTest(root), Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello.", Emotion: "happy"},
		StagingWAVPath: filepath.Join(root, "neutts-happy.wav"),
	})
	if err != nil || !audioCppArgsContainPair(plan.CLIArgs(), "--emotion", "happy") {
		t.Fatalf("NeuTTS valid emotion plan=%v err=%v", plan, err)
	}
}

func TestAudioCppSpeechRequestProfilesFailClosed(t *testing.T) {
	root := t.TempDir()
	pocketRegistration := audioCppRegistrationForTest(t, AudioSynthesizeContract, "pocket_tts")
	pocketValue, _ := NewProductionRegistry().Resolve(AudioSynthesizeContract, pocketRegistration.Identity)
	pocket := pocketValue.(AudioCppTTSSynthesizeInvocationDriver)
	if _, err := pocket.PlanAudioCppTTSSynthesis(AudioCppTTSSynthesizeInvocationInput{LoadoutID: "pocket", RecipeID: pocketRegistration.RecipeID, ExactBindings: []InvocationExactBinding{audioCppBindingForTest(root, AudioCppTTSModelRequirementID, "pocket_tts")}, Runtime: audioCppRuntimeForTest(root), Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello", Language: "de"}, StagingWAVPath: filepath.Join(root, "pocket.wav")}); err == nil {
		t.Fatal("English PocketTTS package accepted a German request")
	}

	citrinetRegistration := audioCppRegistrationForTest(t, AudioTranscribeContract, "citrinet_asr")
	citrinetValue, _ := NewProductionRegistry().Resolve(AudioTranscribeContract, citrinetRegistration.Identity)
	citrinet := citrinetValue.(AudioCppASRTranscribeInvocationDriver)
	base := AudioCppASRTranscribeInvocationInput{LoadoutID: "citrinet", RecipeID: citrinetRegistration.RecipeID, ExactBindings: []InvocationExactBinding{audioCppBindingForTest(root, AudioCppASRModelRequirementID, "citrinet_asr")}, Runtime: audioCppRuntimeForTest(root), Request: &runtimev1.SpeechTranscribeScenarioSpec{Language: "en"}, AudioBytes: audioCppPCM16WAVForTest(), MIMEType: "audio/wav", StagingAudioPath: filepath.Join(root, "input.wav"), StagingTextOutPath: filepath.Join(root, "output.txt")}
	truth := true
	base.Request.Timestamps = &truth
	if _, err := citrinet.PlanAudioCppASRTranscription(base); err == nil {
		t.Fatal("Citrinet accepted timestamps")
	}
	base.Request.Timestamps = nil
	base.MIMEType = "audio/mpeg"
	if _, err := citrinet.PlanAudioCppASRTranscription(base); err == nil {
		t.Fatal("Citrinet accepted non-WAV input")
	}
}

func TestAudioCppReferenceVoiceCreatePlanCapturesExactWAV(t *testing.T) {
	var registration AudioCppSpeechRegistration
	for _, candidate := range AudioCppReferenceVoiceRegistrations() {
		if candidate.Family == "glm_tts" {
			registration = candidate
			break
		}
	}
	driverValue, reason := NewProductionRegistry().Resolve(VoiceCreateContract, registration.Identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	driver := driverValue.(VoiceCreateInvocationDriver)
	root := t.TempDir()
	wav := audioCppPCM16WAVForTest()
	plan, err := driver.PlanVoiceCreateInvocation(VoiceCreateInvocationInput{
		ExactBindings:     []InvocationExactBinding{audioCppBindingForTest(root, AudioCppTTSModelRequirementID, "glm_tts")},
		SupportedFeatures: []string{"input.audio"},
		Request: &runtimev1.VoiceCreateScenarioSpec{Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{
			ReferenceAudioBytes: wav, ReferenceAudioMime: "audio/wav", Text: "Hello reference.",
		}}},
		AudioCppReferenceRoot:    filepath.Join(root, "voices"),
		AudioCppProviderVoiceRef: AudioCppReferenceVoicePrefix + "01HZZZZZZZZZZZZZZZZZZZZZZZ",
	})
	if err != nil {
		t.Fatalf("PlanVoiceCreateInvocation: %v", err)
	}
	if plan.AudioCppProviderVoiceRef() == "" || !bytes.Equal(plan.AudioCppReferenceWAV(), wav) || len(plan.AudioCppReferenceMetadata()) == 0 || plan.WorkflowModelID() != registration.RecipeID || plan.AudioCppFamily() != "glm_tts" {
		t.Fatalf("reference voice plan=%+v", plan)
	}
}

func TestAudioCppMiniMaxH3UsesExactEntryContract(t *testing.T) {
	registration := audioCppRegistrationForTest(t, AudioSynthesizeContract, "minimax_h3")
	driverValue, _ := NewProductionRegistry().Resolve(registration.CapabilityContract, registration.Identity)
	driver := driverValue.(AudioCppTTSSynthesizeInvocationDriver)
	requirements, reason := driver.Interpret(InterpretInput{RecipeID: registration.RecipeID})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("requirements=%+v reason=%v", requirements, reason)
	}
	root := t.TempDir()
	var h3Spec audioCppTTSSpec
	for _, spec := range audioCppTTSSpecs {
		if spec.family == "minimax_h3" {
			h3Spec = spec
		}
	}
	facts := make([]ModelAssetFileFact, 0, 12)
	for suffix, size := range h3Spec.requiredFileSizes {
		probe := []byte(nil)
		if suffix == "dit.gguf" {
			probe = audioCppStandaloneProbeForTest("dit")
		}
		facts = append(facts, ModelAssetFileFact{RelativePath: filepath.ToSlash(filepath.Join("MiniMax-H3-Q4-GGUF", suffix)), SizeBytes: size, FormatProbe: probe})
	}
	entry := ModelAssetFileFact{}
	for _, fact := range facts {
		if filepath.Base(fact.RelativePath) == "dit.gguf" {
			entry = fact
		}
	}
	bindingProto := &runtimev1.ModelAssetExactBinding{RequirementId: AudioCppTTSModelRequirementID, ModelAssetId: "h3", VerifiedContentId: "content", EntrySha256: "entry"}
	if _, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{RecipeID: registration.RecipeID, Requirement: requirements[0], Binding: bindingProto, Entry: entry, Files: facts}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("MiniMax-H3 projection reason=%v", reason)
	}
	modelAssetRoot := filepath.Join(root, "ModelAssetRoot")
	packageRoot := filepath.Join(modelAssetRoot, "MiniMax-H3-Q4-GGUF")
	entryPath := filepath.Join(packageRoot, "dit.gguf")
	declaredFiles := make([]string, 0, len(facts))
	for _, fact := range facts {
		declaredFiles = append(declaredFiles, filepath.FromSlash(fact.RelativePath))
	}
	binding := InvocationExactBinding{RequirementID: AudioCppTTSModelRequirementID, ModelAssetID: "asset-minimax_h3", AbsolutePath: entryPath, BundleDir: modelAssetRoot, DeclaredFiles: declaredFiles, VerifiedContentID: "sha256:content-minimax_h3", EntrySHA256: "entry-minimax_h3"}
	plan, err := driver.PlanAudioCppTTSSynthesis(AudioCppTTSSynthesizeInvocationInput{LoadoutID: "h3", RecipeID: registration.RecipeID, ExactBindings: []InvocationExactBinding{binding}, Runtime: audioCppRuntimeForTest(root), Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Speaker 1: Hello."}, StagingWAVPath: filepath.Join(root, "out.wav")})
	if err != nil {
		t.Fatal(err)
	}
	if !audioCppArgsContainPair(plan.CLIArgs(), "--task", "gen") || !audioCppArgsContainPair(plan.CLIArgs(), "--model", entryPath) {
		t.Fatalf("MiniMax-H3 args=%q", plan.CLIArgs())
	}
}

func TestAudioCppMiniMaxH3EntryMetadataOrderIsNotSignificant(t *testing.T) {
	probe := audioCppStandaloneProbeWithEntriesForTest([][2]string{{"general.name", "dit"}, {"general.architecture", "audiocpp"}})
	if !audioCppStandaloneBundleEntry(probe, "dit") {
		t.Fatal("valid MiniMax-H3 DIT entry was rejected when general.name preceded general.architecture")
	}
}

func audioCppRegistrationForTest(t *testing.T, contract, family string) AudioCppSpeechRegistration {
	t.Helper()
	for _, registration := range AudioCppSpeechRegistrations() {
		if registration.CapabilityContract == contract && registration.Family == family {
			return registration
		}
	}
	t.Fatalf("missing registration %s/%s", contract, family)
	return AudioCppSpeechRegistration{}
}

func audioCppBindingForTest(root, requirementID, family string) InvocationExactBinding {
	path := filepath.Join(root, family+".gguf")
	return InvocationExactBinding{RequirementID: requirementID, ModelAssetID: "asset-" + family, AbsolutePath: path, BundleDir: root, DeclaredFiles: []string{filepath.Base(path)}, VerifiedContentID: "sha256:content-" + family, EntrySHA256: "entry-" + family}
}

func audioCppRuntimeForTest(root string) AudioCppSpeechRuntimeInput {
	return AudioCppSpeechRuntimeInput{Package: AudioCppRuntimePackageInput{
		AudioCppPackageID: AudioCppWindowsCUDA13PackageID, AudioCppSelectedSourceRecordID: "audio-source",
		AudioCppRoot: filepath.Join(root, "audio-cpp"), AudioCppExecutablePath: filepath.Join(root, "audio-cpp", "audiocpp_cli.exe"),
		CUDA13DependencyID: AudioCppCUDA13RuntimeDependencyID, CUDA13SelectedSourceRecordID: "cuda-source", CUDA13Root: filepath.Join(root, "cuda13"),
	}}
}

func audioCppArgsContainPair(args []string, key, value string) bool {
	for index := 0; index+1 < len(args); index++ {
		if args[index] == key && args[index+1] == value {
			return true
		}
	}
	return false
}

func audioCppGGUFProbeForTest(family string) []byte {
	var probe bytes.Buffer
	probe.WriteString("GGUF")
	_ = binary.Write(&probe, binary.LittleEndian, uint32(3))
	_ = binary.Write(&probe, binary.LittleEndian, uint64(0))
	_ = binary.Write(&probe, binary.LittleEndian, uint64(1))
	audioCppWriteGGUFStringForTest(&probe, audioCppEmbeddedFamilyKey)
	_ = binary.Write(&probe, binary.LittleEndian, uint32(ggufmetaValueTypeStringForTest))
	audioCppWriteGGUFStringForTest(&probe, family)
	return probe.Bytes()
}

func audioCppStandaloneProbeForTest(name string) []byte {
	return audioCppStandaloneProbeWithEntriesForTest([][2]string{{"general.architecture", "audiocpp"}, {"general.name", name}})
}

func audioCppStandaloneProbeWithEntriesForTest(entries [][2]string) []byte {
	var probe bytes.Buffer
	probe.WriteString("GGUF")
	_ = binary.Write(&probe, binary.LittleEndian, uint32(3))
	_ = binary.Write(&probe, binary.LittleEndian, uint64(0))
	_ = binary.Write(&probe, binary.LittleEndian, uint64(len(entries)))
	for _, item := range entries {
		key, value := item[0], item[1]
		audioCppWriteGGUFStringForTest(&probe, key)
		_ = binary.Write(&probe, binary.LittleEndian, uint32(ggufmetaValueTypeStringForTest))
		audioCppWriteGGUFStringForTest(&probe, value)
	}
	return probe.Bytes()
}

const ggufmetaValueTypeStringForTest = 8

func audioCppWriteGGUFStringForTest(buf *bytes.Buffer, value string) {
	_ = binary.Write(buf, binary.LittleEndian, uint64(len(value)))
	buf.WriteString(value)
}

func audioCppPCM16WAVForTest() []byte {
	value := make([]byte, 46)
	copy(value[:4], "RIFF")
	binary.LittleEndian.PutUint32(value[4:8], uint32(len(value)-8))
	copy(value[8:12], "WAVE")
	copy(value[12:16], "fmt ")
	binary.LittleEndian.PutUint32(value[16:20], 16)
	binary.LittleEndian.PutUint16(value[20:22], 1)
	binary.LittleEndian.PutUint16(value[22:24], 1)
	binary.LittleEndian.PutUint32(value[24:28], 16000)
	binary.LittleEndian.PutUint32(value[28:32], 32000)
	binary.LittleEndian.PutUint16(value[32:34], 2)
	binary.LittleEndian.PutUint16(value[34:36], 16)
	copy(value[36:40], "data")
	binary.LittleEndian.PutUint32(value[40:44], 2)
	return value
}
