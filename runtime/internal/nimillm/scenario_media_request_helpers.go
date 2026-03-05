package nimillm

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func scenarioModal(req *runtimev1.SubmitScenarioJobRequest) runtimev1.Modal {
	if req == nil {
		return runtimev1.Modal_MODAL_UNSPECIFIED
	}
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return runtimev1.Modal_MODAL_IMAGE
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return runtimev1.Modal_MODAL_VIDEO
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return runtimev1.Modal_MODAL_TTS
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return runtimev1.Modal_MODAL_STT
	default:
		return runtimev1.Modal_MODAL_UNSPECIFIED
	}
}

func scenarioImageSpec(req *runtimev1.SubmitScenarioJobRequest) *runtimev1.ImageGenerateScenarioSpec {
	if req == nil || req.GetSpec() == nil {
		return nil
	}
	return req.GetSpec().GetImageGenerate()
}

func scenarioVideoSpec(req *runtimev1.SubmitScenarioJobRequest) *runtimev1.VideoGenerateScenarioSpec {
	if req == nil || req.GetSpec() == nil {
		return nil
	}
	return req.GetSpec().GetVideoGenerate()
}

func scenarioSpeechSynthesizeSpec(req *runtimev1.SubmitScenarioJobRequest) *runtimev1.SpeechSynthesizeScenarioSpec {
	if req == nil || req.GetSpec() == nil {
		return nil
	}
	return req.GetSpec().GetSpeechSynthesize()
}

func scenarioSpeechTranscribeSpec(req *runtimev1.SubmitScenarioJobRequest) *runtimev1.SpeechTranscribeScenarioSpec {
	if req == nil || req.GetSpec() == nil {
		return nil
	}
	return req.GetSpec().GetSpeechTranscribe()
}

func scenarioVoiceRef(spec *runtimev1.SpeechSynthesizeScenarioSpec) string {
	if spec == nil || spec.GetVoiceRef() == nil {
		return ""
	}
	ref := spec.GetVoiceRef()
	switch ref.GetKind() {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		return strings.TrimSpace(ref.GetProviderVoiceRef())
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		return strings.TrimSpace(ref.GetPresetVoiceId())
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET:
		return strings.TrimSpace(ref.GetVoiceAssetId())
	default:
		return ""
	}
}

func scenarioExtensionPayload(req *runtimev1.SubmitScenarioJobRequest, namespace string) map[string]any {
	if req == nil || namespace == "" {
		return nil
	}
	for _, ext := range req.GetExtensions() {
		if strings.TrimSpace(ext.GetNamespace()) != namespace {
			continue
		}
		return StructToMap(ext.GetPayload())
	}
	return nil
}
