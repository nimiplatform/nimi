package capabilitydriver

import (
	"encoding/binary"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestDashscopeQwenAudio31AdmitsOnlyShortInlinePlainWAV(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "dashscope", dashscopeQwenAudio31ASRModel, "audio.transcribe")
	request := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
			MimeType: "audio/wav", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: geminiInlineTranscribeTestWAV()}},
		}}},
	}
	mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone)
	if err != nil || mapped.Adapter() != CloudMediaAdapterDashScopeQwenAudio31ASR || mapped.ProviderModelID() != dashscopeQwenAudio31ASRModel {
		t.Fatalf("Qwen-Audio 3.1 sync mapping=%+v err=%v", mapped, err)
	}
	for name, mutate := range map[string]func(*runtimev1.SpeechTranscribeScenarioSpec){
		"timestamps": func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.Timestamps = testBool(true) },
		"language":   func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.Language = "en" },
		"hint":       func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.Prompt = "Nimi" },
		"remote URL": func(s *runtimev1.SpeechTranscribeScenarioSpec) {
			s.AudioSource = &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: "https://example.com/audio.wav"}}
		},
		"wrong rate": func(s *runtimev1.SpeechTranscribeScenarioSpec) {
			audio := append([]byte(nil), s.AudioSource.GetAudioBytes()...)
			binary.LittleEndian.PutUint32(audio[24:28], 16000)
			s.AudioSource = &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: audio}}
		},
	} {
		copy := *request.GetSpec().GetSpeechTranscribe()
		mutate(&copy)
		candidate := &runtimev1.SubmitScenarioJobRequest{ScenarioType: request.ScenarioType,
			Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &copy}}}
		_, err := driver.MapRequest(target, candidate, nil, CloudMediaStreamNone)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("%s must fail typed before dispatch: reason=%v present=%v err=%v", name, reason, ok, err)
		}
	}
}
