package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func isRunnableKind(k runtimev1.LocalAssetKind) bool {
	switch k {
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO,
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS,
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT,
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING,
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC:
		return true
	default:
		return false
	}
}

func normalizeAssetCapabilities(capabilities []string) []string {
	if len(capabilities) == 0 {
		return nil
	}
	normalized := make([]string, 0, len(capabilities))
	for _, capability := range capabilities {
		trimmed := strings.TrimSpace(capability)
		if trimmed == "" {
			continue
		}
		switch trimmed {
		case "text.generate":
			normalized = append(normalized, "text.generate")
		case "text.embed":
			normalized = append(normalized, "text.embed")
		case "image.generate":
			normalized = append(normalized, "image.generate")
		case "video.generate":
			normalized = append(normalized, "video.generate")
		case "audio.synthesize":
			normalized = append(normalized, "audio.synthesize")
		case "audio.transcribe":
			normalized = append(normalized, "audio.transcribe")
		case "voice.create":
			normalized = append(normalized, "voice.create")
		case "music.generate":
			normalized = append(normalized, "music.generate")
		default:
			normalized = append(normalized, trimmed)
		}
	}
	return normalizeStringSlice(normalized)
}

// inferAssetKindFromCapabilities accepts only an exact, order-independent
// CapabilityContract-to-kind mapping. Unknown or cross-kind capability sets
// fail closed as UNSPECIFIED; callers must not guess a default kind.
func inferAssetKindFromCapabilities(capabilities []string) runtimev1.LocalAssetKind {
	normalizedCapabilities := normalizeAssetCapabilities(capabilities)
	resolved := runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED
	for _, capability := range normalizedCapabilities {
		kind := runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED
		switch capability {
		case "text.generate":
			kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
		case "text.embed":
			kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING
		case "image.generate":
			kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE
		case "video.generate":
			kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO
		case "music.generate":
			kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC
		case "audio.synthesize", "voice.create":
			kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS
		case "audio.transcribe":
			kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT
		default:
			return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED
		}
		if resolved != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED && resolved != kind {
			return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED
		}
		resolved = kind
	}
	return resolved
}

func effectiveAssetKind(kind runtimev1.LocalAssetKind, capabilities []string) runtimev1.LocalAssetKind {
	if kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return kind
	}
	return inferAssetKindFromCapabilities(capabilities)
}

func catalogModelTypeForAssetKind(kind runtimev1.LocalAssetKind) string {
	switch kind {
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT:
		return "chat"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING:
		return "embedding"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE:
		return "image"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO:
		return "video"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS:
		return "tts"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT:
		return "stt"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC:
		return "music"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE:
		return "vae"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CLIP:
		return "clip"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA:
		return "lora"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CONTROLNET:
		return "controlnet"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY:
		return "auxiliary"
	default:
		return ""
	}
}
