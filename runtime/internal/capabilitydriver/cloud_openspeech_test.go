package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestOpenSpeechExactVoicesAndNativeControls(t *testing.T) {
	for _, model := range []string{"seed-tts-1.0", "seed-tts-2.0"} {
		for _, voice := range OpenSpeechVoices(model) {
			t.Run(model+"/"+voice, func(t *testing.T) {
				req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello.", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: voice}}}}}}
				if err := validateOpenSpeechMedia(req, model, CloudMediaStreamNone); err != nil {
					t.Fatal(err)
				}
				s := req.Spec.GetSpeechSynthesize()
				if s.GetAudioFormat() != "mp3" || s.GetSampleRateHz() != 24000 {
					t.Fatal("native default capture")
				}
				for name, change := range map[string]func(*runtimev1.SpeechSynthesizeScenarioSpec){"wrong voice": func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
					s.VoiceRef.Reference = &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "BV001_streaming"}
				}, "volume": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Volume = proto.Float32(1) }, "wav headers": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.AudioFormat = "wav" }, "speed": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Speed = proto.Float32(.49) }, "timing": func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
					s.TimingMode = runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD
				}} {
					t.Run(name, func(t *testing.T) {
						copy := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
						change(copy.Spec.GetSpeechSynthesize())
						if validateOpenSpeechMedia(copy, model, CloudMediaStreamNone) == nil {
							t.Fatal("unsupported input discarded")
						}
					})
				}
			})
		}
	}
}
