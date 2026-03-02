package ai

import (
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"os"
	"strings"
	"time"
)

const (
	defaultAIHTTPTimeout = 30 * time.Second
)

// provider is a type alias for nimillm.Provider.
type provider = nimillm.Provider

// streamingTextProvider is a type alias for nimillm.StreamingTextProvider.
type streamingTextProvider = nimillm.StreamingTextProvider

// Config controls local/cloud provider connectivity.
type Config struct {
	LocalProviders map[string]nimillm.ProviderCredentials // "localai", "nexa"
	CloudProviders map[string]nimillm.ProviderCredentials // "nimillm", "dashscope", ...
	AIHTTPTimeout  time.Duration
}

// cloudProviderEnvBindings maps canonical provider IDs to their environment variable pairs.
var cloudProviderEnvBindings = []struct {
	id      string
	baseEnv string
	keyEnv  string
}{
	{"nimillm", "NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL", "NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY"},
	{"openai", "NIMI_RUNTIME_CLOUD_OPENAI_BASE_URL", "NIMI_RUNTIME_CLOUD_OPENAI_API_KEY"},
	{"anthropic", "NIMI_RUNTIME_CLOUD_ANTHROPIC_BASE_URL", "NIMI_RUNTIME_CLOUD_ANTHROPIC_API_KEY"},
	{"dashscope", "NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL", "NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY"},
	{"volcengine", "NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL", "NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY"},
	{"volcengine_openspeech", "NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL", "NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY"},
	{"gemini", "NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL", "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"},
	{"minimax", "NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL", "NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY"},
	{"kimi", "NIMI_RUNTIME_CLOUD_KIMI_BASE_URL", "NIMI_RUNTIME_CLOUD_KIMI_API_KEY"},
	{"glm", "NIMI_RUNTIME_CLOUD_GLM_BASE_URL", "NIMI_RUNTIME_CLOUD_GLM_API_KEY"},
	{"deepseek", "NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL", "NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY"},
	{"openrouter", "NIMI_RUNTIME_CLOUD_OPENROUTER_BASE_URL", "NIMI_RUNTIME_CLOUD_OPENROUTER_API_KEY"},
}

func loadConfigFromEnv() Config {
	localProviders := make(map[string]nimillm.ProviderCredentials)
	localAIBase := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_AI_BASE_URL"))
	localAIKey := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_AI_API_KEY"))
	if localAIBase != "" || localAIKey != "" {
		localProviders["localai"] = nimillm.ProviderCredentials{BaseURL: localAIBase, APIKey: localAIKey}
	}
	localNexaBase := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_NEXA_BASE_URL"))
	localNexaKey := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_NEXA_API_KEY"))
	if localNexaBase != "" || localNexaKey != "" {
		localProviders["nexa"] = nimillm.ProviderCredentials{BaseURL: localNexaBase, APIKey: localNexaKey}
	}

	cloudProviders := make(map[string]nimillm.ProviderCredentials)
	for _, b := range cloudProviderEnvBindings {
		baseURL := strings.TrimSpace(os.Getenv(b.baseEnv))
		apiKey := strings.TrimSpace(os.Getenv(b.keyEnv))
		if baseURL != "" || apiKey != "" {
			cloudProviders[b.id] = nimillm.ProviderCredentials{BaseURL: baseURL, APIKey: apiKey}
		}
	}

	cfg := Config{
		LocalProviders: localProviders,
		CloudProviders: cloudProviders,
		AIHTTPTimeout:  defaultAIHTTPTimeout,
	}

	if raw := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_AI_HTTP_TIMEOUT")); raw != "" {
		timeout, err := time.ParseDuration(raw)
		if err == nil && timeout > 0 {
			cfg.AIHTTPTimeout = timeout
		}
	}
	return cfg.normalized()
}

func (c Config) normalized() Config {
	if c.AIHTTPTimeout <= 0 {
		c.AIHTTPTimeout = defaultAIHTTPTimeout
	}
	if c.LocalProviders == nil {
		c.LocalProviders = make(map[string]nimillm.ProviderCredentials)
	}
	if c.CloudProviders == nil {
		c.CloudProviders = make(map[string]nimillm.ProviderCredentials)
	}
	return c
}

func (c Config) toCloudConfig() nimillm.CloudConfig {
	return nimillm.CloudConfig{
		Providers:   c.CloudProviders,
		HTTPTimeout: c.AIHTTPTimeout,
	}
}

type routeSelector struct {
	local         provider
	cloud         provider
	cloudProvider *nimillm.CloudProvider
}

func newRouteSelector(cfg Config) *routeSelector {
	return newRouteSelectorWithRegistry(cfg, nil, nil)
}

func newRouteSelectorWithRegistry(cfg Config, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker) *routeSelector {
	normalized := cfg.normalized()

	cloudProvider := nimillm.NewCloudProvider(normalized.toCloudConfig(), registry, aiHealth)

	localaiCreds := normalized.LocalProviders["localai"]
	nexaCreds := normalized.LocalProviders["nexa"]
	return &routeSelector{
		local: &localProvider{
			localai: nimillm.NewBackend("local-localai", localaiCreds.BaseURL, localaiCreds.APIKey, normalized.AIHTTPTimeout),
			nexa:    nimillm.NewBackend("local-nexa", nexaCreds.BaseURL, nexaCreds.APIKey, normalized.AIHTTPTimeout),
		},
		cloud:         cloudProvider,
		cloudProvider: cloudProvider,
	}
}
