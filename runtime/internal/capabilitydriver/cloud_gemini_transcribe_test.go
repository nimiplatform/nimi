package capabilitydriver

import (
	"encoding/binary"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func geminiInlineTranscribeTestWAV() []byte {
	wav := make([]byte, 44+4800)
	copy(wav[:4], "RIFF")
	binary.LittleEndian.PutUint32(wav[4:8], uint32(len(wav)-8))
	copy(wav[8:12], "WAVE")
	copy(wav[12:16], "fmt ")
	binary.LittleEndian.PutUint32(wav[16:20], 16)
	binary.LittleEndian.PutUint16(wav[20:22], 1)
	binary.LittleEndian.PutUint16(wav[22:24], 1)
	binary.LittleEndian.PutUint32(wav[24:28], 24000)
	binary.LittleEndian.PutUint32(wav[28:32], 48000)
	binary.LittleEndian.PutUint16(wav[32:34], 2)
	binary.LittleEndian.PutUint16(wav[34:36], 16)
	copy(wav[36:40], "data")
	binary.LittleEndian.PutUint32(wav[40:44], 4800)
	return wav
}

func TestGeminiInlineTranscribeDriverAdmitsOnlyBoundedWAV(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "gemini", "gemini-3.5-transcribe", "audio.transcribe")
	request := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
			MimeType: "audio/wav", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: geminiInlineTranscribeTestWAV()}},
		}}},
	}
	mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone)
	if err != nil || mapped.Adapter() != CloudMediaAdapterGeminiInteractionsTranscribe {
		t.Fatalf("exact inline ASR mapping=%+v err=%v", mapped, err)
	}
	request.GetSpec().GetSpeechTranscribe().Timestamps = testBool(true)
	request.GetSpec().GetSpeechTranscribe().ResponseFormat = "text"
	if mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone); err != nil || !mapped.Request().GetSpec().GetSpeechTranscribe().GetTimestamps() {
		t.Fatalf("real word timestamps mapping=%+v err=%v", mapped, err)
	}
	cases := []struct {
		name   string
		mutate func(*runtimev1.SpeechTranscribeScenarioSpec)
	}{
		{"diarization", func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.Diarization = testBool(true) }},
		{"response format", func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.ResponseFormat = "srt" }},
		{"language", func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.Language = "en" }},
		{"hint", func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.Prompt = "Nimi" }},
		{"remote URL", func(s *runtimev1.SpeechTranscribeScenarioSpec) {
			s.AudioSource = &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: "https://example.com/audio.wav"}}
		}},
		{"wrong rate", func(s *runtimev1.SpeechTranscribeScenarioSpec) {
			audio := append([]byte(nil), s.AudioSource.GetAudioBytes()...)
			binary.LittleEndian.PutUint32(audio[24:28], 16000)
			s.AudioSource = &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: audio}}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			copy := *request.GetSpec().GetSpeechTranscribe()
			tc.mutate(&copy)
			candidate := &runtimev1.SubmitScenarioJobRequest{ScenarioType: request.ScenarioType, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &copy}}}
			_, err := driver.MapRequest(target, candidate, nil, CloudMediaStreamNone)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
				t.Fatalf("unsupported inline ASR reason=%v ok=%v err=%v", reason, ok, err)
			}
		})
	}
}
