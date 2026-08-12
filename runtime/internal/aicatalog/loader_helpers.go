package catalog

import (
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
)

func normalizeWorkflowType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "reference_audio":
		return "reference_audio"
	case "text_description":
		return "text_description"
	default:
		return ""
	}
}

func isAllowedVoicePersistence(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "provider_persistent", "session_ephemeral":
		return true
	default:
		return false
	}
}

func isAllowedVoiceHandleScope(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "user_scoped", "app_scoped":
		return true
	default:
		return false
	}
}

func isAllowedVoiceDeleteSemantics(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "runtime_authoritative_delete", "best_effort_provider_delete":
		return true
	default:
		return false
	}
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
