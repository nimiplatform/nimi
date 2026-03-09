package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func runtimeConfigPath() string {
	if raw := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CONFIG_PATH")); raw != "" {
		return expandUserPath(raw)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultRuntimeConfigRelPath)
}

func RuntimeConfigPath() string {
	return runtimeConfigPath()
}

func writeBytesAtomic(path string, content []byte, mode os.FileMode) error {
	if path == "" {
		return fmt.Errorf("runtime config path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create runtime config directory: %w", err)
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, content, mode); err != nil {
		return fmt.Errorf("write temp runtime config file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename temp runtime config file: %w", err)
	}
	return nil
}

func loadRuntimeFileConfig() (FileConfig, error) {
	path := runtimeConfigPath()
	if path == "" {
		return FileConfig{SchemaVersion: DefaultSchemaVersion}, nil
	}
	return LoadFileConfig(path)
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
		if _, legacyRuntime := root["runtime"]; legacyRuntime {
			return FileConfig{}, fmt.Errorf("parse runtime config file %q: legacy nested runtime object is not supported", path)
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
		return FileConfig{}, fmt.Errorf("parse runtime config file %q: %w", path, err)
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
		jwksURL := strings.TrimSpace(fileCfg.Auth.JWT.JWKSURL)
		if jwksURL != "" {
			parsed, err := url.Parse(jwksURL)
			if err != nil {
				return fmt.Errorf("auth.jwt.jwksUrl invalid: %w", err)
			}
			if parsed.Scheme != "http" && parsed.Scheme != "https" {
				return fmt.Errorf("auth.jwt.jwksUrl must use http/https scheme")
			}
			if strings.TrimSpace(parsed.Host) == "" {
				return fmt.Errorf("auth.jwt.jwksUrl must include host")
			}
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
