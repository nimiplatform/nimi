package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// newRuntimeAgentHardDeleteTestService builds a runtime-agent Service and
// returns it together with its backing memory service so K-AGCORE-141 tests
// can assert the agent-scoped memory half of the hard delete directly.
func newRuntimeAgentHardDeleteTestService(t *testing.T) (*Service, *memoryservice.Service) {
	t.Helper()
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	setRuntimeAgentManagedEmbeddingProfileForTest(memorySvc, &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)
	return svc, memorySvc
}

func runtimeAgentRowCount(t *testing.T, svc *Service, table string, column string, value string) int {
	t.Helper()
	var count int
	if err := svc.backend.DB().QueryRow(
		"SELECT COUNT(*) FROM "+table+" WHERE "+column+" = ?", value,
	).Scan(&count); err != nil {
		t.Fatalf("count %s.%s=%q: %v", table, column, value, err)
	}
	return count
}

// TestTerminateAgentHardDeletesProjectionAndAgentScopedMemory is the core
// K-AGCORE-141 conformance: TerminateAgent physically removes the
// runtime_local_agent row, the agent state projection, the agent event log,
// runtime-owned hooks, and every agent-scoped memory bank (AGENT_CORE +
// AGENT_DYADIC). It also purges the bank_locator_key / local_agent_ref keyed
// projection tables that the snapshot rewrite does not cover.
func TestTerminateAgentHardDeletesProjectionAndAgentScopedMemory(t *testing.T) {
	t.Parallel()

	svc, memorySvc := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	const runtimeSourceRef = "agent-hard-delete"
	localRef := testRuntimeAgentLocalRef(runtimeSourceRef)

	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}

	// Materialize a second agent so the delete is provably scoped.
	const survivorRuntimeSourceRef = "agent-hard-delete-survivor"
	survivorRef := testRuntimeAgentLocalRef(survivorRuntimeSourceRef)
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext(survivorRuntimeSourceRef),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization(survivor): %v", err)
	}

	// Set a dyadic context and write a dyadic memory record so the agent owns
	// an AGENT_DYADIC bank in addition to its AGENT_CORE bank.
	if _, err := svc.UpdateAgentState(ctx, &runtimev1.UpdateAgentStateRequest{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
		AgentId: runtimeSourceRef,
		Mutations: []*runtimev1.AgentStateMutation{
			{Mutation: &runtimev1.AgentStateMutation_SetDyadicContext{
				SetDyadicContext: &runtimev1.AgentStateSetDyadicContext{UserId: "user-hd"},
			}},
		},
	}); err != nil {
		t.Fatalf("UpdateAgentState(dyadic): %v", err)
	}
	if _, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
		AgentId: runtimeSourceRef,
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
					Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
						AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: localRef, UserId: "user-hd"},
					},
				},
				Extensions: completePromotionEvidence(t, svc),
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{Observation: "dyadic memory for hard-delete"},
					},
				},
			},
		},
	}); err != nil {
		t.Fatalf("WriteAgentMemory(dyadic): %v", err)
	}

	coreBankKey := memoryservice.LocatorKey(&runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: localRef}},
	})
	dyadicBankKey := memoryservice.LocatorKey(&runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
		Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
			AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: localRef, UserId: "user-hd"},
		},
	})
	survivorCoreBankKey := memoryservice.LocatorKey(&runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: survivorRef}},
	})
	for _, bank := range []struct {
		locator *runtimev1.MemoryBankLocator
		name    string
	}{
		{
			locator: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
				Owner: &runtimev1.MemoryBankLocator_AgentCore{AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: localRef}},
			},
			name: "target Agent Memory",
		},
		{
			locator: &runtimev1.MemoryBankLocator{
				Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
				Owner: &runtimev1.MemoryBankLocator_AgentCore{AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: survivorRef}},
			},
			name: "survivor Agent Memory",
		},
	} {
		if _, err := memorySvc.EnsureCanonicalBank(ctx, bank.locator, bank.name, nil); err != nil {
			t.Fatalf("EnsureCanonicalBank(%s): %v", bank.name, err)
		}
	}

	// Seed every bank_locator_key / locator_key projection table the snapshot
	// rewrite does NOT cover, for both the target's core+dyadic banks and the
	// survivor's core bank. Orphaned rows here are the partial deletion
	// K-AGCORE-141 forbids.
	seedBankLocatorKeyTables(t, svc, coreBankKey)
	seedBankLocatorKeyTables(t, svc, dyadicBankKey)
	seedBankLocatorKeyTables(t, svc, survivorCoreBankKey)
	// Seed the runtime-agent-side projection tables.
	seedRuntimeAgentSideTables(t, svc, localRef, coreBankKey)
	seedRuntimeAgentSideTables(t, svc, survivorRef, survivorCoreBankKey)

	// Preconditions: target rows exist.
	if got := runtimeAgentRowCount(t, svc, "runtime_local_agent", "local_agent_ref", localRef); got != 1 {
		t.Fatalf("precondition runtime_local_agent rows = %d, want 1", got)
	}
	if got := runtimeAgentRowCount(t, svc, "memory_bank", "locator_key", coreBankKey); got != 1 {
		t.Fatalf("precondition agent-core memory_bank rows = %d, want 1", got)
	}
	if got := runtimeAgentRowCount(t, svc, "memory_bank", "locator_key", dyadicBankKey); got != 1 {
		t.Fatalf("precondition agent-dyadic memory_bank rows = %d, want 1", got)
	}

	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
		AgentId: runtimeSourceRef,
		Reason:  "agent friend removed",
	}); err != nil {
		t.Fatalf("TerminateAgent: %v", err)
	}

	// Runtime-agent projection: row, state projection, hooks, event log gone.
	for _, table := range []struct{ name, column string }{
		{"runtime_local_agent", "local_agent_ref"},
		{"runtime_local_agent_state_projection", "local_agent_ref"},
		{"runtime_local_agent_hook", "local_agent_ref"},
		{"runtime_local_agent_event_log", "local_agent_ref"},
		{"runtime_local_agent_behavioral_posture", "local_agent_ref"},
		{"runtime_local_agent_review_run", "local_agent_ref"},
	} {
		if got := runtimeAgentRowCount(t, svc, table.name, table.column, localRef); got != 0 {
			t.Fatalf("%s rows for terminated agent = %d, want 0", table.name, got)
		}
	}

	// Agent-scoped memory banks gone.
	if got := runtimeAgentRowCount(t, svc, "memory_bank", "locator_key", coreBankKey); got != 0 {
		t.Fatalf("agent-core memory_bank rows after terminate = %d, want 0", got)
	}
	if got := runtimeAgentRowCount(t, svc, "memory_bank", "locator_key", dyadicBankKey); got != 0 {
		t.Fatalf("agent-dyadic memory_bank rows after terminate = %d, want 0", got)
	}

	// Every bank_locator_key keyed projection table purged for both banks.
	assertBankLocatorKeyTablesEmpty(t, svc, coreBankKey)
	assertBankLocatorKeyTablesEmpty(t, svc, dyadicBankKey)
	if got := runtimeAgentRowCount(t, svc, "runtime_local_agent_review_followup", "bank_locator_key", coreBankKey); got != 0 {
		t.Fatalf("runtime_local_agent_review_followup rows for agent-core bank = %d, want 0", got)
	}

	// In-memory: agent is gone, memory banks gone.
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetAgent after terminate: status = %s, want NotFound", status.Code(err))
	}
	if _, err := memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: localRef}},
	}}); status.Code(err) != codes.NotFound {
		t.Fatalf("agent-core bank after terminate: status = %s, want NotFound", status.Code(err))
	}

	// Survivor agent untouched: row and every seeded projection table intact.
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(survivorRuntimeSourceRef)}); err != nil {
		t.Fatalf("GetAgent(survivor) after terminate: %v", err)
	}
	if got := runtimeAgentRowCount(t, svc, "runtime_local_agent", "local_agent_ref", survivorRef); got != 1 {
		t.Fatalf("survivor runtime_local_agent rows = %d, want 1", got)
	}
	if got := runtimeAgentRowCount(t, svc, "memory_narrative", "bank_locator_key", survivorCoreBankKey); got != 1 {
		t.Fatalf("survivor memory_narrative rows = %d, want 1 (delete must be agent-scoped)", got)
	}
	if got := runtimeAgentRowCount(t, svc, "agent_truth", "bank_locator_key", survivorCoreBankKey); got != 1 {
		t.Fatalf("survivor agent_truth rows = %d, want 1 (delete must be agent-scoped)", got)
	}
	if got := runtimeAgentRowCount(t, svc, "runtime_local_agent_review_run", "local_agent_ref", survivorRef); got != 1 {
		t.Fatalf("survivor runtime_local_agent_review_run rows = %d, want 1", got)
	}
}

// TestTerminateAgentSnapshotDoesNotReinsertDeletedRef proves a deleted
// local_agent_ref does not reappear after a snapshot reload (K-AGCORE-141
// "runtime snapshot persistence must not re-insert a deleted local_agent_ref").
func TestTerminateAgentSnapshotDoesNotReinsertDeletedRef(t *testing.T) {
	t.Parallel()

	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	const runtimeSourceRef = "agent-snapshot-delete"
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
		AgentId: runtimeSourceRef,
	}); err != nil {
		t.Fatalf("TerminateAgent: %v", err)
	}
	// Reload in-memory state from the persisted snapshot.
	if err := svc.loadState(); err != nil {
		t.Fatalf("loadState after terminate: %v", err)
	}
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetAgent after snapshot reload: status = %s, want NotFound (deleted ref must not reappear)", status.Code(err))
	}
}

// TestTerminateAgentIdempotentTypedNoOpForAbsentRef proves TerminateAgent for
// a never-materialized local_agent_ref succeeds as a typed no-op rather than
// failing not-found (K-AGCORE-141 fixed rule).
func TestTerminateAgentIdempotentTypedNoOpForAbsentRef(t *testing.T) {
	t.Parallel()

	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	resp, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-never-existed"),
		AgentId: "agent-never-existed",
	})
	if err != nil {
		t.Fatalf("TerminateAgent(absent ref): %v", err)
	}
	if !resp.GetAck().GetOk() {
		t.Fatalf("TerminateAgent(absent ref) ack = %#v, want ok", resp.GetAck())
	}

	// And idempotent after a real delete: a second terminate is still a no-op.
	const runtimeSourceRef = "agent-idempotent-delete"
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	for i := 0; i < 2; i++ {
		resp, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
			Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
			AgentId: runtimeSourceRef,
		})
		if err != nil {
			t.Fatalf("TerminateAgent attempt %d: %v", i, err)
		}
		if !resp.GetAck().GetOk() {
			t.Fatalf("TerminateAgent attempt %d ack = %#v, want ok", i, resp.GetAck())
		}
	}
}

// TestTerminateAgentSubstrateFailureFailsClosed proves a persistence-substrate
// failure during deletion returns a typed error and leaves no partial
// deletion: the projection row and its agent-scoped memory bank are both still
// present (K-AGCORE-141 "either completes together or fails closed").
func TestTerminateAgentSubstrateFailureFailsClosed(t *testing.T) {
	t.Parallel()

	svc, memorySvc := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	const runtimeSourceRef = "agent-fail-closed"
	localRef := testRuntimeAgentLocalRef(runtimeSourceRef)
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	if _, err := memorySvc.EnsureCanonicalBank(ctx, &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: localRef},
		},
	}, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}

	// Close the shared persistence backend so the deletion transaction fails.
	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("close backend: %v", err)
	}

	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
		AgentId: runtimeSourceRef,
	}); err == nil {
		t.Fatal("TerminateAgent on a failed substrate must return a typed error, not pseudo-success")
	}

	// No partial deletion: the in-memory projection row and the agent-scoped
	// memory bank both survive the failed delete.
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); err != nil {
		t.Fatalf("GetAgent after failed terminate: %v (the row must not be partially deleted)", err)
	}
	if _, err := memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: localRef}},
	}}); err != nil {
		t.Fatalf("agent-core bank after failed terminate: %v (memory must not be partially deleted)", err)
	}
}

// seedBankLocatorKeyTables inserts one row keyed by bankLocatorKey into every
// memory projection table that persistSnapshotWithTxHook does NOT rewrite, so
// a test can prove the K-AGCORE-141 tx-hook purge reaches each table.
func seedBankLocatorKeyTables(t *testing.T, svc *Service, bankLocatorKey string) {
	t.Helper()
	db := svc.backend.DB()
	stmts := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO memory_narrative(narrative_id, bank_locator_key, topic, content, source_version, status, created_at, updated_at) VALUES (?, ?, 't', 'c', 'v', 'admitted', 'now', 'now')`,
			[]any{"nar-" + bankLocatorKey, bankLocatorKey}},
		{`INSERT INTO memory_narrative_embedding(locator_key, narrative_id, embedding_profile_json, vector_json, updated_at) VALUES (?, ?, '{}', '[]', 'now')`,
			[]any{bankLocatorKey, "nar-" + bankLocatorKey}},
		{`INSERT INTO memory_narrative_alias(bank_locator_key, narrative_id, alias_norm, alias_display, status, updated_at) VALUES (?, ?, 'a', 'A', 'active', 'now')`,
			[]any{bankLocatorKey, "nar-" + bankLocatorKey}},
		{`INSERT INTO narrative_source(narrative_id, memory_id, bank_locator_key, absorbed_at) VALUES (?, ?, ?, 'now')`,
			[]any{"nar-" + bankLocatorKey, "mem-" + bankLocatorKey, bankLocatorKey}},
		{`INSERT INTO memory_relation(relation_id, bank_locator_key, source_id, target_id, relation_type, confidence, created_by, created_at) VALUES (?, ?, 's', 't', 'rel', 1.0, 'test', 'now')`,
			[]any{"rel-" + bankLocatorKey, bankLocatorKey}},
		{`INSERT INTO memory_recall_feedback_event(feedback_id, bank_locator_key, target_kind, target_id, polarity, query_text, source_system, created_at) VALUES (?, ?, 'k', 'i', 'p', 'q', 's', 'now')`,
			[]any{"fb-" + bankLocatorKey, bankLocatorKey}},
		{`INSERT INTO memory_recall_feedback_summary(bank_locator_key, target_kind, target_id, last_feedback_at) VALUES (?, 'k', 'i', 'now')`,
			[]any{bankLocatorKey}},
		{`INSERT INTO agent_truth(truth_id, bank_locator_key, dimension, normalized_key, statement, confidence, status, created_at, updated_at, truth_json) VALUES (?, ?, 'd', 'nk', 'st', 1.0, 'admitted', 'now', 'now', '{}')`,
			[]any{"truth-" + bankLocatorKey, bankLocatorKey}},
		{`INSERT INTO truth_source(truth_id, memory_id, bank_locator_key, observed_at) VALUES (?, ?, ?, 'now')`,
			[]any{"truth-" + bankLocatorKey, "mem-" + bankLocatorKey, bankLocatorKey}},
		{`INSERT INTO memory_review_commit(review_run_id, bank_locator_key, outcome_hash, committed_at, outcomes_json) VALUES (?, ?, 'h', 'now', '{}')`,
			[]any{"rc-" + bankLocatorKey, bankLocatorKey}},
		{`INSERT INTO memory_review_checkpoint(bank_locator_key, checkpoint_json, updated_at) VALUES (?, '{}', 'now')`,
			[]any{bankLocatorKey}},
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt.query, stmt.args...); err != nil {
			t.Fatalf("seed projection row (%s): %v", stmt.query, err)
		}
	}
}

func assertBankLocatorKeyTablesEmpty(t *testing.T, svc *Service, bankLocatorKey string) {
	t.Helper()
	tables := []struct{ name, column string }{
		{"memory_narrative", "bank_locator_key"},
		{"memory_narrative_embedding", "locator_key"},
		{"memory_narrative_alias", "bank_locator_key"},
		{"narrative_source", "bank_locator_key"},
		{"memory_relation", "bank_locator_key"},
		{"memory_recall_feedback_event", "bank_locator_key"},
		{"memory_recall_feedback_summary", "bank_locator_key"},
		{"agent_truth", "bank_locator_key"},
		{"truth_source", "bank_locator_key"},
		{"memory_review_commit", "bank_locator_key"},
		{"memory_review_checkpoint", "bank_locator_key"},
	}
	for _, table := range tables {
		if got := runtimeAgentRowCount(t, svc, table.name, table.column, bankLocatorKey); got != 0 {
			t.Fatalf("%s rows for deleted bank %q = %d, want 0 (orphaned projection)", table.name, bankLocatorKey, got)
		}
	}
}

// seedRuntimeAgentSideTables inserts rows into the runtime-agent-side
// projection tables the snapshot rewrite does not cover.
func seedRuntimeAgentSideTables(t *testing.T, svc *Service, localAgentRef string, agentCoreBankKey string) {
	t.Helper()
	db := svc.backend.DB()
	if _, err := db.Exec(
		`INSERT INTO runtime_local_agent_behavioral_posture(local_agent_ref, status_text, truth_basis_json, posture_json, updated_at) VALUES (?, '', '{}', '{}', 'now')`,
		localAgentRef,
	); err != nil {
		t.Fatalf("seed runtime_local_agent_behavioral_posture: %v", err)
	}
	if _, err := db.Exec(
		`INSERT INTO runtime_local_agent_review_run(review_run_id, local_agent_ref, bank_locator_key, status, prepared_outcomes_json, created_at, updated_at) VALUES (?, ?, ?, 'prepared', '{}', 'now', 'now')`,
		"rr-"+localAgentRef, localAgentRef, agentCoreBankKey,
	); err != nil {
		t.Fatalf("seed runtime_local_agent_review_run: %v", err)
	}
	if _, err := db.Exec(
		`INSERT INTO runtime_local_agent_review_followup(bank_locator_key, review_run_id, completed_at) VALUES (?, ?, 'now')`,
		agentCoreBankKey, "rr-"+localAgentRef,
	); err != nil {
		t.Fatalf("seed runtime_local_agent_review_followup: %v", err)
	}
}
