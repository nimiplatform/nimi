package storage

import (
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/skill"
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

func TestSQLiteBackend_SkillSearchDoesNotIndexUnadmittedMetadata(t *testing.T) {
	b, err := NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new sqlite backend: %v", err)
	}
	defer b.Close()

	raw, err := json.Marshal(map[string]any{
		"bundle_id":   "skill_001",
		"scope_id":    "agent_001",
		"version":     1,
		"status":      string(skill.BundleStatusActive),
		"name":        "Code Review Procedure",
		"description": "Review code changes",
		"steps": []map[string]any{
			{"step_id": "s1", "instruction": "Read the diff", "order": 1},
		},
		"metadata": map[string]any{
			"runtime_provider": "forbiddenprovidertoken",
			"scheduler":        "forbiddenschedulertoken",
		},
		"created_at": time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC),
		"updated_at": time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("marshal skill bundle: %v", err)
	}
	if err := b.Save("agent_001", KindSkill, "skill_001", raw); err != nil {
		t.Fatalf("save skill bundle: %v", err)
	}
	if got, err := b.SearchSkill("agent_001", "forbiddenprovidertoken", 10); err != nil {
		t.Fatalf("search skill metadata token: %v", err)
	} else if len(got) != 0 {
		t.Fatalf("metadata token must not be indexed, got %+v", got)
	}
	if got, err := b.SearchSkill("agent_001", "review", 10); err != nil {
		t.Fatalf("search skill admitted text: %v", err)
	} else if len(got) != 1 {
		t.Fatalf("expected admitted skill text to remain searchable, got %+v", got)
	}
}
