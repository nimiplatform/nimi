package aiconfig

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/proto"
)

var ErrBackendRequired = errors.New("AIConfig persistence backend is required")

// Store owns complete current AIConfig values. Overwrite replaces the whole
// value for one account namespace and owner; no partial mutation is exposed.
type Store interface {
	Get(context.Context, string, *runtimev1.AIConfigOwner) (*runtimev1.AIConfig, bool, error)
	Overwrite(context.Context, string, *runtimev1.AIConfig) error
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
	rows map[storeKey]*runtimev1.AIConfig
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{rows: make(map[storeKey]*runtimev1.AIConfig)}
}

func (s *MemoryStore) Get(_ context.Context, accountNamespace string, owner *runtimev1.AIConfigOwner) (*runtimev1.AIConfig, bool, error) {
	key, err := canonicalStoreKey(accountNamespace, owner)
	if err != nil {
		return nil, false, err
	}
	s.mu.RLock()
	stored, found := s.rows[key]
	s.mu.RUnlock()
	if !found {
		return nil, false, nil
	}
	return cloneConfig(stored), true, nil
}

func (s *MemoryStore) Overwrite(_ context.Context, accountNamespace string, config *runtimev1.AIConfig) error {
	canonical, err := Canonicalize(config)
	if err != nil {
		return err
	}
	key, err := canonicalStoreKey(accountNamespace, canonical.GetOwner())
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.rows[key] = canonical
	s.mu.Unlock()
	return nil
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

func (s *SQLiteStore) Get(ctx context.Context, accountNamespace string, owner *runtimev1.AIConfigOwner) (*runtimev1.AIConfig, bool, error) {
	key, err := canonicalStoreKey(accountNamespace, owner)
	if err != nil {
		return nil, false, err
	}
	var raw []byte
	err = s.backend.DB().QueryRowContext(ctx, `
		SELECT config_blob
		FROM runtime_ai_config
		WHERE account_namespace = ? AND owner_kind = ? AND owner_id = ?
	`, key.accountNamespace, key.ownerKind, key.ownerID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("read AIConfig: %w", err)
	}
	config := &runtimev1.AIConfig{}
	if err := proto.Unmarshal(raw, config); err != nil {
		return nil, false, fmt.Errorf("decode AIConfig: %w", err)
	}
	canonical, err := Canonicalize(config)
	if err != nil {
		return nil, false, fmt.Errorf("validate persisted AIConfig: %w", err)
	}
	persistedKey, err := canonicalStoreKey(key.accountNamespace, canonical.GetOwner())
	if err != nil {
		return nil, false, fmt.Errorf("validate persisted AIConfig owner: %w", err)
	}
	if persistedKey != key {
		return nil, false, fmt.Errorf("persisted AIConfig owner does not match storage key")
	}
	return canonical, true, nil
}

func (s *SQLiteStore) Overwrite(ctx context.Context, accountNamespace string, config *runtimev1.AIConfig) error {
	canonical, err := Canonicalize(config)
	if err != nil {
		return err
	}
	key, err := canonicalStoreKey(accountNamespace, canonical.GetOwner())
	if err != nil {
		return err
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(canonical)
	if err != nil {
		return fmt.Errorf("encode AIConfig: %w", err)
	}
	if err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO runtime_ai_config(account_namespace, owner_kind, owner_id, config_blob)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(account_namespace, owner_kind, owner_id)
			DO UPDATE SET config_blob = excluded.config_blob
		`, key.accountNamespace, key.ownerKind, key.ownerID, raw)
		return err
	}); err != nil {
		return fmt.Errorf("overwrite AIConfig: %w", err)
	}
	return nil
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
