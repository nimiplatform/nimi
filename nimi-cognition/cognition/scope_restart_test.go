package cognition

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	_ "modernc.org/sqlite"
)

// C1.7 — After explicit Close + reopen (forcing WAL checkpoint),
// previously-created scope and its descendants are still present.
func TestKnowledgeScopeRegistry_DurableAcrossRestart(t *testing.T) {
	root := t.TempDir()

	// Phase 1: create scope + page, then explicitly Close to flush WAL.
	c1 := newTestCognitionAt(t, root)
	scope, err := c1.KnowledgeScopeRegistry().CreateKnowledgeScope(context.Background(), KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws-restart"},
		DisplayName: "Restart Bank",
	})
	if err != nil {
		t.Fatalf("create scope: %v", err)
	}
	scopeID := scope.ScopeID

	page := knowledge.Page{
		PageID:    "page-restart-1",
		ScopeID:   scopeID,
		Kind:      knowledge.ProjectionKindNote,
		Version:   1,
		Title:     "Persistent Note",
		Body:      []byte(`"persisted across restart"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	if err := c1.RuntimeBridge().SaveKnowledge(context.Background(), runtimeKnowledgeAuthorization(RuntimeAccessWrite, scope.Owner, scopeID), page); err != nil {
		t.Fatalf("save page: %v", err)
	}

	// Issue an explicit checkpoint via an aux handle, then close c1. This
	// matches the design intent: the test must prove durability after WAL
	// is flushed, not just after process exit.
	auxDB, err := sql.Open("sqlite", filepath.Join(root, "cognition.sqlite"))
	if err != nil {
		t.Fatalf("open aux db pre-checkpoint: %v", err)
	}
	if _, err := auxDB.Exec(`PRAGMA wal_checkpoint(TRUNCATE);`); err != nil {
		t.Fatalf("wal checkpoint: %v", err)
	}
	if err := auxDB.Close(); err != nil {
		t.Fatalf("close aux db: %v", err)
	}
	if err := c1.Close(); err != nil {
		t.Fatalf("close c1: %v", err)
	}

	// Phase 2: reopen and verify.
	c2 := newTestCognitionAt(t, root)
	got, err := c2.KnowledgeScopeRegistry().GetKnowledgeScope(context.Background(), scopeID)
	if err != nil {
		t.Fatalf("get scope after reopen: %v", err)
	}
	if got.ScopeID != scopeID {
		t.Fatalf("expected scope_id %s, got %s", scopeID, got.ScopeID)
	}
	if got.DisplayName != "Restart Bank" {
		t.Fatalf("expected display_name preserved across restart, got %q", got.DisplayName)
	}
	if got.Owner.Kind != KnowledgeScopeOwnerKindWorkspace || got.Owner.WorkspaceID != "ws-restart" {
		t.Fatalf("expected owner preserved across restart, got %+v", got.Owner)
	}

	loaded, err := c2.RuntimeBridge().LoadKnowledge(context.Background(), runtimeKnowledgeAuthorization(RuntimeAccessRead, got.Owner, scopeID), scopeID, "page-restart-1")
	if err != nil {
		t.Fatalf("load page after reopen: %v", err)
	}
	if loaded.Title != "Persistent Note" {
		t.Fatalf("expected page title preserved, got %q", loaded.Title)
	}
}
