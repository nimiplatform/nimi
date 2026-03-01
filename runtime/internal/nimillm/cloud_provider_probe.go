package nimillm

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// NormalizeTokenProviderID canonicalizes public token provider identifiers.
func NormalizeTokenProviderID(raw string) (string, error) {
	token := normalizeProbeProviderToken(raw)
	if token == "" {
		return "nimillm", nil
	}

	switch token {
	case "litellm", "cloudlitellm", "cloudai":
		return "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	case "nimillm", "cloudnimillm":
		return "nimillm", nil
	case "alibaba", "aliyun", "cloudalibaba", "dashscope":
		return "dashscope", nil
	case "bytedance", "byte", "cloudbytedance", "volcengine":
		return "volcengine", nil
	case "gemini", "cloudgemini":
		return "gemini", nil
	case "minimax", "cloudminimax":
		return "minimax", nil
	case "kimi", "moonshot", "cloudkimi":
		return "kimi", nil
	case "glm", "zhipu", "bigmodel", "cloudglm":
		return "glm", nil
	case "deepseek", "clouddeepseek":
		return "deepseek", nil
	case "openrouter", "cloudopenrouter":
		return "openrouter", nil
	default:
		return "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
}

// ResolveProbeBackend resolves a cloud backend for token provider probing.
func (p *CloudProvider) ResolveProbeBackend(providerID string, endpoint string, apiKey string) (*Backend, string, error) {
	canonicalProviderID, err := NormalizeTokenProviderID(providerID)
	if err != nil {
		return nil, "", err
	}

	template := p.backends[canonicalProviderID]
	backendName := "cloud-" + canonicalProviderID
	backend := probeBackendFromTemplate(backendName, template, endpoint, apiKey, p.probeTimeout())
	if backend == nil {
		return nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
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

func probeBackendFromTemplate(name string, template *Backend, endpoint string, apiKey string, timeout time.Duration) *Backend {
	normalizedEndpoint := strings.TrimSpace(endpoint)
	normalizedAPIKey := strings.TrimSpace(apiKey)
	if template != nil {
		if normalizedEndpoint == "" && normalizedAPIKey == "" {
			return template
		}
		return template.WithRequestOverrides(normalizedEndpoint, normalizedAPIKey)
	}
	if normalizedEndpoint == "" {
		return nil
	}
	return NewBackend(name, normalizedEndpoint, normalizedAPIKey, timeout)
}

func normalizeProbeProviderToken(raw string) string {
	value := strings.TrimSpace(strings.ToLower(raw))
	if value == "" {
		return ""
	}
	var builder strings.Builder
	builder.Grow(len(value))
	for _, ch := range value {
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') {
			builder.WriteRune(ch)
		}
	}
	return builder.String()
}
