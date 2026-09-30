package capabilitydriver

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func openAISpeechTestRequest(mutate func(*runtimev1.SpeechSynthesizeScenarioSpec)) *runtimev1.SubmitScenarioJobRequest {
	spec := &runtimev1.SpeechSynthesizeScenarioSpec{
		Text:     "你好，欢迎使用 Nimi。",
		VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "coral"}},
	}
	if mutate != nil {
		mutate(spec)
	}
	return &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: spec}},
	}
}

func openAISpeechPreset(voice string) *runtimev1.VoiceReference {
	return &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: voice}}
}

func TestOpenAISpeechMapsOnlyBuiltInVoiceMP3(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "openai", "gpt-4o-mini-tts", "audio.synthesize")
	for name, mutate := range map[string]func(*runtimev1.SpeechSynthesizeScenarioSpec){
		"plain": nil,
		"declared mp3 at speed": func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.Language, s.AudioFormat, s.Speed, s.SampleRateHz = "zh", "MP3", proto.Float32(1.5), proto.Int32(24000)
		},
		"newest voice": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.VoiceRef = openAISpeechPreset("cedar") },
	} {
		mapped, err := driver.MapRequest(target, openAISpeechTestRequest(mutate), nil, CloudMediaStreamNone)
		if err != nil || mapped.Adapter() != CloudMediaAdapterOpenAISpeech || mapped.ProviderModelID() != "gpt-4o-mini-tts" {
			t.Fatalf("%s mapping=%+v err=%v", name, mapped, err)
		}
	}
	legacy, legacyTarget := cloudMediaDriverTarget(t, "openai", "tts-1", "audio.synthesize")
	if mapped, err := legacy.MapRequest(legacyTarget, openAISpeechTestRequest(nil), nil, CloudMediaStreamNone); err != nil || mapped.Adapter() != CloudMediaAdapterOpenAISpeech {
		t.Fatalf("tts-1 mapping=%+v err=%v", mapped, err)
	}

	for name, tc := range map[string]struct {
		model  string
		stream CloudMediaStreamMode
		mutate func(*runtimev1.SpeechSynthesizeScenarioSpec)
	}{
		"no voice":               {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.VoiceRef = nil }},
		"unknown voice":          {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.VoiceRef = openAISpeechPreset("Coral") }},
		"voice newer than tts-1": {model: "tts-1", mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.VoiceRef = openAISpeechPreset("cedar") }},
		"voice asset": {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.VoiceRef = &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET, Reference: &runtimev1.VoiceReference_VoiceAssetId{VoiceAssetId: "asset-1"}}
		}},
		"too long": {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.Text = strings.Repeat("好", maxOpenAISpeechInputRunes+1)
		}},
		"language":    {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Language = "ja" }},
		"wav":         {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.AudioFormat = "wav" }},
		"sample rate": {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.SampleRateHz = proto.Int32(16000) }},
		"slow":        {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Speed = proto.Float32(0.2) }},
		"pitch":       {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Pitch = proto.Float32(1) }},
		"volume":      {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Volume = proto.Float32(1) }},
		"emotion":     {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Emotion = "cheerful" }},
		"render hints": {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.VoiceRenderHints = &runtimev1.VoiceRenderHints{Speed: 1.2}
		}},
		"word timing": {mutate: func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.TimingMode = runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD
		}},
		"native stream":    {stream: CloudMediaStreamNative},
		"simulated stream": {stream: CloudMediaStreamSimulated},
	} {
		model := tc.model
		if model == "" {
			model = "gpt-4o-mini-tts"
		}
		stream := tc.stream
		if stream == "" {
			stream = CloudMediaStreamNone
		}
		driver, target := cloudMediaDriverTarget(t, "openai", model, "audio.synthesize")
		_, err := driver.MapRequest(target, openAISpeechTestRequest(tc.mutate), nil, stream)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("%s must fail typed before dispatch: reason=%v present=%v err=%v", name, reason, ok, err)
		}
	}
	extended := openAISpeechTestRequest(nil)
	payload, _ := structpb.NewStruct(map[string]any{"instructions": "cheerful"})
	extended.Extensions = []*runtimev1.ScenarioExtension{{Namespace: "nimi.scenario.speech_synthesize.request", Payload: payload}}
	_, err := driver.MapRequest(target, extended, nil, CloudMediaStreamNone)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("extensions must not reach the exact speech cell: reason=%v present=%v err=%v", reason, ok, err)
	}
}
