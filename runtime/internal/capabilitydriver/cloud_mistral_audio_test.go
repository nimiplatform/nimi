package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
)

func mistralTranscribeJob() *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte("validated later at the audio boundary")}}}}}}
}
func mistralSpeechJob() *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "你好。", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "voice_3142"}}}}}}
}
func TestMistralVoxtral3AdmitsNativeTranscriptionWithoutInventedWordTiming(t *testing.T) {
	for _, model := range []string{"voxtral-mini-transcribe-3-0", "voxtral-small-transcribe-3-0"} {
		d, target := cloudMediaDriverTarget(t, "mistral", model, "audio.transcribe")
		request := mistralTranscribeJob()
		request.GetSpec().GetSpeechTranscribe().Diarization = proto.Bool(true)
		mapped, err := d.MapRequest(target, request, nil, CloudMediaStreamNone)
		if err != nil || mapped.Adapter() != CloudMediaAdapterMistralTranscribe {
			t.Fatalf("%s: %v %v", model, mapped, err)
		}
		for name, modify := range map[string]func(*runtimev1.SpeechTranscribeScenarioSpec){
			"word timestamps":        func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.Timestamps = proto.Bool(true) },
			"speaker count":          func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.SpeakerCount = proto.Int32(2) },
			"provider output format": func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.ResponseFormat = "verbose_json" },
			"unsupported language":   func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.Language = "en-US" },
			"unsupported mime":       func(s *runtimev1.SpeechTranscribeScenarioSpec) { s.MimeType = "video/mp4" },
		} {
			t.Run(model+"/"+name, func(t *testing.T) {
				r := proto.Clone(request).(*runtimev1.SubmitScenarioJobRequest)
				modify(r.GetSpec().GetSpeechTranscribe())
				if _, err := d.MapRequest(target, r, nil, CloudMediaStreamNone); err == nil {
					t.Fatal("unsupported native option accepted")
				}
			})
		}
	}
}
func TestMistralVoxtral3SpeechCapturesFormatAndExactVoices(t *testing.T) {
	d, target := cloudMediaDriverTarget(t, "mistral", MistralVoxtralTTS3, "audio.synthesize")
	for _, mode := range []CloudMediaStreamMode{CloudMediaStreamNone, CloudMediaStreamNative} {
		request := mistralSpeechJob()
		mapped, err := d.MapRequest(target, request, nil, mode)
		if err != nil || mapped.Adapter() != CloudMediaAdapterMistralSpeech || mapped.Request().GetSpec().GetSpeechSynthesize().GetAudioFormat() != "wav" || request.GetSpec().GetSpeechSynthesize().GetAudioFormat() != "" {
			t.Fatalf("speech capture %v %v", mapped, err)
		}
	}
	for name, modify := range map[string]func(*runtimev1.SpeechSynthesizeScenarioSpec){
		"ignored language": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Language = "zh" },
		"ignored speed":    func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Speed = proto.Float32(1) },
		"word timing": func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.TimingMode = runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD
		},
		"raw pcm": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.AudioFormat = "pcm" },
		"unknown preset": func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.VoiceRef.Reference = &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "guessed-voice"}
		},
		"arbitrary provider id": func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
			s.VoiceRef = &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF, Reference: &runtimev1.VoiceReference_ProviderVoiceRef{ProviderVoiceRef: "https://other.invalid/voice"}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			r := mistralSpeechJob()
			modify(r.GetSpec().GetSpeechSynthesize())
			if _, err := d.MapRequest(target, r, nil, CloudMediaStreamNative); err == nil {
				t.Fatal("unsupported control accepted")
			}
		})
	}
	if _, err := d.MapRequest(target, mistralSpeechJob(), nil, CloudMediaStreamSimulated); err == nil {
		t.Fatal("native voice routed through generic simulated speech")
	}
}
func TestMistralVoiceLifecycleRequiresCapturedTarget(t *testing.T) {
	d, target := cloudMediaDriverTarget(t, "mistral", MistralVoxtralTTS3, "voice.create")
	id := "e3382729-55e6-409e-aa7f-a3fc3974f4d3"
	if mapped, err := d.MapVoiceDeleteRequest(target, id, MistralVoiceWorkflow); err != nil || mapped.Adapter() != CloudMediaAdapterMistralVoiceDelete {
		t.Fatalf("delete %v %v", mapped, err)
	}
	if _, err := d.MapVoiceDeleteRequest(target, id, "another-workflow"); err == nil {
		t.Fatal("foreign workflow deletion")
	}
	if _, err := d.MapVoiceInspectRequest(target, "../escaped"); err == nil {
		t.Fatal("arbitrary inspection path")
	}
	if mapped, err := d.MapVoiceInspectRequest(target, id); err != nil || mapped.Adapter() != CloudMediaAdapterMistralVoiceInspect {
		t.Fatalf("inspect %v %v", mapped, err)
	}
}
