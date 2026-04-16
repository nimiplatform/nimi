package storage

import (
	"database/sql"
	"testing"
)

func TestSQLiteBackend_MemorySchemaOmitsServiceMetadataColumns(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer b.Close()

	rows, err := b.db.Query(`PRAGMA table_info(memory_record)`)
	if err != nil {
		t.Fatalf("pragma table_info: %v", err)
	}
	defer rows.Close()

	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var name string
		var ctype string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan pragma row: %v", err)
		}
		columns[name] = true
	}
	if rows.Err() != nil {
		t.Fatalf("iterate pragma rows: %v", rows.Err())
	}
	if columns["support_score"] || columns["drift_status"] {
		t.Fatalf("memory_record schema still contains removed service metadata columns: %+v", columns)
	}
}
