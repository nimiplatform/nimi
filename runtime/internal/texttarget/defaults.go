package texttarget

import (
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

const BundledDefaultLocalTextModel = "qwen2.5"

var localQualifiedPrefixes = []string{"local", "llama", "media", "speech", "sidecar"}

func ResolveLocalDefaultModel(cfg config.Config) string {
	if value := strings.TrimSpace(cfg.DefaultLocalTextModel); value != "" {
		return value
	}
	return BundledDefaultLocalTextModel
}

func EnsureLocalQualifiedModel(modelID string) string {
	normalized := strings.TrimSpace(modelID)
	if normalized == "" {
		return ""
	}
	if prefix, remainder, ok := splitCanonicalLocalPrefix(normalized); ok {
		return prefix + "/" + remainder
	}
	return "local/" + normalized
}

func EnsureLocalLatestModelRef(modelID string) string {
	qualified := EnsureLocalQualifiedModel(modelID)
	if qualified == "" {
		return ""
	}
	_, remainder, ok := strings.Cut(qualified, "/")
	if !ok {
		return qualified
	}
	if strings.Contains(remainder, "@") || strings.Contains(remainder, ":") {
		return qualified
	}
	return qualified + "@latest"
}

func ResolveCloudProvider(cfg config.Config, providerHint string) (string, config.RuntimeFileTarget, error) {
	if value := strings.TrimSpace(providerHint); value != "" {
		canonical, ok := config.ResolveCanonicalProviderID(value)
		if !ok {
			return "", config.RuntimeFileTarget{}, fmt.Errorf("unsupported cloud provider %q", providerHint)
		}
		target, ok := cfg.Providers[canonical]
		if !ok {
			return "", config.RuntimeFileTarget{}, fmt.Errorf("provider %q is not configured", canonical)
		}
		return canonical, target, nil
	}
	providerName := strings.TrimSpace(cfg.DefaultCloudProvider)
	if providerName == "" {
		return "", config.RuntimeFileTarget{}, fmt.Errorf("no default cloud provider is configured")
	}
	target, ok := cfg.Providers[providerName]
	if !ok {
		return "", config.RuntimeFileTarget{}, fmt.Errorf("default cloud provider %q is not configured", providerName)
	}
	return providerName, target, nil
}

func ResolveProviderDefaultTextModel(cfg config.Config, providerName string) (string, string, error) {
	canonicalProvider := strings.TrimSpace(providerName)
	if canonicalProvider == "" {
		return "", "", fmt.Errorf("provider name is required")
	}
	target, ok := cfg.Providers[canonicalProvider]
	if !ok {
		return "", "", fmt.Errorf("provider %q is not configured", canonicalProvider)
	}
	if value := strings.TrimSpace(target.DefaultModel); value != "" {
		return value, "config", nil
	}
	record, ok := providerregistry.Lookup(canonicalProvider)
	if ok && strings.TrimSpace(record.DefaultTextModel) != "" {
		return strings.TrimSpace(record.DefaultTextModel), "catalog", nil
	}
	return "", "", fmt.Errorf("provider %q has no default text model", canonicalProvider)
}

func LooksLikeQualifiedRemoteModel(modelID string) bool {
	normalized := strings.TrimSpace(modelID)
	if normalized == "" {
		return false
	}
	prefix, rest, ok := strings.Cut(normalized, "/")
	if !ok || rest == "" {
		return false
	}
	prefix = strings.TrimSpace(prefix)
	if strings.EqualFold(prefix, "cloud") {
		return true
	}
	_, ok = config.ResolveCanonicalProviderID(prefix)
	return ok
}

func splitCanonicalLocalPrefix(modelID string) (string, string, bool) {
	prefix, remainder, ok := strings.Cut(modelID, "/")
	if !ok {
		return "", "", false
	}
	remainder = strings.TrimSpace(remainder)
	if remainder == "" {
		return "", "", false
	}
	for _, candidate := range localQualifiedPrefixes {
		if strings.EqualFold(strings.TrimSpace(prefix), candidate) {
			return candidate, remainder, true
		}
	}
	return "", "", false
}

func IsHighLevelQualifiedModel(modelID string) bool {
	normalized := strings.TrimSpace(modelID)
	if normalized == "" {
		return false
	}
	prefix, rest, ok := strings.Cut(normalized, "/")
	if !ok || strings.TrimSpace(rest) == "" {
		return false
	}
	lower := strings.ToLower(strings.TrimSpace(prefix))
	return lower == "local" || lower == "llama" || lower == "media" || lower == "speech" || lower == "sidecar" || LooksLikeQualifiedRemoteModel(normalized)
}

func ResolveInternalDefaultAlias(cfg config.Config, rawModelID string) (string, error) {
	modelID := strings.TrimSpace(rawModelID)
	if modelID == "" {
		return "", nil
	}
	switch strings.ToLower(modelID) {
	case "local/default":
		return EnsureLocalQualifiedModel(ResolveLocalDefaultModel(cfg)), nil
	case "cloud/default":
		providerName, _, err := ResolveCloudProvider(cfg, "")
		if err != nil {
			return "", err
		}
		defaultModel, _, err := ResolveProviderDefaultTextModel(cfg, providerName)
		if err != nil {
			return "", err
		}
		return providerName + "/" + defaultModel, nil
	}
	prefix, rest, ok := strings.Cut(modelID, "/")
	if !ok {
		return modelID, nil
	}
	canonical, ok := config.ResolveCanonicalProviderID(prefix)
	if !ok || !strings.EqualFold(strings.TrimSpace(rest), "default") {
		return modelID, nil
	}
	defaultModel, _, err := ResolveProviderDefaultTextModel(cfg, canonical)
	if err != nil {
		return "", err
	}
	return canonical + "/" + defaultModel, nil
}
