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
	ownerPort := newTestOwnerPort(store, owner, nil)
	bridge := NewBridge(store, ownerPort, authorize)
	drained, err := bridge.DrainOne(ctx, "agent-a")
	if err != nil || !drained.Drained || drained.Outcome != memoryv1.OutcomeReceived {
		t.Fatalf("transfer committed custody: result=%+v err=%v", drained, err)
	}
	facade := NewFacade(store, ownerPort, bridge, authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	remembered, err := facade.ProcessRemember(ctx, "agent-a", drained.OperationID)
	if err != nil || remembered.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("process Remember: result=%+v err=%v", remembered, err)
	}
	recalled, err := facade.Recall(ctx, RecallIntent{LocalAgentRef: "agent-a", OperationID: "recall-a", Query: "jasmine tea", Limit: 4})
	if err != nil || recalled.Outcome != memoryv1.OutcomeReady || len(recalled.Hits) != 1 {
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
	ownerPort := newTestOwnerPort(store, owner, nil)
	bridge := NewBridge(store, ownerPort, func(context.Context, Binding) error { return nil })
	facade := NewFacade(store, ownerPort, bridge, func(context.Context, Binding) error { return nil }, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
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
	ownerPort := newTestOwnerPort(store, owner, nil)
	bridge := NewBridge(store, ownerPort, authorize)
	facade := NewFacade(store, ownerPort, bridge, authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
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
	var correctionEventRef, correctionOperationID, correctionSubjectRef, correctionTargetRef, correctionContent string
	if err := backend.DB().QueryRow(`SELECT e.event_ref, c.operation_id, c.account_subject_ref, c.target_memory_ref, c.corrected_content
		FROM runtime_cognition_memory_committed_event e JOIN runtime_cognition_memory_committed_correction c ON c.event_ref = e.event_ref
		WHERE e.local_agent_ref = ? AND e.event_kind = 'correction_committed'`, binding.LocalAgentRef).Scan(&correctionEventRef, &correctionOperationID, &correctionSubjectRef, &correctionTargetRef, &correctionContent); err != nil {
		t.Fatalf("load Runtime committed correction truth: %v", err)
	}
	if !validRef(correctionEventRef) || !validRef(correctionOperationID) || correctionSubjectRef != binding.AccountSubjectRef || correctionTargetRef != base.AffectedMemoryRefs[0] || correctionContent != "I prefer chamomile tea" {
		t.Fatalf("Runtime committed correction truth changed: event=%q operation=%q subject=%q target=%q content=%q", correctionEventRef, correctionOperationID, correctionSubjectRef, correctionTargetRef, correctionContent)
	}
	status, err := ownerPort.core.InspectStatus(ctx, binding.BindingRef, binding.BankRef)
	if err != nil {
		t.Fatal(err)
	}
	terminalCompacted := false
	for _, event := range status.Events {
		if event.OperationID == correctionOperationID {
			terminalCompacted = event.Outcome == memoryv1.OutcomeAdmitted && !event.PayloadPresent
			break
		}
	}
	if !terminalCompacted {
		t.Fatalf("Cognition correction custody did not reach compacted terminal state: operation=%q events=%+v", correctionOperationID, status.Events)
	}
}

func TestFacadeCutoffOperationsAreCommittedForAnUnensuredEmptyBank(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	binding := createTestBinding(t, backend, store, "agent-empty", true)
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open Cognition owner: %v", err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	authorize := func(context.Context, Binding) error { return nil }
	ownerPort := newTestOwnerPort(store, owner, nil)
	bridge := NewBridge(store, ownerPort, authorize)
	facade := NewFacade(store, ownerPort, bridge, authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	ctx := context.Background()
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, "agent-empty", testEnvelope("event-before-disable", "operation-before-disable", "Please remember that I like cedar forests."))
		return err
	}); err != nil {
		t.Fatalf("enqueue pending event before unbound disable: %v", err)
	}
	disabled, err := facade.SetEnabled(ctx, "agent-empty", false)
	if err != nil || disabled.Outcome != memoryv1.OutcomeCommitted || disabled.Projection.Enabled || disabled.Projection.AdoptionRequired {
		t.Fatalf("disable empty bank: result=%+v err=%v", disabled, err)
	}
	oldRows, err := store.ListOutbox(ctx, binding.BindingRef)
	if err != nil || len(oldRows) != 1 || oldRows[0].State != "cutoff_non_effecting" || oldRows[0].PayloadPresent {
		t.Fatalf("unbound disable did not permanently dispose pre-cut pending work: rows=%+v err=%v", oldRows, err)
	}
	afterDisable, err := store.BindingForAgent(ctx, "agent-empty")
	if err != nil || afterDisable.BindingRef == binding.BindingRef || afterDisable.BankRef != "" || afterDisable.LifecycleRef != "" || afterDisable.Enabled {
		t.Fatalf("unbound disable did not rotate to a disabled empty stream: binding=%+v err=%v", afterDisable, err)
	}
	if enabled, err := facade.SetEnabled(ctx, "agent-empty", true); err != nil || enabled.Outcome != memoryv1.OutcomeCommitted || !enabled.Projection.Enabled {
		t.Fatalf("re-enable rotated unbound stream: result=%+v err=%v", enabled, err)
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, "agent-empty", testEnvelope("event-before-delete", "operation-before-delete", "Please remember that I like pine forests."))
		return err
	}); err != nil {
		t.Fatalf("enqueue pending event before unbound delete-all: %v", err)
	}
	deleted, err := facade.DeleteAll(ctx, "agent-empty", true)
	if err != nil || deleted.Outcome != memoryv1.OutcomeCommitted || !deleted.Projection.Enabled {
		t.Fatalf("delete-all empty bank: result=%+v err=%v", deleted, err)
	}
	preDeleteRows, err := store.ListOutbox(ctx, afterDisable.BindingRef)
	if err != nil || len(preDeleteRows) != 1 || preDeleteRows[0].State != "cutoff_non_effecting" || preDeleteRows[0].PayloadPresent {
		t.Fatalf("unbound delete-all did not permanently dispose pre-cut pending work: rows=%+v err=%v", preDeleteRows, err)
	}
	afterDelete, err := store.BindingForAgent(ctx, "agent-empty")
	if err != nil || afterDelete.BindingRef == afterDisable.BindingRef || afterDelete.BankRef != "" || afterDelete.LifecycleRef != "" || !afterDelete.Enabled {
		t.Fatalf("unbound delete-all did not preserve enabled intent on a new empty stream: binding=%+v err=%v", afterDelete, err)
	}
}

func TestFacadeUnboundCutoffFailureDoesNotStrandLateEnsuredBank(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	binding := createTestBinding(t, backend, store, "agent-cutoff-ensure-race", true)
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	ownerPort := newTestOwnerPort(store, owner, nil)
	authorize := func(context.Context, Binding) error { return nil }
	facade := NewFacade(store, ownerPort, NewBridge(store, ownerPort, authorize), authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	ensured, err := ownerPort.EnsureBank(context.Background(), &runtimev1.CognitionMemoryEnsureBankRequest{
		ContractVersion: memoryv1.ContractVersion,
		BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: binding.BindingRef},
		Operation:       &runtimev1.CognitionMemoryOperationRef{Value: binding.BindingOperationID},
	})
	if err != nil {
		t.Fatalf("ensure owner bank before Runtime bind: %v", err)
	}
	if _, err := backend.DB().Exec(`CREATE TRIGGER inject_unbound_cutoff_rotation_failure BEFORE UPDATE OF state ON runtime_cognition_memory_stream WHEN NEW.state = 'retired' BEGIN SELECT RAISE(ABORT, 'injected cutoff rotation failure'); END`); err != nil {
		t.Fatalf("install cutoff failure: %v", err)
	}
	if result, err := facade.SetEnabled(context.Background(), "agent-cutoff-ensure-race", false); err == nil || result.Outcome != memoryv1.OutcomeUnavailable {
		t.Fatalf("injected cutoff rotation unexpectedly succeeded: result=%+v err=%v", result, err)
	}
	if _, err := backend.DB().Exec(`DROP TRIGGER inject_unbound_cutoff_rotation_failure`); err != nil {
		t.Fatalf("remove cutoff failure: %v", err)
	}
	if err := store.BindEnsuredBank(context.Background(), binding.BindingRef, ensured.GetBank().GetValue(), ensured.GetLifecycleCutoff().GetValue()); err != nil {
		t.Fatalf("persist late EnsureBank result: %v", err)
	}
	disabled, err := facade.SetEnabled(context.Background(), "agent-cutoff-ensure-race", false)
	if err != nil || disabled.Outcome != memoryv1.OutcomeCommitted || disabled.Projection.Enabled {
		t.Fatalf("late EnsureBank stranded cutoff recovery: result=%+v err=%v", disabled, err)
	}
	if _, pending, err := facade.pendingCutoff(context.Background(), "agent-cutoff-ensure-race"); err != nil || pending {
		t.Fatalf("cutoff remained unfinished after retry: pending=%v err=%v", pending, err)
	}
}

func TestFacadeSetEnabledRejectsPendingCutoffUntilRecoveryCompletes(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	binding := createTestBinding(t, backend, store, "agent-cutoff-reenable", true)
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	ownerPort := newTestOwnerPort(store, owner, nil)
	authorize := func(context.Context, Binding) error { return nil }
	facade := NewFacade(store, ownerPort, NewBridge(store, ownerPort, authorize), authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	ensured, err := ownerPort.EnsureBank(context.Background(), &runtimev1.CognitionMemoryEnsureBankRequest{
		ContractVersion: memoryv1.ContractVersion,
		BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: binding.BindingRef},
		Operation:       &runtimev1.CognitionMemoryOperationRef{Value: binding.BindingOperationID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.BindEnsuredBank(context.Background(), binding.BindingRef, ensured.GetBank().GetValue(), ensured.GetLifecycleCutoff().GetValue()); err != nil {
		t.Fatal(err)
	}
	const operationID = "cutoff-before-reenable"
	const replacementBinding = "binding-after-reenable-cutoff"
	const newLifecycle = "lifecycle-after-reenable-cutoff"
	now := "2026-08-28T12:00:00Z"
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE runtime_cognition_memory_agent SET enabled = 0, updated_at = ? WHERE local_agent_ref = ?`, now, "agent-cutoff-reenable"); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_cognition_memory_cutoff(operation_id, local_agent_ref, old_binding_ref, replacement_binding_ref, bank_ref, old_lifecycle_ref, new_lifecycle_ref, delete_all, previous_enabled, desired_enabled, phase, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, 0, 1, 0, 'prepared', ?, ?)`, operationID, "agent-cutoff-reenable", binding.BindingRef, replacementBinding, ensured.GetBank().GetValue(), ensured.GetLifecycleCutoff().GetValue(), newLifecycle, now, now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	committed, err := ownerPort.ApplyCutoff(context.Background(), &runtimev1.CognitionMemoryApplyCutoffRequest{
		ContractVersion:        memoryv1.ContractVersion,
		BankBinding:            &runtimev1.CognitionMemoryBankBindingRef{Value: binding.BindingRef},
		Bank:                   ensured.GetBank(),
		Operation:              &runtimev1.CognitionMemoryOperationRef{Value: operationID},
		Cutoff:                 &runtimev1.CognitionMemoryLifecycleCutoffRef{Value: newLifecycle},
		ReplacementBankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: replacementBinding},
	})
	if err != nil || committed.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_COMMITTED {
		t.Fatalf("commit owner cutoff before simulated crash: response=%+v err=%v", committed, err)
	}
	rejected, err := facade.SetEnabled(context.Background(), "agent-cutoff-reenable", true)
	if !errors.Is(err, ErrConflict) || rejected.Outcome != memoryv1.OutcomeConflict {
		t.Fatalf("re-enable did not reject pending cutoff: result=%+v err=%v", rejected, err)
	}
	stale, err := store.BindingForAgent(context.Background(), "agent-cutoff-reenable")
	if err != nil || stale.BindingRef != binding.BindingRef || stale.Enabled {
		t.Fatalf("re-enable changed stale binding before recovery: binding=%+v err=%v", stale, err)
	}
	if err := facade.ResumeCutoff(context.Background(), "agent-cutoff-reenable"); err != nil {
		t.Fatalf("resume owner-committed cutoff: %v", err)
	}
	enabled, err := facade.SetEnabled(context.Background(), "agent-cutoff-reenable", true)
	if err != nil || enabled.Outcome != memoryv1.OutcomeCommitted || !enabled.Projection.Enabled {
		t.Fatalf("re-enable did not recover owner-committed cutoff: result=%+v err=%v", enabled, err)
	}
	after, err := store.BindingForAgent(context.Background(), "agent-cutoff-reenable")
	if err != nil || after.BindingRef != replacementBinding || after.LifecycleRef != newLifecycle || !after.Enabled {
		t.Fatalf("re-enable restored stale binding: binding=%+v err=%v", after, err)
	}
}

func TestCutoffSchemaAllowsOnlyOneUnfinishedOperationPerAgent(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	insert := func(operationID, replacementBinding string) error {
		_, err := backend.DB().Exec(`INSERT INTO runtime_cognition_memory_cutoff(operation_id, local_agent_ref, old_binding_ref, replacement_binding_ref, bank_ref, old_lifecycle_ref, new_lifecycle_ref, delete_all, previous_enabled, desired_enabled, phase, created_at, updated_at) VALUES(?, 'agent-unique-cutoff', 'binding-old', ?, 'bank-old', 'lifecycle-old', 'lifecycle-new', 0, 1, 0, 'prepared', '2026-08-28T12:00:00Z', '2026-08-28T12:00:00Z')`, operationID, replacementBinding)
		return err
	}
	if err := insert("cutoff-unique-a", "binding-unique-a"); err != nil {
		t.Fatal(err)
	}
	if err := insert("cutoff-unique-b", "binding-unique-b"); err == nil {
		t.Fatal("second unfinished cutoff for one Agent was accepted")
	}
}

func TestFacadeCorrectionReturnsCommittedOutcomeWhenPostCommitCompletionFails(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	createTestBinding(t, backend, store, "agent-correction-post-commit", true)
	core, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = core.Close() })
	authorize := func(context.Context, Binding) error { return nil }
	baseOwner := newTestOwnerPort(store, core, nil)
	baseBridge := NewBridge(store, baseOwner, authorize)
	baseFacade := NewFacade(store, baseOwner, baseBridge, authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	ctx := context.Background()
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, "agent-correction-post-commit", testEnvelope("event-correction-base", "operation-correction-base", "I prefer jasmine tea"))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	drained, err := baseBridge.DrainOne(ctx, "agent-correction-post-commit")
	if err != nil {
		t.Fatal(err)
	}
	base, err := baseFacade.ProcessRemember(ctx, "agent-correction-post-commit", drained.OperationID)
	if err != nil || len(base.AffectedMemoryRefs) != 1 {
		t.Fatalf("seed correction target: result=%+v err=%v", base, err)
	}
	failingOwner := &postCommitFailureOwner{OwnerPort: baseOwner}
	facade := NewFacade(store, failingOwner, NewBridge(store, failingOwner, authorize), authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	corrected, err := facade.Correct(ctx, "agent-correction-post-commit", base.AffectedMemoryRefs[0], "I prefer chamomile tea")
	if err != nil || corrected.Outcome != memoryv1.OutcomeAdmitted || len(corrected.AffectedMemoryRefs) != 1 || corrected.Projection.Outcome != memoryv1.OutcomeUnavailable {
		t.Fatalf("canonical correction was reported as failed after commit: result=%+v err=%v", corrected, err)
	}
}

type postCommitFailureOwner struct {
	OwnerPort
}

func (o *postCommitFailureOwner) ExecuteRemember(ctx context.Context, operationID string) (memoryv1.DecisionResult, error) {
	result, err := o.OwnerPort.ExecuteRemember(ctx, operationID)
	if err == nil && result.Outcome.TerminalRemember() {
		return result, errors.New("injected completion failure after canonical decision")
	}
	return result, err
}

func (o *postCommitFailureOwner) Inspect(context.Context, *runtimev1.CognitionMemoryInspectRequest) (*runtimev1.CognitionMemoryInspectResponse, error) {
	return &runtimev1.CognitionMemoryInspectResponse{Outcome: runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNAVAILABLE}, errors.New("injected inspect failure after canonical decision")
}

func TestFacadeRebuildsEmbeddingOnceAfterBatchAndOnceAfterCorrection(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	createTestBinding(t, backend, store, "agent-batch", true)
	core, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = core.Close() })
	snapshot := memoryv1.CapabilitySnapshot{
		ConfigRevision: 1, EmbeddingSpaceRef: "embedding-space-batch",
		Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex, memoryv1.CapabilityTextEmbed, memoryv1.CapabilityVectorIndex},
	}
	baseOwner := newTestOwnerPort(store, core, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, error) { return snapshot, nil })
	owner := &countingOwnerPort{OwnerPort: baseOwner}
	authorize := func(context.Context, Binding) error { return nil }
	bridge := NewBridge(store, owner, authorize)
	embedding := batchEmbeddingPort{}
	facade := NewFacade(store, owner, bridge, authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return snapshot, embedding, nil
	})
	ctx := context.Background()
	for index, item := range []struct{ event, operation, text string }{
		{"event-batch-1", "operation-batch-1", "I prefer cedar forests"},
		{"event-batch-2", "operation-batch-2", "I like jasmine tea"},
	} {
		if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
			_, err := store.EnqueueCommittedEventTx(tx, "agent-batch", testEnvelope(item.event, item.operation, item.text))
			return err
		}); err != nil {
			t.Fatalf("enqueue batch item %d: %v", index, err)
		}
		drained, err := bridge.DrainOne(ctx, "agent-batch")
		if err != nil || !drained.Drained {
			t.Fatalf("drain batch item %d: result=%+v err=%v", index, drained, err)
		}
		if _, err := facade.ProcessRemember(ctx, "agent-batch", drained.OperationID); err != nil {
			t.Fatalf("remember batch item %d: %v", index, err)
		}
	}
	if owner.rebuildCalls != 0 {
		t.Fatalf("per-event Remember rebuilt full embedding %d times", owner.rebuildCalls)
	}
	if err := facade.ResumePending(ctx, "agent-batch"); err != nil {
		t.Fatalf("complete batch: %v", err)
	}
	if owner.rebuildCalls != 1 {
		t.Fatalf("batch embedding rebuilds = %d, want 1", owner.rebuildCalls)
	}
	projection, err := facade.Inspect(ctx, InspectIntent{LocalAgentRef: "agent-batch", Limit: 100})
	if err != nil || len(projection.Items) != 2 {
		t.Fatalf("inspect batch: projection=%+v err=%v", projection, err)
	}
	owner.rebuildCalls = 0
	corrected, err := facade.Correct(ctx, "agent-batch", projection.Items[0].MemoryRef, "I prefer quiet cedar forests")
	if err != nil || corrected.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("correct batch Memory: result=%+v err=%v", corrected, err)
	}
	if owner.rebuildCalls != 1 {
		t.Fatalf("correction embedding rebuilds = %d, want 1", owner.rebuildCalls)
	}
}

type countingOwnerPort struct {
	OwnerPort
	rebuildCalls int
}

func (o *countingOwnerPort) RebuildEmbedding(ctx context.Context, operationID, bankRef string, snapshot memoryv1.CapabilitySnapshot, port memoryv1.EmbeddingPort) (memoryv1.Outcome, error) {
	o.rebuildCalls++
	return o.OwnerPort.RebuildEmbedding(ctx, operationID, bankRef, snapshot, port)
}

type batchEmbeddingPort struct{}

func (batchEmbeddingPort) Embed(_ context.Context, request memoryv1.AIEmbeddingRequest) (memoryv1.AIEmbeddingResult, error) {
	vectors := make([][]float64, len(request.Inputs))
	for index := range vectors {
		vectors[index] = []float64{1, float64(index + 1)}
	}
	return memoryv1.AIEmbeddingResult{Vectors: vectors, Dimension: 2}, nil
}
