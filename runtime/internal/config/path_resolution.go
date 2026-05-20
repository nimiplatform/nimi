package config

import (
	"os"
	"path/filepath"
	"strings"
)

func resolveLocalStatePath(fileCfg FileConfig) string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_STATE_PATH")); value != "" {
		return expandUserPath(value)
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
	if fileCfg.ManagedRoots != nil {
		if value := strings.TrimSpace(fileCfg.ManagedRoots.Models); value != "" {
			return expandUserPath(value)
		}
	}
	dataRoot := resolveDataRootRef(fileCfg)
	if dataRoot == "" {
		return ""
	}
	return filepath.Join(dataRoot, "models")
}

func resolveDataRootRef(fileCfg FileConfig) string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_DATA_ROOT_REF")); value != "" {
		return expandUserPath(value)
	}
	if value := strings.TrimSpace(fileCfg.DataRootRef); value != "" {
		return expandUserPath(value)
	}
	return ""
}

func resolveManagedRoots(fileCfg FileConfig) ManagedRootsConfig {
	dataRoot := resolveDataRootRef(fileCfg)
	resolve := func(explicit string, child string) string {
		if trimmed := strings.TrimSpace(explicit); trimmed != "" {
			return expandUserPath(trimmed)
		}
		if dataRoot == "" {
			return ""
		}
		return filepath.Join(dataRoot, child)
	}
	var roots FileConfigManagedRoots
	if fileCfg.ManagedRoots != nil {
		roots = *fileCfg.ManagedRoots
	}
	return ManagedRootsConfig{
		Models:       resolve(roots.Models, "models"),
		Dependencies: resolve(roots.Dependencies, "dependencies"),
		Environments: resolve(roots.Environments, "environments"),
		Logs:         resolve(roots.Logs, "logs"),
		Audit:        resolve(roots.Audit, "audit"),
	}
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

func resolveAppRegistryPath(fileCfg FileConfig) string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_APP_REGISTRY_PATH")); value != "" {
		return expandUserPath(value)
	}
	if value := strings.TrimSpace(fileCfg.AppRegistryPath); value != "" {
		return expandUserPath(value)
	}
	return ""
}

// resolveRuntimeID resolves the stable local Runtime daemon identity. The
// config file is the only persistent source; an empty value means config init
// has not yet generated one. (K-CFG-018)
func resolveRuntimeID(fileCfg FileConfig) string {
	return strings.TrimSpace(fileCfg.RuntimeID)
}

// resolveLocalService resolves the Runtime local service posture. An absent
// localService object defaults to the admitted desktop-local enabled posture.
// (K-CFG-018)
func resolveLocalService(fileCfg FileConfig) LocalServiceConfig {
	resolved := LocalServiceConfig{Enabled: true, Mode: LocalServiceModeDesktopLocal}
	if fileCfg.LocalService == nil {
		return resolved
	}
	if fileCfg.LocalService.Enabled != nil {
		resolved.Enabled = *fileCfg.LocalService.Enabled
	}
	if mode := strings.TrimSpace(fileCfg.LocalService.Mode); mode != "" {
		resolved.Mode = mode
	}
	return resolved
}
