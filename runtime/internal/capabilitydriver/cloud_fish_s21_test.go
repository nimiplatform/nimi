package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestFishS21AdmitsExactFormatsAndRejectsUnmappedControls(t *testing.T) {
	for _, model := range []string{"s2.1-pro", "s2.1-pro-free"} {
		driver, target := cloudMediaDriverTarget(t, "fish_audio", model, "audio.synthesize")
		for format, rate := range map[string]int32{"wav": 24000, "pcm": 16000, "mp3": 44100, "opus": 48000} {
			req := openAISpeechTestRequest(func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.AudioFormat = format
				s.SampleRateHz = proto.Int32(rate)
				s.Speed = proto.Float32(0.5)
			})
			mapped, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone)
			if err != nil || mapped.ProviderModelID() != model || mapped.Adapter() != CloudMediaAdapterFishAudioNative {
				t.Fatalf("%s %s = %v %v", model, format, mapped, err)
			}
		}
		for _, edit := range []func(*runtimev1.SpeechSynthesizeScenarioSpec){
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.AudioFormat = "mp3"
				s.SampleRateHz = proto.Int32(16000)
			},
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Speed = proto.Float32(2.1) },
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Volume = proto.Float32(0.5) },
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.IdentityAudio = &runtimev1.SpeechAudioReference{ArtifactId: "owned-audio"}
			},
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.TimingMode = runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD
			},
		} {
			if _, err := driver.MapRequest(target, openAISpeechTestRequest(edit), nil, CloudMediaStreamNone); err == nil {
				t.Fatalf("%s unmapped option accepted", model)
			}
		}
		if _, err := driver.MapRequest(target, openAISpeechTestRequest(nil), nil, CloudMediaStreamNative); err == nil {
			t.Fatal("JSON binary request claimed native streaming")
		}
	}
}
