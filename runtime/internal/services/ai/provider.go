package ai

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/protobuf/types/known/structpb"
	"os"
	"strings"
	"time"
)

const (
	defaultAIHTTPTimeout = 30 * time.Second
)

// Config controls local/cloud provider connectivity.
type Config struct {
	LocalAIBaseURL        string
	LocalAIAPIKey         string
	CloudAIBaseURL        string
	CloudAIAPIKey         string
	CloudLiteLLMBaseURL   string
	CloudLiteLLMAPIKey    string
	CloudAlibabaBaseURL   string
	CloudAlibabaAPIKey    string
	CloudBytedanceBaseURL string
	CloudBytedanceAPIKey  string
	AIHTTPTimeout         time.Duration
}

func loadConfigFromEnv() Config {
	cfg := Config{
		LocalAIBaseURL:        strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_AI_BASE_URL")),
		LocalAIAPIKey:         strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_AI_API_KEY")),
		CloudAIBaseURL:        strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_AI_BASE_URL")),
		CloudAIAPIKey:         strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_AI_API_KEY")),
		CloudLiteLLMBaseURL:   strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_LITELLM_BASE_URL")),
		CloudLiteLLMAPIKey:    strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_LITELLM_API_KEY")),
		CloudAlibabaBaseURL:   strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_BASE_URL")),
		CloudAlibabaAPIKey:    strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_API_KEY")),
		CloudBytedanceBaseURL: strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_BASE_URL")),
		CloudBytedanceAPIKey:  strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_API_KEY")),
		AIHTTPTimeout:         defaultAIHTTPTimeout,
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
	c.CloudAIBaseURL = strings.TrimSpace(c.CloudAIBaseURL)
	c.CloudAIAPIKey = strings.TrimSpace(c.CloudAIAPIKey)
	c.CloudLiteLLMBaseURL = strings.TrimSpace(c.CloudLiteLLMBaseURL)
	c.CloudLiteLLMAPIKey = strings.TrimSpace(c.CloudLiteLLMAPIKey)
	c.CloudAlibabaBaseURL = strings.TrimSpace(c.CloudAlibabaBaseURL)
	c.CloudAlibabaAPIKey = strings.TrimSpace(c.CloudAlibabaAPIKey)
	c.CloudBytedanceBaseURL = strings.TrimSpace(c.CloudBytedanceBaseURL)
	c.CloudBytedanceAPIKey = strings.TrimSpace(c.CloudBytedanceAPIKey)

	// Alias for old single cloud env.
	if c.CloudLiteLLMBaseURL == "" {
		c.CloudLiteLLMBaseURL = c.CloudAIBaseURL
	}
	if c.CloudLiteLLMAPIKey == "" {
		c.CloudLiteLLMAPIKey = c.CloudAIAPIKey
	}
	return c
}

type provider interface {
	route() runtimev1.RoutePolicy
	resolveModelID(raw string) string
	checkModelAvailability(modelID string) error
	generateText(ctx context.Context, modelID string, req *runtimev1.GenerateRequest, inputText string) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error)
	embed(ctx context.Context, modelID string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error)
	generateImage(ctx context.Context, modelID string, prompt string) ([]byte, *runtimev1.UsageStats, error)
	generateVideo(ctx context.Context, modelID string, prompt string) ([]byte, *runtimev1.UsageStats, error)
	synthesizeSpeech(ctx context.Context, modelID string, text string) ([]byte, *runtimev1.UsageStats, error)
	transcribe(ctx context.Context, modelID string, audio []byte, mimeType string) (string, *runtimev1.UsageStats, error)
}

type streamingTextProvider interface {
	streamGenerateText(ctx context.Context, modelID string, req *runtimev1.StreamGenerateRequest, onDelta func(string) error) (*runtimev1.UsageStats, runtimev1.FinishReason, error)
}

type routeSelector struct {
	local provider
	cloud provider
}

type routeDecisionInfo struct {
	BackendName    string
	HintAutoSwitch bool
	HintFrom       string
	HintTo         string
}

func newRouteSelector(cfg Config) *routeSelector {
	return newRouteSelectorWithRegistry(cfg, nil, nil)
}

func newRouteSelectorWithRegistry(cfg Config, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker) *routeSelector {
	normalized := cfg.normalized()
	return &routeSelector{
		local: &localProvider{
			backend: newOpenAIBackend("local", normalized.LocalAIBaseURL, normalized.LocalAIAPIKey, normalized.AIHTTPTimeout),
		},
		cloud: &cloudProvider{
			litellm:   newOpenAIBackend("cloud-litellm", normalized.CloudLiteLLMBaseURL, normalized.CloudLiteLLMAPIKey, normalized.AIHTTPTimeout),
			alibaba:   newOpenAIBackend("cloud-alibaba", normalized.CloudAlibabaBaseURL, normalized.CloudAlibabaAPIKey, normalized.AIHTTPTimeout),
			bytedance: newOpenAIBackend("cloud-bytedance", normalized.CloudBytedanceBaseURL, normalized.CloudBytedanceAPIKey, normalized.AIHTTPTimeout),
			registry:  registry,
			health:    aiHealth,
		},
	}
}
