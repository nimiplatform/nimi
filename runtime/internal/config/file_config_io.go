package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func portableRuntimeConfigPath() (string, error) {
	raw := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CONFIG_PATH"))
	if raw == "" {
		return "", nil
	}
	path := filepath.Clean(expandUserPath(raw))
	home, err := os.UserHomeDir()
	if err == nil && strings.TrimSpace(home) != "" {
		retired := filepath.Clean(filepath.Join(home, defaultRuntimeConfigRelPath))
		if path == retired || strings.EqualFold(path, retired) {
			return "", fmt.Errorf("%s is retired and forbidden as a portable Runtime config path", retired)
		}
	}
	return path, nil
}

// PortableRuntimeConfigPath resolves the explicit non-production portable
// config fixture. There is no default file discovery.
func PortableRuntimeConfigPath() (string, error) {
	return portableRuntimeConfigPath()
}

func RuntimeConfigPath() string {
	path, _ := portableRuntimeConfigPath()
	return path
}

func writeBytesAtomic(path string, content []byte, mode os.FileMode) error {
	if path == "" {
		return fmt.Errorf("runtime config path is empty")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create runtime config directory: %w", err)
	}

	tmpFile, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp runtime config file: %w", err)
	}
	tmpPath := tmpFile.Name()
	cleanupTemp := func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}
	if err := tmpFile.Chmod(mode); err != nil {
		cleanupTemp()
		return fmt.Errorf("set temp runtime config permissions: %w", err)
	}
	if _, err := tmpFile.Write(content); err != nil {
		cleanupTemp()
		return fmt.Errorf("write temp runtime config file: %w", err)
	}
	if err := tmpFile.Sync(); err != nil {
		cleanupTemp()
		return fmt.Errorf("sync temp runtime config file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("close temp runtime config file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename temp runtime config file: %w", err)
	}
	return nil
}

func loadRuntimeFileConfig() (FileConfig, error) {
	path, err := portableRuntimeConfigPath()
	if err != nil {
		return FileConfig{}, err
	}
	if path == "" {
		return FileConfig{SchemaVersion: DefaultSchemaVersion}, nil
	}
	fileCfg, err := LoadFileConfig(path)
	if err != nil {
		return FileConfig{}, err
	}
	if err := RejectProductControlOwnedFileConfigFields(fileCfg); err != nil {
		return FileConfig{}, fmt.Errorf("load portable Runtime config %q: %w", path, err)
	}
	return fileCfg, nil
}

// RejectProductControlOwnedFileConfigFields keeps portable/user-writable
// Runtime config from becoming a second data-root authority. Service-owned
// protected state uses LoadFileConfig directly and is reconciled independently
// against the fixed Product Control record.
func RejectProductControlOwnedFileConfigFields(fileCfg FileConfig) error {
	if strings.TrimSpace(fileCfg.DataRootRef) != "" {
		return fmt.Errorf("dataRootRef is Product Control-owned and forbidden outside protected Runtime derived state; use Product Control dataRoot.path")
	}
	if fileCfg.ManagedRoots == nil {
		return nil
	}
	for _, field := range []struct {
		label string
		value string
	}{
		{label: "models", value: fileCfg.ManagedRoots.Models},
		{label: "dependencies", value: fileCfg.ManagedRoots.Dependencies},
		{label: "environments", value: fileCfg.ManagedRoots.Environments},
		{label: "apps", value: fileCfg.ManagedRoots.Apps},
		{label: "accounts", value: fileCfg.ManagedRoots.Accounts},
		{label: "logs", value: fileCfg.ManagedRoots.Logs},
		{label: "audit", value: fileCfg.ManagedRoots.Audit},
	} {
		if strings.TrimSpace(field.value) != "" {
			return fmt.Errorf("managedRoots.%s is Product Control-owned and forbidden outside protected Runtime derived state; use Product Control dataRoot.path", field.label)
		}
	}
	return nil
}

func LoadFileConfig(path string) (FileConfig, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return FileConfig{SchemaVersion: DefaultSchemaVersion}, nil
		}
		return FileConfig{}, fmt.Errorf("read runtime config file %q: %w", path, err)
	}
	if len(strings.TrimSpace(string(content))) == 0 {
		return FileConfig{SchemaVersion: DefaultSchemaVersion}, nil
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(content, &root); err == nil {
		if _, nestedRuntime := root["runtime"]; nestedRuntime {
			return FileConfig{}, fmt.Errorf("parse runtime config file %q: nested runtime object is removed; use top-level runtime config fields", path)
		}
		if err := rejectLegacyLocalRuntimeConfigKeys(path, root); err != nil {
			return FileConfig{}, err
		}
		if rawAuth, ok := root["auth"]; ok {
			var authFields map[string]json.RawMessage
			if err := json.Unmarshal(rawAuth, &authFields); err == nil {
				if _, retired := authFields["developerRegistration"]; retired {
					return FileConfig{}, fmt.Errorf("parse runtime config file %q: auth.developerRegistration is retired; use Runtime-owned Developer Mode and the protected local-app carrier", path)
				}
			}
		}
		if _, legacyCatalogOverride := root["modelCatalogOverridePath"]; legacyCatalogOverride {
			return FileConfig{}, fmt.Errorf("parse runtime config file %q: modelCatalogOverridePath is removed; use modelCatalogCustomDir", path)
		}
		if _, removedRemoteEnabled := root["modelCatalogRemoteEnabled"]; removedRemoteEnabled {
			return FileConfig{}, fmt.Errorf("parse runtime config file %q: modelCatalogRemoteEnabled is removed; non-scenario catalog metadata is YAML-only", path)
		}
		if _, removedRemoteURL := root["modelCatalogRemoteUrl"]; removedRemoteURL {
			return FileConfig{}, fmt.Errorf("parse runtime config file %q: modelCatalogRemoteUrl is removed; non-scenario catalog metadata is YAML-only", path)
		}
		if _, removedRefreshInterval := root["modelCatalogRefreshIntervalSeconds"]; removedRefreshInterval {
			return FileConfig{}, fmt.Errorf("parse runtime config file %q: modelCatalogRefreshIntervalSeconds is removed; non-scenario catalog metadata is YAML-only", path)
		}
		if _, removedCachePath := root["modelCatalogCachePath"]; removedCachePath {
			return FileConfig{}, fmt.Errorf("parse runtime config file %q: modelCatalogCachePath is removed; non-scenario catalog metadata is YAML-only", path)
		}
	}
	var parsed FileConfig
	decoder := json.NewDecoder(bytes.NewReader(content))
	if err := decoder.Decode(&parsed); err != nil {
		return FileConfig{}, fmt.Errorf("parse runtime config file %q: %w", path, err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return FileConfig{}, fmt.Errorf("parse runtime config file %q: unexpected trailing content", path)
	}
	if err := ValidateFileConfig(parsed); err != nil {
		return FileConfig{}, fmt.Errorf("validate runtime config file %q: %w", path, err)
	}
	return parsed, nil
}

func ValidateFileConfig(fileCfg FileConfig) error {
	if fileCfg.SchemaVersion != DefaultSchemaVersion {
		return fmt.Errorf("schemaVersion must be %d", DefaultSchemaVersion)
	}
	defaultCloudProvider := strings.TrimSpace(fileCfg.DefaultCloudProvider)
	defaultLocalTextModel := strings.TrimSpace(fileCfg.DefaultLocalTextModel)
	for providerName, providerCfg := range fileCfg.Providers {
		if !isCanonicalProviderName(providerName) {
			return fmt.Errorf("provider %q is forbidden; use canonical provider name", providerName)
		}
		if strings.TrimSpace(providerCfg.APIKey) != "" && strings.TrimSpace(providerCfg.APIKeyEnv) != "" {
			return fmt.Errorf("provider %q cannot set both apiKey and apiKeyEnv", providerName)
		}
	}
	if defaultCloudProvider != "" {
		canonical, ok := ResolveCanonicalProviderID(defaultCloudProvider)
		if !ok {
			return fmt.Errorf("defaultCloudProvider %q must name a canonical configured cloud provider", defaultCloudProvider)
		}
		if _, exists := fileCfg.Providers[canonical]; !exists {
			return fmt.Errorf("defaultCloudProvider %q must reference a configured provider", canonical)
		}
	}
	if defaultLocalTextModel != "" {
		if looksLikeQualifiedRemoteModel(defaultLocalTextModel) {
			return fmt.Errorf("defaultLocalTextModel %q must name a local model id, not a remote qualified model", defaultLocalTextModel)
		}
	}
	if fileCfg.Auth != nil && fileCfg.Auth.JWT != nil {
		if err := validateJWTSettings(fileCfg.Auth.JWT.Issuer, fileCfg.Auth.JWT.Audience, fileCfg.Auth.JWT.JWKSURL, fileCfg.Auth.JWT.RevocationURL); err != nil {
			return err
		}
	}
	if err := validateOptionalFileConfigInt(fileCfg.ShutdownTimeoutSeconds, "shutdownTimeoutSeconds", 1, 600); err != nil {
		return err
	}
	if err := validateOptionalFileConfigInt(fileCfg.SessionTTLMinSeconds, "sessionTtlMinSeconds", 1, 86400); err != nil {
		return err
	}
	if err := validateOptionalFileConfigInt(fileCfg.SessionTTLMaxSeconds, "sessionTtlMaxSeconds", 1, 604800); err != nil {
		return err
	}
	if fileCfg.SessionTTLMinSeconds != nil && fileCfg.SessionTTLMaxSeconds != nil && *fileCfg.SessionTTLMaxSeconds < *fileCfg.SessionTTLMinSeconds {
		return fmt.Errorf("sessionTtlMaxSeconds must be >= sessionTtlMinSeconds")
	}
	if err := validateOptionalFileConfigInt(fileCfg.AIHealthIntervalSeconds, "aiHealthIntervalSeconds", 1, 3600); err != nil {
		return err
	}
	if err := validateOptionalFileConfigInt(fileCfg.AIHTTPTimeoutSeconds, "aiHttpTimeoutSeconds", 1, 600); err != nil {
		return err
	}
	if err := validateOptionalFileConfigInt(fileCfg.GlobalConcurrencyLimit, "globalConcurrencyLimit", 1, 256); err != nil {
		return err
	}
	if err := validateOptionalFileConfigInt(fileCfg.PerAppConcurrencyLimit, "perAppConcurrencyLimit", 1, 128); err != nil {
		return err
	}
	if fileCfg.GlobalConcurrencyLimit != nil && fileCfg.PerAppConcurrencyLimit != nil && *fileCfg.PerAppConcurrencyLimit > *fileCfg.GlobalConcurrencyLimit {
		return fmt.Errorf("perAppConcurrencyLimit must be <= globalConcurrencyLimit")
	}
	if err := validateOptionalFileConfigInt(fileCfg.IdempotencyCapacity, "idempotencyCapacity", 1, 1_000_000); err != nil {
		return err
	}
	if err := validateOptionalFileConfigInt(fileCfg.MaxDelegationDepth, "maxDelegationDepth", 1, 16); err != nil {
		return err
	}
	if err := validateOptionalFileConfigInt(fileCfg.AuditRingBufferSize, "auditRingBufferSize", 1, 1_000_000); err != nil {
		return err
	}
	if err := validateOptionalFileConfigInt(fileCfg.UsageStatsBufferSize, "usageStatsBufferSize", 1, 1_000_000); err != nil {
		return err
	}
	if err := validateOptionalFileConfigInt(fileCfg.LocalAuditCapacity, "localAuditCapacity", 1, 1_000_000); err != nil {
		return err
	}
	if fileCfg.LocalService != nil {
		if fileCfg.LocalService.Enabled == nil {
			return fmt.Errorf("localService.enabled is required when localService is set")
		}
		mode := strings.TrimSpace(fileCfg.LocalService.Mode)
		if mode == "" {
			return fmt.Errorf("localService.mode is required when localService is set")
		}
		if mode != LocalServiceModeDesktopLocal {
			return fmt.Errorf("localService.mode %q is forbidden; only %q is admitted", mode, LocalServiceModeDesktopLocal)
		}
	}
	if fileCfg.Engines != nil {
		if err := validateOptionalFileConfigPort(fileConfigEngineInt(fileCfg, "llama", "port"), "engines.llama.port"); err != nil {
			return err
		}
		if err := validateOptionalFileConfigPort(fileConfigEngineInt(fileCfg, "media", "port"), "engines.media.port"); err != nil {
			return err
		}
		if err := validateOptionalFileConfigPort(fileConfigEngineInt(fileCfg, "speech", "port"), "engines.speech.port"); err != nil {
			return err
		}
	}
	return nil
}

func validateOptionalFileConfigInt(value *int, field string, min int, max int) error {
	if value == nil {
		return nil
	}
	if *value < min || *value > max {
		return fmt.Errorf("%s must be between %d and %d", field, min, max)
	}
	return nil
}

func validateOptionalFileConfigPort(value *int, field string) error {
	if value == nil {
		return nil
	}
	if *value < 1 || *value > 65535 {
		return fmt.Errorf("%s must be between 1 and 65535", field)
	}
	return nil
}

func rejectLegacyLocalRuntimeConfigKeys(path string, root map[string]json.RawMessage) error {
	for _, key := range []string{"providers"} {
		raw, ok := root[key]
		if !ok {
			continue
		}
		var section map[string]json.RawMessage
		if err := json.Unmarshal(raw, &section); err != nil {
			continue
		}
		for _, legacyKey := range []string{"local", "nexa", "nimi_media"} {
			if _, exists := section[legacyKey]; exists {
				return fmt.Errorf("parse runtime config file %q: providers.%s is removed; clear legacy local runtime config and reconfigure engines.llama/engines.media", path, legacyKey)
			}
		}
	}
	raw, ok := root["engines"]
	if !ok {
		return nil
	}
	var engines map[string]json.RawMessage
	if err := json.Unmarshal(raw, &engines); err != nil {
		return nil
	}
	for _, legacyKey := range []string{"localai", "nexa", "nimi_media"} {
		if _, exists := engines[legacyKey]; exists {
			return fmt.Errorf("parse runtime config file %q: engines.%s is removed; clear legacy local runtime config and reconfigure engines.llama/engines.media", path, legacyKey)
		}
	}
	return nil
}

func looksLikeQualifiedRemoteModel(modelID string) bool {
	normalized := strings.TrimSpace(modelID)
	if normalized == "" {
		return false
	}
	parts := strings.SplitN(normalized, "/", 2)
	if len(parts) != 2 {
		return false
	}
	prefix := strings.TrimSpace(parts[0])
	if prefix == "" {
		return false
	}
	if strings.EqualFold(prefix, "cloud") {
		return true
	}
	_, ok := ResolveCanonicalProviderID(prefix)
	return ok
}

func MarshalFileConfig(fileCfg FileConfig) ([]byte, error) {
	if err := ValidateFileConfig(fileCfg); err != nil {
		return nil, err
	}
	raw, err := json.MarshalIndent(fileCfg, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}

func WriteFileConfig(path string, fileCfg FileConfig) error {
	content, err := MarshalFileConfig(fileCfg)
	if err != nil {
		return err
	}
	return writeBytesAtomic(path, content, 0o600)
}

func expandUserPath(raw string) string {
	path := strings.TrimSpace(raw)
	if path == "" {
		return ""
	}
	if path == "~" {
		home, err := os.UserHomeDir()
		if err == nil {
			return home
		}
		return path
	}
	if !strings.HasPrefix(path, "~/") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return path
	}
	return filepath.Join(home, strings.TrimPrefix(path, "~/"))
}
