package nimillm

import (
	"strings"
	"time"
)

// ProviderCredentials holds base URL and API key for a single cloud provider.
type ProviderCredentials struct {
	BaseURL string
	APIKey  string
}

// CloudConfig holds all cloud provider connection parameters.
// Providers is keyed by canonical provider ID (e.g. "nimillm", "dashscope",
// "volcengine", "gemini", "minimax", "kimi", "glm").
type CloudConfig struct {
	Providers   map[string]ProviderCredentials
	HTTPTimeout time.Duration

	// EnforceEndpointSecurity enables endpoint validation + DNS-pinned outbound
	// transport for cloud requests (K-SEC-003/K-SEC-004).
	EnforceEndpointSecurity bool

	// AllowLoopbackEndpoint allows HTTP loopback endpoints when endpoint
	// security is enabled.
	AllowLoopbackEndpoint bool
}

// ResolveProviderAlias returns the canonical provider ID for a given name.
func ResolveProviderAlias(name string) string {
	switch strings.TrimSpace(strings.ToLower(name)) {
	case "nimillm", "openai", "anthropic", "dashscope", "volcengine", "volcengine_openspeech", "gemini", "minimax", "kimi", "glm", "deepseek", "openrouter", "openai_compatible",
		"azure", "mistral", "groq", "xai", "qianfan", "hunyuan", "spark":
		return strings.TrimSpace(strings.ToLower(name))
	default:
		return ""
	}
}
