package texttarget

import (
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

const BundledDefaultLocalTextModel = "qwen2.5"

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
	lower := strings.ToLower(normalized)
	if strings.HasPrefix(lower, "local/") || strings.HasPrefix(lower, "localai/") || strings.HasPrefix(lower, "nexa/") || strings.HasPrefix(lower, "sidecar/") || strings.HasPrefix(lower, "localsidecar/") {
		return normalized
	}
	return "local/" + normalized
}

func EnsureLocalLatestModelRef(modelID string) string {
	qualified := EnsureLocalQualifiedModel(modelID)
	if qualified == "" {
		return ""
	}
	if strings.Contains(qualified, "@") || strings.Count(qualified, ":") == 1 {
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
			return "", config.RuntimeFileTarget{}, fmt.Errorf("provider %s is not configured", canonical)
		}
		return canonical, target, nil
	}
	providerName := strings.TrimSpace(cfg.DefaultCloudProvider)
	if providerName == "" {
		return "", config.RuntimeFileTarget{}, fmt.Errorf("no default cloud provider is configured")
	}
	target, ok := cfg.Providers[providerName]
	if !ok {
		return "", config.RuntimeFileTarget{}, fmt.Errorf("default cloud provider %s is not configured", providerName)
	}
	return providerName, target, nil
}

func ResolveProviderDefaultTextModel(cfg config.Config, providerName string) (string, string, error) {
	target := cfg.Providers[strings.TrimSpace(providerName)]
	if value := strings.TrimSpace(target.DefaultModel); value != "" {
		return value, "config", nil
	}
	record, ok := providerregistry.Lookup(strings.TrimSpace(providerName))
	if ok && strings.TrimSpace(record.DefaultTextModel) != "" {
		return strings.TrimSpace(record.DefaultTextModel), "catalog", nil
	}
	return "", "", fmt.Errorf("provider %s has no default text model. Run 'nimi provider set %s --default-model <model>'", providerName, providerName)
}

func LooksLikeQualifiedRemoteModel(modelID string) bool {
	normalized := strings.TrimSpace(modelID)
	if normalized == "" {
		return false
	}
	prefix, rest, ok := strings.Cut(normalized, "/")
	if !ok || strings.TrimSpace(rest) == "" {
		return false
	}
	prefix = strings.TrimSpace(prefix)
	if strings.EqualFold(prefix, "cloud") {
		return true
	}
	_, ok = config.ResolveCanonicalProviderID(prefix)
	return ok
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
	return lower == "local" || lower == "localai" || lower == "nexa" || lower == "sidecar" || lower == "localsidecar" || LooksLikeQualifiedRemoteModel(normalized)
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
