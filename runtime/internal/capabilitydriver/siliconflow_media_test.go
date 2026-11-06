package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestSiliconFlowSpeechRejectsAmbiguousVoiceAndControls(t *testing.T) {
	model := "FunAudioLLM/CosyVoice2-0.5B"
	driver, target := cloudMediaDriverTarget(t, "siliconflow", model, "audio.synthesize")
	base := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "A short sentence.", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: model + ":alex"}}}}}}
	for _, mutate := range []func(*runtimev1.SpeechSynthesizeScenarioSpec){
		func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.VoiceRef.Reference = &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "alex"}
		},
		func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.VoiceRef.Reference = &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "fnlp/MOSS-TTSD-v0.5:alex"}
		},
		func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Language = "en" },
		func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.SampleRateHz = proto.Int32(24000)
			s.AudioFormat = "mp3"
		},
		func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Speed = proto.Float32(.1) },
	} {
		bad := proto.Clone(base).(*runtimev1.SubmitScenarioJobRequest)
		mutate(bad.GetSpec().GetSpeechSynthesize())
		if _, err := driver.MapRequest(target, bad, nil, CloudMediaStreamNone); err == nil {
			t.Fatal("unsupported native speech request accepted", bad)
		}
	}
	if _, err := driver.MapRequest(target, base, nil, CloudMediaStreamNative); err == nil {
		t.Fatal("unreviewed streaming admitted")
	}
	for _, rate := range []int32{8000, 16000, 24000, 32000, 44100} {
		req := proto.Clone(base).(*runtimev1.SubmitScenarioJobRequest)
		req.GetSpec().GetSpeechSynthesize().AudioFormat = "wav"
		req.GetSpec().GetSpeechSynthesize().SampleRateHz = proto.Int32(rate)
		if _, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone); err != nil {
			t.Fatal(rate, err)
		}
	}
}

func TestSiliconFlowImageEditCannotSilentlyDropSizeOrInputs(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "siliconflow", SiliconFlowImageEditModel, "image.generate")
	for _, spec := range []*runtimev1.ImageGenerateScenarioSpec{
		{Prompt: "edit", ReferenceImageArtifactId: "owned", Size: "1024x1024"},
		{Prompt: "edit"},
		{Prompt: "edit", ReferenceImageArtifactId: "owned", ReferenceImages: []string{"https://example.com/image.png"}},
		{Prompt: "edit", ReferenceImages: []string{"http://example.com/image.png"}},
	} {
		req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: spec}}}
		if _, err := driver.MapRequest(target, req, nil, CloudMediaStreamNone); err == nil {
			t.Fatal("unrepresentable edit accepted", spec)
		}
	}
}
