package capabilitydriver

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGoogleCloudTTSExactVoicesDefaultsAndControls(t *testing.T) {
	for _, model := range []string{"chirp-3-hd", "gemini-2.5-flash-tts", "gemini-2.5-pro-tts", "gemini-2.5-flash-lite-preview-tts", "gemini-3.1-flash-tts-preview"} {
		t.Run(model, func(t *testing.T) {
			driver, target := cloudMediaDriverTarget(t, "google_cloud_tts", model, "audio.synthesize")
			valid := func() *runtimev1.SubmitScenarioJobRequest {
				return openAISpeechTestRequest(func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
					s.Text = "  Hello, Nimi.  "
					s.VoiceRef = openAISpeechPreset("Kore")
					if model == "chirp-3-hd" {
						s.VoiceRef = openAISpeechPreset("en-US-Chirp3-HD-Kore")
						s.Speed = proto.Float32(.5)
					} else {
						s.Emotion = "Friendly and warm"
					}
				})
			}
			for _, format := range []string{"", "wav", "mp3", "ogg", "pcm", "mulaw", "alaw"} {
				req := valid()
				req.GetSpec().GetSpeechSynthesize().AudioFormat = format
				mapped, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone)
				if err != nil {
					t.Fatal(err)
				}
				s := mapped.Request().GetSpec().GetSpeechSynthesize()
				if s.GetLanguage() != "en-US" || s.GetSampleRateHz() <= 0 || s.GetAudioFormat() == "" || s.GetText() != "  Hello, Nimi.  " || req.GetSpec().GetSpeechSynthesize().SampleRateHz != nil {
					t.Fatalf("captured defaults changed the original request: %v", s)
				}
			}
			for _, change := range []func(*runtimev1.SpeechSynthesizeScenarioSpec){
				func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.VoiceRef = openAISpeechPreset("en-US-JennyNeural") },
				func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Text = strings.Repeat("界", 1667) },
				func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Pitch = proto.Float32(1) },
				func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.SampleRateHz = proto.Int32(0) },
				func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.AudioFormat = "flac" },
				func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
					s.TimingMode = runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD
				},
			} {
				req := valid()
				change(req.GetSpec().GetSpeechSynthesize())
				if _, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone); err == nil {
					t.Fatal("accepted unsupported speech controls")
				}
			}
			req := valid()
			req.Extensions = []*runtimev1.ScenarioExtension{{Namespace: "nimi.scenario.speech_synthesize.request", Payload: &structpb.Struct{}}}
			if _, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone); err == nil {
				t.Fatal("native override bypassed captured target")
			}
			if _, err := driver.MapRequest(target, valid(), nil, CloudMediaStreamNative); err == nil {
				t.Fatal("finite synthesis claimed streaming")
			}
		})
	}
}
