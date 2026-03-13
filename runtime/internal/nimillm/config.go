package nimillm

import (
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

// ProviderCredentials holds base URL and API key for a single cloud provider.
type ProviderCredentials struct {
	BaseURL string
	APIKey  string
	Headers map[string]string
}

// CloudConfig holds all cloud provider connection parameters.
// Providers is keyed by canonical provider ID (e.g. "nimillm", "dashscope",
// "volcengine", "gemini", "minimax", "kimi", "glm").
type CloudConfig struct {
	Providers   map[string]ProviderCredentials
	HTTPTimeout time.Duration

	// EnforceEndpointSecurity enables endpoint validation + DNS-pinned outbound
	// transport for cloud requests (K-SEC-003/K-SEC-004).
	EnforceEndpointSecurity bool

	// AllowLoopbackEndpoint allows HTTP loopback endpoints when endpoint
	// security is enabled.
	AllowLoopbackEndpoint bool
}

// ResolveProviderAlias returns the canonical provider ID for a given name.
func ResolveProviderAlias(name string) string {
	normalized := strings.TrimSpace(strings.ToLower(name))
	if normalized == "" {
		return ""
	}
	normalized = strings.ReplaceAll(normalized, "-", "_")
	normalized = strings.ReplaceAll(normalized, " ", "_")
	for strings.Contains(normalized, "__") {
		normalized = strings.ReplaceAll(normalized, "__", "_")
	}
	record, ok := providerregistry.Lookup(normalized)
	if !ok || record.RuntimePlane != "remote" {
		return ""
	}
	return normalized
}
