package connector

import "strings"

type ProviderAuthProfile struct {
	ID               string
	AllowedProviders map[string]struct{}
	ResolveHeaders   func(string) map[string]string
}

var providerAuthProfiles = buildProviderAuthProfiles()

func buildProviderAuthProfiles() map[string]ProviderAuthProfile {
	result := make(map[string]ProviderAuthProfile, len(GeneratedProviderAuthProfiles))
	for _, spec := range GeneratedProviderAuthProfiles {
		result[spec.ID] = ProviderAuthProfile{
			ID:               spec.ID,
			AllowedProviders: profileProviderSet(spec.AllowedProviders...),
			ResolveHeaders:   resolveProviderAuthProfileHeaders(spec.HeaderBehavior),
		}
	}
	return result
}

func resolveProviderAuthProfileHeaders(headerBehavior string) func(string) map[string]string {
	switch strings.ToLower(strings.TrimSpace(headerBehavior)) {
	case "codex_oauth":
		return codexOAuthHeaders
	case "anthropic":
		return anthropicCredentialHeaders
	default:
		return nil
	}
}

func profileProviderSet(providers ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(providers))
	for _, provider := range providers {
		normalized := strings.ToLower(strings.TrimSpace(provider))
		if normalized == "" {
			continue
		}
		result[normalized] = struct{}{}
	}
	return result
}

func LookupProviderAuthProfile(raw string) (ProviderAuthProfile, bool) {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" {
		return ProviderAuthProfile{}, false
	}
	profile, ok := providerAuthProfiles[normalized]
	return profile, ok
}

func providerAuthProfileAllowedForProvider(profile ProviderAuthProfile, provider string) bool {
	if len(profile.AllowedProviders) == 0 {
		return false
	}
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	_, ok := profile.AllowedProviders[normalizedProvider]
	return ok
}
