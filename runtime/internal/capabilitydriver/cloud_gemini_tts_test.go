package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
)

func TestGeminiTTSDriverAdmitsPrebuiltEmotionAndRejectsUnsupportedControls(t *testing.T) {
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
	chinese := proto.Clone(spec).(*runtimev1.SpeechSynthesizeScenarioSpec)
	chinese.Text = "你好，欢迎使用 Nimi。"
	chinese.Language = "zh"
	chineseRequest := &runtimev1.SubmitScenarioJobRequest{ScenarioType: request.ScenarioType, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: chinese}}}
	if mapped, err := driver.MapRequest(target, chineseRequest, nil, CloudMediaStreamNone); err != nil || mapped.Adapter() != CloudMediaAdapterGeminiTTSGenerateContent {
		t.Fatalf("Chinese Gemini TTS mapping=%+v err=%v", mapped, err)
	}
	cases := []struct {
		name   string
		mutate func(*runtimev1.SpeechSynthesizeScenarioSpec)
	}{
		{"unknown voice", func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.VoiceRef.Reference = &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "Unknown"}
		}},
		{"voice casing", func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.VoiceRef.Reference = &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "puck"}
		}},
		{"mp3", func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.AudioFormat = "mp3" }},
		{"other language", func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Language = "ja" }},
		{"rate", func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.SampleRateHz = testInt32(16000) }},
		{"speed", func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Speed = testFloat32(1) }},
		{"pitch zero", func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Pitch = testFloat32(0) }},
		{"volume zero", func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Volume = testFloat32(0) }},
		{"render style", func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.VoiceRenderHints = &runtimev1.VoiceRenderHints{Style: 0.5}
		}},
		{"word timing", func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.TimingMode = runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			copy := proto.Clone(spec).(*runtimev1.SpeechSynthesizeScenarioSpec)
			tc.mutate(copy)
			candidate := &runtimev1.SubmitScenarioJobRequest{ScenarioType: request.ScenarioType, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: copy}}}
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

func TestGeminiTTSCatalogVoicesShareDriverDialect(t *testing.T) {
	resolver, err := catalog.NewResolver(catalog.ResolverConfig{})
	if err != nil {
		t.Fatal(err)
	}
	for _, model := range []string{"gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"} {
		t.Run(model, func(t *testing.T) {
			voices, err := resolver.ResolveVoices("gemini", model)
			if err != nil || len(voices.Voices) != 30 {
				t.Fatalf("prebuilt voices=%+v err=%v", voices, err)
			}
			entry, err := resolver.ResolveModelEntry("gemini", model)
			if err != nil || entry.VoiceRequestOptions == nil || !entry.VoiceRequestOptions.SupportsEmotion || entry.VoiceRequestOptions.VoiceRenderHints != nil || entry.VoiceRequestOptions.SupportsNativeStreamTTS {
				t.Fatalf("exact speech metadata=%+v err=%v", entry.VoiceRequestOptions, err)
			}
			driver, target := cloudMediaDriverTarget(t, "gemini", model, "audio.synthesize")
			for _, voice := range voices.Voices {
				spec := &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "  Hello, 世界!\n", Emotion: "warm and enthusiastic",
					VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: voice.VoiceID}},
				}
				request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: spec}}}
				mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone)
				if err != nil || mapped.Adapter() != CloudMediaAdapterGeminiTTSGenerateContent || !proto.Equal(mapped.Request().GetSpec().GetSpeechSynthesize(), spec) {
					t.Fatalf("%s/%s mapping=%+v err=%v", model, voice.VoiceID, mapped, err)
				}
			}
		})
	}
}

func TestGeminiTTSStoredVoiceKeepsSeparateEmotionBoundary(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "gemini", "gemini-3.8-flash-tts", "audio.synthesize")
	spec := &runtimev1.SpeechSynthesizeScenarioSpec{
		Text:     "Hello.",
		VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF, Reference: &runtimev1.VoiceReference_ProviderVoiceRef{ProviderVoiceRef: "voice_owned"}},
	}
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: spec}}}
	if mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone); err != nil || mapped.Adapter() != CloudMediaAdapterGeminiTTSInteractions {
		t.Fatalf("stored voice mapping=%+v err=%v", mapped, err)
	}
	spec.Emotion = "cheerful"
	if _, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone); err == nil {
		t.Fatal("unmapped stored voice emotion admitted")
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
