package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestTerminationFenceRetriesOwnerDeleteAndPreservesOtherAgent(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	ctx := context.Background()
	bindingA := createTestBinding(t, backend, store, "agent-a", true)
	bindingB := createTestBinding(t, backend, store, "agent-b", true)
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open Cognition owner: %v", err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	ownerPort := newTestOwnerPort(store, owner, nil)
	bridge := NewBridge(store, ownerPort, func(context.Context, Binding) error { return nil })
	facade := NewFacade(store, ownerPort, bridge, func(context.Context, Binding) error { return nil }, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	for _, agent := range []struct {
		ref, event, operation, text string
	}{{"agent-a", "event-a", "operation-a", "I prefer jasmine tea"}, {"agent-b", "event-b", "operation-b", "I prefer coffee"}} {
		if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
			_, err := store.EnqueueCommittedEventTx(tx, agent.ref, testEnvelope(agent.event, agent.operation, agent.text))
			return err
		}); err != nil {
			t.Fatalf("enqueue %s: %v", agent.ref, err)
		}
		drained, err := bridge.DrainOne(ctx, agent.ref)
		if err != nil {
			t.Fatalf("drain %s: %v", agent.ref, err)
		}
		if result, err := facade.ProcessRemember(ctx, agent.ref, drained.OperationID); err != nil || result.Outcome != memoryv1.OutcomeAdmitted {
			t.Fatalf("remember %s: result=%+v err=%v", agent.ref, result, err)
		}
	}
	boundA, _ := store.BindingForAgent(ctx, "agent-a")
	boundB, _ := store.BindingForAgent(ctx, "agent-b")
	memoriesA, err := owner.ListMemories(ctx, boundA.BankRef, false)
	if err != nil || len(memoriesA) != 1 {
		t.Fatalf("load correction target before termination: memories=%+v err=%v", memoriesA, err)
	}
	if corrected, err := facade.Correct(ctx, "agent-a", memoriesA[0].MemoryRef, "I prefer chamomile tea"); err != nil || corrected.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("commit correction before termination: result=%+v err=%v", corrected, err)
	}
	assertRowCount(t, backend, "runtime_cognition_memory_committed_correction", 1)
	failingOwner := &failOnceTerminationOwner{OwnerPort: ownerPort, fail: true}
	termination := NewTerminationService(store, failingOwner)
	first, err := termination.TerminateAgentMemory(ctx, "agent-a", "terminate-agent-a", memoryv1.DeleteReasonAgentTermination)
	if err == nil || first.Phase != "fenced" {
		t.Fatalf("owner failure did not leave recoverable fenced phase: result=%+v err=%v", first, err)
	}
	var state string
	if err := backend.DB().QueryRow(`SELECT state FROM runtime_cognition_memory_agent WHERE local_agent_ref = 'agent-a'`).Scan(&state); err != nil || state != "terminating" {
		t.Fatalf("Runtime fence was not durable: state=%s err=%v", state, err)
	}
	if _, err := store.EnqueueCommittedEventTx(mustBeginTx(t, backend), "agent-a", testEnvelope("late-event", "late-operation", "I prefer late work")); !errors.Is(err, ErrConflict) {
		t.Fatalf("fenced Agent accepted new outbox work: %v", err)
	}
	second, err := termination.TerminateAgentMemory(ctx, "agent-a", "terminate-agent-a", memoryv1.DeleteReasonAgentTermination)
	if err != nil || second.Phase != "completed" || second.Outcome != memoryv1.OutcomeDeleted {
		t.Fatalf("termination retry did not complete: result=%+v err=%v", second, err)
	}
	if _, err := store.BindingForAgent(ctx, "agent-a"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("terminated Runtime Memory binding remains active: %v", err)
	}
	assertRowCount(t, backend, "runtime_cognition_memory_committed_correction", 0)
	if memories, err := owner.ListMemories(ctx, boundA.BankRef, true); err == nil || len(memories) != 0 {
		t.Fatalf("deleted Cognition bank remained readable: memories=%+v err=%v", memories, err)
	}
	survivor, err := owner.ListMemories(ctx, boundB.BankRef, false)
	if err != nil || len(survivor) != 1 || survivor[0].Content != "I prefer coffee" {
		t.Fatalf("termination changed survivor Agent: memories=%+v err=%v", survivor, err)
	}
	third, err := termination.TerminateAgentMemory(ctx, "agent-a", "terminate-agent-a", memoryv1.DeleteReasonAgentTermination)
	if err != nil || third.Phase != "completed" {
		t.Fatalf("completed termination retry was not idempotent: result=%+v err=%v", third, err)
	}
	if boundA.BindingRef == bindingB.BindingRef || boundB.BindingRef == bindingA.BindingRef {
		t.Fatal("test Agent bindings crossed")
	}
}

func TestTerminationDeletesUnensuredBindingWithoutFabricatingOwnerBank(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	createTestBinding(t, backend, store, "agent-empty", true)
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open Cognition owner: %v", err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	termination := NewTerminationService(store, newTestOwnerPort(store, owner, nil))
	result, err := termination.TerminateAgentMemory(context.Background(), "agent-empty", "terminate-empty", memoryv1.DeleteReasonAgentTermination)
	if err != nil || result.Outcome != memoryv1.OutcomeDeleted || result.Phase != "completed" {
		t.Fatalf("terminate unensured binding: result=%+v err=%v", result, err)
	}
	if _, err := store.BindingForAgent(context.Background(), "agent-empty"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("unensured Runtime binding remained after termination: %v", err)
	}
	retry, err := termination.TerminateAgentMemory(context.Background(), "agent-empty", "terminate-empty", memoryv1.DeleteReasonAgentTermination)
	if err != nil || retry.Outcome != memoryv1.OutcomeDeleted || retry.Phase != "completed" {
		t.Fatalf("unensured termination retry: result=%+v err=%v", retry, err)
	}
}

func TestAccountTerminationMakesLateEmbeddingCallbackNonEffecting(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	ctx := context.Background()
	createTestBinding(t, backend, store, "agent-account-late", true)
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open Cognition owner: %v", err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	ownerPort := newTestOwnerPort(store, owner, nil)
	bridge := NewBridge(store, ownerPort, func(context.Context, Binding) error { return nil })
	facade := NewFacade(store, ownerPort, bridge, func(context.Context, Binding) error { return nil }, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, "agent-account-late", testEnvelope("event-account-late", "operation-account-late", "I prefer cedar tea"))
		return err
	}); err != nil {
		t.Fatalf("enqueue account-late Memory: %v", err)
	}
	drained, err := bridge.DrainOne(ctx, "agent-account-late")
	if err != nil || !drained.Drained {
		t.Fatalf("drain account-late Memory: result=%+v err=%v", drained, err)
	}
	if result, err := facade.ProcessRemember(ctx, "agent-account-late", drained.OperationID); err != nil || result.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("remember account-late Memory: result=%+v err=%v", result, err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	port := NewRuntimeEmbeddingPort(
		backend, "account-late", "agent-account-late",
		func(context.Context, string, string) (ResolvedEmbeddingBinding, error) {
			return ResolvedEmbeddingBinding{ConfigRevision: 1, EmbeddingSpaceRef: "space-account-late", Profile: testEmbeddingProfile("provider-late", "model-late", 2)}, nil
		},
		func(context.Context, *runtimev1.MemoryEmbeddingProfile, []string) ([][]float64, error) {
			close(started)
			<-release
			return [][]float64{{0.25, 0.75}}, nil
		},
	)
	type embedResult struct {
		result memoryv1.AIEmbeddingResult
		err    error
	}
	embedDone := make(chan embedResult, 1)
	go func() {
		result, err := port.Embed(ctx, memoryv1.AIEmbeddingRequest{OperationID: "late-account-embedding", ConfigRevision: 1, EmbeddingSpaceRef: "space-account-late", Inputs: []string{"late input"}})
		embedDone <- embedResult{result: result, err: err}
	}()
	<-started
	termination := NewTerminationService(store, ownerPort)
	terminated, err := termination.TerminateAgentMemory(ctx, "agent-account-late", "account-terminal-child", memoryv1.DeleteReasonAccountTermination)
	if err != nil || terminated.Phase != "completed" || terminated.Outcome != memoryv1.OutcomeDeleted {
		close(release)
		t.Fatalf("Account termination: result=%+v err=%v", terminated, err)
	}
	close(release)
	late := <-embedDone
	if late.err == nil || !errors.Is(late.err, ErrConflict) {
		t.Fatalf("late embedding callback regained effect: result=%+v err=%v", late.result, late.err)
	}
	var jobs int
	if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_ai_job WHERE operation_id = 'late-account-embedding'`).Scan(&jobs); err != nil || jobs != 0 {
		t.Fatalf("late embedding Job survived Account termination: jobs=%d err=%v", jobs, err)
	}
}

type failOnceTerminationOwner struct {
	OwnerPort
	fail bool
}

func (o *failOnceTerminationOwner) DeleteBank(ctx context.Context, request *runtimev1.CognitionMemoryDeleteBankRequest) (*runtimev1.CognitionMemoryDeleteBankResponse, error) {
	if o.fail {
		o.fail = false
		return &runtimev1.CognitionMemoryDeleteBankResponse{Outcome: runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNAVAILABLE}, errors.New("injected Cognition delete failure")
	}
	return o.OwnerPort.DeleteBank(ctx, request)
}

func mustBeginTx(t *testing.T, backend interface{ DB() *sql.DB }) *sql.Tx {
	t.Helper()
	tx, err := backend.DB().Begin()
	if err != nil {
		t.Fatalf("begin direct rejection transaction: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback() })
	return tx
}
