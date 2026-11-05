package capabilitydriver

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func currentSpeechProbe(t *testing.T, family string, voices []string, defaultID string) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"schema_version": 1, "family": family, "options": map[string]any{"request": []any{map[string]any{"name": "voice_id", "type": "enum", "values": voices, "default": defaultID}}}})
	if err != nil {
		t.Fatal(err)
	}
	var probe bytes.Buffer
	probe.WriteString("GGUF")
	_ = binary.Write(&probe, binary.LittleEndian, uint32(3))
	_ = binary.Write(&probe, binary.LittleEndian, uint64(0))
	_ = binary.Write(&probe, binary.LittleEndian, uint64(3))
	audioCppWriteGGUFStringForTest(&probe, "audiocpp.model_spec.version")
	_ = binary.Write(&probe, binary.LittleEndian, uint32(4))
	_ = binary.Write(&probe, binary.LittleEndian, uint32(1))
	for _, entry := range [][2]string{{audioCppEmbeddedFamilyKey, family}, {audioCppEmbeddedSpecKey, string(raw)}} {
		audioCppWriteGGUFStringForTest(&probe, entry[0])
		_ = binary.Write(&probe, binary.LittleEndian, uint32(8))
		audioCppWriteGGUFStringForTest(&probe, entry[1])
	}
	return probe.Bytes()
}

func TestCurrentAudioCppPresetsComeFromSelectedGGUF(t *testing.T) {
	for _, family := range []string{"kitten_tts2", "plapre"} {
		registration := audioCppRegistrationForTest(t, AudioSynthesizeContract, family)
		resolved, _ := NewProductionRegistry().Resolve(registration.CapabilityContract, registration.Identity)
		driver := resolved.(AudioCppTTSDriver)
		root := t.TempDir()
		binding := audioCppBindingForTest(root, AudioCppTTSModelRequirementID, family)
		probe := currentSpeechProbe(t, family, []string{"ActualVoice", "OtherVoice"}, "OtherVoice")
		if err := os.WriteFile(binding.AbsolutePath, probe, 0o600); err != nil {
			t.Fatal(err)
		}
		voices, err := driver.ListPresetVoices([]InvocationExactBinding{binding})
		if err != nil || len(voices) != 2 || voices[0].VoiceID != "ActualVoice" {
			t.Fatalf("selected voices=%v err=%v", voices, err)
		}
		input := AudioCppTTSSynthesizeInvocationInput{LoadoutID: "loadout", RecipeID: registration.RecipeID, ExactBindings: []InvocationExactBinding{binding}, Runtime: audioCppRuntimeForTest(root), Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello."}, StagingWAVPath: filepath.Join(root, "out.wav")}
		plan, err := driver.PlanAudioCppTTSSynthesis(input)
		if err != nil || !audioCppArgsContainPair(plan.CLIArgs(), "--voice-id", "OtherVoice") {
			t.Fatalf("default voice %v %v", plan, err)
		}
		input.Request.VoiceRef = &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "EngineOnlyVoice"}}
		if _, err = driver.PlanAudioCppTTSSynthesis(input); err == nil {
			t.Fatal("engine voice absent from selected package accepted")
		}
		for _, invalid := range [][]byte{audioCppGGUFProbeForTest(family), currentSpeechProbe(t, family, []string{"A", "A"}, "A"), currentSpeechProbe(t, family, []string{"A"}, "B"), currentSpeechProbe(t, "another_family", []string{"A"}, "A")} {
			if audioCppPresetProbeValid(invalid, family) {
				t.Fatal("invalid preset contract accepted")
			}
		}
	}
}

func currentSpeechWAV(seconds float64) []byte {
	samples := int(seconds * 16000)
	value := make([]byte, 44+samples*2)
	copy(value, audioCppPCM16WAVForTest())
	binary.LittleEndian.PutUint32(value[4:8], uint32(len(value)-8))
	binary.LittleEndian.PutUint32(value[40:44], uint32(samples*2))
	return value
}

func TestKittenReferenceDurationTranscriptAndNativeLanguage(t *testing.T) {
	registration := audioCppRegistrationForTest(t, AudioSynthesizeContract, "kitten_tts2")
	resolved, _ := NewProductionRegistry().Resolve(registration.CapabilityContract, registration.Identity)
	driver := resolved.(AudioCppTTSDriver)
	ref := &AudioCppReferenceVoiceInput{ProviderVoiceRef: "selected", WAVPath: filepath.Join(t.TempDir(), "source.wav"), WAVBytes: currentSpeechWAV(1), MIMEType: "audio/wav", ReferenceText: "Original words."}
	req := &runtimev1.SpeechSynthesizeScenarioSpec{Text: "New words.", Language: "auto", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF, Reference: &runtimev1.VoiceReference_ProviderVoiceRef{ProviderVoiceRef: ref.ProviderVoiceRef}}}
	for _, seconds := range []float64{0.5, 1, 30, 30.1} {
		ref.WAVBytes = currentSpeechWAV(seconds)
		_, args, err := driver.ttsRequestArgs(req, ref)
		if (err == nil) != (seconds >= 1 && seconds <= 30) {
			t.Fatalf("duration %v: %v", seconds, err)
		}
		if err == nil && (audioCppArgsContainPair(args, "--language", "auto") || !audioCppArgsContainPair(args, "--reference-text", ref.ReferenceText)) {
			t.Fatalf("wrong native controls %v", args)
		}
	}
	ref.WAVBytes = currentSpeechWAV(1)
	ref.ReferenceText = ""
	if _, _, err := driver.ttsRequestArgs(req, ref); err == nil {
		t.Fatal("missing clone transcript accepted")
	}
	ref.ReferenceText = "Original words."
	req.Language = "zh"
	if _, _, err := driver.ttsRequestArgs(req, ref); err == nil {
		t.Fatal("nonexistent language switch accepted")
	}
}
