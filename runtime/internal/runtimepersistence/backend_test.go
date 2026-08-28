package runtimepersistence

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestBackendFailsClosedWithoutHealthyBackup(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	dbPath := filepath.Join(dir, dbFileName)
	if err := os.WriteFile(dbPath, []byte("not-a-sqlite-db"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(memory.db): %v", err)
	}

	backend, err := Open(nil, filepath.Join(dir, "local-state.json"))
	if err == nil {
		_ = backend.Close()
		t.Fatal("expected corrupted sqlite open to fail without backup")
	}
}

func TestBackendRestoresNewestHealthyBackup(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('restore_probe', 'restored') ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
		return err
	}); err != nil {
		t.Fatalf("WriteTx(restore_probe): %v", err)
	}
	healthyBackup, err := backend.BackupNow(context.Background())
	if err != nil {
		t.Fatalf("BackupNow: %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	corruptBackup := filepath.Join(filepath.Dir(healthyBackup), "memory-corrupt.db")
	if err := os.WriteFile(corruptBackup, []byte("corrupt-backup"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(corrupt backup): %v", err)
	}
	later := time.Now().Add(time.Minute)
	if err := os.Chtimes(corruptBackup, later, later); err != nil {
		t.Fatalf("os.Chtimes(corrupt backup): %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, dbFileName), []byte("corrupt-primary"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(corrupt primary): %v", err)
	}

	backend, err = Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open(restored): %v", err)
	}
	defer func() {
		if err := backend.Close(); err != nil {
			t.Fatalf("Close(restored): %v", err)
		}
	}()

	var value string
	if err := backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = 'restore_probe'`).Scan(&value); err != nil {
		t.Fatalf("QueryRow(restore_probe): %v", err)
	}
	if value != "restored" {
		t.Fatalf("expected restored probe value, got %q", value)
	}
}

func TestBackendRuntimeLocalAgentSchemaIgnoresRetiredTables(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`CREATE TABLE runtime_agent_agent (
				agent_id TEXT PRIMARY KEY,
				agent_json TEXT NOT NULL
			)`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_agent_agent(agent_id, agent_json) VALUES ('agent-old', '{"retired":true}')`); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES ('local-agent:user-new:agent-old', '{"current":true}')`)
		return err
	}); err != nil {
		t.Fatalf("WriteTx(seed tables): %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close(seed): %v", err)
	}

	backend, err = Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open(reopen): %v", err)
	}
	defer func() {
		if err := backend.Close(); err != nil {
			t.Fatalf("Close(reopen): %v", err)
		}
	}()

	if !tableExists(t, backend.DB(), "runtime_agent_agent") {
		t.Fatal("expected retired runtime_agent_agent table to remain outside current schema")
	}
	var retiredJSON string
	if err := backend.DB().QueryRow(`SELECT agent_json FROM runtime_agent_agent WHERE agent_id = 'agent-old'`).Scan(&retiredJSON); err != nil {
		t.Fatalf("QueryRow(retired runtime_agent_agent): %v", err)
	}
	if retiredJSON != `{"retired":true}` {
		t.Fatalf("expected retired row to be untouched, got %q", retiredJSON)
	}
	var localAgentRef string
	var agentJSON string
	if err := backend.DB().QueryRow(`SELECT local_agent_ref, agent_json FROM runtime_local_agent`).Scan(&localAgentRef, &agentJSON); err != nil {
		t.Fatalf("QueryRow(runtime_local_agent): %v", err)
	}
	if localAgentRef != "local-agent:user-new:agent-old" {
		t.Fatalf("expected current local_agent_ref row, got %q", localAgentRef)
	}
	if agentJSON != `{"current":true}` {
		t.Fatalf("expected current runtime local agent row, got %q", agentJSON)
	}
}

func TestBackendFreshSchemaUsesRealmSourceMaterializationV3Only(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	backend, err := Open(nil, filepath.Join(dir, "local-state.json"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() {
		if err := backend.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
	}()

	assertRealmSourceMaterializationEpochV3(t, backend.DB())
	assertCurrentRealmSourceMaterializationObjects(t, backend.DB())
	assertRetiredRealmSourceMaterializationObjectsAbsent(t, backend.DB())
	assertRetiredRuntimeMemoryTablesAbsent(t, backend.DB())
}

func TestBackendRejectsEmptyIntermediateSourceSnapshotSchema(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	db, err := sql.Open(dbDriverName, filepath.Join(dir, dbFileName))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE runtime_local_agent_source_snapshot_v2 (
		local_agent_ref TEXT PRIMARY KEY,snapshot_schema_version INTEGER NOT NULL,snapshot_hash TEXT NOT NULL,captured_at TEXT NOT NULL,
		packet_id TEXT NOT NULL,packet_hash TEXT NOT NULL,realm_issuer TEXT NOT NULL,signing_key_fingerprint TEXT NOT NULL,
		source_kind TEXT NOT NULL,source_id TEXT NOT NULL,world_id TEXT NOT NULL,source_hash TEXT NOT NULL,world_content_hash TEXT NOT NULL,
		coverage_hash TEXT NOT NULL,materialization_context_hash TEXT NOT NULL,payload_hash TEXT NOT NULL,ordered_component_set_hash TEXT NOT NULL,
		closure_set_manifest_hash TEXT NOT NULL,normalization_version TEXT NOT NULL,compiler_compatibility_version TEXT NOT NULL,typed_snapshot_json BLOB NOT NULL,
		CHECK(snapshot_schema_version = 2))`)
	if err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	backend, err := Open(nil, filepath.Join(dir, "local-state.json"))
	if err == nil {
		_ = backend.Close()
		t.Fatal("empty intermediate source snapshot schema was accepted")
	}
	if !strings.Contains(err.Error(), "snapshot_schema_version must be hard-cut to 3") {
		t.Fatalf("unexpected source snapshot schema error: %v", err)
	}
}

func TestBackendRejectsConflictingRuntimeSourceRefEncodings(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES (?, ?)`,
			"conflicting-source-agent",
			`{"runtimeSourceRef":"runtime-source:worldCharacter:world:character:hash","runtime_source_ref":"runtime-source:personaCharacter:world:persona:hash"}`,
		)
		return err
	}); err != nil {
		_ = backend.Close()
		t.Fatal(err)
	}
	if err := backend.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(nil, localStatePath)
	if err == nil {
		_ = reopened.Close()
		t.Fatal("conflicting Runtime source identity did not fail closed")
	}
	if !strings.Contains(err.Error(), "conflicting runtimeSourceRef encodings") {
		t.Fatalf("unexpected conflicting Runtime source identity error: %v", err)
	}
}

func TestBackendSerializesWritesWhileReadsProceed(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	backend, err := Open(nil, filepath.Join(dir, "local-state.json"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() {
		if err := backend.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
	}()

	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS write_probe (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)`); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO write_probe(id, value) VALUES (1, 0)`)
		return err
	}); err != nil {
		t.Fatalf("WriteTx(init probe): %v", err)
	}

	const writers = 24
	const readers = 8
	var wg sync.WaitGroup
	errCh := make(chan error, writers+readers)
	for idx := 0; idx < writers; idx++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errCh <- backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
				_, err := tx.Exec(`UPDATE write_probe SET value = value + 1 WHERE id = 1`)
				return err
			})
		}()
	}
	for idx := 0; idx < readers; idx++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			deadline := time.Now().Add(300 * time.Millisecond)
			for time.Now().Before(deadline) {
				var value int
				if err := backend.DB().QueryRow(`SELECT value FROM write_probe WHERE id = 1`).Scan(&value); err != nil {
					errCh <- err
					return
				}
				time.Sleep(5 * time.Millisecond)
			}
			errCh <- nil
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatalf("unexpected concurrent access error: %v", err)
		}
	}

	var value int
	if err := backend.DB().QueryRow(`SELECT value FROM write_probe WHERE id = 1`).Scan(&value); err != nil {
		t.Fatalf("QueryRow(final value): %v", err)
	}
	if value != writers {
		t.Fatalf("expected serialized write count %d, got %d", writers, value)
	}
}

func tableExists(t *testing.T, db *sql.DB, name string) bool {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&count); err != nil {
		t.Fatalf("QueryRow(table exists %s): %v", name, err)
	}
	return count > 0
}

func schemaObjectExists(t *testing.T, db *sql.DB, kind, name string) bool {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_schema WHERE type = ? AND name = ?`, kind, name).Scan(&count); err != nil {
		t.Fatalf("QueryRow(schema object exists %s %s): %v", kind, name, err)
	}
	return count > 0
}

func assertRealmSourceMaterializationEpochV3(t *testing.T, db *sql.DB) {
	t.Helper()
	var epoch string
	if err := db.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, realmSourceMaterializationEpochMetaKey).Scan(&epoch); err != nil {
		t.Fatalf("QueryRow(Realm source materialization epoch): %v", err)
	}
	if epoch != realmSourceMaterializationEpochV3 {
		t.Fatalf("expected Realm source materialization epoch %q, got %q", realmSourceMaterializationEpochV3, epoch)
	}
}

func assertCurrentRealmSourceMaterializationObjects(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, object := range currentRealmSourceMaterializationObjects() {
		if !schemaObjectExists(t, db, object.kind, object.name) {
			t.Errorf("expected current Realm source materialization %s %s", object.kind, object.name)
		}
	}
}

func assertRetiredRealmSourceMaterializationObjectsAbsent(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, name := range retiredRealmSourceMaterializationTriggers() {
		if schemaObjectExists(t, db, "trigger", name) {
			t.Errorf("retired Realm source materialization trigger %s remains", name)
		}
	}
	for _, name := range retiredRealmSourceMaterializationTables() {
		if schemaObjectExists(t, db, "table", name) {
			t.Errorf("retired Realm source materialization table %s remains", name)
		}
	}
}

func assertRetiredRuntimeMemoryTablesAbsent(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, name := range []string{
		"memory_meta",
		"memory_bank",
		"memory_record",
		"memory_record_fts",
		"memory_record_embedding",
		"memory_replication_backlog",
		"memory_narrative",
		"memory_narrative_embedding",
		"memory_narrative_alias",
		"narrative_source",
		"memory_relation",
		"memory_recall_feedback_event",
		"memory_recall_feedback_summary",
		"agent_truth",
		"truth_source",
		"memory_review_commit",
		"memory_review_checkpoint",
		"runtime_local_agent_review_run",
		"runtime_local_agent_review_followup",
	} {
		if schemaObjectExists(t, db, "table", name) {
			t.Errorf("retired Runtime Memory table %s remains in fresh schema", name)
		}
	}
}
