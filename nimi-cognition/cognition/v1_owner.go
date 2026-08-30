package cognition

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

// V1Owner is the production LocalAgent Cognition composition. Its durable
// surface is limited to canonical Memory and snapshot-bound Agent Source.
type V1Owner struct {
	memoryCore            *memoryv1.Core
	sourceStore           *storage.SQLiteBackend
	sourceBridge          *RuntimeSourceBridge
	memoryInitiallyAbsent bool
	sourceInitiallyAbsent bool
	freshOwnerRoot        bool
}

type V1OwnerResourceInspection struct {
	Kind   string
	Status string
	Reason string
}

type V1OwnerInspection struct {
	Resources []V1OwnerResourceInspection
}

// @nimi-authority: definition.nimi.cognition.runtime-bridge.domain
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r002
// @nimi-authority: rule.nimi.cognition.memory.r001
func NewV1Owner(rootDir string) (*V1Owner, error) {
	if strings.TrimSpace(rootDir) == "" {
		return nil, errors.New("cognition V1 owner: root directory is required")
	}
	memoryPresent, err := ownerStoreFilePresent(filepath.Join(rootDir, "cognition-memory-v1.sqlite3"))
	if err != nil {
		return nil, fmt.Errorf("cognition V1 owner: inspect Memory store: %w", err)
	}
	sourcePresent, err := ownerStoreFilePresent(filepath.Join(rootDir, "cognition-agent-source-v1.sqlite3"))
	if err != nil {
		return nil, fmt.Errorf("cognition V1 owner: inspect Agent Source store: %w", err)
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
		memoryCore:            memoryCore,
		sourceStore:           sourceStore,
		memoryInitiallyAbsent: !memoryPresent,
		sourceInitiallyAbsent: !sourcePresent,
		freshOwnerRoot:        !memoryPresent && !sourcePresent,
		sourceBridge: &RuntimeSourceBridge{
			store: sourceStore,
			now:   time.Now,
		},
	}, nil
}

func ownerStoreFilePresent(path string) (bool, error) {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() {
		return false, errors.New("owner store path is not a regular file")
	}
	return true, nil
}

// InspectStore projects only aggregate owner health. Raw Memory, source,
// Account, Agent, and snapshot identities remain inside their current owners.
func (o *V1Owner) InspectStore(ctx context.Context) (V1OwnerInspection, error) {
	if o == nil || o.memoryCore == nil || o.sourceStore == nil {
		return V1OwnerInspection{}, errors.New("cognition V1 owner: store unavailable")
	}
	memory, err := o.memoryCore.InspectStore(ctx)
	if err != nil {
		return V1OwnerInspection{}, fmt.Errorf("cognition V1 owner: inspect Memory store: %w", err)
	}
	source, err := o.sourceStore.InspectRuntimeSourceStore(ctx)
	if err != nil {
		return V1OwnerInspection{}, fmt.Errorf("cognition V1 owner: inspect Agent Source store: %w", err)
	}
	memoryReason := "COGNITION_MEMORY_OWNER_STORE_REOPENED"
	memoryStatus := "available"
	if o.memoryInitiallyAbsent && !o.freshOwnerRoot {
		memoryStatus = "unavailable"
		memoryReason = "COGNITION_MEMORY_OWNER_FILE_MISSING"
	} else if memory.Empty {
		memoryReason = "COGNITION_MEMORY_OWNER_STORE_EMPTY"
	}
	sourceReason := "COGNITION_SOURCE_OWNER_STORE_REOPENED"
	sourceStatus := "available"
	if o.sourceInitiallyAbsent && !o.freshOwnerRoot {
		sourceStatus = "unavailable"
		sourceReason = "COGNITION_SOURCE_OWNER_FILE_MISSING"
	} else if source.Empty {
		sourceReason = "COGNITION_SOURCE_OWNER_STORE_EMPTY"
	}
	return V1OwnerInspection{Resources: []V1OwnerResourceInspection{
		{Kind: "cognition_memory", Status: memoryStatus, Reason: memoryReason},
		{Kind: "agent_source", Status: sourceStatus, Reason: sourceReason},
	}}, nil
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
