package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type interruptedPointerOwner struct {
	OwnerPort
	commitError, rememberError error
}

func (o *interruptedPointerOwner) Commit(ctx context.Context, req *runtimev1.CognitionMemoryCommitRequest) (*runtimev1.CognitionMemoryCommitResponse, error) {
	if o.commitError != nil {
		return nil, o.commitError
	}
	return o.OwnerPort.Commit(ctx, req)
}

func (o *interruptedPointerOwner) ExecuteRemember(ctx context.Context, op string) (memoryv1.DecisionResult, error) {
	if o.rememberError != nil {
		return memoryv1.DecisionResult{}, o.rememberError
	}
	return o.OwnerPort.ExecuteRemember(ctx, op)
}

func TestSessionPointerReplayResumesOneDurableDelivery(t *testing.T) {
	ctx := context.Background()
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	const agent = "agent-pointer-replay"
	binding := createTestBinding(t, backend, store, agent, true)
	core, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = core.Close() })
	owner := &interruptedPointerOwner{OwnerPort: newTestOwnerPort(store, core, nil)}
	authorize := func(context.Context, Binding) error { return nil }
	// Use a fresh facade and bridge on every delivery, as on process restart.
	deliver := func(id string) (bool, error) {
		facade := NewFacade(store, owner, NewBridge(store, owner, authorize), authorize, nil)
		return facade.CommitSessionPointer(ctx, id, agent, "ws-replay", "completed", "Review finished", "os.pc.workspace", time.Now())
	}
	failure := errors.New("owner unavailable")
	owner.commitError = failure
	if _, err := deliver("first"); !errors.Is(err, failure) {
		t.Fatalf("expected interrupted custody transfer, got %v", err)
	}
	owner.commitError, owner.rememberError = nil, failure
	if _, err := deliver("first"); !errors.Is(err, failure) {
		t.Fatalf("expected interrupted Remember after receipt, got %v", err)
	}
	owner.rememberError = nil
	for i := 0; i < 2; i++ {
		if committed, err := deliver("first"); err != nil || !committed {
			t.Fatalf("resuming or replaying completed milestone: committed=%v err=%v", committed, err)
		}
	}
	items, err := store.ListOutbox(ctx, binding.BindingRef)
	if err != nil || len(items) != 1 || items[0].State != "received" || items[0].DeliverySequence != 1 {
		t.Fatalf("expected one received delivery, got %+v err=%v", items, err)
	}
	binding, err = store.BindingForAgent(ctx, agent)
	if err != nil {
		t.Fatal(err)
	}
	status, err := owner.InspectStatusSummary(ctx, binding.BindingRef, binding.BankRef)
	if err != nil || status.Current != 1 || status.Superseded != 0 {
		t.Fatalf("replay changed memory history: status=%+v err=%v", status, err)
	}
	if _, err := deliver("second"); err != nil {
		t.Fatal(err)
	}
	items, err = store.ListOutbox(ctx, binding.BindingRef)
	if err != nil || len(items) != 2 || items[1].DeliverySequence != 2 {
		t.Fatalf("distinct milestone with identical content lost: items=%+v err=%v", items, err)
	}
}

func TestSessionPointerSingleSlotThrottleAndAntiResurrectionDeleteSession(t *testing.T) {
	ctx := context.Background()
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	const agentRef = "agent-session-ptr"
	_ = createTestBinding(t, backend, store, agentRef, true)
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

	// Deletion before first bank creation must also fence the general enqueue entry.
	if _, _, err := facade.ForgetSessionLineage(ctx, agentRef, "ws_prebank"); err != nil {
		t.Fatal(err)
	}
	late := testEnvelope("prebank-late", "prebank-late-op", "late text")
	late.Sources = append(late.Sources, &runtimev1.CognitionMemorySourceRef{Kind: "session", Value: "ws_prebank"})
	err = backend.WriteTx(ctx, func(tx *sql.Tx) error { _, err := store.EnqueueCommittedEventTx(tx, agentRef, late); return err })
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("late secondary session source: %v", err)
	}

	// 1. Commit initial_goal pointer -> succeeds immediately (and ensures bank via bridge).
	baseTime := time.Date(2026, 11, 24, 14, 0, 0, 0, time.UTC)
	committed, err := facade.CommitSessionPointer(ctx, "initial-alpha", agentRef, "ws_alpha_001", "initial_goal", "Build multi-session router core", "os.pc.workspace", baseTime)
	if err != nil || !committed {
		t.Fatalf("initial_goal CommitSessionPointer failed: committed=%v err=%v", committed, err)
	}

	// 2. Incremental update 5 minutes later (< 30 min cooldown) -> throttled (no spam!).
	throttled, err := facade.CommitSessionPointer(ctx, "progress-alpha-1", agentRef, "ws_alpha_001", "progress", "Build multi-session router core v2", "os.pc.workspace", baseTime.Add(5*time.Minute))
	if err != nil || throttled {
		t.Fatalf("expected incremental update within 30m cooldown to be throttled, committed=%v err=%v", throttled, err)
	}
	// A delayed redelivery of the initial milestone must not restart the cooldown.
	if _, err := facade.CommitSessionPointer(ctx, "initial-alpha", agentRef, "ws_alpha_001", "initial_goal", "Build multi-session router core", "os.pc.workspace", baseTime.Add(34*time.Minute)); err != nil {
		t.Fatal(err)
	}

	// 3. Incremental update 35 minutes later with real topic change -> commits and atomically supersedes prior active slot!
	updated, err := facade.CommitSessionPointer(ctx, "progress-alpha-2", agentRef, "ws_alpha_001", "progress", "Multi-session router core shipped with FTS5 tests", "os.pc.workspace", baseTime.Add(35*time.Minute))
	if err != nil || !updated {
		t.Fatalf("post-cooldown CommitSessionPointer failed: committed=%v err=%v", updated, err)
	}

	proj, err := facade.Inspect(ctx, InspectIntent{LocalAgentRef: agentRef, Limit: 50})
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	if proj.CurrentCount != 1 || proj.SupersededCount != 1 {
		t.Fatalf("expected exactly 1 current slot + 1 superseded slot, got current=%d superseded=%d", proj.CurrentCount, proj.SupersededCount)
	}

	// 4. Anti-Resurrection DeleteSession test:
	// Enqueue an UN-DRAINED pending session_pointer event into runtime_cognition_memory_outbox
	// (simulating an in-flight background commit right when the user clicks Delete Session).
	binding, err := store.BindingForAgent(ctx, agentRef)
	if err != nil {
		t.Fatalf("BindingForAgent: %v", err)
	}
	pendingOpID := "cmop_" + ulid.Make().String()
	pendingEnv := &runtimev1.CognitionMemoryCommittedEventEnvelope{
		Event:       &runtimev1.CognitionMemoryEventRef{Value: "cmevt_" + ulid.Make().String()},
		Operation:   &runtimev1.CognitionMemoryOperationRef{Value: pendingOpID},
		Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
		Sources:     []*runtimev1.CognitionMemorySourceRef{{Kind: "session", Value: "ws_alpha_001"}},
		CommittedAt: timestamppb.New(baseTime.Add(40 * time.Minute)),
		Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_SessionPointerCommitted{
			SessionPointerCommitted: &runtimev1.CognitionMemorySessionPointerCommitted{
				WorkSessionRef: "ws_alpha_001",
				ScopeTag:       memoryv1.ScopeTagSessionPointer,
				SlotKey:        "session_ref:ws_alpha_001",
				TopicSummary:   "Ghost memory that MUST NOT resurrect after DeleteSession",
				BodyKind:       "os.pc.workspace",
			},
		},
	}
	if err := store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, agentRef, pendingEnv)
		return err
	}); err != nil {
		t.Fatalf("enqueue ghost pending event: %v", err)
	}

	// Call ForgetSessionLineage -> MUST neutralize pending outbox FIRST and forget committed lineage!
	forgottenCount, neutralizedCount, err := facade.ForgetSessionLineage(ctx, agentRef, "ws_alpha_001")
	if err != nil {
		t.Fatalf("ForgetSessionLineage: %v", err)
	}
	if neutralizedCount != 1 {
		t.Fatalf("expected 1 pending outbox item neutralized, got %d", neutralizedCount)
	}
	if forgottenCount != 2 {
		t.Fatalf("expected 2 lineage memories (superseded + current) forgotten, got %d", forgottenCount)
	}

	// Verify outbox row is cutoff_non_effecting with payload IS NULL.
	var state string
	var payloadPresent bool
	if err := store.backend.DB().QueryRowContext(ctx, `SELECT state, payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE operation_id = ?`, pendingOpID).Scan(&state, &payloadPresent); err != nil {
		t.Fatalf("inspect neutralized outbox row: %v", err)
	}
	if state != "cutoff_non_effecting" || payloadPresent {
		t.Fatalf("expected cutoff_non_effecting with payload=NULL, got state=%q payloadPresent=%v", state, payloadPresent)
	}

	// Attempt to drain outbox afterward -> already settled as zero-payload cutoff_non_effecting, 0 memories resurrected!
	drained, err := bridge.DrainOne(ctx, agentRef)
	if err != nil {
		t.Fatalf("DrainOne after neutralization: %v", err)
	}
	if drained.Drained {
		t.Fatalf("already-settled neutralized outbox event MUST NOT drain again: %+v", drained)
	}
	afterProj, err := facade.Inspect(ctx, InspectIntent{LocalAgentRef: agentRef, Limit: 50})
	if err != nil {
		t.Fatalf("Inspect after delete: %v", err)
	}
	if afterProj.CurrentCount != 0 || afterProj.ForgottenCount != 2 {
		t.Fatalf("expected 0 current & 2 forgotten after ForgetSessionLineage, got current=%d forgotten=%d", afterProj.CurrentCount, afterProj.ForgottenCount)
	}

	// 5. Follow-up unrelated event AFTER neutralization MUST NOT stall with delivery_gap!
	committedBeta, err := facade.CommitSessionPointer(ctx, "initial-beta", agentRef, "ws_beta_002", "initial_goal", "Fresh unrelated session after alpha deleted", "os.pc.workspace", baseTime.Add(50*time.Minute))
	if err != nil || !committedBeta {
		t.Fatalf("expected follow-up event after neutralization to succeed without delivery_gap: committed=%v err=%v", committedBeta, err)
	}
	afterBeta, err := facade.Inspect(ctx, InspectIntent{LocalAgentRef: agentRef, Limit: 50})
	if err != nil {
		t.Fatalf("Inspect after beta commit: %v", err)
	}
	if afterBeta.CurrentCount != 1 {
		t.Fatalf("expected exactly 1 current memory (beta only, zero ghost alpha), got %d", afterBeta.CurrentCount)
	}

	// 6. Already-received (not yet remembered) Cognition receipt MUST also be neutralized by ForgetSessionLineage!
	inFlightOpID := "cmop_" + ulid.Make().String()
	inFlightEnv := &runtimev1.CognitionMemoryCommittedEventEnvelope{
		Event:       &runtimev1.CognitionMemoryEventRef{Value: "cmevt_" + ulid.Make().String()},
		Operation:   &runtimev1.CognitionMemoryOperationRef{Value: inFlightOpID},
		Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
		Sources:     []*runtimev1.CognitionMemorySourceRef{{Kind: "session", Value: "ws_gamma_003"}},
		CommittedAt: timestamppb.New(baseTime.Add(60 * time.Minute)),
		Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_SessionPointerCommitted{
			SessionPointerCommitted: &runtimev1.CognitionMemorySessionPointerCommitted{
				WorkSessionRef: "ws_gamma_003",
				ScopeTag:       memoryv1.ScopeTagSessionPointer,
				SlotKey:        "session_ref:ws_gamma_003",
				TopicSummary:   "In-flight drained receipt before DeleteSession",
				BodyKind:       "os.pc.workspace",
			},
		},
	}
	if err := store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, agentRef, inFlightEnv)
		return err
	}); err != nil {
		t.Fatalf("enqueue in-flight gamma event: %v", err)
	}
	// Drain to Cognition memory_receipts WITHOUT calling ProcessRemember yet!
	inFlightDrain, err := bridge.DrainOne(ctx, agentRef)
	if err != nil || !inFlightDrain.Drained {
		t.Fatalf("drain in-flight gamma event: %+v err=%v", inFlightDrain, err)
	}
	// Now DeleteSession calls ForgetSessionLineage -> MUST neutralize the already-received receipt!
	_, neutGamma, err := facade.ForgetSessionLineage(ctx, agentRef, "ws_gamma_003")
	if err != nil || neutGamma != 1 {
		t.Fatalf("expected 1 already-received Cognition receipt neutralized, got neut=%d err=%v", neutGamma, err)
	}
	// Calling ProcessRemember afterward must return no_effect (zero resurrection)!
	remRes, err := facade.ProcessRemember(ctx, agentRef, inFlightOpID)
	if err != nil {
		t.Fatalf("ProcessRemember on neutralized receipt: %v", err)
	}
	if remRes.Outcome != memoryv1.OutcomeNoEffect || len(remRes.AffectedMemoryRefs) != 0 {
		t.Fatalf("expected no_effect on neutralized receipt, got %+v", remRes)
	}

	// 7. Tainted external source MUST be rejected by CommitSessionPointer.
	taintedCommitted, err := facade.CommitSessionPointer(ctx, "external", agentRef, "ws_ext_004", "initial_goal", "Untrusted external summary", "channel_external", baseTime.Add(70*time.Minute))
	if err != nil || taintedCommitted {
		t.Fatalf("expected tainted channel_external source to be rejected, committed=%v err=%v", taintedCommitted, err)
	}
}

func TestSessionPointerAuditRecoveryScopeTagAndCutoffFences(t *testing.T) {
	ctx := context.Background()
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	const agentRef = "agent-session-recovery"
	_ = createTestBinding(t, backend, store, agentRef, true)
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
	baseTime := time.Date(2026, 11, 24, 15, 0, 0, 0, time.UTC)

	// 1. Scope-tag isolation: a session_pointer row and a global_fact row with identical
	//    content MUST NOT deduplicate each other during rememberInputs.
	committed, err := facade.CommitSessionPointer(ctx, "scope", agentRef, "ws_scope_001", "initial_goal", "I prefer dark roast coffee", "os.pc.workspace", baseTime)
	if err != nil || !committed {
		t.Fatalf("commit session pointer: committed=%v err=%v", committed, err)
	}
	binding, err := store.BindingForAgent(ctx, agentRef)
	if err != nil {
		t.Fatalf("BindingForAgent: %v", err)
	}
	msgOpID := "cmop_" + ulid.Make().String()
	msgEnv := &runtimev1.CognitionMemoryCommittedEventEnvelope{
		Event:       &runtimev1.CognitionMemoryEventRef{Value: "cmevt_" + ulid.Make().String()},
		Operation:   &runtimev1.CognitionMemoryOperationRef{Value: msgOpID},
		Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
		Sources:     []*runtimev1.CognitionMemorySourceRef{{Kind: "conversation", Value: "conv-1"}},
		CommittedAt: timestamppb.New(baseTime.Add(1 * time.Minute)),
		Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_MessageCommitted{
			MessageCommitted: &runtimev1.CognitionMemoryMessageCommitted{
				Actor:        runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_USER,
				Conversation: &runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: "conv-1"},
				Message:      &runtimev1.CognitionMemorySourceRef{Kind: "message", Value: "msg-1"},
				Parts: []*runtimev1.CognitionMemoryMessagePart{{
					Part: &runtimev1.CognitionMemorySourceRef{Kind: "part", Value: "part-1"},
					Content: &runtimev1.CognitionMemoryMessagePart_Text{
						Text: &runtimev1.CognitionMemoryTextPart{Text: "I prefer dark roast coffee"},
					},
				}},
			},
		},
	}
	if err := store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, agentRef, msgEnv)
		return err
	}); err != nil {
		t.Fatalf("enqueue global_fact message: %v", err)
	}
	if drained, err := bridge.DrainOne(ctx, agentRef); err != nil || !drained.Drained {
		t.Fatalf("drain global_fact message: %+v err=%v", drained, err)
	}
	rem, err := facade.ProcessRemember(ctx, agentRef, msgOpID)
	if err != nil || rem.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("expected global_fact message to be admitted independently of session_pointer with identical text, got %+v err=%v", rem, err)
	}

	// 2. Crash recovery between owner.Commit and store.AcknowledgeReceived:
	//    Enqueue an event, deliver directly to owner.Commit WITHOUT calling AcknowledgeReceived,
	//    then run ForgetSessionLineage -> ReceiveNoOpCutoff MUST convert pending commit custody
	//    without OutcomeConflict and advance frontier cleanly!
	crashOpID := "cmop_" + ulid.Make().String()
	crashEvtID := "cmevt_" + ulid.Make().String()
	crashEnv := &runtimev1.CognitionMemoryCommittedEventEnvelope{
		Event:       &runtimev1.CognitionMemoryEventRef{Value: crashEvtID},
		Operation:   &runtimev1.CognitionMemoryOperationRef{Value: crashOpID},
		Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
		Sources:     []*runtimev1.CognitionMemorySourceRef{{Kind: "session", Value: "ws_crash_002"}},
		CommittedAt: timestamppb.New(baseTime.Add(2 * time.Minute)),
		Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_SessionPointerCommitted{
			SessionPointerCommitted: &runtimev1.CognitionMemorySessionPointerCommitted{
				WorkSessionRef: "ws_crash_002",
				ScopeTag:       memoryv1.ScopeTagSessionPointer,
				SlotKey:        "session_ref:ws_crash_002",
				TopicSummary:   "Crash window pointer before ACK",
				BodyKind:       "os.pc.workspace",
			},
		},
	}
	var crashItem OutboxItem
	if err := store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var enqErr error
		crashItem, enqErr = store.EnqueueCommittedEventTx(tx, agentRef, crashEnv)
		return enqErr
	}); err != nil {
		t.Fatalf("enqueue crash event: %v", err)
	}
	// Simulate owner.Commit succeeding while process crashes before store.AcknowledgeReceived.
	commitEnv := crashItem.Envelope
	commitEnv.LifecycleCutoff = &runtimev1.CognitionMemoryLifecycleCutoffRef{Value: binding.LifecycleRef}
	if _, err := ownerPort.Commit(ctx, &runtimev1.CognitionMemoryCommitRequest{Envelope: commitEnv}); err != nil {
		t.Fatalf("simulated direct owner.Commit: %v", err)
	}
	// Also simulate in-flight MarkProcessing on that receipt before DeleteSession arrives!
	if _, err := owner.MarkProcessing(ctx, crashOpID); err != nil {
		t.Fatalf("MarkProcessing on crashOpID: %v", err)
	}
	if _, _, err := facade.ForgetSessionLineage(ctx, agentRef, "ws_crash_002"); err != nil {
		t.Fatalf("ForgetSessionLineage after commit-without-ACK crash MUST recover cleanly: %v", err)
	}

	// 3. Late CommitSessionPointer after ForgetSessionLineage MUST be blocked by deleted_session_cutoffs!
	resurrected, err := facade.CommitSessionPointer(ctx, "late", agentRef, "ws_crash_002", "completed", "Late milestone after DeleteSession", "os.pc.workspace", baseTime.Add(5*time.Minute))
	if err != nil || resurrected {
		t.Fatalf("late CommitSessionPointer after DeleteSession MUST NOT resurrect: committed=%v err=%v", resurrected, err)
	}

	// 4. Non-head neutralized outbox row: seq=N live message + seq=N+1 deleted session.
	//    DeleteSession neutralizes seq=N+1; draining seq=N then seq=N+1 settles seq=N+1 as
	//    cutoff_noop (OutcomeNoEffect), and calling ProcessRemember on cutoff_noop returns
	//    OutcomeNoEffect rather than OutcomeInvalid(unknown_operation).
	liveOpID := "cmop_" + ulid.Make().String()
	liveEnv := &runtimev1.CognitionMemoryCommittedEventEnvelope{
		Event:       &runtimev1.CognitionMemoryEventRef{Value: "cmevt_" + ulid.Make().String()},
		Operation:   &runtimev1.CognitionMemoryOperationRef{Value: liveOpID},
		Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
		Sources:     []*runtimev1.CognitionMemorySourceRef{{Kind: "conversation", Value: "conv-2"}},
		CommittedAt: timestamppb.New(baseTime.Add(10 * time.Minute)),
		Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_MessageCommitted{
			MessageCommitted: &runtimev1.CognitionMemoryMessageCommitted{
				Actor:        runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_USER,
				Conversation: &runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: "conv-2"},
				Message:      &runtimev1.CognitionMemorySourceRef{Kind: "message", Value: "msg-2"},
				Parts: []*runtimev1.CognitionMemoryMessagePart{{
					Part: &runtimev1.CognitionMemorySourceRef{Kind: "part", Value: "part-2"},
					Content: &runtimev1.CognitionMemoryMessagePart_Text{
						Text: &runtimev1.CognitionMemoryTextPart{Text: "I prefer jasmine green tea"},
					},
				}},
			},
		},
	}
	nonHeadOpID := "cmop_" + ulid.Make().String()
	nonHeadEnv := &runtimev1.CognitionMemoryCommittedEventEnvelope{
		Event:       &runtimev1.CognitionMemoryEventRef{Value: "cmevt_" + ulid.Make().String()},
		Operation:   &runtimev1.CognitionMemoryOperationRef{Value: nonHeadOpID},
		Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
		Sources:     []*runtimev1.CognitionMemorySourceRef{{Kind: "session", Value: "ws_nonhead_003"}},
		CommittedAt: timestamppb.New(baseTime.Add(11 * time.Minute)),
		Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_SessionPointerCommitted{
			SessionPointerCommitted: &runtimev1.CognitionMemorySessionPointerCommitted{
				WorkSessionRef: "ws_nonhead_003",
				ScopeTag:       memoryv1.ScopeTagSessionPointer,
				SlotKey:        "session_ref:ws_nonhead_003",
				TopicSummary:   "Non-head deleted session",
				BodyKind:       "os.pc.workspace",
			},
		},
	}
	if err := store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if _, err := store.EnqueueCommittedEventTx(tx, agentRef, liveEnv); err != nil {
			return err
		}
		_, err := store.EnqueueCommittedEventTx(tx, agentRef, nonHeadEnv)
		return err
	}); err != nil {
		t.Fatalf("enqueue live + non-head events: %v", err)
	}
	if _, _, err := facade.ForgetSessionLineage(ctx, agentRef, "ws_nonhead_003"); err != nil {
		t.Fatalf("ForgetSessionLineage for non-head session: %v", err)
	}
	// Drain seq=N (live)
	d1, err := bridge.DrainOne(ctx, agentRef)
	if err != nil || !d1.Drained || d1.OperationID != liveOpID {
		t.Fatalf("drain live head item: %+v err=%v", d1, err)
	}
	if _, err := facade.ProcessRemember(ctx, agentRef, liveOpID); err != nil {
		t.Fatalf("ProcessRemember live item: %v", err)
	}
	// Drain seq=N+1 (neutralized non-head cutoff_noop)
	d2, err := bridge.DrainOne(ctx, agentRef)
	if err != nil || !d2.Drained || d2.OperationID != nonHeadOpID || d2.Outcome != memoryv1.OutcomeNoEffect {
		t.Fatalf("drain non-head neutralized item: %+v err=%v", d2, err)
	}
	// Calling ProcessRemember on cutoff_noop MUST succeed as OutcomeNoEffect (never unknown_operation)!
	noopRes, err := facade.ProcessRemember(ctx, agentRef, nonHeadOpID)
	if err != nil || noopRes.Outcome != memoryv1.OutcomeNoEffect {
		t.Fatalf("ProcessRemember on cutoff_noop must return OutcomeNoEffect, got %+v err=%v", noopRes, err)
	}
}

func TestSessionPointerContentFreeAndSlotKeyFilterFacadeRecall(t *testing.T) {
	ctx := context.Background()
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	const agentRef = "agent-named-brief-facade"
	_ = createTestBinding(t, backend, store, agentRef, true)
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

	baseTime := time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)
	// Content-free named-handoff pointer commits cleanly with empty summary.
	committed, err := facade.CommitSessionPointer(ctx, "named-empty-1", agentRef, "ws_named_1", "completed", "", "os.pc.workspace", baseTime)
	if err != nil || !committed {
		t.Fatalf("content-free CommitSessionPointer failed: committed=%v err=%v", committed, err)
	}
	// Normal pointer + simulated legacy restricted pointer with private term.
	if _, err := facade.CommitSessionPointer(ctx, "norm-1", agentRef, "ws_norm_1", "completed", "春季发布清单审核", "os.pc.workspace", baseTime); err != nil {
		t.Fatalf("commit norm-1: %v", err)
	}
	if _, err := facade.CommitSessionPointer(ctx, "legacy-priv-1", agentRef, "ws_legacy_priv", "completed", "朱砂秘钥 春季发布清单审核 春季发布清单审核", "os.pc.workspace", baseTime); err != nil {
		t.Fatalf("commit legacy-priv-1: %v", err)
	}

	// Private word filtered out via AllowedSlotKeys returns OutcomeNoHits.
	privRes, err := facade.Recall(ctx, RecallIntent{
		NoModelWork:     true,
		LocalAgentRef:   agentRef,
		Query:           "朱砂秘钥",
		Limit:           4,
		ScopeTags:       []string{memoryv1.ScopeTagSessionPointer},
		FilterSlotKeys:  true,
		AllowedSlotKeys: []string{"session_ref:ws_norm_1"},
	})
	if err != nil || privRes.Outcome != memoryv1.OutcomeNoHits || len(privRes.Hits) != 0 {
		t.Fatalf("filtered private recall must return OutcomeNoHits, got %+v err=%v", privRes, err)
	}

	// Shared word with Limit=1 still returns eligible ws_norm_1 even though hidden legacy has higher TF.
	sharedRes, err := facade.Recall(ctx, RecallIntent{
		NoModelWork:     true,
		LocalAgentRef:   agentRef,
		Query:           "春季发布清单审核",
		Limit:           1,
		ScopeTags:       []string{memoryv1.ScopeTagSessionPointer},
		FilterSlotKeys:  true,
		AllowedSlotKeys: []string{"session_ref:ws_norm_1"},
	})
	if err != nil || sharedRes.Outcome != memoryv1.OutcomeReady || len(sharedRes.Hits) != 1 || sharedRes.Hits[0].SlotKey != "session_ref:ws_norm_1" {
		t.Fatalf("filtered shared recall must return eligible ws_norm_1 without hidden quota interference: %+v err=%v", sharedRes, err)
	}
}

func TestRestrictedSessionLegacyOutboxReplayExcludesPrivateContentWhileAdvancingOrdinaryPointers(t *testing.T) {
	ctx := context.Background()
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	const agentRef = "agent-legacy-replay-fence"
	binding := createTestBinding(t, backend, store, agentRef, true)
	core, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open Cognition owner: %v", err)
	}
	t.Cleanup(func() { _ = core.Close() })
	authorize := func(context.Context, Binding) error { return nil }
	ownerPort := newTestOwnerPort(store, core, nil)
	bridge := NewBridge(store, ownerPort, authorize)
	facade := NewFacade(store, ownerPort, bridge, authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{ConfigRevision: 1, Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})

	baseTime := time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)
	enqueuePending := func(deliveryID, sessionRef, summary string, offset time.Duration) string {
		opID := "cmop_" + deliveryID
		env := &runtimev1.CognitionMemoryCommittedEventEnvelope{
			Event:       &runtimev1.CognitionMemoryEventRef{Value: "cmevt_" + deliveryID},
			Operation:   &runtimev1.CognitionMemoryOperationRef{Value: opID},
			Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
			Sources:     []*runtimev1.CognitionMemorySourceRef{{Kind: "session", Value: sessionRef}},
			CommittedAt: timestamppb.New(baseTime.Add(offset)),
			Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_SessionPointerCommitted{
				SessionPointerCommitted: &runtimev1.CognitionMemorySessionPointerCommitted{
					WorkSessionRef: sessionRef,
					ScopeTag:       memoryv1.ScopeTagSessionPointer,
					SlotKey:        "session_ref:" + sessionRef,
					TopicSummary:   summary,
					BodyKind:       "os.pc.workspace",
				},
			},
		}
		if err := store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
			_, err := store.EnqueueCommittedEventTx(tx, agentRef, env)
			return err
		}); err != nil {
			t.Fatalf("seed legacy pending envelope %s: %v", deliveryID, err)
		}
		return opID
	}

	restrictedOp1 := enqueuePending("legacy-restricted-1", "ws_restricted_legacy", "朱砂暗语-旧待投机密摘要", 1*time.Minute)
	ordinaryOp1 := enqueuePending("legacy-ordinary-1", "ws_ordinary_1", "公开常规工作计划摘要", 2*time.Minute)
	restrictedOp2 := enqueuePending("legacy-restricted-2", "ws_restricted_legacy", "朱砂暗语-第二条旧待投", 3*time.Minute)
	ordinaryOp2 := enqueuePending("legacy-ordinary-2", "ws_ordinary_2", "公开第二个任务进展", 4*time.Minute)

	// 1. Fail-closed: lookup error blocks delivery without leaking.
	facade.SetSessionRestrictionChecker(func(_ context.Context, _, _ string) (bool, error) {
		return false, errors.New("sessions.db temporarily unavailable")
	})
	if err := bridge.ReplayStartup(ctx); err == nil {
		t.Fatal("expected ReplayStartup to fail closed when restriction checker errors")
	}

	// 2. Real restriction predicate: restricted envelopes neutralized, ordinary pointers advance in order.
	facade.SetSessionRestrictionChecker(func(_ context.Context, _, workSessionRef string) (bool, error) {
		return workSessionRef == "ws_restricted_legacy", nil
	})
	if err := bridge.ReplayStartup(ctx); err != nil {
		t.Fatalf("ReplayStartup with restriction checker: %v", err)
	}
	for _, opID := range []string{ordinaryOp1, ordinaryOp2} {
		if _, err := facade.ProcessRemember(ctx, agentRef, opID); err != nil {
			t.Fatalf("ProcessRemember ordinary %s: %v", opID, err)
		}
	}

	for _, opID := range []string{restrictedOp1, restrictedOp2} {
		var state string
		var payloadPresent bool
		if err := store.backend.DB().QueryRowContext(ctx, `SELECT state, payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE operation_id = ?`, opID).Scan(&state, &payloadPresent); err != nil {
			t.Fatalf("inspect restricted outbox row %s: %v", opID, err)
		}
		if state != "cutoff_non_effecting" || payloadPresent {
			t.Fatalf("restricted outbox row %s was not neutralized: state=%q payloadPresent=%v", opID, state, payloadPresent)
		}
	}

	proj, err := facade.Inspect(ctx, InspectIntent{LocalAgentRef: agentRef, Limit: 50})
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	if proj.CurrentCount != 2 {
		t.Fatalf("expected exactly 2 ordinary memories (0 restricted), got current=%d items=%+v", proj.CurrentCount, proj.Items)
	}
	for _, item := range proj.Items {
		if item.SlotKey == "session_ref:ws_restricted_legacy" || item.Content == "朱砂暗语-旧待投机密摘要" || item.Content == "朱砂暗语-第二条旧待投" {
			t.Fatalf("restricted private content leaked into general Memory: %+v", item)
		}
	}
	secretRecall, err := facade.Recall(ctx, RecallIntent{
		NoModelWork:   true,
		LocalAgentRef: agentRef,
		Query:         "朱砂暗语",
		Limit:         10,
		ScopeTags:     []string{memoryv1.ScopeTagSessionPointer},
	})
	if err != nil || len(secretRecall.Hits) != 0 {
		t.Fatalf("private legacy summary entered FTS5 recall index: hits=%+v err=%v", secretRecall.Hits, err)
	}
	ordinaryRecall, err := facade.Recall(ctx, RecallIntent{
		NoModelWork:   true,
		LocalAgentRef: agentRef,
		Query:         "常规工作计划",
		Limit:         10,
		ScopeTags:     []string{memoryv1.ScopeTagSessionPointer},
	})
	if err != nil || len(ordinaryRecall.Hits) != 1 || ordinaryRecall.Hits[0].SlotKey != "session_ref:ws_ordinary_1" {
		t.Fatalf("ordinary pointer did not commit cleanly in order: hits=%+v err=%v", ordinaryRecall.Hits, err)
	}

	// 3. Idempotency: repeated ReplayStartup and re-delivery of neutralized deliveryID are no-ops.
	if err := bridge.ReplayStartup(ctx); err != nil {
		t.Fatalf("idempotent ReplayStartup: %v", err)
	}
	if committed, err := facade.CommitSessionPointer(ctx, "legacy-restricted-1", agentRef, "ws_restricted_legacy", "completed", "朱砂暗语-重投", "os.pc.workspace", baseTime.Add(5*time.Minute)); err != nil || committed {
		t.Fatalf("replaying neutralized deliveryID must stay idempotent no-op: committed=%v err=%v", committed, err)
	}

	// 4. Direct publication for a restricted session scrubs TopicSummary to content-free pointer.
	if committed, err := facade.CommitSessionPointer(ctx, "restricted-new-milestone", agentRef, "ws_restricted_legacy", "completed", "绝密新简报词", "os.pc.workspace", baseTime.Add(10*time.Minute)); err != nil || !committed {
		t.Fatalf("content-free opaque pointer for active restricted session failed: committed=%v err=%v", committed, err)
	}
	secretRecall2, err := facade.Recall(ctx, RecallIntent{
		NoModelWork:   true,
		LocalAgentRef: agentRef,
		Query:         "绝密新简报词",
		Limit:         10,
		ScopeTags:     []string{memoryv1.ScopeTagSessionPointer},
	})
	if err != nil || len(secretRecall2.Hits) != 0 {
		t.Fatalf("direct CommitSessionPointer leaked restricted summary: hits=%+v err=%v", secretRecall2.Hits, err)
	}

	// 5. Forget / DeleteSession barrier stays intact and subsequent ordinary session advances cleanly.
	forgotten, _, err := facade.ForgetSessionLineage(ctx, agentRef, "ws_restricted_legacy")
	if err != nil || forgotten != 1 {
		t.Fatalf("ForgetSessionLineage on restricted session failed: forgotten=%d err=%v", forgotten, err)
	}
	if committed, err := facade.CommitSessionPointer(ctx, "restricted-after-forget", agentRef, "ws_restricted_legacy", "completed", "", "os.pc.workspace", baseTime.Add(15*time.Minute)); err != nil || committed {
		t.Fatalf("late commit after ForgetSessionLineage must be blocked: committed=%v err=%v", committed, err)
	}
	if committed, err := facade.CommitSessionPointer(ctx, "ordinary-after-forget", agentRef, "ws_ordinary_3", "initial_goal", "删除后继续推进的普通会话", "os.pc.workspace", baseTime.Add(20*time.Minute)); err != nil || !committed {
		t.Fatalf("ordinary pointer after restricted Forget stalled: committed=%v err=%v", committed, err)
	}
}
