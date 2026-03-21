package localrouting

import "strings"

func knownProviders() []string {
	return []string{"llama", "media", "speech", "sidecar"}
}

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
	case "voice_workflow.tts_v2v":
		return "voice_workflow.tts_v2v"
	case "voice_workflow.tts_t2v":
		return "voice_workflow.tts_t2v"
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
	normalizedProvider := NormalizeProvider(provider)
	for _, candidate := range knownProviders() {
		if normalizedProvider == candidate {
			return true
		}
	}
	return false
}

func ProviderSupportsCapability(provider string, capability string) bool {
	normalizedProvider := NormalizeProvider(provider)
	for _, candidate := range providersForNormalizedCapability(NormalizeCapability(capability)) {
		if normalizedProvider == candidate {
			return true
		}
	}
	return false
}

func PreferenceOrder(goos string, capability string) []string {
	_ = strings.ToLower(strings.TrimSpace(goos))
	return providersForNormalizedCapability(NormalizeCapability(capability))
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
		providers = knownProviders()
	}
	out := make([]string, 0, len(providers))
	seen := make(map[string]struct{}, len(providers))
	for _, provider := range providers {
		if provider == "" {
			continue
		}
		if _, ok := seen[provider]; ok {
			continue
		}
		seen[provider] = struct{}{}
		if providerSupportsNormalizedCapability(provider, capability) {
			out = append(out, provider)
		}
	}
	return out
}

func providersForNormalizedCapability(capability string) []string {
	switch capability {
	case "image.generate", "image.edit", "video.generate", "i2v":
		return supportedProvidersInOrder(capability, "media")
	case "audio.synthesize", "audio.transcribe", "voice_workflow.tts_v2v", "voice_workflow.tts_t2v":
		return supportedProvidersInOrder(capability, "speech")
	case "text.generate", "text.embed", "image.understand", "audio.understand":
		return supportedProvidersInOrder(capability, "llama")
	case "music.generate":
		return supportedProvidersInOrder(capability, "sidecar")
	default:
		return supportedProvidersInOrder(capability, knownProviders()...)
	}
}

func providerSupportsNormalizedCapability(provider string, capability string) bool {
	switch provider {
	case "llama":
		return capability == "text.generate" || capability == "text.embed" || capability == "image.understand" || capability == "audio.understand"
	case "media":
		return capability == "image.generate" || capability == "image.edit" || capability == "video.generate" || capability == "i2v"
	case "speech":
		return capability == "audio.synthesize" || capability == "audio.transcribe" || capability == "voice_workflow.tts_v2v" || capability == "voice_workflow.tts_t2v"
	case "sidecar":
		return capability == "music.generate"
	default:
		return false
	}
}
