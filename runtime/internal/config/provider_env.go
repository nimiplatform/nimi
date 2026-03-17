package config

import (
	"os"
	"strings"
)

type providerEnvBinding struct {
	baseURLKey string
	apiKeyKey  string
}

func applyProviderEnvDefaults(fileCfg FileConfig) {
	for providerName, providerCfg := range fileCfg.Providers {
		binding, ok := resolveProviderBinding(providerName)
		if !ok {
			continue
		}

		apiKeyValue := ResolveProviderAPIKey(providerCfg)
		if strings.TrimSpace(os.Getenv(binding.apiKeyKey)) == "" && apiKeyValue != "" {
			_ = os.Setenv(binding.apiKeyKey, apiKeyValue)
		}

		baseURLValue := strings.TrimSpace(providerCfg.BaseURL)
		if baseURLValue == "" && canonicalProviderKey(providerName) == "gemini" && (apiKeyValue != "" || strings.TrimSpace(os.Getenv(binding.apiKeyKey)) != "") {
			baseURLValue = defaultCloudGeminiBaseURL
		}
		if strings.TrimSpace(os.Getenv(binding.baseURLKey)) == "" && baseURLValue != "" {
			_ = os.Setenv(binding.baseURLKey, baseURLValue)
		}
	}
}

func applyImplicitProviderDefaults() {
	if strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL")) == "" && strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_GEMINI_API_KEY")) != "" {
		_ = os.Setenv("NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL", defaultCloudGeminiBaseURL)
	}
}

// ResolveProviderAPIKey resolves the API key from a RuntimeFileTarget (env var or literal).
func ResolveProviderAPIKey(target RuntimeFileTarget) string {
	if envRef := strings.TrimSpace(target.APIKeyEnv); envRef != "" {
		if value := strings.TrimSpace(os.Getenv(envRef)); value != "" {
			return value
		}
	}
	value := strings.TrimSpace(target.APIKey)
	if strings.HasPrefix(value, "${") && strings.HasSuffix(value, "}") {
		envRef := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(value, "${"), "}"))
		if envRef != "" {
			return strings.TrimSpace(os.Getenv(envRef))
		}
	}
	return value
}

func resolveProviderBinding(raw string) (providerEnvBinding, bool) {
	switch canonicalProviderKey(raw) {
	case "nimillm":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY",
		}, true
	case "openai":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_OPENAI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_OPENAI_API_KEY",
		}, true
	case "anthropic":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ANTHROPIC_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ANTHROPIC_API_KEY",
		}, true
	case "dashscope":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY",
		}, true
	case "volcengine":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY",
		}, true
	case "azure":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_AZURE_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_AZURE_API_KEY",
		}, true
	case "mistral":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_MISTRAL_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_MISTRAL_API_KEY",
		}, true
	case "groq":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_GROQ_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_GROQ_API_KEY",
		}, true
	case "xai":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_XAI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_XAI_API_KEY",
		}, true
	case "qianfan":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_QIANFAN_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_QIANFAN_API_KEY",
		}, true
	case "hunyuan":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_HUNYUAN_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_HUNYUAN_API_KEY",
		}, true
	case "spark":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_SPARK_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_SPARK_API_KEY",
		}, true
	case "volcengine_openspeech":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY",
		}, true
	case "gemini":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY",
		}, true
	case "minimax":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY",
		}, true
	case "kimi":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_KIMI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_KIMI_API_KEY",
		}, true
	case "glm":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_GLM_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_GLM_API_KEY",
		}, true
	case "deepseek":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY",
		}, true
	case "openrouter":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_OPENROUTER_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_OPENROUTER_API_KEY",
		}, true
	case "openai_compatible":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_API_KEY",
		}, true
	default:
		return providerEnvBinding{}, false
	}
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
		}
	}
	return builder.String()
}

// ResolveCanonicalProviderID maps a config.json provider key to its canonical provider ID.
// Returns ("", false) for local providers or unknown names.
func ResolveCanonicalProviderID(raw string) (string, bool) {
	switch canonicalProviderKey(raw) {
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
