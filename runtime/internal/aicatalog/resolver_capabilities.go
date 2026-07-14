package catalog

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
)

func (r *Resolver) SupportsScenario(providerType string, modelID string, scenarioType runtimev1.ScenarioType) (bool, error) {
	return r.SupportsScenarioForSubject("", providerType, modelID, scenarioType)
}

func (r *Resolver) SupportsScenarioForSubject(subjectUserID string, providerType string, modelID string, scenarioType runtimev1.ScenarioType) (bool, error) {
	model, err := r.ResolveModelEntryForSubject(subjectUserID, providerType, modelID)
	if err != nil {
		return false, err
	}
	capabilities := make(map[string]struct{}, len(model.Capabilities))
	for _, capability := range model.Capabilities {
		normalized, err := aicapabilities.NormalizeCatalogCapability(capability)
		if err != nil {
			continue
		}
		capabilities[normalized] = struct{}{}
	}
	hasAny := func(values ...string) bool {
		for _, value := range values {
			if _, ok := capabilities[value]; ok {
				return true
			}
		}
		return false
	}

	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		return hasAny(aicapabilities.TextGenerate), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED:
		return hasAny(aicapabilities.TextEmbed), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return hasAny(aicapabilities.ImageGenerate), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return hasAny(aicapabilities.VideoGenerate), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return hasAny(aicapabilities.AudioSynthesize), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return hasAny(aicapabilities.AudioTranscribe), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return hasAny(aicapabilities.WorldGenerate), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		_, workflowErr := r.ResolveVoiceWorkflowForSubject(subjectUserID, providerType, modelID, "voice_clone")
		if workflowErr == nil {
			return true, nil
		}
		if workflowErr == ErrVoiceWorkflowUnsupported {
			return false, nil
		}
		return false, workflowErr
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		_, workflowErr := r.ResolveVoiceWorkflowForSubject(subjectUserID, providerType, modelID, "voice_design")
		if workflowErr == nil {
			return true, nil
		}
		if workflowErr == ErrVoiceWorkflowUnsupported {
			return false, nil
		}
		return false, workflowErr
	default:
		return false, nil
	}
}

func (r *Resolver) SupportsCapability(providerType string, modelID string, capability string) (bool, error) {
	return r.SupportsCapabilityForSubject("", providerType, modelID, capability)
}

func (r *Resolver) SupportsCapabilityForSubject(subjectUserID string, providerType string, modelID string, capability string) (bool, error) {
	model, err := r.ResolveModelEntryForSubject(subjectUserID, providerType, modelID)
	if err != nil {
		return false, err
	}
	return aicapabilities.HasCatalogCapability(model.Capabilities, capability), nil
}

// ResolveAPIModelID returns the canonical API model ID for a provider model.
// If the catalog entry has an explicit ApiModelID, that value is returned;
// otherwise modelID is returned unchanged.
func (r *Resolver) ResolveAPIModelID(providerType string, modelID string) string {
	return r.ResolveAPIModelIDForSubject("", providerType, modelID)
}

func (r *Resolver) ResolveAPIModelIDForSubject(subjectUserID string, providerType string, modelID string) string {
	entry, err := r.ResolveModelEntryForSubject(subjectUserID, providerType, modelID)
	if err != nil {
		return modelID
	}
	if api := strings.TrimSpace(entry.ApiModelID); api != "" {
		return api
	}
	return modelID
}

func (r *Resolver) SupportsVoice(providerType string, modelID string, voiceID string) (ResolveVoicesResult, bool, error) {
	return r.SupportsVoiceForSubject("", providerType, modelID, voiceID)
}

func (r *Resolver) SupportsVoiceForSubject(subjectUserID string, providerType string, modelID string, voiceID string) (ResolveVoicesResult, bool, error) {
	result, err := r.ResolveVoicesForSubject(subjectUserID, providerType, modelID)
	if err != nil {
		return ResolveVoicesResult{}, false, err
	}
	requested := strings.TrimSpace(voiceID)
	if requested == "" {
		return result, true, nil
	}
	requestedLower := strings.ToLower(requested)
	for _, voice := range result.Voices {
		id := strings.TrimSpace(voice.VoiceID)
		if id == "" {
			continue
		}
		if id == requested || strings.ToLower(id) == requestedLower {
			return result, true, nil
		}
	}
	return result, false, nil
}
