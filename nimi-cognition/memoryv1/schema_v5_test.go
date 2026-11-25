package memoryv1

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

func TestConcurrentFirstOpen(t *testing.T) {
	root := t.TempDir()
	start := make(chan struct{})
	results := make(chan error, 8)
	for range 8 {
		go func() {
			<-start
			core, err := Open(root)
			if err == nil {
				err = core.Close()
			}
			results <- err
		}()
	}
	close(start)
	for range 8 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
}

func TestSchemaV4ToV5MigrationSingleSlotSupersedeAndScopeTagRecall(t *testing.T) {
	dir := t.TempDir()
	storePath := filepath.Join(dir, storeFilename)

	// 1. Seed a genuine Schema v4 SQLite store (no scope_tag / slot_key columns, user_version = 4).
	seedDB, err := sql.Open("sqlite", storePath)
	if err != nil {
		t.Fatalf("open v4 seed db: %v", err)
	}
	v4DDL := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE memory_banks (bank_ref TEXT PRIMARY KEY, lifecycle_ref TEXT NOT NULL, canonical_version INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL CHECK (state IN ('active', 'deleted')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
		`CREATE TABLE memory_bank_bindings (binding_ref TEXT PRIMARY KEY, bank_ref TEXT NOT NULL REFERENCES memory_banks(bank_ref) ON DELETE CASCADE, state TEXT NOT NULL CHECK (state IN ('active', 'retired')), created_at TEXT NOT NULL, retired_at TEXT)`,
		`CREATE TABLE memory_operations (operation_id TEXT PRIMARY KEY, operation_kind TEXT NOT NULL, binding_ref TEXT NOT NULL, bank_ref TEXT, event_ref TEXT, delivery_sequence INTEGER, request_key TEXT NOT NULL, outcome TEXT NOT NULL, result_json BLOB, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
		`CREATE TABLE memory_frontiers (binding_ref TEXT PRIMARY KEY REFERENCES memory_bank_bindings(binding_ref) ON DELETE CASCADE, received_frontier INTEGER NOT NULL DEFAULT 0, ready_frontier INTEGER NOT NULL DEFAULT 0)`,
		`CREATE TABLE memory_receipts (operation_id TEXT PRIMARY KEY REFERENCES memory_operations(operation_id) ON DELETE CASCADE, binding_ref TEXT NOT NULL REFERENCES memory_bank_bindings(binding_ref) ON DELETE CASCADE, bank_ref TEXT NOT NULL, event_ref TEXT NOT NULL, delivery_sequence INTEGER NOT NULL CHECK (delivery_sequence > 0), request_key TEXT NOT NULL, lifecycle_ref TEXT NOT NULL, outcome TEXT NOT NULL, payload BLOB, committed_at TEXT NOT NULL, terminal_at TEXT, UNIQUE(binding_ref, delivery_sequence), UNIQUE(bank_ref, event_ref))`,
		`CREATE TABLE memories (memory_ref TEXT PRIMARY KEY, bank_ref TEXT NOT NULL, content TEXT NOT NULL, epistemic_status TEXT NOT NULL, lifecycle TEXT NOT NULL, occurred_at TEXT NOT NULL, updated_at TEXT NOT NULL, source_explanation TEXT NOT NULL, event_ref TEXT NOT NULL, supersedes_ref TEXT)`,
		`CREATE TABLE memory_lineage (memory_ref TEXT NOT NULL REFERENCES memories(memory_ref) ON DELETE CASCADE, ref_type TEXT NOT NULL CHECK (ref_type IN ('subject', 'source')), ref_kind TEXT NOT NULL, ref_value TEXT NOT NULL, PRIMARY KEY(memory_ref, ref_type, ref_kind, ref_value))`,
		`CREATE TABLE memory_derived_generations (bank_ref TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('fts', 'embedding')), generation_ref TEXT NOT NULL, canonical_version INTEGER NOT NULL, lifecycle_ref TEXT NOT NULL, config_revision INTEGER NOT NULL DEFAULT 0, embedding_space_ref TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('building', 'ready', 'failed')), updated_at TEXT NOT NULL, PRIMARY KEY(bank_ref, kind, generation_ref))`,
		`CREATE VIRTUAL TABLE memory_fts USING fts5(memory_ref UNINDEXED, bank_ref UNINDEXED, content)`,
		`CREATE TABLE memory_vector_items (generation_ref TEXT NOT NULL, memory_ref TEXT NOT NULL, dimension INTEGER NOT NULL, vector_json BLOB NOT NULL, PRIMARY KEY(generation_ref, memory_ref))`,
		`CREATE TABLE memory_operation_routes (operation_id TEXT PRIMARY KEY, operation_kind TEXT NOT NULL, bank_ref TEXT NOT NULL, request_key TEXT NOT NULL, pipeline TEXT NOT NULL, algorithm_revision TEXT NOT NULL, config_revision INTEGER NOT NULL, capabilities_json BLOB NOT NULL, ai_lifecycle_ref TEXT NOT NULL DEFAULT '', ai_disposition TEXT NOT NULL DEFAULT 'none' CHECK(ai_disposition IN ('none', 'retained', 'pending', 'done')), outcome TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
		`INSERT INTO memory_banks(bank_ref, lifecycle_ref, canonical_version, state, created_at, updated_at) VALUES ('bank_v4', 'cut_v4', 1, 'active', '2026-11-20T00:00:00Z', '2026-11-20T00:00:00Z')`,
		`INSERT INTO memory_bank_bindings(binding_ref, bank_ref, state, created_at) VALUES ('bind_v4', 'bank_v4', 'active', '2026-11-20T00:00:00Z')`,
		`INSERT INTO memory_frontiers(binding_ref, received_frontier, ready_frontier) VALUES ('bind_v4', 0, 0)`,
		`INSERT INTO memories(memory_ref, bank_ref, content, epistemic_status, lifecycle, occurred_at, updated_at, source_explanation, event_ref) VALUES ('mem_legacy_v4', 'bank_v4', 'I prefer dark mode editor themes', 'explicit', 'current', '2026-11-20T00:00:00Z', '2026-11-20T00:00:00Z', 'v4 legacy fact', 'ev_v4_1')`,
		`PRAGMA user_version = 4`,
	}
	for _, stmt := range v4DDL {
		if _, err := seedDB.Exec(stmt); err != nil {
			t.Fatalf("seed v4 statement failed: %v\nSQL: %s", err, stmt)
		}
	}
	_ = seedDB.Close()

	// 2. Open with v5 Core -> MUST seamlessly migrate v4 -> v5 and preserve legacy row with scope_tag='global_fact'.
	now := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)
	core, err := Open(dir, WithClock(func() time.Time { return now }))
	if err != nil {
		t.Fatalf("Open v4->v5 migration failed: %v", err)
	}
	t.Cleanup(func() { _ = core.Close() })

	ctx := context.Background()
	listed, err := core.ListMemories(ctx, "bank_v4", false)
	if err != nil || len(listed) != 1 {
		t.Fatalf("ListMemories after v4->v5: items=%+v err=%v", listed, err)
	}
	if listed[0].ScopeTag != ScopeTagGlobalFact || listed[0].SlotKey != "" {
		t.Fatalf("legacy row expected scope_tag=global_fact slot_key='', got %+v", listed[0])
	}

	// 3. Commit two session_pointer_committed updates for the SAME slot_key -> single active slot atomically supersedes old row!
	commitPointer := func(seq uint64, opID, evRef, summary string) []string {
		now = now.Add(time.Minute)
		_, err := core.ReceiveCommittedEvent(ctx, CommitRequest{
			ContractVersion:  ContractVersion,
			BindingRef:       "bind_v4",
			BankRef:          "bank_v4",
			EventRef:         evRef,
			DeliverySequence: seq,
			OperationID:      opID,
			LifecycleRef:     "cut_v4",
			Subjects:         []TypedRef{{Kind: "account_subject", Value: "acct_1"}},
			Sources:          []TypedRef{{Kind: "session", Value: "ws_proj_alpha"}},
			CommittedAt:      now,
			Fact: CommittedFact{
				Kind: EventKindSessionPointer,
				SessionPointer: &SessionPointerFact{
					WorkSessionRef: "ws_proj_alpha",
					ScopeTag:       ScopeTagSessionPointer,
					SlotKey:        "session_ref:ws_proj_alpha",
					TopicSummary:   summary,
					BodyKind:       "os.pc.workspace",
				},
			},
		})
		if err != nil {
			t.Fatalf("ReceiveCommittedEvent %s: %v", opID, err)
		}
		res, err := core.ExecuteRemember(ctx, opID)
		if err != nil || res.Outcome != OutcomeAdmitted {
			t.Fatalf("ExecuteRemember %s: res=%+v err=%v", opID, res, err)
		}
		return res.AffectedMemoryRefs
	}

	firstRefs := commitPointer(1, "op_ptr_1", "ev_ptr_1", "Project Alpha editor initial planning milestone")
	secondRefs := commitPointer(2, "op_ptr_2", "ev_ptr_2", "Project Alpha editor shipping milestone completed")
	if len(firstRefs) != 1 || len(secondRefs) != 1 || firstRefs[0] == secondRefs[0] {
		t.Fatalf("expected distinct refs for first=%v second=%v", firstRefs, secondRefs)
	}

	// Only 1 current pointer + 1 legacy global_fact should be current (first pointer MUST be superseded!).
	currentList, err := core.ListMemories(ctx, "bank_v4", false)
	if err != nil {
		t.Fatalf("ListMemories current: %v", err)
	}
	if len(currentList) != 2 {
		t.Fatalf("expected exactly 2 current memories (1 global_fact + 1 active slot), got %d: %+v", len(currentList), currentList)
	}

	// 4. Recall with ScopeTags allowlist filters cleanly between global_fact and session_pointer!
	if err := core.RebuildFTS(ctx, "bank_v4"); err != nil {
		t.Fatalf("RebuildFTS: %v", err)
	}
	snap := CapabilitySnapshot{Available: []Capability{CapabilityFTSIndex}}
	ptrRecall, err := core.Recall(ctx, RecallRequest{
		OperationID:  "op_recall_ptr",
		BindingRef:   "bind_v4",
		BankRef:      "bank_v4",
		LifecycleRef: "cut_v4",
		Subject:      TypedRef{Kind: "account_subject", Value: "acct_1"},
		Query:        "editor",
		Limit:        10,
		ScopeTags:    []string{ScopeTagSessionPointer},
		Capabilities: snap,
	}, nil)
	if err != nil || len(ptrRecall.Hits) != 1 || ptrRecall.Hits[0].MemoryRef != secondRefs[0] {
		t.Fatalf("expected only latest session_pointer hit, got %+v err=%v", ptrRecall, err)
	}
	factRecall, err := core.Recall(ctx, RecallRequest{
		OperationID:  "op_recall_fact",
		BindingRef:   "bind_v4",
		BankRef:      "bank_v4",
		LifecycleRef: "cut_v4",
		Subject:      TypedRef{Kind: "account_subject", Value: "acct_1"},
		Query:        "editor",
		Limit:        10,
		ScopeTags:    []string{ScopeTagGlobalFact},
		Capabilities: snap,
	}, nil)
	if err != nil || len(factRecall.Hits) != 1 || factRecall.Hits[0].MemoryRef != "mem_legacy_v4" {
		t.Fatalf("expected only global_fact hit, got %+v err=%v", factRecall, err)
	}

	// 5. FindMemoryRefsBySource finds ALL session-lineage memories (both current & superseded) for exact ForgetExact!
	sessionRefs, err := core.FindMemoryRefsBySource(ctx, "bank_v4", "session", "ws_proj_alpha")
	if err != nil {
		t.Fatalf("FindMemoryRefsBySource: %v", err)
	}
	if len(sessionRefs) != 2 {
		t.Fatalf("expected 2 session lineage refs (superseded + current), got %v", sessionRefs)
	}
	forgetRes, err := core.ForgetExact(ctx, ForgetRequest{
		OperationID:      "op_forget_session",
		BindingRef:       "bind_v4",
		BankRef:          "bank_v4",
		LifecycleRef:     "cut_v4",
		TargetMemoryRefs: sessionRefs,
		Confirmed:        true,
	})
	if err != nil || forgetRes.Outcome != OutcomeForgotten || len(forgetRes.AffectedMemoryRefs) != 2 {
		t.Fatalf("ForgetExact session lineage failed: res=%+v err=%v", forgetRes, err)
	}
	remaining, err := core.FindMemoryRefsBySource(ctx, "bank_v4", "session", "ws_proj_alpha")
	if err != nil || len(remaining) != 0 {
		t.Fatalf("expected 0 remaining session lineage refs after forget, got %v err=%v", remaining, err)
	}

	// 6. Whitespace-only ScopeTags allowlist MUST be rejected as OutcomeInvalid (never fall back to unfiltered).
	invalidRecall, err := core.Recall(ctx, RecallRequest{
		OperationID:  "op_recall_blank_scope",
		BindingRef:   "bind_v4",
		BankRef:      "bank_v4",
		LifecycleRef: "cut_v4",
		Subject:      TypedRef{Kind: "account_subject", Value: "acct_1"},
		Query:        "tea",
		Limit:        10,
		ScopeTags:    []string{"   ", "\t"},
		Capabilities: snap,
	}, nil)
	if err == nil || invalidRecall.Outcome != OutcomeInvalid {
		t.Fatalf("expected OutcomeInvalid for whitespace-only ScopeTags, got %+v err=%v", invalidRecall, err)
	}

	// 7. IncludeRecentLife with ScopeTags=[session_pointer] MUST NOT leak global_fact life_change memories!
	if _, err := core.db.ExecContext(ctx, `INSERT INTO memories(memory_ref, bank_ref, content, epistemic_status, lifecycle, occurred_at, updated_at, source_explanation, event_ref, scope_tag, slot_key) VALUES('mem_life_global', 'bank_v4', 'Walked in the rain', 'inferred', 'current', ?, ?, 'life', 'evt_life_1', 'global_fact', '')`, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := core.db.ExecContext(ctx, `INSERT INTO memory_lineage(memory_ref, ref_type, ref_kind, ref_value) VALUES('mem_life_global', 'source', 'life_change', 'chg_1')`); err != nil {
		t.Fatal(err)
	}
	scopedLifeRecall, err := core.Recall(ctx, RecallRequest{
		OperationID:       "op_recall_scoped_life",
		BindingRef:        "bind_v4",
		BankRef:           "bank_v4",
		LifecycleRef:      "cut_v4",
		Subject:           TypedRef{Kind: "account_subject", Value: "acct_1"},
		Query:             "tea",
		Limit:             10,
		ScopeTags:         []string{ScopeTagSessionPointer},
		IncludeRecentLife: true,
		Capabilities:      snap,
	}, nil)
	if err != nil {
		t.Fatalf("scoped IncludeRecentLife recall failed: %v", err)
	}
	for _, hit := range scopedLifeRecall.Hits {
		if hit.ScopeTag != ScopeTagSessionPointer {
			t.Fatalf("IncludeRecentLife leaked non-session_pointer memory: %+v", hit)
		}
	}
}
