package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// RegistryEntry records a managed engine binary.
type RegistryEntry struct {
	Engine     EngineKind `json:"engine"`
	Version    string     `json:"version"`
	BinaryPath string     `json:"binary_path"`
	SHA256     string     `json:"sha256,omitempty"`
	Platform   string     `json:"platform"`
	InstalledAt string    `json:"installed_at"`
}

// Registry manages the on-disk engine binary inventory.
type Registry struct {
	mu      sync.RWMutex
	path    string
	entries map[string]*RegistryEntry // key: "engine/version"
}

// NewRegistry creates or loads a registry from the given directory.
// The registry file is stored at dir/registry.json.
func NewRegistry(dir string) (*Registry, error) {
	path := filepath.Join(dir, "registry.json")
	r := &Registry{
		path:    path,
		entries: make(map[string]*RegistryEntry),
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return r, nil
		}
		return nil, fmt.Errorf("read engine registry: %w", err)
	}

	if len(data) == 0 {
		return r, nil
	}

	var entries []*RegistryEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, fmt.Errorf("parse engine registry: %w", err)
	}

	for _, e := range entries {
		r.entries[registryKey(e.Engine, e.Version)] = e
	}
	return r, nil
}

// Get returns the registry entry for the given engine and version, or nil.
func (r *Registry) Get(engine EngineKind, version string) *RegistryEntry {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.entries[registryKey(engine, version)]
}

// Put stores or updates a registry entry and persists to disk.
func (r *Registry) Put(entry *RegistryEntry) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.entries[registryKey(entry.Engine, entry.Version)] = entry
	return r.persist()
}

// Remove deletes a registry entry and persists to disk.
func (r *Registry) Remove(engine EngineKind, version string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.entries, registryKey(engine, version))
	return r.persist()
}

// List returns all registry entries.
func (r *Registry) List() []*RegistryEntry {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]*RegistryEntry, 0, len(r.entries))
	for _, e := range r.entries {
		result = append(result, e)
	}
	return result
}

func (r *Registry) persist() error {
	entries := make([]*RegistryEntry, 0, len(r.entries))
	for _, e := range r.entries {
		entries = append(entries, e)
	}

	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal engine registry: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(r.path), 0o755); err != nil {
		return fmt.Errorf("create engine registry directory: %w", err)
	}

	tmpPath := r.path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return fmt.Errorf("write engine registry temp: %w", err)
	}
	if err := os.Rename(tmpPath, r.path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename engine registry: %w", err)
	}
	return nil
}

func registryKey(engine EngineKind, version string) string {
	return string(engine) + "/" + version
}
