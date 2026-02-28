package nimillm

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	tokenProviderIDNimiLLM   = "nimillm"
	tokenProviderIDAlibaba   = "alibaba"
	tokenProviderIDBytedance = "bytedance"
	tokenProviderIDGemini    = "gemini"
	tokenProviderIDMiniMax   = "minimax"
	tokenProviderIDKimi      = "kimi"
	tokenProviderIDGLM       = "glm"
)

// NormalizeTokenProviderID canonicalizes public token provider identifiers.
func NormalizeTokenProviderID(raw string) (string, error) {
	token := normalizeProbeProviderToken(raw)
	if token == "" {
		return tokenProviderIDNimiLLM, nil
	}

	switch token {
	case "litellm", "cloudlitellm", "cloudai":
		return "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	case "nimillm", "cloudnimillm":
		return tokenProviderIDNimiLLM, nil
	case "alibaba", "aliyun", "cloudalibaba", "dashscope":
		return tokenProviderIDAlibaba, nil
	case "bytedance", "byte", "cloudbytedance", "volcengine":
		return tokenProviderIDBytedance, nil
	case "gemini", "cloudgemini":
		return tokenProviderIDGemini, nil
	case "minimax", "cloudminimax":
		return tokenProviderIDMiniMax, nil
	case "kimi", "moonshot", "cloudkimi":
		return tokenProviderIDKimi, nil
	case "glm", "zhipu", "bigmodel", "cloudglm":
		return tokenProviderIDGLM, nil
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

	template := p.backendByProviderID(canonicalProviderID)
	backendName := "cloud-" + canonicalProviderID
	if canonicalProviderID == tokenProviderIDNimiLLM {
		backendName = "cloud-nimillm"
	}
	backend := probeBackendFromTemplate(backendName, template, endpoint, apiKey, p.probeTimeout())
	if backend == nil {
		return nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	return backend, canonicalProviderID, nil
}

func (p *CloudProvider) backendByProviderID(providerID string) *Backend {
	switch providerID {
	case tokenProviderIDNimiLLM:
		return p.nimiLLM
	case tokenProviderIDAlibaba:
		return p.alibaba
	case tokenProviderIDBytedance:
		return p.bytedance
	case tokenProviderIDGemini:
		return p.gemini
	case tokenProviderIDMiniMax:
		return p.minimax
	case tokenProviderIDKimi:
		return p.kimi
	case tokenProviderIDGLM:
		return p.glm
	default:
		return nil
	}
}

func (p *CloudProvider) probeTimeout() time.Duration {
	for _, backend := range []*Backend{p.nimiLLM, p.alibaba, p.bytedance, p.gemini, p.minimax, p.kimi, p.glm} {
		if backend != nil && backend.client != nil {
			return backend.client.Timeout
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
