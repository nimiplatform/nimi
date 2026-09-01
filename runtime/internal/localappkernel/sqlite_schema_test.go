package localappkernel

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenSQLiteRejectsNonCanonicalRegistrationSchema(t *testing.T) {
	dataRoot := t.TempDir()
	databasePath, err := CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		t.Fatal(err)
	}
	database, err := sql.Open("sqlite", "file:"+filepath.ToSlash(databasePath))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`CREATE TABLE canonical_registration (
		registration_handle TEXT PRIMARY KEY,
		source_digest TEXT NOT NULL
	)`); err != nil {
		_ = database.Close()
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	identity := mustWindowsIdentity(t, "S-1-5-21-1000-1001-1002-1003")
	_, err = OpenSQLite(context.Background(), databasePath, identity, Options{
		HostInstallID: "host-install-schema-cut",
		DataRoot:      dataRoot,
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported canonical_registration shape") {
		t.Fatalf("noncanonical schema error = %v", err)
	}

	inspected, err := sql.Open("sqlite", "file:"+filepath.ToSlash(databasePath))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = inspected.Close() }()
	columns, err := sqliteTableColumns(context.Background(), inspected, "canonical_registration")
	if err != nil {
		t.Fatal(err)
	}
	if !columns["source_digest"] || columns["immutable_lineage_id"] {
		t.Fatalf("schema rejection mutated the existing table: %#v", columns)
	}
}
