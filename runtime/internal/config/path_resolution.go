package config

import (
	"os"
	"path/filepath"
	"strings"
)

func normalizeStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		result = append(result, trimmed)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		result[trimmedKey] = value
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func resolveLocalStatePath(fileCfg FileConfig) string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_STATE_PATH")); value != "" {
		return value
	}
	if value := strings.TrimSpace(fileCfg.LocalStatePath); value != "" {
		return expandUserPath(value)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultLocalStateRelPath)
}

func resolveLocalModelsPath(fileCfg FileConfig) string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_MODELS_PATH")); value != "" {
		return expandUserPath(value)
	}
	if value := strings.TrimSpace(fileCfg.LocalModelsPath); value != "" {
		return expandUserPath(value)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultLocalModelsRelPath)
}

func resolveModelCatalogCustomDir(fileCfg FileConfig) string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_MODEL_CATALOG_CUSTOM_DIR")); value != "" {
		return expandUserPath(value)
	}
	if value := strings.TrimSpace(fileCfg.ModelCatalogCustomDir); value != "" {
		return expandUserPath(value)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultModelCatalogCustomRelPath)
}
