package localservice

import "strings"

type profileRuntimeImageCompanionSlotContract struct {
	Role          string
	EngineSlot    string
	ComponentKind string
	Required      bool
}

func normalizeProfileRuntimeImageModelFamily(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	switch normalized {
	case "z-image":
		if value != "z-image" {
			return ""
		}
	case "z-image-turbo", "z-image-base":
		return ""
	}
	return normalized
}

func invalidProfileRuntimeImageModelFamily(value string) bool {
	return strings.TrimSpace(value) != "" && normalizeProfileRuntimeImageModelFamily(value) == ""
}

func profileRuntimeRequiredImageCompanionSlots(family string) []profileRuntimeImageCompanionSlotContract {
	switch normalizeProfileRuntimeImageModelFamily(family) {
	case "ideogram4":
		return []profileRuntimeImageCompanionSlotContract{
			{Role: "uncond_diffusion_model", EngineSlot: "uncond_diffusion_model", ComponentKind: "image", Required: true},
			{Role: "text_encoder", EngineSlot: "llm_path", ComponentKind: "chat", Required: true},
			{Role: "vae", EngineSlot: "vae_path", ComponentKind: "vae", Required: true},
		}
	case "z-image":
		return []profileRuntimeImageCompanionSlotContract{
			{Role: "text_encoder", EngineSlot: "llm_path", ComponentKind: "chat", Required: true},
			{Role: "vae", EngineSlot: "vae_path", ComponentKind: "vae", Required: true},
		}
	default:
		return nil
	}
}
