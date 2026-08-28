package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

// openRuntimeAgentTestComposition uses the same post-cut owner topology as
// production: one Runtime persistence backend and one separate Cognition
// Memory owner. Tests that are not about legacy Memory must not reactivate the
// retired Runtime Memory store merely to construct RuntimeAgent.
func openRuntimeAgentTestComposition(t *testing.T, localStatePath string) (*Service, func()) {
	svc, _, closeFn := openRuntimeAgentTestCompositionWithOwner(t, localStatePath)
	return svc, closeFn
}

func openRuntimeAgentTestCompositionWithOwner(t *testing.T, localStatePath string) (*Service, *memoryv1.Core, func()) {
	t.Helper()
	backend, err := runtimepersistence.Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("runtime persistence Open: %v", err)
	}
	owner, err := memoryv1.Open(filepath.Join(filepath.Dir(localStatePath), "cognition-memory-v1-test"))
	if err != nil {
		_ = backend.Close()
		t.Fatalf("Cognition Memory Open: %v", err)
	}
	svc, err := NewWithBackend(nil, localStatePath, backend)
	if err != nil {
		_ = owner.Close()
		_ = backend.Close()
		t.Fatalf("runtimeagent.NewWithBackend: %v", err)
	}
	store := cognitionmemory.NewStore(backend)
	bridge := cognitionmemory.NewBridge(store, owner, svc.AuthorizeCognitionMemoryBinding)
	facade := cognitionmemory.NewFacade(
		store,
		owner,
		bridge,
		svc.AuthorizeCognitionMemoryBinding,
		func(context.Context, cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
			return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
		},
	)
	termination := cognitionmemory.NewTerminationService(store, owner)
	if err := svc.ConfigureCognitionMemory(store, bridge, facade, termination); err != nil {
		svc.Close()
		_ = owner.Close()
		_ = backend.Close()
		t.Fatalf("ConfigureCognitionMemory: %v", err)
	}
	svc.SetSourceCognitionBridge(&sourceCognitionBridgeStub{})
	closeFn := func() {
		svc.Close()
		_ = owner.Close()
		_ = backend.Close()
	}
	return svc, owner, closeFn
}
