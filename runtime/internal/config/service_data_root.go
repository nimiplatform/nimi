package config

import (
	"fmt"
	"path/filepath"
	"strings"
)

const ServiceOwnedConfigFilename = "config.json"

// ApplyProtectedDataRootBinding applies a data-plane root that has already
// been authenticated by the platform-specific signed service profile. It does
// not read a user file or choose a path; callers own that trust decision.
func ApplyProtectedDataRootBinding(cfg *Config, dataRootRef string) error {
	if cfg == nil {
		return fmt.Errorf("Runtime config is required")
	}
	root := filepath.Clean(strings.TrimSpace(dataRootRef))
	if root == "." || !filepath.IsAbs(root) || root == filepath.VolumeName(root)+string(filepath.Separator) {
		return fmt.Errorf("protected dataRootRef must be an absolute non-root path")
	}
	managedRoots := resolveManagedRoots(FileConfig{
		SchemaVersion: DefaultSchemaVersion,
		DataRootRef:   root,
	})
	cfg.DataRootRef = root
	cfg.LocalModelsPath = managedRoots.Models
	cfg.ManagedRoots = managedRoots
	return nil
}

// ServiceOwnedConfigPath resolves the mutable Runtime configuration beside the
// service-owned local state. Callers must supply the already-verified
// service-owned local-state path; request and renderer paths are not accepted.
func ServiceOwnedConfigPath(localStatePath string) (string, error) {
	runtimeRoot := filepath.Dir(filepath.Clean(strings.TrimSpace(localStatePath)))
	if runtimeRoot == "." || !filepath.IsAbs(runtimeRoot) || runtimeRoot == filepath.VolumeName(runtimeRoot)+string(filepath.Separator) {
		return "", fmt.Errorf("service-owned Runtime root must be an absolute non-root path")
	}
	return filepath.Join(runtimeRoot, ServiceOwnedConfigFilename), nil
}

// WriteServiceOwnedDataRoot persists the bounded data-plane configuration
// selected by Product Control. It preserves other admitted service-owned
// fields, derives every managed root from the same selected nimi_data root,
// and reports whether a restart-disposition field changed.
func WriteServiceOwnedDataRoot(path string, dataRootRef string) (bool, error) {
	root := filepath.Clean(strings.TrimSpace(dataRootRef))
	if root == "." || !filepath.IsAbs(root) || root == filepath.VolumeName(root)+string(filepath.Separator) {
		return false, fmt.Errorf("dataRootRef must be an absolute non-root path")
	}
	fileCfg, err := LoadFileConfig(path)
	if err != nil {
		return false, fmt.Errorf("load service-owned Runtime config: %w", err)
	}
	nextRoots := &FileConfigManagedRoots{
		Models:       filepath.Join(root, string(DataPlaneRootModels)),
		Dependencies: filepath.Join(root, string(DataPlaneRootDependencies)),
		Environments: filepath.Join(root, string(DataPlaneRootEnvironments)),
		Logs:         filepath.Join(root, string(DataPlaneRootLogs)),
		Audit:        filepath.Join(root, string(DataPlaneRootAudit)),
	}
	changed := filepath.Clean(strings.TrimSpace(fileCfg.DataRootRef)) != root || !sameFileConfigManagedRoots(fileCfg.ManagedRoots, nextRoots)
	if !changed {
		return false, nil
	}
	fileCfg.DataRootRef = root
	fileCfg.ManagedRoots = nextRoots
	if err := WriteFileConfig(path, fileCfg); err != nil {
		return false, fmt.Errorf("write service-owned Runtime data-root config: %w", err)
	}
	return true, nil
}

// ApplyServiceOwnedDataRoot overlays only the admitted mutable data-plane
// fields onto the fixed boot configuration. Missing state leaves setup
// fail-closed; it never guesses a root from the acceptance proposal.
func ApplyServiceOwnedDataRoot(cfg *Config, path string) error {
	if cfg == nil {
		return fmt.Errorf("Runtime config is required")
	}
	fileCfg, err := LoadFileConfig(path)
	if err != nil {
		return fmt.Errorf("load service-owned Runtime data-root config: %w", err)
	}
	if strings.TrimSpace(fileCfg.DataRootRef) == "" {
		cfg.DataRootRef = ""
		cfg.LocalModelsPath = ""
		cfg.ManagedRoots = ManagedRootsConfig{}
		return nil
	}
	dataRootRef := filepath.Clean(strings.TrimSpace(fileCfg.DataRootRef))
	if !filepath.IsAbs(dataRootRef) || dataRootRef == filepath.VolumeName(dataRootRef)+string(filepath.Separator) {
		return fmt.Errorf("service-owned dataRootRef must be an absolute non-root path")
	}
	managedRoots := resolveManagedRoots(fileCfg)
	for label, value := range map[string]string{
		"models": managedRoots.Models, "dependencies": managedRoots.Dependencies,
		"environments": managedRoots.Environments, "logs": managedRoots.Logs, "audit": managedRoots.Audit,
	} {
		if !filepath.IsAbs(value) {
			return fmt.Errorf("service-owned managedRoots.%s must be absolute", label)
		}
	}
	cfg.DataRootRef = dataRootRef
	cfg.LocalModelsPath = managedRoots.Models
	cfg.ManagedRoots = managedRoots
	return nil
}

func sameFileConfigManagedRoots(left *FileConfigManagedRoots, right *FileConfigManagedRoots) bool {
	if left == nil || right == nil {
		return left == right
	}
	return filepath.Clean(left.Models) == filepath.Clean(right.Models) &&
		filepath.Clean(left.Dependencies) == filepath.Clean(right.Dependencies) &&
		filepath.Clean(left.Environments) == filepath.Clean(right.Environments) &&
		filepath.Clean(left.Logs) == filepath.Clean(right.Logs) &&
		filepath.Clean(left.Audit) == filepath.Clean(right.Audit)
}
