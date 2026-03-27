package localrouting

import (
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
)

func knownProviders() []string {
	return []string{"llama", "media", "speech", "sidecar"}
}

func NormalizeCapability(capability string) string {
	normalized := strings.ToLower(strings.TrimSpace(capability))
	switch normalized {
	case "chat":
		normalized = aicapabilities.TextGenerate
	case "embedding", "embed":
		normalized = aicapabilities.TextEmbed
	case "image":
		normalized = aicapabilities.ImageGenerate
	case "video":
		normalized = aicapabilities.VideoGenerate
	case "music":
		normalized = aicapabilities.MusicGenerate
	case "tts", "speech":
		normalized = aicapabilities.AudioSynthesize
	case "stt", "transcription":
		normalized = aicapabilities.AudioTranscribe
	}

	if catalogCapability, err := aicapabilities.NormalizeCatalogCapability(normalized); err == nil {
		switch catalogCapability {
		case aicapabilities.TextGenerateVision, aicapabilities.TextGenerateAudio, aicapabilities.TextGenerateVideo:
			return aicapabilities.TextGenerate
		case aicapabilities.MusicGenerateIteration:
			return aicapabilities.MusicGenerate
		default:
			return catalogCapability
		}
	}

	switch normalized {
	case "image.understand":
		return "image.understand"
	case "image.edit":
		return "image.edit"
	case "i2v":
		return "i2v"
	case "voice_workflow.tts_v2v":
		return "voice_workflow.tts_v2v"
	case "voice_workflow.tts_t2v":
		return "voice_workflow.tts_t2v"
	case "audio.understand":
		return "audio.understand"
	default:
		return normalized
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

// PreferenceOrder is intentionally capability-only today. The reserved first
// parameter keeps the call shape stable for a future OS-specific ordering
// policy without implying that the current implementation uses it.
func PreferenceOrder(_ string, capability string) []string {
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
