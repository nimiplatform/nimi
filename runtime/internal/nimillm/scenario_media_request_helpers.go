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
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return runtimev1.Modal_MODAL_MUSIC
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

func scenarioExtensionNamespaceForType(scenarioType runtimev1.ScenarioType) string {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return "nimi.scenario.image.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return "nimi.scenario.video.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return "nimi.scenario.speech_synthesize.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return "nimi.scenario.speech_transcribe.request"
	default:
		return ""
	}
}

// ScenarioExtensionPayloadForType returns the namespaced scenario extension
// payload for the given scenario type.
func ScenarioExtensionPayloadForType(scenarioType runtimev1.ScenarioType, extensions []*runtimev1.ScenarioExtension) map[string]any {
	namespace := scenarioExtensionNamespaceForType(scenarioType)
	if namespace == "" {
		return nil
	}
	for _, ext := range extensions {
		if strings.TrimSpace(ext.GetNamespace()) != namespace {
			continue
		}
		return StructToMap(ext.GetPayload())
	}
	return nil
}

func scenarioExtensionPayloadForScenario(req *runtimev1.SubmitScenarioJobRequest) map[string]any {
	if req == nil {
		return nil
	}
	return ScenarioExtensionPayloadForType(req.GetScenarioType(), req.GetExtensions())
}
