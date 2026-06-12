package localrouting

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"gopkg.in/yaml.v3"
)

var authorityRoutes = sync.OnceValues(loadAuthorityRoutes)

type authorityRoute struct {
	Provider   string
	Capability string
}

type authorityRoutingDocument struct {
	Routes []struct {
		Provider   string `yaml:"provider"`
		Capability string `yaml:"capability"`
	} `yaml:"routes"`
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
	case "voice_workflow.voice_clone":
		return "voice_workflow.voice_clone"
	case "voice_workflow.voice_design":
		return "voice_workflow.voice_design"
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
	routes, err := authorityRoutes()
	if err != nil {
		return nil
	}
	providers := make([]string, 0, len(routes))
	seen := map[string]struct{}{}
	for _, route := range routes {
		if route.Provider == "*" || route.Capability == "*" || route.Capability != capability {
			continue
		}
		if _, ok := seen[route.Provider]; ok {
			continue
		}
		seen[route.Provider] = struct{}{}
		providers = append(providers, route.Provider)
	}
	return supportedProvidersInOrder(capability, providers...)
}

func providerSupportsNormalizedCapability(provider string, capability string) bool {
	normalizedProvider := NormalizeProvider(provider)
	routes, err := authorityRoutes()
	if err != nil {
		return false
	}
	for _, route := range routes {
		if route.Provider == normalizedProvider && route.Capability == capability {
			return true
		}
	}
	return false
}

func knownProviders() []string {
	return []string{"llama", "media", "speech", "sidecar"}
}

func loadAuthorityRoutes() ([]authorityRoute, error) {
	path, err := localAdapterRoutingAuthorityPath()
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc authorityRoutingDocument
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	routes := make([]authorityRoute, 0, len(doc.Routes))
	for _, route := range doc.Routes {
		provider := NormalizeProvider(route.Provider)
		capability := NormalizeCapability(route.Capability)
		if provider == "" || capability == "" {
			continue
		}
		routes = append(routes, authorityRoute{Provider: provider, Capability: capability})
	}
	return routes, nil
}

func localAdapterRoutingAuthorityPath() (string, error) {
	const relative = ".nimi/spec/runtime/kernel/tables/local-adapter-routing.yaml"
	var starts []string
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	if exe, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(exe))
	}
	for _, start := range starts {
		for dir := filepath.Clean(start); ; dir = filepath.Dir(dir) {
			candidate := filepath.Join(dir, relative)
			if _, err := os.Stat(candidate); err == nil {
				return candidate, nil
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
		}
	}
	return "", os.ErrNotExist
}
