package modelregistry

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	defaultRegistryRelativePath = ".nimi/runtime/model-registry.json"
)

type persistedRegistry struct {
	SchemaVersion int              `json:"schemaVersion"`
	SavedAt       string           `json:"savedAt"`
	Entries       []persistedEntry `json:"entries"`
}

type persistedEntry struct {
	ModelID      string   `json:"modelId"`
	Version      string   `json:"version"`
	Status       int32    `json:"status"`
	Capabilities []string `json:"capabilities"`
	Files        []string `json:"files,omitempty"`
	LastHealthAt string   `json:"lastHealthAt,omitempty"`
	Source       string   `json:"source,omitempty"`
	ProviderHint string   `json:"providerHint,omitempty"`
}

// ResolvePersistencePath resolves the registry persistence path.
// Priority: env NIMI_RUNTIME_MODEL_REGISTRY_PATH -> ~/.nimi/runtime/model-registry.json.
func ResolvePersistencePath() string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_MODEL_REGISTRY_PATH")); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultRegistryRelativePath)
}

// NewFromFile loads registry content from disk. Missing file returns empty registry.
func NewFromFile(path string) (*Registry, error) {
	registry := New()
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return registry, nil
	}

	payload, err := os.ReadFile(trimmed)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return registry, nil
		}
		return nil, err
	}
	if len(payload) == 0 {
		return registry, nil
	}

	var decoded persistedRegistry
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil, err
	}

	for _, item := range decoded.Entries {
		if strings.TrimSpace(item.ModelID) == "" {
			continue
		}
		lastHealthAt := time.Time{}
		if item.LastHealthAt != "" {
			parsed, err := time.Parse(time.RFC3339Nano, item.LastHealthAt)
			if err == nil {
				lastHealthAt = parsed.UTC()
			}
		}
		registry.Upsert(Entry{
			ModelID:      strings.TrimSpace(item.ModelID),
			Version:      strings.TrimSpace(item.Version),
			Status:       normalizePersistedModelStatus(item.Status),
			Capabilities: append([]string(nil), item.Capabilities...),
			Files:        append([]string(nil), item.Files...),
			LastHealthAt: lastHealthAt,
			Source:       strings.TrimSpace(item.Source),
			ProviderHint: ProviderHint(strings.TrimSpace(item.ProviderHint)),
		})
	}
	return registry, nil
}

// SaveToFile persists the current registry snapshot to disk atomically.
func (r *Registry) SaveToFile(path string) error {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return nil
	}

	entries := r.List()
	persisted := persistedRegistry{
		SchemaVersion: 1,
		SavedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Entries:       make([]persistedEntry, 0, len(entries)),
	}
	for _, item := range entries {
		entry := persistedEntry{
			ModelID:      item.ModelID,
			Version:      item.Version,
			Status:       int32(item.Status),
			Capabilities: append([]string(nil), item.Capabilities...),
			Files:        append([]string(nil), item.Files...),
			Source:       item.Source,
			ProviderHint: string(item.ProviderHint),
		}
		if !item.LastHealthAt.IsZero() {
			entry.LastHealthAt = item.LastHealthAt.UTC().Format(time.RFC3339Nano)
		}
		persisted.Entries = append(persisted.Entries, entry)
	}

	payload, err := json.MarshalIndent(persisted, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(trimmed), 0o755); err != nil {
		return err
	}

	tempPath := trimmed + ".tmp." + strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
	if err := os.WriteFile(tempPath, payload, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tempPath, trimmed); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	return nil
}

func normalizePersistedModelStatus(value int32) runtimev1.ModelStatus {
	switch runtimev1.ModelStatus(value) {
	case runtimev1.ModelStatus_MODEL_STATUS_UNSPECIFIED,
		runtimev1.ModelStatus_MODEL_STATUS_PULLING,
		runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		runtimev1.ModelStatus_MODEL_STATUS_FAILED,
		runtimev1.ModelStatus_MODEL_STATUS_REMOVED:
		return runtimev1.ModelStatus(value)
	default:
		return runtimev1.ModelStatus_MODEL_STATUS_UNSPECIFIED
	}
}
