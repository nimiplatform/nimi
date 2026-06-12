package nimillm

import (
	"strings"
	"time"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

var admittedTokenProbeProviders = map[string]struct{}{
	"nimillm":               {},
	"dashscope":             {},
	"volcengine":            {},
	"volcengine_openspeech": {},
	"gemini":                {},
	"minimax":               {},
	"mimo":                  {},
	"kimi":                  {},
	"glm":                   {},
	"deepseek":              {},
	"openrouter":            {},
	"openai":                {},
	"openai_compatible":     {},
	"openai_codex":          {},
}

// NormalizeTokenProviderID canonicalizes public token provider identifiers.
func NormalizeTokenProviderID(raw string) (string, error) {
	token := normalizeProbeProviderToken(raw)
	if token == "" {
		return "nimillm", nil
	}
	if _, ok := admittedTokenProbeProviders[token]; ok {
		return token, nil
	}
	return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
}

func normalizeProbeProviderToken(raw string) string {
	value := strings.TrimSpace(strings.ToLower(raw))
	value = strings.TrimPrefix(value, "cloud-")
	value = strings.TrimPrefix(value, "cloud_")
	value = strings.ReplaceAll(value, "-", "_")
	if value == "" {
		return ""
	}
	return value
}

// ResolveProbeBackend resolves a cloud backend for token provider probing.
func (p *CloudProvider) ResolveProbeBackend(providerID string, endpoint string, apiKey string, headers map[string]string) (*Backend, string, error) {
	canonicalProviderID, err := NormalizeTokenProviderID(providerID)
	if err != nil {
		return nil, "", err
	}

	template := p.backends[canonicalProviderID]
	backendName := "cloud-" + canonicalProviderID
	backend := probeBackendFromTemplate(backendName, template, endpoint, apiKey, headers, p.probeTimeout(), p.allowLoopbackEndpoint)
	if backend == nil {
		return nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	return backend, canonicalProviderID, nil
}

func (p *CloudProvider) probeTimeout() time.Duration {
	for _, providerID := range knownProviders {
		if b := p.backends[providerID]; b != nil && b.client != nil {
			return b.client.Timeout
		}
	}
	return defaultHTTPTimeout
}

func probeBackendFromTemplate(name string, template *Backend, endpoint string, apiKey string, headers map[string]string, timeout time.Duration, allowLoopback bool) *Backend {
	normalizedEndpoint := strings.TrimSpace(endpoint)
	normalizedAPIKey := strings.TrimSpace(apiKey)
	if template != nil {
		if normalizedEndpoint == "" && normalizedAPIKey == "" && headers == nil {
			return template
		}
		return template.WithRequestOverridesAndHeadersWithPolicy(normalizedEndpoint, normalizedAPIKey, headers, allowLoopback)
	}
	if normalizedEndpoint == "" {
		return nil
	}
	return NewSecuredBackendWithHeaders(name, normalizedEndpoint, normalizedAPIKey, headers, timeout, allowLoopback)
}
