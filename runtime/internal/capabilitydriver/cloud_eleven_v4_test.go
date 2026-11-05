package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"strings"
	"testing"
)

func TestElevenV4NativeFiniteAdmission(t *testing.T) {
	for _, model := range []string{"eleven_v4", "eleven_v4_turbo"} {
		driver, target := cloudMediaDriverTarget(t, "elevenlabs", model, "audio.synthesize")
		for format, rate := range map[string]int32{"wav": 24000, "mp3": 22050, "pcm": 16000, "ogg": 48000} {
			req := openAISpeechTestRequest(func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.AudioFormat = format
				s.SampleRateHz = proto.Int32(rate)
			})
			if mapped, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone); err != nil || mapped.ProviderModelID() != model {
				t.Fatalf("%s %s: %v", model, format, err)
			}
		}
		for _, edit := range []func(*runtimev1.SpeechSynthesizeScenarioSpec){
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Volume = proto.Float32(1) },
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.VoiceRenderHints = &runtimev1.VoiceRenderHints{} },
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.AudioFormat = "mp3"
				s.SampleRateHz = proto.Int32(32000)
			},
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.PerformanceAudio = &runtimev1.SpeechPerformanceReference{ArtifactId: "owned"}
			},
		} {
			if _, err := driver.MapRequest(target, openAISpeechTestRequest(edit), nil, CloudMediaStreamNone); err == nil {
				t.Fatalf("%s dropped unmapped control", model)
			}
		}
		if model == "eleven_v4" {
			if _, err := driver.MapRequest(target, openAISpeechTestRequest(func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Text = strings.Repeat("中", 10001) }), nil, CloudMediaStreamNone); err == nil {
				t.Fatal("v4 character limit ignored")
			}
		}
	}
}
