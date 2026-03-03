package nimillm

import (
	"strings"
	"time"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// NormalizeTokenProviderID canonicalizes public token provider identifiers.
func NormalizeTokenProviderID(raw string) (string, error) {
	token := normalizeProbeProviderToken(raw)
	if token == "" {
		return "nimillm", nil
	}

	switch token {
	case "nimillm":
		return "nimillm", nil
	case "dashscope":
		return "dashscope", nil
	case "volcengine":
		return "volcengine", nil
	case "volcengine_openspeech":
		return "volcengine_openspeech", nil
	case "gemini":
		return "gemini", nil
	case "minimax":
		return "minimax", nil
	case "kimi":
		return "kimi", nil
	case "glm":
		return "glm", nil
	case "deepseek":
		return "deepseek", nil
	case "openrouter":
		return "openrouter", nil
	case "openai":
		return "openai", nil
	case "anthropic":
		return "anthropic", nil
	case "openai_compatible":
		return "openai_compatible", nil
	case "azure":
		return "azure", nil
	case "mistral":
		return "mistral", nil
	case "groq":
		return "groq", nil
	case "xai":
		return "xai", nil
	case "qianfan":
		return "qianfan", nil
	case "hunyuan":
		return "hunyuan", nil
	case "spark":
		return "spark", nil
	default:
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func normalizeProbeProviderToken(raw string) string {
	value := strings.TrimSpace(strings.ToLower(raw))
	value = strings.TrimPrefix(value, "cloud-")
	value = strings.TrimPrefix(value, "cloud_")
	if value == "" {
		return ""
	}
	return value
}

// ResolveProbeBackend resolves a cloud backend for token provider probing.
func (p *CloudProvider) ResolveProbeBackend(providerID string, endpoint string, apiKey string) (*Backend, string, error) {
	canonicalProviderID, err := NormalizeTokenProviderID(providerID)
	if err != nil {
		return nil, "", err
	}

	template := p.backends[canonicalProviderID]
	backendName := "cloud-" + canonicalProviderID
	backend := probeBackendFromTemplate(backendName, template, endpoint, apiKey, p.probeTimeout(), p.enforceEndpointSecurity, p.allowLoopbackEndpoint)
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

func probeBackendFromTemplate(name string, template *Backend, endpoint string, apiKey string, timeout time.Duration, enforceEndpointSecurity bool, allowLoopback bool) *Backend {
	normalizedEndpoint := strings.TrimSpace(endpoint)
	normalizedAPIKey := strings.TrimSpace(apiKey)
	if template != nil {
		if normalizedEndpoint == "" && normalizedAPIKey == "" {
			return template
		}
		return template.WithRequestOverridesWithPolicy(normalizedEndpoint, normalizedAPIKey, allowLoopback)
	}
	if normalizedEndpoint == "" {
		return nil
	}
	if enforceEndpointSecurity {
		return NewSecuredBackend(name, normalizedEndpoint, normalizedAPIKey, timeout, allowLoopback)
	}
	return NewBackend(name, normalizedEndpoint, normalizedAPIKey, timeout)
}
