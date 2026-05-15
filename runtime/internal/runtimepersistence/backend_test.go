package runtimepersistence

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
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
		_, err := tx.Exec(`INSERT INTO memory_meta(key, value) VALUES ('restore_probe', 'restored') ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
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
	if err := backend.DB().QueryRow(`SELECT value FROM memory_meta WHERE key = 'restore_probe'`).Scan(&value); err != nil {
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
