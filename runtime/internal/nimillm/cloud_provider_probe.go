package nimillm

import (
	_ "embed"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc/codes"
	"gopkg.in/yaml.v3"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

//go:embed authority/provider-probe-targets.yaml
var providerProbeTargetsAuthorityYAML []byte

var admittedTokenProbeProviderSet = sync.OnceValues(loadAdmittedTokenProbeProvidersFromAuthority)

type providerProbeTargetsDocument struct {
	Targets []providerProbeTargetEntry `yaml:"targets"`
}

type providerProbeTargetEntry struct {
	Name     string `yaml:"name"`
	Category string `yaml:"category"`
}

func loadAdmittedTokenProbeProvidersFromAuthority() (map[string]struct{}, error) {
	var document providerProbeTargetsDocument
	if err := yaml.Unmarshal(providerProbeTargetsAuthorityYAML, &document); err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID)
	}
	out := make(map[string]struct{})
	for _, target := range document.Targets {
		name := strings.TrimSpace(target.Name)
		category := strings.TrimSpace(target.Category)
		if category != "cloud" {
			continue
		}
		if !strings.HasPrefix(name, "cloud-") {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID)
		}
		providerID := strings.ReplaceAll(strings.TrimPrefix(name, "cloud-"), "-", "_")
		if providerID == "" {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID)
		}
		out[providerID] = struct{}{}
	}
	if _, ok := out["nimillm"]; !ok || len(out) == 0 {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID)
	}
	return out, nil
}

// NormalizeTokenProviderID canonicalizes public token provider identifiers.
func NormalizeTokenProviderID(raw string) (string, error) {
	token := normalizeProbeProviderToken(raw)
	admitted, err := admittedTokenProbeProviderSet()
	if err != nil {
		return "", err
	}
	if token == "" {
		return "nimillm", nil
	}
	if _, ok := admitted[token]; ok {
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
