package config

import (
	"os"
	"sort"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

type providerEnvBinding struct {
	canonicalID string
	baseURLKey  string
	apiKeyKey   string
}

type ResolvedCloudProvider struct {
	CanonicalID string
	BaseURL     string
	APIKey      string
}

var providerEnvBindings = buildProviderEnvBindings()

func buildProviderEnvBindings() []providerEnvBinding {
	ids := append([]string(nil), providerregistry.RemoteProviders...)
	sort.Strings(ids)
	out := make([]providerEnvBinding, 0, len(ids))
	for _, providerID := range ids {
		token := providerEnvToken(providerID)
		if token == "" {
			continue
		}
		out = append(out, providerEnvBinding{
			canonicalID: providerID,
			baseURLKey:  "NIMI_RUNTIME_CLOUD_" + token + "_BASE_URL",
			apiKeyKey:   "NIMI_RUNTIME_CLOUD_" + token + "_API_KEY",
		})
	}
	return out
}

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

func defaultRemoteProviderBaseURL(canonicalID string) string {
	record, ok := providerregistry.Lookup(strings.TrimSpace(canonicalID))
	if !ok || record.RuntimePlane != "remote" || record.RequiresExplicitEndpoint {
		return ""
	}
	return strings.TrimSpace(record.DefaultEndpoint)
}

func resolveCloudProviders(fileTargets map[string]RuntimeFileTarget) map[string]RuntimeFileTarget {
	resolved := make(map[string]RuntimeFileTarget, len(fileTargets)+len(providerEnvBindings))
	for providerName, target := range fileTargets {
		resolved[normalizedProviderKey(providerName)] = target
	}

	for _, binding := range providerEnvBindings {
		target := resolved[binding.canonicalID]
		resolvedBase := strings.TrimSpace(os.Getenv(binding.baseURLKey))
		if resolvedBase == "" {
			resolvedBase = strings.TrimSpace(target.BaseURL)
		}

		resolvedAPIKey := resolveProviderAPIKeyWithBinding(target, binding.apiKeyKey)
		if resolvedBase == "" && resolvedAPIKey == "" && strings.TrimSpace(target.DefaultModel) == "" {
			continue
		}
		if resolvedBase == "" {
			resolvedBase = defaultRemoteProviderBaseURL(binding.canonicalID)
		}

		target.BaseURL = resolvedBase
		target.APIKey = resolvedAPIKey
		target.APIKeyEnv = ""
		resolved[binding.canonicalID] = target
	}

	return resolved
}

func ResolveCloudProviderTargets(fileTargets map[string]RuntimeFileTarget) []ResolvedCloudProvider {
	resolvedTargets := resolveCloudProviders(fileTargets)
	targets := make([]ResolvedCloudProvider, 0, len(resolvedTargets))
	for _, binding := range providerEnvBindings {
		target, ok := resolvedTargets[binding.canonicalID]
		if !ok {
			continue
		}
		baseURL := strings.TrimSpace(target.BaseURL)
		if baseURL == "" {
			continue
		}
		targets = append(targets, ResolvedCloudProvider{
			CanonicalID: binding.canonicalID,
			BaseURL:     baseURL,
			APIKey:      strings.TrimSpace(target.APIKey),
		})
	}
	return targets
}

// ResolveProviderAPIKey resolves the API key from a RuntimeFileTarget (env var or literal).
func ResolveProviderAPIKey(target RuntimeFileTarget) string {
	return resolveProviderAPIKeyWithBinding(target, "")
}

func resolveProviderAPIKeyWithBinding(target RuntimeFileTarget, fallbackEnvKey string) string {
	if envRef := strings.TrimSpace(target.APIKeyEnv); envRef != "" {
		if value := strings.TrimSpace(os.Getenv(envRef)); value != "" {
			return value
		}
	}
	if fallbackEnvKey != "" {
		if value := strings.TrimSpace(os.Getenv(fallbackEnvKey)); value != "" {
			return value
		}
	}
	return strings.TrimSpace(target.APIKey)
}

// NormalizeProviderName strips non-alphanumeric characters and lowercases.
func NormalizeProviderName(raw string) string {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	if trimmed == "" {
		return ""
	}
	var builder strings.Builder
	builder.Grow(len(trimmed))
	for _, char := range trimmed {
		if char >= 'a' && char <= 'z' {
			builder.WriteRune(char)
			continue
		}
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
			continue
		}
		if char == '_' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

// ResolveCanonicalProviderID maps a config.json provider key to its canonical provider ID.
// Returns ("", false) for local providers or unknown names.
func ResolveCanonicalProviderID(raw string) (string, bool) {
	canonical := normalizedProviderKey(raw)
	if canonical == "" {
		return "", false
	}
	record, ok := providerregistry.Lookup(canonical)
	if !ok || record.RuntimePlane != "remote" {
		return "", false
	}
	return canonical, true
}
