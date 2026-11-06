package capabilitydriver

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestPollyCapturesExactEngineFormatPairsAndRejectsIgnoredControls(t *testing.T) {
	for _, model := range []string{"polly-standard-tts", "polly-neural-tts", "polly-long-form-tts", "polly-generative-tts"} {
		driver, target := cloudMediaDriverTarget(t, "aws_polly", model, "audio.synthesize")
		valid := func() *runtimev1.SubmitScenarioJobRequest {
			return openAISpeechTestRequest(func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.VoiceRef = openAISpeechPreset("Joanna")
				if model == "polly-long-form-tts" {
					s.VoiceRef = openAISpeechPreset("Danielle")
				}
			})
		}
		for _, format := range []string{"mp3", "ogg", "ogg_opus", "pcm", "mulaw", "alaw"} {
			r := valid()
			r.GetSpec().GetSpeechSynthesize().AudioFormat = format
			mapped, err := driver.MapRequest(target, r, nil, CloudMediaStreamNone)
			if err != nil {
				t.Fatal(err)
			}
			s := mapped.Request().GetSpec().GetSpeechSynthesize()
			expected := int32(24000)
			if model == "polly-standard-tts" {
				expected = 22050
			}
			switch format {
			case "ogg_opus":
				expected = 48000
			case "pcm":
				expected = 16000
			case "mulaw", "alaw":
				expected = 8000
			}
			if s.GetSampleRateHz() != expected || r.GetSpec().GetSpeechSynthesize().SampleRateHz != nil {
				t.Fatalf("default capture %s %s: %v", model, format, s)
			}
		}
		for _, change := range []func(*runtimev1.SpeechSynthesizeScenarioSpec){
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Text = strings.Repeat("界", 3001) },
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Speed = proto.Float32(1.2) },
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Emotion = "happy" },
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.AudioFormat = "pcm"
				s.SampleRateHz = proto.Int32(24000)
			},
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.SampleRateHz = proto.Int32(0) },
			func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.TimingMode = runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD
			},
		} {
			r := valid()
			change(r.GetSpec().GetSpeechSynthesize())
			if _, err := driver.MapRequest(target, r, nil, CloudMediaStreamNone); err == nil {
				t.Fatal("unsupported Polly request accepted")
			}
		}
	}
}

func TestAzureSpeechCapturesModelVoiceStyleAndExactOutputRate(t *testing.T) {
	for _, tc := range []struct{ model, voice, style string }{
		{"azure-neural-tts", "en-US-JennyNeural", ""}, {"azure-hd-tts", "en-US-Ava:DragonHDLatestNeural", ""}, {"azure-hd-tts", "en-us-ava:DragonHDOmniLatestNeural", ""},
		{"azure-openai-tts-preview", "en-US-NovaMultilingualNeuralHD", ""}, {"azure-hd-flash-tts", "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural", "cheerful"},
		{"azure-mai-voice-2.1", "en-US-Harper:MAI-Voice-2.1", "happy"}, {"azure-mai-voice-2.1-flash", "zh-CN-Mei:MAI-Voice-2.1-Flash", "whispering"},
	} {
		t.Run(tc.voice, func(t *testing.T) {
			driver, target := cloudMediaDriverTarget(t, "azure_speech", tc.model, "audio.synthesize")
			valid := func() *runtimev1.SubmitScenarioJobRequest {
				return openAISpeechTestRequest(func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
					s.VoiceRef = openAISpeechPreset(tc.voice)
					s.Emotion = tc.style
				})
			}
			for _, format := range []string{"mp3", "wav", "pcm", "ogg"} {
				r := valid()
				r.GetSpec().GetSpeechSynthesize().AudioFormat = format
				m, err := driver.MapRequest(target, r, nil, CloudMediaStreamNone)
				if err != nil {
					t.Fatal(err)
				}
				s := m.Request().GetSpec().GetSpeechSynthesize()
				rate := int32(24000)
				if format == "ogg" {
					rate = 48000
				}
				if s.GetSampleRateHz() != rate || s.GetLanguage() == "" || s.GetEmotion() != tc.style {
					t.Fatal(s)
				}
			}
			for _, change := range []func(*runtimev1.SpeechSynthesizeScenarioSpec){
				func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Speed = proto.Float32(2) },
				func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.SampleRateHz = proto.Int32(12345) },
				func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Emotion = "unpublished-style" },
				func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
					s.VoiceRef = openAISpeechPreset("unrelated:MAI-Voice-1")
				},
				func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.AudioFormat = "flac" },
			} {
				r := valid()
				change(r.GetSpec().GetSpeechSynthesize())
				if _, err := driver.MapRequest(target, r, nil, CloudMediaStreamNone); err == nil {
					t.Fatal("ignored Azure control accepted")
				}
			}
			if _, err := driver.MapRequest(target, valid(), nil, CloudMediaStreamNative); err == nil {
				t.Fatal("REST complete-file synthesis claimed native stream")
			}
		})
	}
}
