package localrouting

import "strings"

var allProviders = []string{"localai", "nexa", "nimi_media", "sidecar"}

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

func NormalizeProvider(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "localsidecar":
		return "sidecar"
	default:
		return strings.ToLower(strings.TrimSpace(provider))
	}
}

func IsKnownProvider(provider string) bool {
	switch NormalizeProvider(provider) {
	case "localai", "nexa", "nimi_media", "sidecar":
		return true
	default:
		return false
	}
}

func ProviderSupportsCapability(provider string, capability string) bool {
	switch NormalizeProvider(provider) {
	case "localai":
		switch NormalizeCapability(capability) {
		case "text.generate", "text.embed", "image.generate", "video.generate", "audio.synthesize", "audio.transcribe", "music.generate":
			return true
		}
	case "nexa":
		switch NormalizeCapability(capability) {
		case "text.generate", "text.embed", "audio.synthesize", "audio.transcribe":
			return true
		}
	case "nimi_media":
		switch NormalizeCapability(capability) {
		case "image.generate", "video.generate":
			return true
		}
	case "sidecar":
		return NormalizeCapability(capability) == "music.generate"
	}
	return false
}

func PreferenceOrder(goos string, capability string) []string {
	normalizedGOOS := strings.ToLower(strings.TrimSpace(goos))
	normalizedCapability := NormalizeCapability(capability)
	switch normalizedGOOS {
	case "windows":
		switch normalizedCapability {
		case "image.generate", "video.generate":
			return supportedProvidersInOrder(normalizedCapability, "nimi_media")
		case "text.generate", "text.embed", "audio.synthesize", "audio.transcribe":
			return supportedProvidersInOrder(normalizedCapability, "nexa")
		case "music.generate":
			return supportedProvidersInOrder(normalizedCapability, "sidecar")
		default:
			return supportedProvidersInOrder(normalizedCapability, "localai", "sidecar", "nexa", "nimi_media")
		}
	default:
		switch normalizedCapability {
		case "image.generate", "video.generate":
			return supportedProvidersInOrder(normalizedCapability, "localai", "nimi_media", "nexa", "sidecar")
		case "text.generate", "text.embed", "audio.synthesize", "audio.transcribe":
			return supportedProvidersInOrder(normalizedCapability, "localai", "nexa", "sidecar", "nimi_media")
		case "music.generate":
			return supportedProvidersInOrder(normalizedCapability, "sidecar", "localai", "nexa")
		default:
			return supportedProvidersInOrder(normalizedCapability, "localai", "sidecar", "nexa", "nimi_media")
		}
	}
}

func PreferenceRank(goos string, capability string, provider string) int {
	normalizedProvider := NormalizeProvider(provider)
	order := PreferenceOrder(goos, capability)
	for index, engine := range order {
		if normalizedProvider == engine {
			return index
		}
	}
	return len(order)
}

func supportedProvidersInOrder(capability string, providers ...string) []string {
	if len(providers) == 0 {
		providers = allProviders
	}
	out := make([]string, 0, len(providers))
	seen := make(map[string]struct{}, len(providers))
	for _, provider := range providers {
		normalizedProvider := NormalizeProvider(provider)
		if normalizedProvider == "" {
			continue
		}
		if _, ok := seen[normalizedProvider]; ok {
			continue
		}
		seen[normalizedProvider] = struct{}{}
		if ProviderSupportsCapability(normalizedProvider, capability) {
			out = append(out, normalizedProvider)
		}
	}
	return out
}
