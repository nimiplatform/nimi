package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestCosyVoiceWordExactVoiceAndFormatAdmission(t *testing.T) {
	for _, tc := range []struct {
		model, voice, format string
		rate                 int32
		ok                   bool
	}{
		{"cosyvoice-v3-plus", "longanyang", "wav", 24000, true},
		{"cosyvoice-v3-plus", "longanhuan", "mp3", 0, true},
		{"cosyvoice-v3-flash", "longhuhu_v3", "wav", 24000, true},
		{"cosyvoice-v3-flash", "loongriko_v3", "wav", 24000, false},
		{"cosyvoice-v3-plus", "longhuhu_v3", "wav", 24000, false},
		{"cosyvoice-v3-plus", "longanyang", "opus", 22050, false},
		{"cosyvoice-v3-plus", "longanyang", "opus", 24000, true},
		{"cosyvoice-v3.5-plus", "longanyang", "wav", 24000, false},
	} {
		t.Run(tc.model+"/"+tc.voice+"/"+tc.format, func(t *testing.T) {
			spec := &runtimev1.SpeechSynthesizeScenarioSpec{TimingMode: runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD, AudioFormat: tc.format, VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: tc.voice}}}
			if tc.rate != 0 {
				spec.SampleRateHz = &tc.rate
			}
			if err := ValidateCosyVoiceWordRequest(tc.model, spec); (err == nil) != tc.ok {
				t.Fatalf("word admission = %v", err)
			}
			spec.TimingMode = runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE
			if err := ValidateCosyVoiceWordRequest(tc.model, spec); err != nil {
				t.Fatalf("none changed = %v", err)
			}
		})
	}
}
