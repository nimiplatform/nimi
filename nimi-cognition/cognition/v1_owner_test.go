package cognition

import (
	"database/sql"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestV1OwnerFreshSchemaContainsOnlyAdmittedFamilies(t *testing.T) {
	root := t.TempDir()
	owner, err := NewV1Owner(root)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()

	if _, err := os.Stat(filepath.Join(root, "cognition.sqlite")); !os.IsNotExist(err) {
		t.Fatalf("legacy Cognition store is reachable from V1 owner: err=%v", err)
	}

	sourceTables := sqliteTableNames(t, filepath.Join(root, "cognition-agent-source-v1.sqlite3"))
	wantSourceTables := []string{"runtime_source_omission", "runtime_source_scope", "runtime_source_unit"}
	if strings.Join(sourceTables, ",") != strings.Join(wantSourceTables, ",") {
		t.Fatalf("V1 Agent Source tables = %v, want %v", sourceTables, wantSourceTables)
	}

	memoryTables := sqliteTableNames(t, filepath.Join(root, "cognition-memory-v1.sqlite3"))
	for _, required := range []string{"memory_banks", "memory_operations", "memories"} {
		if !containsString(memoryTables, required) {
			t.Fatalf("V1 Memory table %q is missing: %v", required, memoryTables)
		}
	}
	for _, table := range memoryTables {
		if table == "scope" || table == "kernel" || table == "kernel_rule" || table == "kernel_commit" ||
			table == "memory_record" || table == "memory_history" || table == "artifact_ref" || table == "cognition_scope_registry" ||
			strings.HasPrefix(table, "knowledge_") || strings.HasPrefix(table, "skill_") || strings.HasPrefix(table, "digest_") {
			t.Fatalf("legacy Cognition table %q is reachable from V1 owner", table)
		}
	}
}

func sqliteTableNames(t *testing.T, path string) []string {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	sort.Strings(names)
	return names
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
