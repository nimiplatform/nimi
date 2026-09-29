package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestGeminiTTSDriverAdmitsOnlyExactKoreWAV(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "gemini", "gemini-3.8-flash-tts", "audio.synthesize")
	spec := &runtimev1.SpeechSynthesizeScenarioSpec{
		Text: "Hello from Nimi.", Language: "en", AudioFormat: "wav", SampleRateHz: testInt32(24000),
		VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "Kore"}},
	}
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: spec}}}
	mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone)
	if err != nil || mapped.Adapter() != CloudMediaAdapterGeminiTTSGenerateContent {
		t.Fatalf("exact Gemini TTS mapping=%+v err=%v", mapped, err)
	}
	chinese := *spec
	chinese.Text = "你好，欢迎使用 Nimi。"
	chinese.Language = "zh"
	chineseRequest := &runtimev1.SubmitScenarioJobRequest{ScenarioType: request.ScenarioType, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &chinese}}}
	if mapped, err := driver.MapRequest(target, chineseRequest, nil, CloudMediaStreamNone); err != nil || mapped.Adapter() != CloudMediaAdapterGeminiTTSGenerateContent {
		t.Fatalf("Chinese Gemini TTS mapping=%+v err=%v", mapped, err)
	}
	cases := []struct {
		name   string
		mutate func(*runtimev1.SpeechSynthesizeScenarioSpec)
	}{
		{"other voice", func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.VoiceRef.Reference = &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "Puck"}
		}},
		{"mp3", func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.AudioFormat = "mp3" }},
		{"other language", func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Language = "ja" }},
		{"rate", func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.SampleRateHz = testInt32(16000) }},
		{"emotion", func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Emotion = "cheerful" }},
		{"word timing", func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.TimingMode = runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			copy := *spec
			ref := *spec.VoiceRef
			copy.VoiceRef = &ref
			tc.mutate(&copy)
			candidate := &runtimev1.SubmitScenarioJobRequest{ScenarioType: request.ScenarioType, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &copy}}}
			_, err := driver.MapRequest(target, candidate, nil, CloudMediaStreamNone)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
				t.Fatalf("unsupported Gemini TTS reason=%v ok=%v err=%v", reason, ok, err)
			}
		})
	}
	if _, err := driver.MapRequest(target, request, nil, CloudMediaStreamSimulated); err == nil {
		t.Fatal("Gemini unary TTS accepted a simulated stream claim")
	}
}

func TestGeminiTTSLiteUsesSameExactDialect(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "gemini", "gemini-3.8-flash-lite-tts", "audio.synthesize")
	request := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
			Text:     "Hello from Nimi Lite.",
			VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "Kore"}},
		}}},
	}
	mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone)
	if err != nil || mapped.Adapter() != CloudMediaAdapterGeminiTTSGenerateContent {
		t.Fatalf("Lite TTS mapping=%+v err=%v", mapped, err)
	}
	request.GetSpec().GetSpeechSynthesize().Text = "你好，欢迎使用 Nimi 轻量版。"
	request.GetSpec().GetSpeechSynthesize().Language = "zh"
	if mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone); err != nil || mapped.Adapter() != CloudMediaAdapterGeminiTTSGenerateContent {
		t.Fatalf("Lite Chinese TTS mapping=%+v err=%v", mapped, err)
	}
}
