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
	LocalAIBaseURL              string
	LocalAIAPIKey               string
	LocalNexaBaseURL            string
	LocalNexaAPIKey             string
	CloudNimiLLMBaseURL         string
	CloudNimiLLMAPIKey          string
	CloudAlibabaBaseURL         string
	CloudAlibabaAPIKey          string
	CloudBytedanceBaseURL       string
	CloudBytedanceAPIKey        string
	CloudBytedanceSpeechBaseURL string
	CloudBytedanceSpeechAPIKey  string
	CloudGeminiBaseURL          string
	CloudGeminiAPIKey           string
	CloudMiniMaxBaseURL         string
	CloudMiniMaxAPIKey          string
	CloudKimiBaseURL            string
	CloudKimiAPIKey             string
	CloudGLMBaseURL             string
	CloudGLMAPIKey              string
	AIHTTPTimeout               time.Duration
}

func loadConfigFromEnv() Config {
	cfg := Config{
		LocalAIBaseURL:              strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_AI_BASE_URL")),
		LocalAIAPIKey:               strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_AI_API_KEY")),
		LocalNexaBaseURL:            strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_NEXA_BASE_URL")),
		LocalNexaAPIKey:             strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_NEXA_API_KEY")),
		CloudNimiLLMBaseURL:         strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL")),
		CloudNimiLLMAPIKey:          strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY")),
		CloudAlibabaBaseURL:         strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_BASE_URL")),
		CloudAlibabaAPIKey:          strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_API_KEY")),
		CloudBytedanceBaseURL:       strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_BASE_URL")),
		CloudBytedanceAPIKey:        strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_API_KEY")),
		CloudBytedanceSpeechBaseURL: strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_BASE_URL")),
		CloudBytedanceSpeechAPIKey:  strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_API_KEY")),
		CloudGeminiBaseURL:          strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL")),
		CloudGeminiAPIKey:           strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY")),
		CloudMiniMaxBaseURL:         strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_BASE_URL")),
		CloudMiniMaxAPIKey:          strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_API_KEY")),
		CloudKimiBaseURL:            strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_BASE_URL")),
		CloudKimiAPIKey:             strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_API_KEY")),
		CloudGLMBaseURL:             strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GLM_BASE_URL")),
		CloudGLMAPIKey:              strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GLM_API_KEY")),
		AIHTTPTimeout:               defaultAIHTTPTimeout,
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
	c.LocalAIBaseURL = strings.TrimSpace(c.LocalAIBaseURL)
	c.LocalAIAPIKey = strings.TrimSpace(c.LocalAIAPIKey)
	c.LocalNexaBaseURL = strings.TrimSpace(c.LocalNexaBaseURL)
	c.LocalNexaAPIKey = strings.TrimSpace(c.LocalNexaAPIKey)
	c.CloudNimiLLMBaseURL = strings.TrimSpace(c.CloudNimiLLMBaseURL)
	c.CloudNimiLLMAPIKey = strings.TrimSpace(c.CloudNimiLLMAPIKey)
	c.CloudAlibabaBaseURL = strings.TrimSpace(c.CloudAlibabaBaseURL)
	c.CloudAlibabaAPIKey = strings.TrimSpace(c.CloudAlibabaAPIKey)
	c.CloudBytedanceBaseURL = strings.TrimSpace(c.CloudBytedanceBaseURL)
	c.CloudBytedanceAPIKey = strings.TrimSpace(c.CloudBytedanceAPIKey)
	c.CloudBytedanceSpeechBaseURL = strings.TrimSpace(c.CloudBytedanceSpeechBaseURL)
	c.CloudBytedanceSpeechAPIKey = strings.TrimSpace(c.CloudBytedanceSpeechAPIKey)
	c.CloudGeminiBaseURL = strings.TrimSpace(c.CloudGeminiBaseURL)
	c.CloudGeminiAPIKey = strings.TrimSpace(c.CloudGeminiAPIKey)
	c.CloudMiniMaxBaseURL = strings.TrimSpace(c.CloudMiniMaxBaseURL)
	c.CloudMiniMaxAPIKey = strings.TrimSpace(c.CloudMiniMaxAPIKey)
	c.CloudKimiBaseURL = strings.TrimSpace(c.CloudKimiBaseURL)
	c.CloudKimiAPIKey = strings.TrimSpace(c.CloudKimiAPIKey)
	c.CloudGLMBaseURL = strings.TrimSpace(c.CloudGLMBaseURL)
	c.CloudGLMAPIKey = strings.TrimSpace(c.CloudGLMAPIKey)

	return c
}

func (c Config) toCloudConfig() nimillm.CloudConfig {
	return nimillm.CloudConfig{
		NimiLLMBaseURL:         c.CloudNimiLLMBaseURL,
		NimiLLMAPIKey:          c.CloudNimiLLMAPIKey,
		AlibabaBaseURL:         c.CloudAlibabaBaseURL,
		AlibabaAPIKey:          c.CloudAlibabaAPIKey,
		BytedanceBaseURL:       c.CloudBytedanceBaseURL,
		BytedanceAPIKey:        c.CloudBytedanceAPIKey,
		BytedanceSpeechBaseURL: c.CloudBytedanceSpeechBaseURL,
		BytedanceSpeechAPIKey:  c.CloudBytedanceSpeechAPIKey,
		GeminiBaseURL:          c.CloudGeminiBaseURL,
		GeminiAPIKey:           c.CloudGeminiAPIKey,
		MiniMaxBaseURL:         c.CloudMiniMaxBaseURL,
		MiniMaxAPIKey:          c.CloudMiniMaxAPIKey,
		KimiBaseURL:            c.CloudKimiBaseURL,
		KimiAPIKey:             c.CloudKimiAPIKey,
		GLMBaseURL:             c.CloudGLMBaseURL,
		GLMAPIKey:              c.CloudGLMAPIKey,
		HTTPTimeout:            c.AIHTTPTimeout,
	}
}

type routeSelector struct {
	local provider
	cloud provider
}

func newRouteSelector(cfg Config) *routeSelector {
	return newRouteSelectorWithRegistry(cfg, nil, nil)
}

func newRouteSelectorWithRegistry(cfg Config, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker) *routeSelector {
	normalized := cfg.normalized()

	// Inject request credential extractor into nimillm.
	nimillm.RequestInjectedCredentials = requestInjectedCredentials

	cloudProvider := nimillm.NewCloudProvider(normalized.toCloudConfig(), registry, aiHealth)

	return &routeSelector{
		local: &localProvider{
			localai: nimillm.NewBackend("local-localai", normalized.LocalAIBaseURL, normalized.LocalAIAPIKey, normalized.AIHTTPTimeout),
			nexa:    nimillm.NewBackend("local-nexa", normalized.LocalNexaBaseURL, normalized.LocalNexaAPIKey, normalized.AIHTTPTimeout),
		},
		cloud: cloudProvider,
	}
}
