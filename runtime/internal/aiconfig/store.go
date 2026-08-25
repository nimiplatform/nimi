package aiconfig

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/proto"
)

var (
	ErrBackendRequired        = errors.New("AIConfig persistence backend is required")
	ErrInvalidPersistedConfig = errors.New("persisted AIConfig is invalid")
)

const InitialRevision = "0"

// Store owns complete current AIConfig values. Overwrite replaces the whole
// value for one account namespace and owner; no partial mutation is exposed.
type Store interface {
	Get(context.Context, string, *runtimev1.AIConfigOwner) (*runtimev1.AIConfig, string, bool, error)
	Overwrite(context.Context, string, string, *runtimev1.AIConfig) (*runtimev1.AIConfig, string, bool, error)
}

type storeKey struct {
	accountNamespace string
	ownerKind        int32
	ownerID          string
}

const (
	storeOwnerKindApp                        int32 = 1
	storeOwnerKindRuntimeLocalAgentSubsystem int32 = 2
	runtimeLocalAgentSubsystemStorageOwnerID       = "runtime.local-agent-subsystem"
)

type MemoryStore struct {
	mu   sync.RWMutex
	rows map[storeKey]memoryRow
}

type memoryRow struct {
	config   *runtimev1.AIConfig
	revision uint64
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{rows: make(map[storeKey]memoryRow)}
}

func (s *MemoryStore) Get(_ context.Context, accountNamespace string, owner *runtimev1.AIConfigOwner) (*runtimev1.AIConfig, string, bool, error) {
	key, err := canonicalStoreKey(accountNamespace, owner)
	if err != nil {
		return nil, "", false, err
	}
	s.mu.RLock()
	stored, found := s.rows[key]
	s.mu.RUnlock()
	if !found {
		return nil, InitialRevision, false, nil
	}
	return cloneConfig(stored.config), encodeRevision(stored.revision), true, nil
}

func (s *MemoryStore) Overwrite(_ context.Context, accountNamespace string, expectedRevision string, config *runtimev1.AIConfig) (*runtimev1.AIConfig, string, bool, error) {
	canonical, err := Canonicalize(config)
	if err != nil {
		return nil, "", false, err
	}
	key, err := canonicalStoreKey(accountNamespace, canonical.GetOwner())
	if err != nil {
		return nil, "", false, err
	}
	expected, err := parseRevision(expectedRevision)
	if err != nil {
		return nil, "", false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	current, found := s.rows[key]
	if found && current.revision != expected {
		return cloneConfig(current.config), encodeRevision(current.revision), false, nil
	}
	if !found && expected != 0 {
		return nil, InitialRevision, false, nil
	}
	if found && proto.Equal(current.config, canonical) {
		return cloneConfig(current.config), encodeRevision(current.revision), true, nil
	}
	next := expected + 1
	if next == 0 {
		return nil, "", false, fmt.Errorf("AIConfig revision overflow")
	}
	s.rows[key] = memoryRow{config: canonical, revision: next}
	return cloneConfig(canonical), encodeRevision(next), true, nil
}

type SQLiteStore struct {
	backend *runtimepersistence.Backend
}

func NewSQLiteStore(backend *runtimepersistence.Backend) (*SQLiteStore, error) {
	if backend == nil {
		return nil, ErrBackendRequired
	}
	return &SQLiteStore{backend: backend}, nil
}

func (s *SQLiteStore) Get(ctx context.Context, accountNamespace string, owner *runtimev1.AIConfigOwner) (*runtimev1.AIConfig, string, bool, error) {
	key, err := canonicalStoreKey(accountNamespace, owner)
	if err != nil {
		return nil, "", false, err
	}
	var raw []byte
	var revision uint64
	err = s.backend.DB().QueryRowContext(ctx, `
		SELECT config_blob, revision
		FROM runtime_ai_config
		WHERE account_namespace = ? AND owner_kind = ? AND owner_id = ?
	`, key.accountNamespace, key.ownerKind, key.ownerID).Scan(&raw, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, InitialRevision, false, nil
	}
	if err != nil {
		return nil, "", false, fmt.Errorf("read AIConfig: %w", err)
	}
	if revision == 0 {
		return nil, "", false, invalidPersistedConfig("zero revision")
	}
	config := &runtimev1.AIConfig{}
	if err := proto.Unmarshal(raw, config); err != nil {
		return nil, "", false, invalidPersistedConfig("decode AIConfig: %v", err)
	}
	canonical, err := Canonicalize(config)
	if err != nil {
		return nil, "", false, invalidPersistedConfig("validate AIConfig: %v", err)
	}
	persistedKey, err := canonicalStoreKey(key.accountNamespace, canonical.GetOwner())
	if err != nil {
		return nil, "", false, invalidPersistedConfig("validate AIConfig owner: %v", err)
	}
	if persistedKey != key {
		return nil, "", false, invalidPersistedConfig("owner does not match storage key")
	}
	return canonical, encodeRevision(revision), true, nil
}

func (s *SQLiteStore) Overwrite(ctx context.Context, accountNamespace string, expectedRevision string, config *runtimev1.AIConfig) (*runtimev1.AIConfig, string, bool, error) {
	canonical, err := Canonicalize(config)
	if err != nil {
		return nil, "", false, err
	}
	key, err := canonicalStoreKey(accountNamespace, canonical.GetOwner())
	if err != nil {
		return nil, "", false, err
	}
	expected, err := parseRevision(expectedRevision)
	if err != nil {
		return nil, "", false, err
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(canonical)
	if err != nil {
		return nil, "", false, fmt.Errorf("encode AIConfig: %w", err)
	}
	var resultConfig *runtimev1.AIConfig
	var resultRevision uint64
	committed := false
	if err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var currentRaw []byte
		var currentRevision uint64
		err := tx.QueryRowContext(ctx, `
			SELECT config_blob, revision FROM runtime_ai_config
			WHERE account_namespace = ? AND owner_kind = ? AND owner_id = ?
		`, key.accountNamespace, key.ownerKind, key.ownerID).Scan(&currentRaw, &currentRevision)
		if errors.Is(err, sql.ErrNoRows) {
			if expected != 0 {
				resultRevision = 0
				return nil
			}
		} else if err != nil {
			return err
		} else {
			if currentRevision == 0 {
				return invalidPersistedConfig("zero revision")
			}
			current := &runtimev1.AIConfig{}
			if err := proto.Unmarshal(currentRaw, current); err != nil {
				return invalidPersistedConfig("decode current AIConfig: %v", err)
			}
			currentCanonical, err := Canonicalize(current)
			if err != nil {
				return invalidPersistedConfig("validate current AIConfig: %v", err)
			}
			resultConfig = currentCanonical
			resultRevision = currentRevision
			if currentRevision != expected {
				return nil
			}
			if proto.Equal(currentCanonical, canonical) {
				committed = true
				return nil
			}
		}
		next := expected + 1
		if next == 0 {
			return fmt.Errorf("AIConfig revision overflow")
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO runtime_ai_config(account_namespace, owner_kind, owner_id, config_blob, revision)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(account_namespace, owner_kind, owner_id)
			DO UPDATE SET config_blob = excluded.config_blob, revision = excluded.revision
		`, key.accountNamespace, key.ownerKind, key.ownerID, raw, next)
		if err != nil {
			return err
		}
		resultConfig = canonical
		resultRevision = next
		committed = true
		return nil
	}); err != nil {
		return nil, "", false, fmt.Errorf("overwrite AIConfig: %w", err)
	}
	return cloneConfig(resultConfig), encodeRevision(resultRevision), committed, nil
}

func invalidPersistedConfig(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidPersistedConfig, fmt.Sprintf(format, args...))
}

func parseRevision(value string) (uint64, error) {
	if value == "" || (len(value) > 1 && value[0] == '0') {
		return 0, fmt.Errorf("AIConfig expected revision is invalid")
	}
	revision, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("AIConfig expected revision is invalid")
	}
	return revision, nil
}

func encodeRevision(value uint64) string {
	return strconv.FormatUint(value, 10)
}

func canonicalStoreKey(accountNamespace string, owner *runtimev1.AIConfigOwner) (storeKey, error) {
	if err := requireExactNonEmpty("account namespace", accountNamespace); err != nil {
		return storeKey{}, err
	}
	if err := validateOwner(owner); err != nil {
		return storeKey{}, err
	}
	var ownerKind int32
	var ownerID string
	switch typed := owner.GetOwner().(type) {
	case *runtimev1.AIConfigOwner_App:
		ownerKind = storeOwnerKindApp
		ownerID = typed.App.GetAppId()
	case *runtimev1.AIConfigOwner_RuntimeLocalAgentSubsystem:
		ownerKind = storeOwnerKindRuntimeLocalAgentSubsystem
		ownerID = runtimeLocalAgentSubsystemStorageOwnerID
	default:
		return storeKey{}, fmt.Errorf("AIConfig owner kind must be App or shared LocalAgent")
	}
	return storeKey{
		accountNamespace: accountNamespace,
		ownerKind:        ownerKind,
		ownerID:          ownerID,
	}, nil
}

func cloneConfig(config *runtimev1.AIConfig) *runtimev1.AIConfig {
	if config == nil {
		return nil
	}
	cloned, _ := proto.Clone(config).(*runtimev1.AIConfig)
	return cloned
}
