package runtimepersistence

import (
	"bytes"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/storedformat"
)

func TestMemoryExecutionPreflightClassifiesWithoutChangingStoredData(t *testing.T) {
	for _, tc := range []struct {
		name, ddl string
		refused   bool
	}{
		{"legacy", `CREATE TABLE runtime_cognition_memory_ai_job (operation_id TEXT PRIMARY KEY, profile_json TEXT);
		INSERT INTO runtime_cognition_memory_ai_job VALUES ('retained-operation', '{"retain":"original"}');`, true},
		{"current", `CREATE TABLE runtime_cognition_memory_ai_job (operation_id TEXT PRIMARY KEY, payload_disposition TEXT);`, false},
		{"sqlite-column-case", `CREATE TABLE runtime_cognition_memory_ai_job (operation_id TEXT PRIMARY KEY, PAYLOAD_DISPOSITION TEXT);`, false},
		{"fresh-table", `CREATE TABLE unrelated_history (value TEXT); INSERT INTO unrelated_history VALUES ('keep');`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, dbFileName)
			db, err := sql.Open(dbDriverName, path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(tc.ddl); err != nil {
				t.Fatal(err)
			}
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			refusal := PreflightStoredMemoryExecution(filepath.Join(dir, "local-state.json"))
			if (refusal != nil) != tc.refused {
				t.Fatalf("refusal = %v, expected refused=%v", refusal, tc.refused)
			}
			if refusal != nil && (refusal.Owner() != "runtimepersistence.memory-execution" || refusal.Handling() != storedformat.OfflineRepair) {
				t.Fatalf("wrong owner classification: %v", refusal)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("classification changed stored data: %v", err)
			}
			files, err := os.ReadDir(dir)
			if err != nil || len(files) != 1 {
				t.Fatalf("classification created files: %v, %v", files, err)
			}
		})
	}
}

func TestMemoryExecutionPreflightDoesNotInventRefusalsOrCreateState(t *testing.T) {
	dir := t.TempDir()
	state := filepath.Join(dir, "missing", "local-state.json")
	if refusal := PreflightStoredMemoryExecution(state); refusal != nil {
		t.Fatalf("missing database classified as incompatible: %v", refusal)
	}
	if _, err := os.Stat(filepath.Dir(state)); !os.IsNotExist(err) {
		t.Fatalf("classification created the absent directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, dbFileName), []byte("unreadable database"), 0o600); err != nil {
		t.Fatal(err)
	}
	if refusal := PreflightStoredMemoryExecution(filepath.Join(dir, "local-state.json")); refusal != nil {
		t.Fatalf("unclassified corruption attributed to the Memory schema: %v", refusal)
	}
}
