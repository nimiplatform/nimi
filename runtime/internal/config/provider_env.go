package config

import (
	"os"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

type providerEnvBinding struct {
	canonicalID string
	baseURLKey  string
	apiKeyKey   string
}

type ResolvedCloudProvider struct {
	CanonicalID string
	BaseURL     string
	APIKey      string
}

var providerEnvBindings = []providerEnvBinding{
	{canonicalID: "dashscope", baseURLKey: "NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY"},
	{canonicalID: "deepseek", baseURLKey: "NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY"},
	{canonicalID: "gemini", baseURLKey: "NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"},
	{canonicalID: "glm", baseURLKey: "NIMI_RUNTIME_CLOUD_GLM_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_GLM_API_KEY"},
	{canonicalID: "kimi", baseURLKey: "NIMI_RUNTIME_CLOUD_KIMI_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_KIMI_API_KEY"},
	{canonicalID: "minimax", baseURLKey: "NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY"},
	{canonicalID: "mimo", baseURLKey: "NIMI_RUNTIME_CLOUD_MIMO_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_MIMO_API_KEY"},
	{canonicalID: "nimillm", baseURLKey: "NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY"},
	{canonicalID: "openrouter", baseURLKey: "NIMI_RUNTIME_CLOUD_OPENROUTER_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_OPENROUTER_API_KEY"},
	{canonicalID: "volcengine", baseURLKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY"},
	{canonicalID: "volcengine_openspeech", baseURLKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY"},
}

func defaultRemoteProviderBaseURL(canonicalID string) string {
	record, ok := providerregistry.Lookup(strings.TrimSpace(canonicalID))
	if !ok || record.RuntimePlane != "remote" || record.RequiresExplicitEndpoint {
		return ""
	}
	return strings.TrimSpace(record.DefaultEndpoint)
}

func resolveCloudProviders(fileTargets map[string]RuntimeFileTarget) map[string]RuntimeFileTarget {
	resolved := make(map[string]RuntimeFileTarget, len(fileTargets)+len(providerEnvBindings))
	for providerName, target := range fileTargets {
		resolved[normalizedProviderKey(providerName)] = target
	}

	for _, binding := range providerEnvBindings {
		target := resolved[binding.canonicalID]
		resolvedBase := strings.TrimSpace(os.Getenv(binding.baseURLKey))
		if resolvedBase == "" {
			resolvedBase = strings.TrimSpace(target.BaseURL)
		}

		resolvedAPIKey, resolvedAPIKeyEnv := resolveProviderAPIKeyWithBindingSource(target, binding.apiKeyKey)
		declaredAPIKeyEnv := strings.TrimSpace(target.APIKeyEnv)
		if resolvedBase == "" && resolvedAPIKey == "" && strings.TrimSpace(target.DefaultModel) == "" {
			continue
		}
		if resolvedBase == "" {
			resolvedBase = defaultRemoteProviderBaseURL(binding.canonicalID)
		}

		target.BaseURL = resolvedBase
		if resolvedAPIKeyEnv != "" {
			target.APIKey = ""
			target.APIKeyEnv = resolvedAPIKeyEnv
		} else if declaredAPIKeyEnv != "" && resolvedAPIKey == "" {
			target.APIKey = ""
			target.APIKeyEnv = declaredAPIKeyEnv
		} else {
			target.APIKey = resolvedAPIKey
			target.APIKeyEnv = ""
		}
		resolved[binding.canonicalID] = target
	}

	return resolved
}

func ResolveCloudProviderTargets(fileTargets map[string]RuntimeFileTarget) []ResolvedCloudProvider {
	resolvedTargets := resolveCloudProviders(fileTargets)
	targets := make([]ResolvedCloudProvider, 0, len(resolvedTargets))
	for _, binding := range providerEnvBindings {
		target, ok := resolvedTargets[binding.canonicalID]
		if !ok {
			continue
		}
		baseURL := strings.TrimSpace(target.BaseURL)
		if baseURL == "" {
			continue
		}
		targets = append(targets, ResolvedCloudProvider{
			CanonicalID: binding.canonicalID,
			BaseURL:     baseURL,
			APIKey:      strings.TrimSpace(target.APIKey),
		})
	}
	return targets
}

// ResolveProviderAPIKey resolves the API key from a RuntimeFileTarget (env var or literal).
func ResolveProviderAPIKey(target RuntimeFileTarget) string {
	return resolveProviderAPIKeyWithBinding(target, "")
}

func resolveProviderAPIKeyWithBinding(target RuntimeFileTarget, fallbackEnvKey string) string {
	value, _ := resolveProviderAPIKeyWithBindingSource(target, fallbackEnvKey)
	return value
}

func resolveProviderAPIKeyWithBindingSource(target RuntimeFileTarget, fallbackEnvKey string) (string, string) {
	if envRef := strings.TrimSpace(target.APIKeyEnv); envRef != "" {
		if value := strings.TrimSpace(os.Getenv(envRef)); value != "" {
			return value, envRef
		}
	}
	if fallbackEnvKey != "" {
		if value := strings.TrimSpace(os.Getenv(fallbackEnvKey)); value != "" {
			return value, fallbackEnvKey
		}
	}
	return strings.TrimSpace(target.APIKey), ""
}

// NormalizeProviderName strips non-alphanumeric characters and lowercases.
func NormalizeProviderName(raw string) string {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	if trimmed == "" {
		return ""
	}
	var builder strings.Builder
	builder.Grow(len(trimmed))
	for _, char := range trimmed {
		if char >= 'a' && char <= 'z' {
			builder.WriteRune(char)
			continue
		}
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
			continue
		}
		if char == '_' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

// ResolveCanonicalProviderID maps a config.json provider key to its canonical provider ID.
// Returns ("", false) for local providers or unknown names.
func ResolveCanonicalProviderID(raw string) (string, bool) {
	canonical := normalizedProviderKey(raw)
	if canonical == "" {
		return "", false
	}
	record, ok := providerregistry.Lookup(canonical)
	if !ok || record.RuntimePlane != "remote" {
		return "", false
	}
	return canonical, true
}
