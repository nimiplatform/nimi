package localrouting

import "strings"

func NormalizeCapability(capability string) string {
	switch strings.ToLower(strings.TrimSpace(capability)) {
	case "chat", "text.generate":
		return "text.generate"
	case "embedding", "embed", "text.embed":
		return "text.embed"
	case "image", "image.generate":
		return "image.generate"
	case "video", "video.generate":
		return "video.generate"
	case "tts", "speech", "audio.synthesize":
		return "audio.synthesize"
	case "stt", "transcription", "audio.transcribe":
		return "audio.transcribe"
	case "music", "music.generate":
		return "music.generate"
	default:
		return strings.ToLower(strings.TrimSpace(capability))
	}
}

func PreferenceOrder(goos string, capability string) []string {
	normalizedGOOS := strings.ToLower(strings.TrimSpace(goos))
	switch normalizedGOOS {
	case "windows":
		switch NormalizeCapability(capability) {
		case "image.generate", "video.generate":
			return []string{"nimi_media", "localai", "nexa", "sidecar"}
		case "text.generate", "text.embed", "audio.synthesize", "audio.transcribe":
			return []string{"nexa", "localai", "sidecar", "nimi_media"}
		case "music.generate":
			return []string{"sidecar", "localai", "nexa"}
		default:
			return []string{"localai", "sidecar", "nexa", "nimi_media"}
		}
	default:
		switch NormalizeCapability(capability) {
		case "image.generate", "video.generate":
			return []string{"localai", "nimi_media", "nexa", "sidecar"}
		case "text.generate", "text.embed", "audio.synthesize", "audio.transcribe":
			return []string{"localai", "nexa", "sidecar", "nimi_media"}
		case "music.generate":
			return []string{"sidecar", "localai", "nexa"}
		default:
			return []string{"localai", "sidecar", "nexa", "nimi_media"}
		}
	}
}

func PreferenceRank(goos string, capability string, provider string) int {
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	order := PreferenceOrder(goos, capability)
	for index, engine := range order {
		if normalizedProvider == engine {
			return index
		}
	}
	return len(order)
}
