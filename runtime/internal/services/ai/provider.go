package ai

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

const (
	defaultAIHTTPTimeout = 5 * time.Minute
)

// provider is a type alias for nimillm.Provider.
type provider = nimillm.Provider

type scenarioSpeechStreamChunk = nimillm.SpeechStreamChunk

type scenarioStreamingSpeechProvider = nimillm.StreamingSpeechProvider

// Config controls local/cloud provider connectivity.
type Config struct {
	CloudProviders map[string]nimillm.ProviderCredentials // "nimillm", "dashscope", ...
	AIHTTPTimeout  time.Duration

	// EnforceEndpointSecurity enables endpoint validation + DNS pinning for
	// outbound provider HTTP requests (K-SEC-003/K-SEC-004).
	EnforceEndpointSecurity bool

	// AllowLoopbackEndpoint allows HTTP loopback endpoints while endpoint
	// security is enabled.
	AllowLoopbackEndpoint bool

	// providerPollWait is an internal owner seam used by deterministic tests.
	// Nil preserves the production timer/backoff path.
	providerPollWait func(context.Context, time.Duration) error
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
	cloudProviders := make(map[string]nimillm.ProviderCredentials)
	for _, b := range cloudProviderEnvBindings {
		baseURL := strings.TrimSpace(os.Getenv(b.baseEnv))
		apiKey := strings.TrimSpace(os.Getenv(b.keyEnv))
		headers := providerCredentialHeadersFromEnv(b.id)
		if baseURL != "" || apiKey != "" || len(headers) > 0 {
			cloudProviders[b.id] = nimillm.ProviderCredentials{BaseURL: baseURL, APIKey: apiKey, Headers: headers}
		}
	}

	cfg := Config{
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
	if c.CloudProviders == nil {
		c.CloudProviders = make(map[string]nimillm.ProviderCredentials)
	}
	return c
}

func (c Config) toCloudConfig() nimillm.CloudConfig {
	providers := make(map[string]nimillm.ProviderCredentials, len(c.CloudProviders))
	for providerID, creds := range c.CloudProviders {
		providers[providerID] = creds
	}
	return nimillm.CloudConfig{
		Providers:               providers,
		HTTPTimeout:             c.AIHTTPTimeout,
		EnforceEndpointSecurity: c.EnforceEndpointSecurity,
		AllowLoopbackEndpoint:   c.AllowLoopbackEndpoint,
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

	return &routeSelector{
		local:         &localProvider{},
		cloud:         cloudProvider,
		cloudProvider: cloudProvider,
	}
}

func providerCredentialHeadersFromEnv(providerID string) map[string]string {
	switch strings.TrimSpace(strings.ToLower(providerID)) {
	case "mubert":
		headers := map[string]string{}
		if customerID := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_MUBERT_CUSTOMER_ID")); customerID != "" {
			headers["customer-id"] = customerID
		}
		if accessToken := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_MUBERT_ACCESS_TOKEN")); accessToken != "" {
			headers["access-token"] = accessToken
		}
		if len(headers) > 0 {
			return headers
		}
	}
	return nil
}
