package aiconfig

import (
	"context"
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
	ref              string
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
	name      string
	isDefault bool
	config    *runtimev1.AIConfig
	revision  uint64
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{rows: make(map[storeKey]memoryRow)}
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
