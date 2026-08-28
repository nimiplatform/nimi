package cognitionmemory

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

func TestFacadeProcessesCommittedCustodyAndRecallsWithoutRuntimeMemoryStore(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	binding := createTestBinding(t, backend, store, "agent-a", true)
	ctx := context.Background()
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, "agent-a", testEnvelope("event-a", "operation-a", "I prefer jasmine tea"))
		return err
	}); err != nil {
		t.Fatalf("enqueue committed event: %v", err)
	}
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open Cognition owner: %v", err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	authorize := func(context.Context, Binding) error { return nil }
	bridge := NewBridge(store, owner, authorize)
	drained, err := bridge.DrainOne(ctx, "agent-a")
	if err != nil || !drained.Drained || drained.Outcome != memoryv1.OutcomeReceived {
		t.Fatalf("transfer committed custody: result=%+v err=%v", drained, err)
	}
	facade := NewFacade(store, owner, bridge, authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	remembered, err := facade.ProcessRemember(ctx, "agent-a", drained.OperationID)
	if err != nil || remembered.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("process Remember: result=%+v err=%v", remembered, err)
	}
	recalled, err := facade.Recall(ctx, RecallIntent{LocalAgentRef: "agent-a", OperationID: "recall-a", Query: "jasmine tea", Limit: 4})
	if err != nil || recalled.Outcome != memoryv1.OutcomeReady || recalled.Pipeline != memoryv1.PipelineRecallFTS || len(recalled.Hits) != 1 {
		t.Fatalf("Runtime-mediated Recall: result=%+v err=%v", recalled, err)
	}
	if recalled.Hits[0].BankRef == "" || recalled.Hits[0].EventRef != "event-a" {
		t.Fatalf("Recall lost opaque bank/provenance binding: %+v", recalled.Hits[0])
	}
	rows, err := store.ListOutbox(ctx, binding.BindingRef)
	if err != nil || len(rows) != 1 || rows[0].PayloadPresent {
		t.Fatalf("Runtime retained committed content after custody: rows=%+v err=%v", rows, err)
	}
	for _, table := range []string{"memory_record", "memory_narrative", "agent_truth"} {
		var count int
		if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
			t.Fatalf("inspect retired Runtime table %s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("retired Runtime table %s must not be created", table)
		}
	}
}

func TestFacadeOptionalRecallFailureAndDisabledStateRemainTyped(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	createTestBinding(t, backend, store, "existing-agent", false)
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open Cognition owner: %v", err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	bridge := NewBridge(store, owner, func(context.Context, Binding) error { return nil })
	facade := NewFacade(store, owner, bridge, func(context.Context, Binding) error { return nil }, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{}, nil, nil
	})
	disabled, err := facade.Recall(context.Background(), RecallIntent{LocalAgentRef: "existing-agent", Query: "anything"})
	if err != nil || disabled.Outcome != memoryv1.OutcomeUnconfigured || len(disabled.Hits) != 0 {
		t.Fatalf("disabled Recall was not typed zero-hit behavior: result=%+v err=%v", disabled, err)
	}
}

func TestFacadeCorrectionDrainsEarlierCommittedFactsBeforeItsOwnOperation(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	createTestBinding(t, backend, store, "agent-a", true)
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open Cognition owner: %v", err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	authorize := func(context.Context, Binding) error { return nil }
	bridge := NewBridge(store, owner, authorize)
	facade := NewFacade(store, owner, bridge, authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	ctx := context.Background()
	enqueue := func(eventRef, operationID, text string) {
		t.Helper()
		if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
			_, err := store.EnqueueCommittedEventTx(tx, "agent-a", testEnvelope(eventRef, operationID, text))
			return err
		}); err != nil {
			t.Fatalf("enqueue %s: %v", operationID, err)
		}
	}
	enqueue("event-base", "operation-base", "I prefer jasmine tea")
	drained, err := bridge.DrainOne(ctx, "agent-a")
	if err != nil {
		t.Fatalf("drain base fact: %v", err)
	}
	base, err := facade.ProcessRemember(ctx, "agent-a", drained.OperationID)
	if err != nil || base.Outcome != memoryv1.OutcomeAdmitted || len(base.AffectedMemoryRefs) != 1 {
		t.Fatalf("remember base fact: result=%+v err=%v", base, err)
	}
	enqueue("event-backlog", "operation-backlog", "I like oolong tea")
	corrected, err := facade.Correct(ctx, "agent-a", base.AffectedMemoryRefs[0], "I prefer chamomile tea")
	if err != nil || corrected.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("correct behind pending fact: result=%+v err=%v", corrected, err)
	}
	if corrected.Projection.CurrentCount != 2 || corrected.Projection.SupersededCount != 1 {
		t.Fatalf("correction/backlog projection = %+v", corrected.Projection)
	}
	binding, err := store.BindingForAgent(ctx, "agent-a")
	if err != nil {
		t.Fatal(err)
	}
	items, err := store.ListOutbox(ctx, binding.BindingRef)
	if err != nil || len(items) != 3 {
		t.Fatalf("outbox after correction: items=%+v err=%v", items, err)
	}
	for _, item := range items {
		if item.State != "received" || item.PayloadPresent {
			t.Fatalf("operation %s retained non-terminal Runtime custody: %+v", item.OperationID, item)
		}
	}
}

func TestFacadeCutoffOperationsAreCommittedForAnUnensuredEmptyBank(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	createTestBinding(t, backend, store, "agent-empty", true)
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open Cognition owner: %v", err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	authorize := func(context.Context, Binding) error { return nil }
	bridge := NewBridge(store, owner, authorize)
	facade := NewFacade(store, owner, bridge, authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	ctx := context.Background()
	disabled, err := facade.SetEnabled(ctx, "agent-empty", false)
	if err != nil || disabled.Outcome != memoryv1.OutcomeCommitted || disabled.Projection.Enabled || disabled.Projection.AdoptionRequired {
		t.Fatalf("disable empty bank: result=%+v err=%v", disabled, err)
	}
	deleted, err := facade.DeleteAll(ctx, "agent-empty", true)
	if err != nil || deleted.Outcome != memoryv1.OutcomeCommitted || deleted.Projection.Enabled {
		t.Fatalf("delete-all empty bank: result=%+v err=%v", deleted, err)
	}
	binding, err := store.BindingForAgent(ctx, "agent-empty")
	if err != nil || binding.BankRef != "" || binding.LifecycleRef != "" {
		t.Fatalf("empty operations fabricated an owner bank: binding=%+v err=%v", binding, err)
	}
}
