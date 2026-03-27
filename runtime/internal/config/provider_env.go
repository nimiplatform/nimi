package config

import (
	"os"
	"strings"
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
	{canonicalID: "nimillm", baseURLKey: "NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY"},
	{canonicalID: "openai", baseURLKey: "NIMI_RUNTIME_CLOUD_OPENAI_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_OPENAI_API_KEY"},
	{canonicalID: "anthropic", baseURLKey: "NIMI_RUNTIME_CLOUD_ANTHROPIC_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_ANTHROPIC_API_KEY"},
	{canonicalID: "dashscope", baseURLKey: "NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY"},
	{canonicalID: "volcengine", baseURLKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY"},
	{canonicalID: "azure", baseURLKey: "NIMI_RUNTIME_CLOUD_AZURE_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_AZURE_API_KEY"},
	{canonicalID: "mistral", baseURLKey: "NIMI_RUNTIME_CLOUD_MISTRAL_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_MISTRAL_API_KEY"},
	{canonicalID: "groq", baseURLKey: "NIMI_RUNTIME_CLOUD_GROQ_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_GROQ_API_KEY"},
	{canonicalID: "xai", baseURLKey: "NIMI_RUNTIME_CLOUD_XAI_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_XAI_API_KEY"},
	{canonicalID: "qianfan", baseURLKey: "NIMI_RUNTIME_CLOUD_QIANFAN_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_QIANFAN_API_KEY"},
	{canonicalID: "hunyuan", baseURLKey: "NIMI_RUNTIME_CLOUD_HUNYUAN_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_HUNYUAN_API_KEY"},
	{canonicalID: "spark", baseURLKey: "NIMI_RUNTIME_CLOUD_SPARK_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_SPARK_API_KEY"},
	{canonicalID: "volcengine_openspeech", baseURLKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY"},
	{canonicalID: "gemini", baseURLKey: "NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"},
	{canonicalID: "minimax", baseURLKey: "NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY"},
	{canonicalID: "kimi", baseURLKey: "NIMI_RUNTIME_CLOUD_KIMI_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_KIMI_API_KEY"},
	{canonicalID: "glm", baseURLKey: "NIMI_RUNTIME_CLOUD_GLM_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_GLM_API_KEY"},
	{canonicalID: "deepseek", baseURLKey: "NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY"},
	{canonicalID: "openrouter", baseURLKey: "NIMI_RUNTIME_CLOUD_OPENROUTER_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_OPENROUTER_API_KEY"},
	{canonicalID: "openai_compatible", baseURLKey: "NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_BASE_URL", apiKeyKey: "NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_API_KEY"},
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

		resolvedAPIKey := resolveProviderAPIKeyWithBinding(target, binding.apiKeyKey)
		if resolvedBase == "" && binding.canonicalID == "gemini" && resolvedAPIKey != "" {
			resolvedBase = defaultCloudGeminiBaseURL
		}

		if resolvedBase == "" && resolvedAPIKey == "" && strings.TrimSpace(target.DefaultModel) == "" {
			continue
		}

		target.BaseURL = resolvedBase
		target.APIKey = resolvedAPIKey
		target.APIKeyEnv = ""
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
	if envRef := strings.TrimSpace(target.APIKeyEnv); envRef != "" {
		if value := strings.TrimSpace(os.Getenv(envRef)); value != "" {
			return value
		}
	}
	if fallbackEnvKey != "" {
		if value := strings.TrimSpace(os.Getenv(fallbackEnvKey)); value != "" {
			return value
		}
	}
	return strings.TrimSpace(target.APIKey)
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
	switch normalizedProviderKey(raw) {
	case "nimillm":
		return "nimillm", true
	case "openai":
		return "openai", true
	case "anthropic":
		return "anthropic", true
	case "dashscope":
		return "dashscope", true
	case "volcengine":
		return "volcengine", true
	case "azure":
		return "azure", true
	case "mistral":
		return "mistral", true
	case "groq":
		return "groq", true
	case "xai":
		return "xai", true
	case "qianfan":
		return "qianfan", true
	case "hunyuan":
		return "hunyuan", true
	case "spark":
		return "spark", true
	case "volcengine_openspeech":
		return "volcengine_openspeech", true
	case "gemini":
		return "gemini", true
	case "minimax":
		return "minimax", true
	case "kimi":
		return "kimi", true
	case "glm":
		return "glm", true
	case "deepseek":
		return "deepseek", true
	case "openrouter":
		return "openrouter", true
	case "openai_compatible":
		return "openai_compatible", true
	default:
		return "", false
	}
}
