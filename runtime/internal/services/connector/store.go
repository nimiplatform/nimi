package connector

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

const (
	registryFileName    = "connector-registry.json"
	legacyCredentialDir = "credentials"
)

var errConnectorLimitExceeded = errors.New("connector limit exceeded")

func countsTowardManagedConnectorLimit(record ConnectorRecord) bool {
	if record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
		return false
	}
	if record.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER {
		return true
	}
	return record.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM && record.OwnerID == "machine"
}

// ConnectorRecord is the persistent representation of a connector.
type ConnectorRecord struct {
	ConnectorID   string                           `json:"connector_id"`
	Kind          runtimev1.ConnectorKind          `json:"kind"`
	OwnerType     runtimev1.ConnectorOwnerType     `json:"owner_type"`
	OwnerID       string                           `json:"owner_id"`
	Provider      string                           `json:"provider"`
	Endpoint      string                           `json:"endpoint"`
	Label         string                           `json:"label"`
	Status        runtimev1.ConnectorStatus        `json:"status"`
	LocalCategory runtimev1.LocalConnectorCategory `json:"local_category"`
	HasCredential bool                             `json:"has_credential"`
	CreatedAt     int64                            `json:"created_at"`
	UpdatedAt     int64                            `json:"updated_at"`
	DeletePending bool                             `json:"delete_pending,omitempty"`
}

// ConnectorMutations describes mutable fields for Update.
type ConnectorMutations struct {
	Label    *string
	Endpoint *string
	APIKey   *string
	Status   *runtimev1.ConnectorStatus
}

// ConnectorStore manages connector records and credentials on disk.
type ConnectorStore struct {
	mu            sync.Mutex
	registryPath  string
	legacyCredDir string
	secretStore   connectorSecretStore
}

// NewConnectorStore creates a store rooted at basePath.
func NewConnectorStore(basePath string) *ConnectorStore {
	return newConnectorStore(basePath, newOSKeychainSecretStore())
}

func newConnectorStore(basePath string, secretStore connectorSecretStore) *ConnectorStore {
	return &ConnectorStore{
		registryPath:  filepath.Join(basePath, registryFileName),
		legacyCredDir: filepath.Join(basePath, legacyCredentialDir),
		secretStore:   secretStore,
	}
}

// ResolveBasePath returns the default connector store base path.
func ResolveBasePath() string {
	if raw := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CONNECTOR_STORE_PATH")); raw != "" {
		return raw
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".nimi", "runtime", "connectors")
}

// Load returns all non-delete-pending connector records.
func (s *ConnectorStore) Load() ([]ConnectorRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.loadRegistryLocked()
	if err != nil {
		return nil, err
	}
	result := make([]ConnectorRecord, 0, len(all))
	for _, r := range all {
		if !r.DeletePending {
			result = append(result, r)
		}
	}
	return result, nil
}

// Get returns a single connector by ID.
func (s *ConnectorStore) Get(connectorID string) (ConnectorRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	records, err := s.loadRegistryLocked()
	if err != nil {
		return ConnectorRecord{}, false, err
	}
	for _, r := range records {
		if r.ConnectorID == connectorID && !r.DeletePending {
			return r, true, nil
		}
	}
	return ConnectorRecord{}, false, nil
}

// Create persists a new connector record and its credential secret.
func (s *ConnectorStore) Create(record ConnectorRecord, apiKey string) (ConnectorRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.createLocked(record, apiKey, 0)
}

// CreateWithOwnerLimit persists a new connector while enforcing a per-owner managed-connector limit.
func (s *ConnectorStore) CreateWithOwnerLimit(record ConnectorRecord, apiKey string, maxManagedPerOwner int) (ConnectorRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.createLocked(record, apiKey, maxManagedPerOwner)
}

func (s *ConnectorStore) createLocked(record ConnectorRecord, apiKey string, maxManagedPerOwner int) (ConnectorRecord, error) {
	if record.ConnectorID == "" {
		record.ConnectorID = ulid.Make().String()
	} else if _, err := sanitizeConnectorID(record.ConnectorID); err != nil {
		return ConnectorRecord{}, fmt.Errorf("invalid connector id: %w", err)
	}
	now := time.Now().UnixMilli()
	if record.CreatedAt == 0 {
		record.CreatedAt = now
	}
	if record.UpdatedAt == 0 {
		record.UpdatedAt = now
	}

	records, err := s.loadRegistryLocked()
	if err != nil {
		return ConnectorRecord{}, fmt.Errorf("load registry: %w", err)
	}

	for _, r := range records {
		if r.ConnectorID == record.ConnectorID {
			return ConnectorRecord{}, fmt.Errorf("connector %q already exists", record.ConnectorID)
		}
	}
	if maxManagedPerOwner > 0 &&
		countsTowardManagedConnectorLimit(record) {
		managedCount := 0
		for _, r := range records {
			if r.DeletePending || !countsTowardManagedConnectorLimit(r) ||
				r.OwnerID != record.OwnerID {
				continue
			}
			managedCount++
		}
		if managedCount >= maxManagedPerOwner {
			return ConnectorRecord{}, errConnectorLimitExceeded
		}
	}

	if apiKey != "" {
		if err := s.writeCredentialLocked(record.ConnectorID, apiKey); err != nil {
			return ConnectorRecord{}, fmt.Errorf("write credential: %w", err)
		}
		record.HasCredential = true
	}

	records = append(records, record)
	if err := s.persistRegistryLocked(records); err != nil {
		return ConnectorRecord{}, fmt.Errorf("persist registry: %w", err)
	}
	return record, nil
}

// Update applies mutations to a connector record.
func (s *ConnectorStore) Update(connectorID string, mutations ConnectorMutations) (ConnectorRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	records, err := s.loadRegistryLocked()
	if err != nil {
		return ConnectorRecord{}, fmt.Errorf("load registry: %w", err)
	}

	idx := -1
	for i, r := range records {
		if r.ConnectorID == connectorID && !r.DeletePending {
			idx = i
			break
		}
	}
	if idx == -1 {
		return ConnectorRecord{}, fmt.Errorf("connector %q not found", connectorID)
	}

	rec := &records[idx]

	if mutations.Label != nil {
		rec.Label = *mutations.Label
	}
	if mutations.Endpoint != nil {
		rec.Endpoint = *mutations.Endpoint
	}
	if mutations.Status != nil {
		rec.Status = *mutations.Status
	}
	if mutations.APIKey != nil {
		key := *mutations.APIKey
		if key != "" {
			if err := s.writeCredentialLocked(connectorID, key); err != nil {
				return ConnectorRecord{}, fmt.Errorf("write credential: %w", err)
			}
			rec.HasCredential = true
		} else {
			_ = s.deleteCredentialLocked(connectorID)
			rec.HasCredential = false
		}
	}

	rec.UpdatedAt = time.Now().UnixMilli()

	if err := s.persistRegistryLocked(records); err != nil {
		return ConnectorRecord{}, fmt.Errorf("persist registry: %w", err)
	}
	return *rec, nil
}

// Delete performs three-step compensating delete (CONN-080/081).
func (s *ConnectorStore) Delete(connectorID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	records, err := s.loadRegistryLocked()
	if err != nil {
		return fmt.Errorf("load registry: %w", err)
	}

	idx := -1
	for i, r := range records {
		if r.ConnectorID == connectorID {
			idx = i
			break
		}
	}
	if idx == -1 {
		return nil // idempotent
	}

	// Step 1: mark delete_pending and persist
	records[idx].DeletePending = true
	if err := s.persistRegistryLocked(records); err != nil {
		return fmt.Errorf("mark delete_pending: %w", err)
	}

	// Step 2: delete credential secret (missing = ok)
	_ = s.deleteCredentialLocked(connectorID)

	// Step 3: remove from registry and persist
	records = append(records[:idx], records[idx+1:]...)
	if err := s.persistRegistryLocked(records); err != nil {
		return fmt.Errorf("remove registry entry: %w", err)
	}
	return nil
}

// LoadCredential reads the API key for a connector.
func (s *ConnectorStore) LoadCredential(connectorID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readCredentialLocked(connectorID)
}

// ReconcileStartup performs startup reconciliation:
// 1. Clean up delete_pending residuals
// 2. Sync has_credential flags
// 3. Remove orphan legacy credential files
func (s *ConnectorStore) ReconcileStartup() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	records, err := s.loadRegistryLocked()
	if err != nil {
		return fmt.Errorf("load registry: %w", err)
	}

	dirty := false

	// Remove delete_pending residuals
	filtered := make([]ConnectorRecord, 0, len(records))
	for _, r := range records {
		if r.DeletePending {
			_ = s.deleteCredentialLocked(r.ConnectorID)
			dirty = true
			continue
		}
		filtered = append(filtered, r)
	}
	records = filtered

	// Sync has_credential flag and migrate any legacy on-disk secrets.
	knownIDs := make(map[string]bool, len(records))
	for i := range records {
		r := &records[i]
		knownIDs[r.ConnectorID] = true
		legacyPath, err := s.credentialPath(r.ConnectorID)
		if err != nil {
			return fmt.Errorf("invalid connector id %q: %w", r.ConnectorID, err)
		}
		_, statErr := os.Stat(legacyPath)
		legacyExists := statErr == nil
		hasCred := false
		if r.HasCredential || legacyExists {
			secret, readErr := s.readCredentialLocked(r.ConnectorID)
			if readErr != nil {
				return fmt.Errorf("load credential %q: %w", r.ConnectorID, readErr)
			}
			hasCred = strings.TrimSpace(secret) != ""
		}
		if r.HasCredential != hasCred {
			r.HasCredential = hasCred
			dirty = true
		}
	}

	// Remove orphan legacy credential files after migration.
	if err := s.cleanOrphanCredentialsLocked(knownIDs); err != nil {
		return fmt.Errorf("clean orphan credentials: %w", err)
	}

	if dirty {
		if err := s.persistRegistryLocked(records); err != nil {
			return fmt.Errorf("persist reconciled registry: %w", err)
		}
	}
	return nil
}

// --- internal helpers ---

func (s *ConnectorStore) loadRegistryLocked() ([]ConnectorRecord, error) {
	data, err := os.ReadFile(s.registryPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read registry: %w", err)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		slog.Warn("connector registry file is whitespace-only; treating as empty store", "path", s.registryPath)
		return nil, nil
	}
	var records []ConnectorRecord
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, fmt.Errorf("parse registry: %w", err)
	}
	return records, nil
}

func (s *ConnectorStore) persistRegistryLocked(records []ConnectorRecord) error {
	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal registry: %w", err)
	}
	data = append(data, '\n')
	return atomicWriteFile(s.registryPath, data, 0o600)
}

func (s *ConnectorStore) credentialPath(connectorID string) (string, error) {
	sanitized, err := sanitizeConnectorID(connectorID)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.legacyCredDir, sanitized+".key"), nil
}

func (s *ConnectorStore) writeCredentialLocked(connectorID string, apiKey string) error {
	sanitized, err := sanitizeConnectorID(connectorID)
	if err != nil {
		return fmt.Errorf("resolve credential key: %w", err)
	}
	if err := s.secretStore.Write(sanitized, apiKey); err != nil {
		return err
	}
	legacyPath, err := s.credentialPath(sanitized)
	if err != nil {
		return fmt.Errorf("resolve legacy credential path: %w", err)
	}
	if removeErr := os.Remove(legacyPath); removeErr != nil && !os.IsNotExist(removeErr) {
		return fmt.Errorf("remove legacy credential: %w", removeErr)
	}
	return nil
}

func (s *ConnectorStore) readCredentialLocked(connectorID string) (string, error) {
	sanitized, err := sanitizeConnectorID(connectorID)
	if err != nil {
		return "", fmt.Errorf("resolve credential key: %w", err)
	}

	if secret, ok, err := s.secretStore.Read(sanitized); err != nil {
		return "", err
	} else if ok {
		return secret, nil
	}

	path, err := s.credentialPath(sanitized)
	if err != nil {
		return "", fmt.Errorf("resolve legacy credential path: %w", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("read credential: %w", err)
	}
	secret := string(data)
	if err := s.secretStore.Write(sanitized, secret); err != nil {
		return "", fmt.Errorf("migrate legacy credential: %w", err)
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("remove migrated legacy credential: %w", err)
	}
	return secret, nil
}

func (s *ConnectorStore) deleteCredentialLocked(connectorID string) error {
	sanitized, err := sanitizeConnectorID(connectorID)
	if err != nil {
		return fmt.Errorf("resolve credential key: %w", err)
	}
	if err := s.secretStore.Delete(sanitized); err != nil {
		return err
	}
	path, err := s.credentialPath(sanitized)
	if err != nil {
		return fmt.Errorf("resolve legacy credential path: %w", err)
	}
	err = os.Remove(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete legacy credential: %w", err)
	}
	return nil
}

func sanitizeConnectorID(connectorID string) (string, error) {
	trimmed := strings.TrimSpace(connectorID)
	if trimmed == "" {
		return "", fmt.Errorf("connector id is required")
	}
	if trimmed == "." || trimmed == ".." {
		return "", fmt.Errorf("connector id %q is not allowed", trimmed)
	}
	if trimmed != filepath.Base(trimmed) || strings.Contains(trimmed, "/") || strings.Contains(trimmed, "\\") {
		return "", fmt.Errorf("connector id %q must not contain path separators", trimmed)
	}
	return trimmed, nil
}

func (s *ConnectorStore) cleanOrphanCredentialsLocked(knownIDs map[string]bool) error {
	entries, err := os.ReadDir(s.legacyCredDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".key") {
			continue
		}
		id := strings.TrimSuffix(name, ".key")
		if !knownIDs[id] {
			_ = os.Remove(filepath.Join(s.legacyCredDir, name))
		}
	}
	return nil
}

// atomicWriteFile writes content atomically: temp → fsync → rename → fsync parent dir.
func atomicWriteFile(path string, content []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create directory: %w", err)
	}

	tmpPath := path + ".tmp"
	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}

	if _, err := f.Write(content); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("write temp file: %w", err)
	}

	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("fsync temp file: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("close temp file: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename temp file: %w", err)
	}

	// fsync parent directory for durability
	d, err := os.Open(dir)
	if err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}
