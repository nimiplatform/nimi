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

func TestBackendMigratesResidualRuntimeAgentNamespaceTables(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_agent_meta(key, value) VALUES ('agent_event_sequence', '229') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		if _, err := tx.Exec(`CREATE TABLE agentcore_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO agentcore_meta(key, value) VALUES ('schema_version', '1'), ('state_initialized', '1'), ('agent_event_sequence', '0'), ('legacy_only', 'old-value')`); err != nil {
			return err
		}
		_, err := tx.Exec(`CREATE TABLE agentcore_agent (
			agent_id TEXT PRIMARY KEY,
			agent_json TEXT NOT NULL
		)`)
		return err
	}); err != nil {
		t.Fatalf("WriteTx(seed legacy tables): %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close(seed): %v", err)
	}

	backend, err = Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open(migrated): %v", err)
	}
	defer func() {
		if err := backend.Close(); err != nil {
			t.Fatalf("Close(migrated): %v", err)
		}
	}()

	if tableExists(t, backend.DB(), "agentcore_meta") {
		t.Fatal("expected legacy agentcore_meta table to be removed")
	}
	if tableExists(t, backend.DB(), "agentcore_agent") {
		t.Fatal("expected empty legacy agentcore_agent table to be removed")
	}
	var sequence string
	if err := backend.DB().QueryRow(`SELECT value FROM runtime_agent_meta WHERE key = 'agent_event_sequence'`).Scan(&sequence); err != nil {
		t.Fatalf("QueryRow(agent_event_sequence): %v", err)
	}
	if sequence != "229" {
		t.Fatalf("expected target meta value to win, got %q", sequence)
	}
	var legacyOnly string
	if err := backend.DB().QueryRow(`SELECT value FROM runtime_agent_meta WHERE key = 'legacy_only'`).Scan(&legacyOnly); err != nil {
		t.Fatalf("QueryRow(legacy_only): %v", err)
	}
	if legacyOnly != "old-value" {
		t.Fatalf("expected missing legacy meta key to be copied, got %q", legacyOnly)
	}
}

func TestBackendFailsClosedWhenLegacyAndTargetRuntimeAgentRowsConflict(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_agent_agent(agent_id, agent_json) VALUES ('agent-new', '{}')`); err != nil {
			return err
		}
		if _, err := tx.Exec(`CREATE TABLE agentcore_agent (
			agent_id TEXT PRIMARY KEY,
			agent_json TEXT NOT NULL
		)`); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO agentcore_agent(agent_id, agent_json) VALUES ('agent-old', '{}')`)
		return err
	}); err != nil {
		t.Fatalf("WriteTx(seed conflicting rows): %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close(seed): %v", err)
	}

	backend, err = Open(nil, localStatePath)
	if err == nil {
		_ = backend.Close()
		t.Fatal("expected conflicting non-meta legacy and target rows to fail closed")
	}
	if !strings.Contains(err.Error(), "both agentcore_agent and runtime_agent_agent contain rows") {
		t.Fatalf("expected conflict error, got %v", err)
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
