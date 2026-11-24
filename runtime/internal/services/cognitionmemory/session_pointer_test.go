package cognitionmemory

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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

	// 1. Commit initial_goal pointer -> succeeds immediately (and ensures bank via bridge).
	baseTime := time.Date(2026, 11, 24, 14, 0, 0, 0, time.UTC)
	committed, err := facade.CommitSessionPointer(ctx, agentRef, "ws_alpha_001", "initial_goal", "Build multi-session router core", "os.pc.workspace", baseTime)
	if err != nil || !committed {
		t.Fatalf("initial_goal CommitSessionPointer failed: committed=%v err=%v", committed, err)
	}

	// 2. Incremental update 5 minutes later (< 30 min cooldown) -> throttled (no spam!).
	throttled, err := facade.CommitSessionPointer(ctx, agentRef, "ws_alpha_001", "progress", "Build multi-session router core v2", "os.pc.workspace", baseTime.Add(5*time.Minute))
	if err != nil || throttled {
		t.Fatalf("expected incremental update within 30m cooldown to be throttled, committed=%v err=%v", throttled, err)
	}

	// 3. Incremental update 35 minutes later with real topic change -> commits and atomically supersedes prior active slot!
	updated, err := facade.CommitSessionPointer(ctx, agentRef, "ws_alpha_001", "progress", "Multi-session router core shipped with FTS5 tests", "os.pc.workspace", baseTime.Add(35*time.Minute))
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

	// Attempt to drain outbox afterward -> MUST drain 0 items and resurrect 0 memories!
	drained, err := bridge.DrainOne(ctx, agentRef)
	if err != nil {
		t.Fatalf("DrainOne after neutralization: %v", err)
	}
	if drained.Drained {
		t.Fatalf("neutralized outbox event MUST NOT drain or resurrect: %+v", drained)
	}
	afterProj, err := facade.Inspect(ctx, InspectIntent{LocalAgentRef: agentRef, Limit: 50})
	if err != nil {
		t.Fatalf("Inspect after delete: %v", err)
	}
	if afterProj.CurrentCount != 0 || afterProj.ForgottenCount != 2 {
		t.Fatalf("expected 0 current & 2 forgotten after ForgetSessionLineage, got current=%d forgotten=%d", afterProj.CurrentCount, afterProj.ForgottenCount)
	}
}
