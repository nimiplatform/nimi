package cognition

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

// V1Owner is the production LocalAgent Cognition composition. Its durable
// surface is limited to canonical Memory and snapshot-bound Agent Source.
type V1Owner struct {
	memoryCore   *memoryv1.Core
	sourceStore  *storage.SQLiteBackend
	sourceBridge *RuntimeSourceBridge
}

// @nimi-authority: definition.nimi.cognition.runtime-bridge.domain
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r002
// @nimi-authority: rule.nimi.cognition.memory.r001
func NewV1Owner(rootDir string) (*V1Owner, error) {
	if strings.TrimSpace(rootDir) == "" {
		return nil, errors.New("cognition V1 owner: root directory is required")
	}
	memoryCore, err := memoryv1.Open(rootDir)
	if err != nil {
		return nil, fmt.Errorf("cognition V1 owner: open Memory: %w", err)
	}
	sourceStore, err := storage.NewRuntimeSourceBackend(rootDir)
	if err != nil {
		_ = memoryCore.Close()
		return nil, fmt.Errorf("cognition V1 owner: open Agent Source: %w", err)
	}
	return &V1Owner{
		memoryCore:  memoryCore,
		sourceStore: sourceStore,
		sourceBridge: &RuntimeSourceBridge{
			store: sourceStore,
			now:   time.Now,
		},
	}, nil
}

func (o *V1Owner) MemoryCore() *memoryv1.Core {
	if o == nil {
		return nil
	}
	return o.memoryCore
}

func (o *V1Owner) SourceBridge() *RuntimeSourceBridge {
	if o == nil {
		return nil
	}
	return o.sourceBridge
}

func (o *V1Owner) Close() error {
	if o == nil {
		return nil
	}
	var sourceErr error
	if o.sourceStore != nil {
		sourceErr = o.sourceStore.Close()
	}
	var memoryErr error
	if o.memoryCore != nil {
		memoryErr = o.memoryCore.Close()
	}
	return errors.Join(sourceErr, memoryErr)
}
