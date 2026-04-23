package nimillm

import (
	"strings"
	"time"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

// NormalizeTokenProviderID canonicalizes public token provider identifiers.
func NormalizeTokenProviderID(raw string) (string, error) {
	token := normalizeProbeProviderToken(raw)
	if token == "" {
		return "nimillm", nil
	}
	record, ok := providerregistry.Lookup(token)
	if ok && record.RuntimePlane == "remote" {
		return token, nil
	}
	return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
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
func (p *CloudProvider) ResolveProbeBackend(providerID string, endpoint string, apiKey string, headers map[string]string) (*Backend, string, error) {
	canonicalProviderID, err := NormalizeTokenProviderID(providerID)
	if err != nil {
		return nil, "", err
	}

	template := p.backends[canonicalProviderID]
	backendName := "cloud-" + canonicalProviderID
	backend := probeBackendFromTemplate(backendName, template, endpoint, apiKey, headers, p.probeTimeout(), p.enforceEndpointSecurity, p.allowLoopbackEndpoint)
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

func probeBackendFromTemplate(name string, template *Backend, endpoint string, apiKey string, headers map[string]string, timeout time.Duration, enforceEndpointSecurity bool, allowLoopback bool) *Backend {
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
	if enforceEndpointSecurity {
		return NewSecuredBackendWithHeaders(name, normalizedEndpoint, normalizedAPIKey, headers, timeout, allowLoopback)
	}
	return NewBackendWithHeaders(name, normalizedEndpoint, normalizedAPIKey, headers, timeout)
}
