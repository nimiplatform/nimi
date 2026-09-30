package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestOpenAITranscribeMapsOnlyUploadedPlainTranscripts(t *testing.T) {
	request := func(spec *runtimev1.SpeechTranscribeScenarioSpec) *runtimev1.SubmitScenarioJobRequest {
		if spec.AudioSource == nil {
			spec.AudioSource = &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte("audio")}}
		}
		if spec.MimeType == "" {
			spec.MimeType = "audio/wav"
		}
		return &runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
			Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: spec}},
		}
	}
	for _, model := range []string{"gpt-transcribe", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"} {
		driver, target := cloudMediaDriverTarget(t, "openai", model, "audio.transcribe")
		mapped, err := driver.MapRequest(target, request(&runtimev1.SpeechTranscribeScenarioSpec{Language: "zh-CN", MimeType: "audio/mpeg"}), nil, CloudMediaStreamNone)
		if err != nil || mapped.Adapter() != CloudMediaAdapterOpenAITranscriptions || mapped.ProviderModelID() != model {
			t.Fatalf("%s mapping=%+v err=%v", model, mapped, err)
		}
	}
	driver, target := cloudMediaDriverTarget(t, "openai", "gpt-4o-transcribe", "audio.transcribe")
	if _, err := driver.MapRequest(target, request(&runtimev1.SpeechTranscribeScenarioSpec{Prompt: "Nimi", ResponseFormat: "text"}), nil, CloudMediaStreamNone); err != nil {
		t.Fatalf("a GPT-4o hint and plain result must map: %v", err)
	}
	whisper, whisperTarget := cloudMediaDriverTarget(t, "openai", "whisper-1", "audio.transcribe")
	if mapped, err := whisper.MapRequest(whisperTarget, request(&runtimev1.SpeechTranscribeScenarioSpec{}), nil, CloudMediaStreamNone); err != nil || mapped.Adapter() != CloudMediaAdapterOpenAICompat {
		t.Fatalf("whisper-1 stays outside the exact cell: mapping=%+v err=%v", mapped, err)
	}

	driver, target = cloudMediaDriverTarget(t, "openai", "gpt-transcribe", "audio.transcribe")
	for name, spec := range map[string]*runtimev1.SpeechTranscribeScenarioSpec{
		"timestamps":    {Timestamps: testBool(true)},
		"diarization":   {Diarization: testBool(true)},
		"speakers":      {SpeakerCount: testInt32(2)},
		"hint":          {Prompt: "Nimi"},
		"json result":   {ResponseFormat: "json"},
		"subtitles":     {ResponseFormat: "srt"},
		"language text": {Language: "Chinese"},
		"ogg file":      {MimeType: "audio/ogg"},
		"remote URL": {AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
			Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: "https://example.com/audio.wav"},
		}},
		"oversized": {AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
			Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: make([]byte, maxOpenAITranscribeUploadBytes+1)},
		}},
	} {
		_, err := driver.MapRequest(target, request(spec), nil, CloudMediaStreamNone)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("%s must fail typed before dispatch: reason=%v present=%v err=%v", name, reason, ok, err)
		}
	}
	extended := request(&runtimev1.SpeechTranscribeScenarioSpec{})
	payload, _ := structpb.NewStruct(map[string]any{"temperature": 0.2})
	extended.Extensions = []*runtimev1.ScenarioExtension{{Namespace: "nimi.scenario.speech_transcribe.request", Payload: payload}}
	_, err := driver.MapRequest(target, extended, nil, CloudMediaStreamNone)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("extensions must not reach the exact transcription cell: reason=%v present=%v err=%v", reason, ok, err)
	}
}
