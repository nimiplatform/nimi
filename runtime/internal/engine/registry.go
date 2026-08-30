package engine

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// RegistryEntry records a managed engine binary.
type RegistryEntry struct {
	Engine             EngineKind        `json:"engine"`
	Version            string            `json:"version"`
	BinaryPath         string            `json:"binary_path"`
	SHA256             string            `json:"sha256,omitempty"`
	BinarySHA256       string            `json:"binary_sha256,omitempty"`
	AudioCppFileSHA256 map[string]string `json:"audio_cpp_file_sha256,omitempty"`
	Platform           string            `json:"platform"`
	AssetName          string            `json:"asset_name,omitempty"`
	AcceleratorPlane   string            `json:"accelerator_plane,omitempty"`
	InstalledAt        string            `json:"installed_at"`
}

// Registry manages the on-disk engine binary inventory.
type Registry struct {
	mu              sync.RWMutex
	path            string
	root            string
	entries         map[string]*RegistryEntry // key: "engine/version"
	pendingRebases  map[string]struct{}
	conflictEntries map[string][]*RegistryEntry
	loadConflict    string
}

type RegistryConflict struct {
	Reference string
	Reason    string
}

// NewRegistry creates or loads a registry from the given directory.
// The registry file is stored at dir/registry.json.
func NewRegistry(dir string) (*Registry, error) {
	path := filepath.Join(dir, "registry.json")
	r := &Registry{
		path:            path,
		root:            filepath.Clean(dir),
		entries:         make(map[string]*RegistryEntry),
		pendingRebases:  make(map[string]struct{}),
		conflictEntries: make(map[string][]*RegistryEntry),
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
		r.loadConflict = "ENGINE_REGISTRY_DOCUMENT_INVALID"
		return r, nil
	}
	grouped := make(map[string][]*RegistryEntry)
	for _, e := range entries {
		if e == nil {
			r.loadConflict = "ENGINE_REGISTRY_ENTRY_INVALID"
			continue
		}
		key := registryKey(e.Engine, e.Version)
		grouped[key] = append(grouped[key], cloneRegistryEntry(e))
	}
	for key, candidates := range grouped {
		if len(candidates) != 1 {
			r.conflictEntries[key] = candidates
			continue
		}
		e := cloneRegistryEntry(candidates[0])
		resolved, changed, resolveErr := resolveRegistryBinaryPath(r.root, e)
		if resolveErr != nil {
			r.conflictEntries[key] = candidates
			continue
		}
		e.BinaryPath = resolved
		if changed {
			r.pendingRebases[key] = struct{}{}
		}
		r.entries[key] = e
	}
	return r, nil
}

func (r *Registry) Conflicts() []RegistryConflict {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]RegistryConflict, 0, len(r.conflictEntries)+1)
	if r.loadConflict != "" {
		result = append(result, RegistryConflict{Reference: "registry.json", Reason: r.loadConflict})
	}
	for key := range r.conflictEntries {
		result = append(result, RegistryConflict{Reference: key, Reason: "ENGINE_REGISTRY_IDENTITY_CONFLICT"})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Reference < result[j].Reference })
	return result
}

// commitPendingRebases persists loader-resolved legacy locators only from the
// Check & Sync owner pass. The returned keys remain available for explicit
// change=rebased reporting even after the durable write succeeds.
func (r *Registry) commitPendingRebases() (map[string]struct{}, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	pending := make(map[string]struct{}, len(r.pendingRebases))
	for key := range r.pendingRebases {
		pending[key] = struct{}{}
	}
	if len(pending) == 0 {
		return pending, nil
	}
	if err := r.persist(); err != nil {
		return pending, err
	}
	r.pendingRebases = make(map[string]struct{})
	return pending, nil
}

// Get returns the registry entry for the given engine and version, or nil.
func (r *Registry) Get(engine EngineKind, version string) *RegistryEntry {
	r.mu.RLock()
	defer r.mu.RUnlock()
	key := registryKey(engine, version)
	if _, pending := r.pendingRebases[key]; pending {
		return nil
	}
	return cloneRegistryEntry(r.entries[key])
}

func (r *Registry) PendingRebase(engine EngineKind, version string) bool {
	if r == nil {
		return false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, pending := r.pendingRebases[registryKey(engine, version)]
	return pending
}

// ConflictReason reports an owner-scoped registry conflict without collapsing
// it into a missing entry. Materializers use this before any download or
// promotion so ambiguous inventory remains inert until Check & Sync reports it.
func (r *Registry) ConflictReason(engine EngineKind, version string) string {
	if r == nil {
		return "ENGINE_REGISTRY_UNAVAILABLE"
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.loadConflict != "" {
		return r.loadConflict
	}
	if _, conflict := r.conflictEntries[registryKey(engine, version)]; conflict {
		return "ENGINE_REGISTRY_IDENTITY_CONFLICT"
	}
	return ""
}

// Put stores or updates a registry entry and persists to disk.
func (r *Registry) Put(entry *RegistryEntry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.pendingRebases) > 0 {
		return errors.New("engine registry requires Check & Sync reconciliation before mutation")
	}
	if r.loadConflict != "" {
		return errors.New("engine registry document requires owner reconciliation")
	}

	cloned := cloneRegistryEntry(entry)
	if cloned == nil {
		return errors.New("engine registry entry is required")
	}
	if _, conflict := r.conflictEntries[registryKey(cloned.Engine, cloned.Version)]; conflict {
		return errors.New("engine registry identity requires owner reconciliation")
	}
	if strings.TrimSpace(cloned.BinaryPath) != "" {
		resolved, changed, err := resolveRegistryBinaryPath(r.root, cloned)
		if err != nil || !filepath.IsAbs(resolved) || changed {
			return fmt.Errorf("engine registry binary must match its owner identity and fixed environments layout")
		}
		cloned.BinaryPath = resolved
	}
	key := registryKey(cloned.Engine, cloned.Version)
	previous, existed := r.entries[key]
	r.entries[key] = cloned
	if err := r.persist(); err != nil {
		if existed {
			r.entries[key] = previous
		} else {
			delete(r.entries, key)
		}
		return err
	}
	return nil
}

// Remove deletes a registry entry and persists to disk.
func (r *Registry) Remove(engine EngineKind, version string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.pendingRebases) > 0 {
		return errors.New("engine registry requires Check & Sync reconciliation before mutation")
	}
	if r.loadConflict != "" {
		return errors.New("engine registry document requires owner reconciliation")
	}
	if _, conflict := r.conflictEntries[registryKey(engine, version)]; conflict {
		return errors.New("engine registry identity requires owner reconciliation")
	}

	key := registryKey(engine, version)
	previous, existed := r.entries[key]
	delete(r.entries, key)
	if err := r.persist(); err != nil {
		if existed {
			r.entries[key] = previous
		}
		return err
	}
	return nil
}

// List returns all registry entries.
func (r *Registry) List() []*RegistryEntry {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]*RegistryEntry, 0, len(r.entries))
	for _, e := range r.entries {
		result = append(result, cloneRegistryEntry(e))
	}
	return result
}

func cloneRegistryEntry(entry *RegistryEntry) *RegistryEntry {
	if entry == nil {
		return nil
	}
	cloned := *entry
	if entry.AudioCppFileSHA256 != nil {
		cloned.AudioCppFileSHA256 = make(map[string]string, len(entry.AudioCppFileSHA256))
		for name, digest := range entry.AudioCppFileSHA256 {
			cloned.AudioCppFileSHA256[name] = digest
		}
	}
	return &cloned
}

func (r *Registry) persist() error {
	if r.loadConflict != "" {
		return errors.New("engine registry document requires owner reconciliation")
	}
	entries := make([]*RegistryEntry, 0, len(r.entries))
	for _, e := range r.entries {
		cloned := cloneRegistryEntry(e)
		if strings.TrimSpace(cloned.BinaryPath) != "" {
			relative, err := filepath.Rel(r.root, cloned.BinaryPath)
			if err != nil || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
				return fmt.Errorf("engine registry binary escaped environments root")
			}
			cloned.BinaryPath = filepath.ToSlash(relative)
		}
		entries = append(entries, cloned)
	}
	for _, conflicts := range r.conflictEntries {
		for _, entry := range conflicts {
			entries = append(entries, cloneRegistryEntry(entry))
		}
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

func resolveRegistryBinaryPath(root string, entry *RegistryEntry) (string, bool, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if entry == nil {
		return "", false, errors.New("engine registry entry is required")
	}
	expected, known, err := registryBinaryPathForOwnerIdentity(root, entry.Engine, entry.Version)
	if err != nil {
		return "", false, err
	}
	value := strings.TrimSpace(entry.BinaryPath)
	if !known {
		if value == "" {
			return "", false, nil
		}
		// Registry identities without an owner-defined layout are retained as
		// inventory intent, but their private path cannot be reinterpreted.
		return "", true, nil
	}
	if value == "" {
		return expected, true, nil
	}
	if !filepath.IsAbs(value) {
		cleaned := filepath.Clean(filepath.FromSlash(value))
		if cleaned == "." || cleaned == ".." || filepath.IsAbs(cleaned) || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
			return "", false, errors.New("engine registry binary locator is invalid")
		}
		resolved := filepath.Join(root, cleaned)
		return expected, !sameManagedPath(resolved, expected), nil
	}
	cleaned := filepath.Clean(value)
	return expected, !sameManagedPath(cleaned, expected), nil
}

func registryBinaryPathForOwnerIdentity(root string, kind EngineKind, version string) (string, bool, error) {
	version = strings.TrimSpace(version)
	if version == "" || version == "." || version == ".." || filepath.Base(version) != version || strings.ContainsAny(version, `/\`) {
		return "", false, errors.New("engine registry version identity is invalid")
	}
	switch kind {
	case EngineLlama:
		return filepath.Join(root, string(EngineLlama), version, llamaBinaryName()), true, nil
	case EngineAudioCPP:
		return filepath.Join(root, string(EngineAudioCPP), version, AudioCppCLIExecutableName), true, nil
	default:
		return "", false, nil
	}
}

func verifyLlamaRegistryEntryForCurrentHost(entry *RegistryEntry, preferredAssetName string) error {
	if entry == nil || entry.Engine != EngineLlama || strings.TrimSpace(entry.Version) == "" {
		return errors.New("llama registry owner identity is incomplete")
	}
	if !strings.EqualFold(strings.TrimSpace(entry.Platform), currentGOOS()+"/"+currentGOARCH()) {
		return errors.New("llama registry platform does not match the current host")
	}
	if strings.TrimSpace(entry.AssetName) == "" || strings.TrimSpace(entry.AssetName) != strings.TrimSpace(preferredAssetName) {
		return errors.New("llama registry release asset does not match the current host")
	}
	if strings.TrimSpace(entry.AcceleratorPlane) != llamaAcceleratorPlaneForAsset(entry.AssetName) {
		return errors.New("llama registry accelerator identity is incomplete")
	}
	digest := strings.ToLower(strings.TrimSpace(entry.SHA256))
	decoded, err := hex.DecodeString(digest)
	if err != nil || len(decoded) != 32 {
		return errors.New("llama registry binary SHA-256 evidence is incomplete")
	}
	info, err := os.Lstat(strings.TrimSpace(entry.BinaryPath))
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("llama registry binary is unavailable")
	}
	actual, err := sha256File(entry.BinaryPath)
	if err != nil || !strings.EqualFold(actual, digest) {
		return errors.New("llama registry binary SHA-256 evidence does not match")
	}
	return nil
}

func registryKey(engine EngineKind, version string) string {
	return string(engine) + "/" + version
}
