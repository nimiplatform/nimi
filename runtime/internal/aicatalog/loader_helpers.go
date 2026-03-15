package catalog

import (
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
)

func normalizeWorkflowType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "tts_v2v":
		return "tts_v2v"
	case "tts_t2v":
		return "tts_t2v"
	default:
		return ""
	}
}

func inferProviderFromWorkflowModelID(workflowModelID string, targetModelRefs []string, modelSet map[string]ModelEntry) string {
	normalizedWorkflowModelID := strings.TrimSpace(strings.ToLower(workflowModelID))
	if idx := strings.Index(normalizedWorkflowModelID, ":"); idx > 0 {
		return strings.TrimSpace(normalizedWorkflowModelID[:idx])
	}
	if idx := strings.Index(normalizedWorkflowModelID, "/"); idx > 0 {
		return strings.TrimSpace(normalizedWorkflowModelID[:idx])
	}
	for _, targetModelRaw := range targetModelRefs {
		modelID := normalizeID(targetModelRaw)
		if modelID == "" {
			continue
		}
		for key := range modelSet {
			if strings.HasSuffix(key, ":"+modelID) {
				parts := strings.SplitN(key, ":", 2)
				if len(parts) == 2 {
					return parts[0]
				}
			}
		}
	}
	return ""
}

func inferProviderFromBindingModelID(modelID string, modelSet map[string]ModelEntry) string {
	for key := range modelSet {
		if strings.HasSuffix(key, ":"+normalizeID(modelID)) {
			parts := strings.SplitN(key, ":", 2)
			if len(parts) == 2 {
				return parts[0]
			}
		}
	}
	return ""
}

func normalizeProvider(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeID(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func isSpeechSynthesisModel(model ModelEntry) bool {
	if strings.EqualFold(strings.TrimSpace(model.ModelType), "tts") {
		return true
	}
	return containsCapability(model.Capabilities, aicapabilities.AudioSynthesize)
}

func modelRequiresVideoGeneration(model ModelEntry) bool {
	return containsCapability(model.Capabilities, aicapabilities.VideoGenerate)
}

func containsCapability(capabilities []string, expected string) bool {
	return aicapabilities.HasCatalogCapability(capabilities, expected)
}

func modelRequiresVoice(model ModelEntry) bool {
	if strings.TrimSpace(model.VoiceSetID) != "" {
		return true
	}
	return isSpeechSynthesisModel(model)
}
