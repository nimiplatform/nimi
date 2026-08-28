package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestOwnerEventAndOutboxCommitAtomically(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	ctx := context.Background()
	binding := createTestBinding(t, backend, store, "agent-a", true)
	injected := errors.New("injected owner transaction failure")
	err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_event_log(sequence, local_agent_ref, event_type, timestamp, event_json) VALUES(1, 'agent-a', 1, ?, '{}')`, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
		if _, err := store.EnqueueCommittedEventTx(tx, "agent-a", testEnvelope("event-a", "operation-a", "committed preference")); err != nil {
			return err
		}
		return injected
	})
	if !errors.Is(err, injected) {
		t.Fatalf("expected injected failure, got %v", err)
	}
	assertRowCount(t, backend, "runtime_local_agent_event_log", 0)
	assertRowCount(t, backend, "runtime_cognition_memory_outbox", 0)
	afterRollback, err := store.BindingForAgent(ctx, "agent-a")
	if err != nil || afterRollback.NextSequence != 1 {
		t.Fatalf("failed transaction consumed delivery sequence: binding=%+v err=%v", afterRollback, err)
	}

	err = backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_event_log(sequence, local_agent_ref, event_type, timestamp, event_json) VALUES(1, 'agent-a', 1, ?, '{}')`, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
		_, err := store.EnqueueCommittedEventTx(tx, "agent-a", testEnvelope("event-a", "operation-a", "committed preference"))
		return err
	})
	if err != nil {
		t.Fatalf("commit owner event and outbox: %v", err)
	}
	assertRowCount(t, backend, "runtime_local_agent_event_log", 1)
	assertRowCount(t, backend, "runtime_cognition_memory_outbox", 1)
	if err := store.BindEnsuredBank(ctx, binding.BindingRef, "bank-a", "cutoff-a"); err != nil {
		t.Fatalf("bind ensured bank: %v", err)
	}
	pending, err := store.NextPending(ctx, binding.BindingRef)
	if err != nil {
		t.Fatalf("load pending event: %v", err)
	}
	if pending.DeliverySequence != 1 || pending.BankRef != "bank-a" || pending.LifecycleRef != "cutoff-a" || pending.Envelope.GetBank().GetValue() != "bank-a" {
		t.Fatalf("pending event lost owner binding: %+v", pending)
	}
}

func TestCommittedCorrectionOwnerFactSurvivesOutboxCompactionAndRestart(t *testing.T) {
	root := filepath.Join(t.TempDir(), "local-state.json")
	backend := openTestBackend(t, root)
	store := NewStore(backend)
	ctx := context.Background()
	binding := createTestBinding(t, backend, store, "agent-correction-owner", true)
	if err := store.BindEnsuredBank(ctx, binding.BindingRef, "bank-correction-owner", "lifecycle-correction-owner"); err != nil {
		t.Fatal(err)
	}
	correction := testEnvelope("event-correction-owner", "operation-correction-owner", "unused")
	correction.Subjects = []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}}
	correction.Sources = []*runtimev1.CognitionMemorySourceRef{{Kind: "agent_center_correction", Value: "operation-correction-owner"}}
	correction.Fact = &runtimev1.CognitionMemoryCommittedEventEnvelope_CorrectionCommitted{CorrectionCommitted: &runtimev1.CognitionMemoryCorrectionCommitted{
		TargetMemory: &runtimev1.CognitionMemoryRef{Value: "memory-correction-target"}, CorrectedContent: "I prefer chamomile tea",
	}}

	injected := errors.New("injected correction owner transaction failure")
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if _, err := store.EnqueueCommittedEventTx(tx, binding.LocalAgentRef, correction); err != nil {
			return err
		}
		return injected
	}); !errors.Is(err, injected) {
		t.Fatalf("rollback correction owner transaction: %v", err)
	}
	assertRowCount(t, backend, "runtime_cognition_memory_committed_event", 0)
	assertRowCount(t, backend, "runtime_cognition_memory_committed_correction", 0)
	assertRowCount(t, backend, "runtime_cognition_memory_outbox", 0)

	var item OutboxItem
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var err error
		item, err = store.EnqueueCommittedEventTx(tx, binding.LocalAgentRef, correction)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.AcknowledgeReceived(ctx, &runtimev1.CognitionMemoryCommitResponse{
		Outcome: runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_RECEIVED,
		Bank:    &runtimev1.CognitionMemoryBankRef{Value: "bank-correction-owner"}, Event: &runtimev1.CognitionMemoryEventRef{Value: item.EventRef},
		Operation: &runtimev1.CognitionMemoryOperationRef{Value: item.OperationID}, DeliverySequence: item.DeliverySequence, ReceivedFrontier: item.DeliverySequence,
	}); err != nil {
		t.Fatal(err)
	}
	if err := backend.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := openTestBackend(t, root)
	var eventRef, localAgentRef, eventKind, sourceKind, sourceRef, operationID, subjectRef, targetRef, correctedContent string
	if err := reopened.DB().QueryRow(`SELECT e.event_ref, e.local_agent_ref, e.event_kind, e.source_kind, e.source_ref, c.operation_id, c.account_subject_ref, c.target_memory_ref, c.corrected_content
		FROM runtime_cognition_memory_committed_event e JOIN runtime_cognition_memory_committed_correction c ON c.event_ref = e.event_ref
		WHERE e.event_ref = ?`, item.EventRef).Scan(&eventRef, &localAgentRef, &eventKind, &sourceKind, &sourceRef, &operationID, &subjectRef, &targetRef, &correctedContent); err != nil {
		t.Fatalf("reload committed correction owner fact: %v", err)
	}
	if eventRef != item.EventRef || localAgentRef != binding.LocalAgentRef || eventKind != "correction_committed" || sourceKind != "agent_center_correction" || sourceRef != item.OperationID || operationID != item.OperationID || subjectRef != binding.AccountSubjectRef || targetRef != "memory-correction-target" || correctedContent != "I prefer chamomile tea" {
		t.Fatalf("committed correction owner fact changed: event=%q agent=%q kind=%q source=%s/%s operation=%q subject=%q target=%q content=%q", eventRef, localAgentRef, eventKind, sourceKind, sourceRef, operationID, subjectRef, targetRef, correctedContent)
	}
	var payloadPresent bool
	if err := reopened.DB().QueryRow(`SELECT payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE operation_id = ?`, item.OperationID).Scan(&payloadPresent); err != nil || payloadPresent {
		t.Fatalf("received outbox payload was not compacted independently: present=%v err=%v", payloadPresent, err)
	}
}

func TestCommittedCorrectionOwnerContextFailsClosedWithoutPartialRows(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	ctx := context.Background()
	binding := createTestBinding(t, backend, store, "agent-correction-context", true)
	newCorrection := func() *runtimev1.CognitionMemoryCommittedEventEnvelope {
		envelope := testEnvelope("event-correction-context", "operation-correction-context", "unused")
		envelope.Subjects = []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}}
		envelope.Sources = []*runtimev1.CognitionMemorySourceRef{{Kind: "agent_center_correction", Value: envelope.GetOperation().GetValue()}}
		envelope.Fact = &runtimev1.CognitionMemoryCommittedEventEnvelope_CorrectionCommitted{CorrectionCommitted: &runtimev1.CognitionMemoryCorrectionCommitted{
			TargetMemory: &runtimev1.CognitionMemoryRef{Value: "memory-correction-context"}, CorrectedContent: "I prefer chamomile tea",
		}}
		return envelope
	}
	tests := map[string]func(*runtimev1.CognitionMemoryCommittedEventEnvelope){
		"extra subject": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.Subjects = append(envelope.Subjects, &runtimev1.CognitionMemorySubjectRef{Kind: "account_subject", Value: "subject-other"})
		},
		"extra source": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.Sources = append(envelope.Sources, &runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: "conversation-other"})
		},
		"wrong source kind": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.Sources[0].Kind = "conversation"
		},
		"wrong source operation": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.Sources[0].Value = "operation-other"
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			envelope := newCorrection()
			mutate(envelope)
			if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
				_, err := store.EnqueueCommittedEventTx(tx, binding.LocalAgentRef, envelope)
				return err
			}); err == nil {
				t.Fatal("invalid correction owner context was admitted")
			}
			assertRowCount(t, backend, "runtime_cognition_memory_committed_event", 0)
			assertRowCount(t, backend, "runtime_cognition_memory_committed_correction", 0)
			assertRowCount(t, backend, "runtime_cognition_memory_outbox", 0)
			current, err := store.BindingForAgent(ctx, binding.LocalAgentRef)
			if err != nil || current.NextSequence != 1 {
				t.Fatalf("failed correction advanced stream: binding=%+v err=%v", current, err)
			}
		})
	}
}

func TestResponseLossRestartAndCustodyAckPreserveIdentity(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	backend := openTestBackend(t, statePath)
	store := NewStore(backend)
	ctx := context.Background()
	binding := createTestBinding(t, backend, store, "agent-a", true)
	if err := store.BindEnsuredBank(ctx, binding.BindingRef, "bank-a", "cutoff-a"); err != nil {
		t.Fatalf("bind ensured bank: %v", err)
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, "agent-a", testEnvelope("event-a", "operation-a", "committed preference"))
		return err
	}); err != nil {
		t.Fatalf("enqueue event: %v", err)
	}
	first, err := store.NextPending(ctx, binding.BindingRef)
	if err != nil {
		t.Fatalf("load first delivery: %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("close backend: %v", err)
	}
	reopened, err := runtimepersistence.Open(slog.Default(), statePath)
	if err != nil {
		t.Fatalf("reopen backend: %v", err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	store = NewStore(reopened)
	replayed, err := store.NextPending(ctx, binding.BindingRef)
	if err != nil {
		t.Fatalf("load replayed delivery: %v", err)
	}
	if replayed.OperationID != first.OperationID || replayed.EventRef != first.EventRef || replayed.DeliverySequence != first.DeliverySequence {
		t.Fatalf("restart changed delivery identity: first=%+v replayed=%+v", first, replayed)
	}
	if err := store.AcknowledgeReceived(ctx, &runtimev1.CognitionMemoryCommitResponse{Outcome: runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_RECEIVED, Bank: &runtimev1.CognitionMemoryBankRef{Value: "bank-a"}, Event: &runtimev1.CognitionMemoryEventRef{Value: first.EventRef}, Operation: &runtimev1.CognitionMemoryOperationRef{Value: first.OperationID}, DeliverySequence: first.DeliverySequence, ReceivedFrontier: first.DeliverySequence}); err != nil {
		t.Fatalf("acknowledge custody: %v", err)
	}
	if err := store.AcknowledgeReceived(ctx, &runtimev1.CognitionMemoryCommitResponse{Outcome: runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_RECEIVED, Bank: &runtimev1.CognitionMemoryBankRef{Value: "bank-a"}, Event: &runtimev1.CognitionMemoryEventRef{Value: first.EventRef}, Operation: &runtimev1.CognitionMemoryOperationRef{Value: first.OperationID}, DeliverySequence: first.DeliverySequence, ReceivedFrontier: first.DeliverySequence}); err != nil {
		t.Fatalf("duplicate custody response was not idempotent: %v", err)
	}
	rows, err := store.ListOutbox(ctx, binding.BindingRef)
	if err != nil || len(rows) != 1 || rows[0].State != "received" || rows[0].PayloadPresent {
		t.Fatalf("acked payload was not bounded-released: rows=%+v err=%v", rows, err)
	}
	afterAck, err := store.BindingForAgent(ctx, "agent-a")
	if err != nil || afterAck.DeliveryFrontier != 1 {
		t.Fatalf("delivery frontier did not advance contiguously: binding=%+v err=%v", afterAck, err)
	}
}

func TestDisabledAgentDoesNotCreateBacklog(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	ctx := context.Background()
	createTestBinding(t, backend, store, "existing-agent", false)
	err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_event_log(sequence, local_agent_ref, event_type, timestamp, event_json) VALUES(1, 'existing-agent', 1, ?, '{}')`, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
		_, err := store.EnqueueCommittedEventTx(tx, "existing-agent", testEnvelope("event-off", "operation-off", "must not catch up"))
		if errors.Is(err, ErrMemoryDisabled) {
			return nil
		}
		return err
	})
	if err != nil {
		t.Fatalf("disabled owner commit failed: %v", err)
	}
	assertRowCount(t, backend, "runtime_local_agent_event_log", 1)
	assertRowCount(t, backend, "runtime_cognition_memory_outbox", 0)
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error { return store.SetEnabledTx(tx, "existing-agent", true) }); err != nil {
		t.Fatalf("explicitly enable existing Agent: %v", err)
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, "existing-agent", testEnvelope("event-on", "operation-on", "new post-enable event"))
		return err
	}); err != nil {
		t.Fatalf("enqueue post-enable event: %v", err)
	}
	assertRowCount(t, backend, "runtime_cognition_memory_outbox", 1)
}

func TestSetEnabledTxRejectsCutoffInsertedAfterPreflight(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	binding := createTestBinding(t, backend, store, "agent-enable-cutoff-race", false)
	ctx := context.Background()
	var unfinished int
	if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_cutoff WHERE local_agent_ref = ? AND phase <> 'completed'`, binding.LocalAgentRef).Scan(&unfinished); err != nil || unfinished != 0 {
		t.Fatalf("enable preflight: unfinished=%d err=%v", unfinished, err)
	}
	row := cutoffRow{
		OperationID: "cutoff-after-enable-preflight", LocalAgentRef: binding.LocalAgentRef,
		OldBindingRef: binding.BindingRef, ReplacementBindingRef: "binding-enable-race-replacement",
		NewLifecycleRef: "lifecycle-enable-race-replacement", Phase: "cognition_committed",
		PreviousEnabled: false, DesiredEnabled: false,
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		return insertCutoffTx(tx, row, time.Now().UTC().Format(time.RFC3339Nano))
	}); err != nil {
		t.Fatalf("insert concurrent cutoff: %v", err)
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		return store.SetEnabledTx(tx, binding.LocalAgentRef, true)
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("enable crossed concurrent cutoff fence: %v", err)
	}
	after, err := store.BindingForAgent(ctx, binding.LocalAgentRef)
	if err != nil || after.Enabled {
		t.Fatalf("concurrent cutoff did not keep Memory disabled: binding=%+v err=%v", after, err)
	}
}

func TestCutoffRotatesStreamWithoutFabricatingReceivedFrontier(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	ctx := context.Background()
	binding := createTestBinding(t, backend, store, "agent-a", true)
	if err := store.BindEnsuredBank(ctx, binding.BindingRef, "bank-a", "cutoff-a"); err != nil {
		t.Fatalf("bind ensured bank: %v", err)
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if _, err := store.EnqueueCommittedEventTx(tx, "agent-a", testEnvelope("event-pre-cut", "operation-pre-cut", "pre-cut event")); err != nil {
			return err
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_, err := tx.Exec(`INSERT INTO runtime_cognition_memory_ai_job(operation_id, local_agent_ref, account_namespace, config_revision, request_key, profile_json, status, result_json, created_at, updated_at) VALUES('embedding-pre-cut', 'agent-a', 'subject-a', 1, 'request-pre-cut', X'01', 'ready', X'01', ?, ?)`, now, now)
		return err
	}); err != nil {
		t.Fatalf("enqueue pre-cut event: %v", err)
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		return store.RotateCutoffTx(tx, "agent-a", binding.BindingRef, "binding-after-cutoff", "cutoff-operation", "bank-a", "cutoff-b", false, false)
	}); err != nil {
		t.Fatalf("rotate cutoff: %v", err)
	}
	oldRows, err := store.ListOutbox(ctx, binding.BindingRef)
	if err != nil || len(oldRows) != 1 || oldRows[0].State != "cutoff_non_effecting" || oldRows[0].PayloadPresent {
		t.Fatalf("pre-cut outbox was not permanently disposed: rows=%+v err=%v", oldRows, err)
	}
	var oldFrontier uint64
	if err := backend.DB().QueryRow(`SELECT delivery_frontier FROM runtime_cognition_memory_stream WHERE binding_ref = ?`, binding.BindingRef).Scan(&oldFrontier); err != nil || oldFrontier != 0 {
		t.Fatalf("cutoff fabricated received delivery frontier: frontier=%d err=%v", oldFrontier, err)
	}
	var jobStatus, failureCode string
	var resultPresent bool
	if err := backend.DB().QueryRow(`SELECT status, failure_code, result_json IS NOT NULL FROM runtime_cognition_memory_ai_job WHERE operation_id = 'embedding-pre-cut'`).Scan(&jobStatus, &failureCode, &resultPresent); err != nil || jobStatus != "failed" || failureCode != "lifecycle_cutoff" || resultPresent {
		t.Fatalf("cutoff retained pre-cut Runtime AI result: status=%q failure=%q result=%v err=%v", jobStatus, failureCode, resultPresent, err)
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error { return store.SetEnabledTx(tx, "agent-a", true) }); err != nil {
		t.Fatalf("re-enable Agent: %v", err)
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		item, err := store.EnqueueCommittedEventTx(tx, "agent-a", testEnvelope("event-post-cut", "operation-post-cut", "post-cut event"))
		if err == nil && (item.BindingRef != "binding-after-cutoff" || item.DeliverySequence != 1) {
			t.Fatalf("post-cut event did not start the replacement stream: %+v", item)
		}
		return err
	}); err != nil {
		t.Fatalf("enqueue post-cut event: %v", err)
	}
}

func TestCommittedEnvelopeRequiresCompleteTypedFact(t *testing.T) {
	validEnvelope := func() *runtimev1.CognitionMemoryCommittedEventEnvelope {
		envelope := testEnvelope("event-complete", "operation-complete", "complete committed text")
		envelope.ContractVersion = 1
		envelope.BankBinding = &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-complete"}
		envelope.DeliverySequence = 1
		return envelope
	}
	validSource := func(kind, value string) *runtimev1.CognitionMemorySourceRef {
		return &runtimev1.CognitionMemorySourceRef{Kind: kind, Value: value}
	}

	validFacts := map[string]func(*runtimev1.CognitionMemoryCommittedEventEnvelope){
		"message": func(*runtimev1.CognitionMemoryCommittedEventEnvelope) {},
		"message-transcription": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.GetMessageCommitted().Parts[0].Content = &runtimev1.CognitionMemoryMessagePart_Transcription{Transcription: &runtimev1.CognitionMemoryTranscriptionPart{
				Text: "transcribed committed text", Transcription: validSource("transcription", "transcription-complete"),
			}}
		},
		"message-artifact": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.GetMessageCommitted().Parts[0].Content = &runtimev1.CognitionMemoryMessagePart_Artifact{Artifact: &runtimev1.CognitionMemoryArtifactPart{
				Artifact: validSource("runtime_artifact", "artifact-complete"), MediaKind: "image/png",
			}}
		},
		"turn": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.Fact = &runtimev1.CognitionMemoryCommittedEventEnvelope_TurnTerminal{TurnTerminal: &runtimev1.CognitionMemoryTurnTerminal{
				Conversation: validSource("conversation", "conversation-complete"),
				Turn:         validSource("conversation_turn", "turn-complete"),
				State:        runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_COMPLETED,
			}}
		},
		"activity": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.Fact = &runtimev1.CognitionMemoryCommittedEventEnvelope_ActivityTerminal{ActivityTerminal: &runtimev1.CognitionMemoryActivityTerminal{
				Activity: validSource("life_track_hook", "activity-complete"), ActivityKind: "life_track",
				State: runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_COMPLETED,
			}}
		},
		"correction": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.Fact = &runtimev1.CognitionMemoryCommittedEventEnvelope_CorrectionCommitted{CorrectionCommitted: &runtimev1.CognitionMemoryCorrectionCommitted{
				TargetMemory: &runtimev1.CognitionMemoryRef{Value: "memory-complete"}, CorrectedContent: "corrected committed content",
			}}
		},
		"relationship": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.Fact = &runtimev1.CognitionMemoryCommittedEventEnvelope_RelationshipCommitted{RelationshipCommitted: &runtimev1.CognitionMemoryRelationshipCommitted{
				RelationshipKind: "friendship", BoundedFact: "The relationship changed",
			}}
		},
	}
	for name, configure := range validFacts {
		t.Run("valid-"+name, func(t *testing.T) {
			envelope := validEnvelope()
			configure(envelope)
			if err := validateCommittedEnvelope(envelope, false); err != nil {
				t.Fatalf("valid typed fact rejected: %v", err)
			}
		})
	}

	invalidFacts := map[string]func(*runtimev1.CognitionMemoryCommittedEventEnvelope){
		"message-without-parts": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.GetMessageCommitted().Parts = nil
		},
		"message-with-unspecified-actor": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.GetMessageCommitted().Actor = runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_UNSPECIFIED
		},
		"message-with-empty-text": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.GetMessageCommitted().Parts[0].GetText().Text = " "
		},
		"transcription-without-ref": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			validFacts["message-transcription"](envelope)
			envelope.GetMessageCommitted().Parts[0].GetTranscription().Transcription = nil
		},
		"artifact-without-ref": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			validFacts["message-artifact"](envelope)
			envelope.GetMessageCommitted().Parts[0].GetArtifact().Artifact = nil
		},
		"turn-without-terminal-state": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			validFacts["turn"](envelope)
			envelope.GetTurnTerminal().State = runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_UNSPECIFIED
		},
		"activity-without-kind": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			validFacts["activity"](envelope)
			envelope.GetActivityTerminal().ActivityKind = ""
		},
		"correction-without-target": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			validFacts["correction"](envelope)
			envelope.GetCorrectionCommitted().TargetMemory = nil
		},
		"relationship-without-fact": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			validFacts["relationship"](envelope)
			envelope.GetRelationshipCommitted().BoundedFact = ""
		},
		"duplicate-source": func(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) {
			envelope.Sources = append(envelope.Sources, envelope.Sources[0])
		},
	}
	for name, configure := range invalidFacts {
		t.Run("invalid-"+name, func(t *testing.T) {
			envelope := validEnvelope()
			configure(envelope)
			if err := validateCommittedEnvelope(envelope, false); err == nil {
				t.Fatal("incomplete typed fact was admitted")
			}
		})
	}
}

func openTestBackend(t *testing.T, statePath string) *runtimepersistence.Backend {
	t.Helper()
	backend, err := runtimepersistence.Open(slog.Default(), statePath)
	if err != nil {
		t.Fatalf("open runtime persistence: %v", err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	return backend
}

func createTestBinding(t *testing.T, backend *runtimepersistence.Backend, store *Store, localAgentRef string, newAgent bool) Binding {
	t.Helper()
	var result Binding
	err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		var err error
		result, err = store.CreateAgentBindingTx(tx, localAgentRef, "subject-opaque-"+localAgentRef, newAgent)
		return err
	})
	if err != nil {
		t.Fatalf("create test binding: %v", err)
	}
	return result
}

func testEnvelope(eventRef, operationID, text string) *runtimev1.CognitionMemoryCommittedEventEnvelope {
	return &runtimev1.CognitionMemoryCommittedEventEnvelope{
		Event:       &runtimev1.CognitionMemoryEventRef{Value: eventRef},
		Operation:   &runtimev1.CognitionMemoryOperationRef{Value: operationID},
		Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: "subject-opaque"}},
		Sources:     []*runtimev1.CognitionMemorySourceRef{{Kind: "conversation", Value: "conversation-opaque"}, {Kind: "message", Value: eventRef}},
		CommittedAt: timestamppb.New(time.Date(2026, 8, 27, 10, 0, 0, 0, time.UTC)),
		Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_MessageCommitted{MessageCommitted: &runtimev1.CognitionMemoryMessageCommitted{
			Actor:        runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_USER,
			Conversation: &runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: "conversation-opaque"},
			Message:      &runtimev1.CognitionMemorySourceRef{Kind: "message", Value: eventRef},
			Parts:        []*runtimev1.CognitionMemoryMessagePart{{Part: &runtimev1.CognitionMemorySourceRef{Kind: "message_part", Value: eventRef + "-part"}, Content: &runtimev1.CognitionMemoryMessagePart_Text{Text: &runtimev1.CognitionMemoryTextPart{Text: text}}}},
		}},
	}
}

func assertRowCount(t *testing.T, backend *runtimepersistence.Backend, table string, want int) {
	t.Helper()
	var count int
	if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	if count != want {
		t.Fatalf("%s row count=%d want=%d", table, count, want)
	}
}

func newTestOwnerPort(store *Store, core *memoryv1.Core, capabilities OwnerCapabilityResolver) *OwnerAdapter {
	if capabilities == nil {
		capabilities = func(context.Context, Binding) (memoryv1.CapabilitySnapshot, error) {
			return memoryv1.CapabilitySnapshot{Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil
		}
	}
	return NewOwnerAdapter(core, store.BindingForOwner, capabilities)
}
