package capabilitydriver

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestXAISpeechNativeAdmission(t *testing.T) {
	for _, voice := range XAISpeechVoices() {
		req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "  你好。 [pause] Hello.  ", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: voice}}}}}}
		if err := validateXAISpeechRequest(req, XAITTSOperation, CloudMediaStreamNone); err != nil {
			t.Fatal(voice, err)
		}
		if s := req.GetSpec().GetSpeechSynthesize(); s.GetLanguage() != "auto" || s.GetAudioFormat() != "mp3" || s.GetSampleRateHz() != 24000 || s.GetText() != "  你好。 [pause] Hello.  " {
			t.Fatal("native defaults or text lost", s)
		}
		for name, change := range map[string]func(*runtimev1.SpeechSynthesizeScenarioSpec){
			"too long": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Text = strings.Repeat("好", 60001) },
			"speed":    func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Speed = proto.Float32(1.6) },
			"pitch":    func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Pitch = proto.Float32(0) },
			"volume":   func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Volume = proto.Float32(1) },
			"emotion":  func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Emotion = "happy" },
			"word timing": func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.TimingMode = runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD
			},
			"voice": func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.VoiceRef.Reference = &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "unknown"}
			},
			"rate":   func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.SampleRateHz = proto.Int32(32000) },
			"format": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.AudioFormat = "flac" },
		} {
			copy := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
			change(copy.GetSpec().GetSpeechSynthesize())
			if validateXAISpeechRequest(copy, XAITTSOperation, CloudMediaStreamNone) == nil {
				t.Fatal(voice, name, "silently accepted")
			}
		}
		if validateXAISpeechRequest(req, "grok-voice-3.0", CloudMediaStreamNone) == nil || validateXAISpeechRequest(req, XAITTSOperation, CloudMediaStreamNative) == nil {
			t.Fatal("realtime model or streaming treated as fixed finite TTS")
		}
	}
}
