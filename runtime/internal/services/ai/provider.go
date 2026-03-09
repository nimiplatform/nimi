package ai

import (
	"context"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimecfg "github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"os"
	"sort"
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

// scenarioTextProvider defines Scenario-native sync text generation for providers.
type scenarioTextProvider interface {
	GenerateTextScenario(
		ctx context.Context,
		modelID string,
		spec *runtimev1.TextGenerateScenarioSpec,
		inputText string,
	) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error)
}

// scenarioStreamingTextProvider defines Scenario-native stream text generation for providers.
type scenarioStreamingTextProvider interface {
	StreamGenerateTextScenario(
		ctx context.Context,
		modelID string,
		spec *runtimev1.TextGenerateScenarioSpec,
		onDelta func(string) error,
	) (*runtimev1.UsageStats, runtimev1.FinishReason, error)
}

// Config controls local/cloud provider connectivity.
type Config struct {
	LocalProviders        map[string]nimillm.ProviderCredentials // "localai", "nexa"
	CloudProviders        map[string]nimillm.ProviderCredentials // "nimillm", "dashscope", ...
	ProviderDefaultModels map[string]string
	DefaultLocalTextModel string
	DefaultCloudProvider  string
	AIHTTPTimeout         time.Duration

	// EnforceEndpointSecurity enables endpoint validation + DNS pinning for
	// outbound provider HTTP requests (K-SEC-003/K-SEC-004).
	EnforceEndpointSecurity bool

	// AllowLoopbackEndpoint allows HTTP loopback endpoints while endpoint
	// security is enabled.
	AllowLoopbackEndpoint bool
}

// cloudProviderEnvBindings maps canonical provider IDs to their environment variable pairs.
var cloudProviderEnvBindings = buildCloudProviderEnvBindings()

func providerEnvToken(providerID string) string {
	token := strings.TrimSpace(strings.ToUpper(providerID))
	token = strings.ReplaceAll(token, "-", "_")
	token = strings.ReplaceAll(token, ".", "_")
	token = strings.ReplaceAll(token, " ", "_")
	for strings.Contains(token, "__") {
		token = strings.ReplaceAll(token, "__", "_")
	}
	return strings.Trim(token, "_")
}

func buildCloudProviderEnvBindings() []struct {
	id      string
	baseEnv string
	keyEnv  string
} {
	ids := append([]string(nil), providerregistry.RemoteProviders...)
	sort.Strings(ids)
	out := make([]struct {
		id      string
		baseEnv string
		keyEnv  string
	}, 0, len(ids))
	for _, providerID := range ids {
		token := providerEnvToken(providerID)
		if token == "" {
			continue
		}
		out = append(out, struct {
			id      string
			baseEnv string
			keyEnv  string
		}{
			id:      providerID,
			baseEnv: fmt.Sprintf("NIMI_RUNTIME_CLOUD_%s_BASE_URL", token),
			keyEnv:  fmt.Sprintf("NIMI_RUNTIME_CLOUD_%s_API_KEY", token),
		})
	}
	return out
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
	if c.ProviderDefaultModels == nil {
		c.ProviderDefaultModels = make(map[string]string)
	}
	c.DefaultLocalTextModel = strings.TrimSpace(c.DefaultLocalTextModel)
	c.DefaultCloudProvider = strings.TrimSpace(c.DefaultCloudProvider)
	return c
}

func (c Config) toCloudConfig() nimillm.CloudConfig {
	return nimillm.CloudConfig{
		Providers:               c.CloudProviders,
		HTTPTimeout:             c.AIHTTPTimeout,
		EnforceEndpointSecurity: c.EnforceEndpointSecurity,
		AllowLoopbackEndpoint:   c.AllowLoopbackEndpoint,
	}
}

type routeSelector struct {
	local         provider
	cloud         provider
	cloudProvider *nimillm.CloudProvider
	targetConfig  runtimecfg.Config
}

func newRouteSelector(cfg Config) *routeSelector {
	return newRouteSelectorWithRegistry(cfg, nil, nil)
}

func newRouteSelectorWithRegistry(cfg Config, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker) *routeSelector {
	normalized := cfg.normalized()

	cloudProvider := nimillm.NewCloudProvider(normalized.toCloudConfig(), registry, aiHealth)

	localaiCreds := normalized.LocalProviders["localai"]
	nexaCreds := normalized.LocalProviders["nexa"]
	localAIBackend := newLocalBackend("local-localai", localaiCreds, normalized)
	nexaBackend := newLocalBackend("local-nexa", nexaCreds, normalized)
	targetConfig := runtimecfg.Config{
		DefaultLocalTextModel: normalized.DefaultLocalTextModel,
		DefaultCloudProvider:  normalized.DefaultCloudProvider,
		Providers:             map[string]runtimecfg.RuntimeFileTarget{},
	}
	for providerID, creds := range normalized.CloudProviders {
		target := targetConfig.Providers[providerID]
		target.BaseURL = creds.BaseURL
		target.APIKey = creds.APIKey
		target.DefaultModel = strings.TrimSpace(normalized.ProviderDefaultModels[providerID])
		targetConfig.Providers[providerID] = target
	}
	for providerID, defaultModel := range normalized.ProviderDefaultModels {
		target := targetConfig.Providers[providerID]
		target.DefaultModel = strings.TrimSpace(defaultModel)
		targetConfig.Providers[providerID] = target
	}
	return &routeSelector{
		local: &localProvider{
			localai: localAIBackend,
			nexa:    nexaBackend,
		},
		cloud:         cloudProvider,
		cloudProvider: cloudProvider,
		targetConfig:  targetConfig,
	}
}

func newLocalBackend(name string, creds nimillm.ProviderCredentials, cfg Config) *nimillm.Backend {
	normalized := cfg.normalized()
	if normalized.EnforceEndpointSecurity {
		// Local engines run on loopback and must allow HTTP loopback.
		return nimillm.NewSecuredBackend(name, creds.BaseURL, creds.APIKey, normalized.AIHTTPTimeout, true)
	}
	return nimillm.NewBackend(name, creds.BaseURL, creds.APIKey, normalized.AIHTTPTimeout)
}
