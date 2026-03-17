package localrouting

import "strings"

var allProviders = []string{"llama", "media", "media.diffusers", "sidecar"}

func NormalizeCapability(capability string) string {
	switch strings.ToLower(strings.TrimSpace(capability)) {
	case "chat", "text.generate":
		return "text.generate"
	case "embedding", "embed", "text.embed":
		return "text.embed"
	case "image.understand":
		return "image.understand"
	case "image", "image.generate":
		return "image.generate"
	case "image.edit":
		return "image.edit"
	case "video", "video.generate":
		return "video.generate"
	case "i2v":
		return "i2v"
	case "tts", "speech", "audio.synthesize":
		return "audio.synthesize"
	case "stt", "transcription", "audio.transcribe":
		return "audio.transcribe"
	case "audio.understand":
		return "audio.understand"
	case "music", "music.generate":
		return "music.generate"
	default:
		return strings.ToLower(strings.TrimSpace(capability))
	}
}

func NormalizeProvider(provider string) string {
	return strings.ToLower(strings.TrimSpace(provider))
}

func IsKnownProvider(provider string) bool {
	switch NormalizeProvider(provider) {
	case "llama", "media", "media.diffusers", "sidecar":
		return true
	default:
		return false
	}
}

func ProviderSupportsCapability(provider string, capability string) bool {
	switch NormalizeProvider(provider) {
	case "llama":
		switch NormalizeCapability(capability) {
		case "text.generate", "text.embed", "image.understand", "audio.understand":
			return true
		}
	case "media", "media.diffusers":
		switch NormalizeCapability(capability) {
		case "image.generate", "image.edit", "video.generate", "i2v":
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
	default:
		switch normalizedCapability {
		case "image.generate", "image.edit", "video.generate", "i2v":
			return supportedProvidersInOrder(normalizedCapability, "media", "media.diffusers")
		case "text.generate", "text.embed", "image.understand", "audio.understand":
			return supportedProvidersInOrder(normalizedCapability, "llama")
		case "music.generate":
			return supportedProvidersInOrder(normalizedCapability, "sidecar")
		default:
			return supportedProvidersInOrder(normalizedCapability, "llama", "media", "media.diffusers", "sidecar")
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
