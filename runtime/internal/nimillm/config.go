package nimillm

import "time"

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
}

// providerAliases maps legacy/alternate names to canonical provider IDs.
// This resolution happens only at the config parsing boundary.
var providerAliases = map[string]string{
	"alibaba":              "dashscope",
	"aliyun":               "dashscope",
	"bytedance":            "volcengine",
	"byte":                 "volcengine",
	"bytedance_openspeech": "volcengine_openspeech",
	"openspeech":           "volcengine_openspeech",
	"zhipu":                "glm",
	"bigmodel":             "glm",
	"moonshot":             "kimi",
}

// ResolveProviderAlias returns the canonical provider ID for a given name.
func ResolveProviderAlias(name string) string {
	if canonical, ok := providerAliases[name]; ok {
		return canonical
	}
	return name
}
