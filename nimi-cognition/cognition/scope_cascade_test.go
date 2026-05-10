package cognition

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	_ "modernc.org/sqlite"
)

// C1.6 — DeleteKnowledgeScope cascades to page / relation / embedding /
// history / ingest task / FTS in one transaction. The FTS leak check is
// the load-bearing assertion: a future implementation that forgets to
// delete the FTS virtual-table rows would silently keep deleted bank
// content visible to SearchKeyword.
func TestKnowledgeScopeRegistry_DeleteCascadesIncludingFTS(t *testing.T) {
	root := t.TempDir()
	c := newTestCognitionAt(t, root)
	registry := c.KnowledgeScopeRegistry()

	scope, err := registry.CreateKnowledgeScope(context.Background(), KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "nimi.desktop"},
		DisplayName: "Cascade Bank",
	})
	if err != nil {
		t.Fatalf("create scope: %v", err)
	}
	scopeID := scope.ScopeID

	// Seed two knowledge pages so cascade has page rows + FTS rows + history
	// + (after refgraph) artifact_ref rows + (via embedding store)
	// knowledge_page_embedding rows to clean up.
	page1 := knowledge.Page{
		PageID:    "page-cascade-1",
		ScopeID:   scopeID,
		Kind:      knowledge.ProjectionKindExplainer,
		Version:   1,
		Title:     "Quantum Banana Theorem",
		Body:      []byte(`"the unique distinguishing phrase that should not survive cascade delete"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	page2 := knowledge.Page{
		PageID:    "page-cascade-2",
		ScopeID:   scopeID,
		Kind:      knowledge.ProjectionKindGuide,
		Version:   1,
		Title:     "Companion Page",
		Body:      []byte(`"second page"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	if err := c.KnowledgeService().Save(page1); err != nil {
		t.Fatalf("save page1: %v", err)
	}
	if err := c.KnowledgeService().Save(page2); err != nil {
		t.Fatalf("save page2: %v", err)
	}

	// Open an independent sql.DB handle against the same SQLite file so we
	// can verify cascade exhaustively. The cognition Close() in t.Cleanup
	// will release its own handle; this auxiliary handle is closed below.
	auxDB, err := sql.Open("sqlite", filepath.Join(root, "cognition.sqlite"))
	if err != nil {
		t.Fatalf("open aux db: %v", err)
	}
	t.Cleanup(func() { _ = auxDB.Close() })

	// Sanity: FTS contains content for the scope.
	preFTS := countRows(t, auxDB, `SELECT COUNT(*) FROM knowledge_page_fts WHERE scope_id = ?`, scopeID)
	if preFTS == 0 {
		t.Fatalf("expected FTS rows seeded before cascade, got 0")
	}

	if err := registry.DeleteKnowledgeScope(context.Background(), scopeID); err != nil {
		t.Fatalf("delete scope: %v", err)
	}

	// Cascade verification — every scope-anchored table reports zero rows
	// for the deleted scope.
	for _, q := range []string{
		`SELECT COUNT(*) FROM cognition_scope_registry WHERE scope_id = ?`,
		`SELECT COUNT(*) FROM scope WHERE scope_id = ?`,
		`SELECT COUNT(*) FROM knowledge_page WHERE scope_id = ?`,
		`SELECT COUNT(*) FROM knowledge_relation WHERE scope_id = ?`,
		`SELECT COUNT(*) FROM knowledge_page_embedding WHERE scope_id = ?`,
		`SELECT COUNT(*) FROM knowledge_history WHERE scope_id = ?`,
		`SELECT COUNT(*) FROM knowledge_ingest_task WHERE scope_id = ?`,
		`SELECT COUNT(*) FROM knowledge_page_fts WHERE scope_id = ?`,
		`SELECT COUNT(*) FROM artifact_ref WHERE scope_id = ?`,
	} {
		if got := countRows(t, auxDB, q, scopeID); got != 0 {
			t.Fatalf("expected 0 rows for query %q, got %d", q, got)
		}
	}

	// FTS leak guard — even MATCH against the unique distinguishing phrase
	// must return 0 rows after cascade. This catches the failure mode
	// where the row delete happens by scope_id but the FTS shadow table
	// still indexes the now-deleted phrase under a different scope_id.
	matchCount := countRows(t, auxDB, `SELECT COUNT(*) FROM knowledge_page_fts WHERE knowledge_page_fts MATCH ?`, "Quantum Banana Theorem")
	if matchCount != 0 {
		t.Fatalf("FTS leak: deleted bank content still searchable (match count %d)", matchCount)
	}

	// Registry follow-up read returns typed not-found.
	if _, err := registry.GetKnowledgeScope(context.Background(), scopeID); err == nil {
		t.Fatalf("expected typed not-found after cascade, got nil")
	}
}

func countRows(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	row := db.QueryRow(query, args...)
	var n int
	if err := row.Scan(&n); err != nil {
		t.Fatalf("count rows query %q: %v", query, err)
	}
	return n
}
