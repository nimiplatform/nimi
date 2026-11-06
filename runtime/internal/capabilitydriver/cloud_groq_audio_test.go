package capabilitydriver

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestGroqSpeechRejectsUnreviewedGenericAPIControls(t *testing.T) {
	for _, tc := range []struct{ model, voice, language string }{{"canopylabs/orpheus-v1-english", "hannah", "en"}, {"canopylabs/orpheus-arabic-saudi", "noura", "ar"}} {
		driver, target := cloudMediaDriverTarget(t, "groq", tc.model, "audio.synthesize")
		valid := func() *runtimev1.SubmitScenarioJobRequest {
			return openAISpeechTestRequest(func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
				s.Text = "Hello"
				s.VoiceRef = openAISpeechPreset(tc.voice)
				s.Language = tc.language
			})
		}
		mapped, err := driver.MapRequest(target, valid(), nil, CloudMediaStreamNone)
		if err != nil || mapped.Adapter() != CloudMediaAdapterGroqSpeech || mapped.Request().GetSpec().GetSpeechSynthesize().GetAudioFormat() != "wav" || mapped.Request().GetSpec().GetSpeechSynthesize().SampleRateHz != nil {
			t.Fatalf("Orpheus mapping %v %v", mapped, err)
		}
		for _, change := range []func(*runtimev1.SpeechSynthesizeScenarioSpec){func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Text = strings.Repeat("界", 201) }, func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Speed = proto.Float32(1) }, func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.SampleRateHz = proto.Int32(24000) }, func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.AudioFormat = "mp3" }, func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.VoiceRef = openAISpeechPreset("unreviewed") }} {
			req := valid()
			change(req.GetSpec().GetSpeechSynthesize())
			if _, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone); err == nil {
				t.Fatal("unsupported Orpheus option accepted")
			}
		}
	}
}

func TestGroqTranscriptionAdmitsNativeContainersAndRejectsDiarization(t *testing.T) {
	for _, model := range []string{"whisper-large-v3", "whisper-large-v3-turbo"} {
		driver, target := cloudMediaDriverTarget(t, "groq", model, "audio.transcribe")
		for _, mime := range []string{"audio/wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/flac", "audio/ogg"} {
			s := &runtimev1.SpeechTranscribeScenarioSpec{MimeType: mime, Timestamps: proto.Bool(true), Language: "en", Prompt: " Nimi ", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte("owned recording")}}}
			req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: s}}}
			mapped, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone)
			if err != nil || mapped.Adapter() != CloudMediaAdapterGroqTranscribe {
				t.Fatal(mapped, err)
			}
			s.Diarization = proto.Bool(true)
			if _, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone); err == nil {
				t.Fatal("unavailable diarization accepted")
			}
			s.Diarization = nil
			s.Prompt = strings.Repeat("界", 75)
			if _, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone); err == nil {
				t.Fatal("oversized vocabulary hint accepted")
			}
		}
	}
}
