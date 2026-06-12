package cognition

import (
	"context"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

// C1.9 — Storage write failure (e.g. underlying DB closed) bubbles up
// as a real Go error rather than being silently swallowed by the
// registry. This guards against a regression where a failed Save would
// be wrapped into a "nil success" or a "success without persisted row"
// path.
func TestKnowledgeScopeRegistry_StorageFailureSurfacesError(t *testing.T) {
	c := newTestCognition(t)
	registry := c.KnowledgeScopeRegistry()

	// Confirm baseline: a valid create succeeds.
	ok, err := registry.CreateKnowledgeScope(context.Background(), KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws-storage"},
		DisplayName: "Sanity Bank",
	})
	if err != nil {
		t.Fatalf("baseline create: %v", err)
	}
	if ok.ScopeID == "" {
		t.Fatalf("baseline create: empty scope id")
	}

	// Force a storage failure by closing the underlying DB. The registry
	// retains a reference to the now-closed *sql.DB.
	if err := c.Close(); err != nil {
		t.Fatalf("close cognition: %v", err)
	}

	// CreateKnowledgeScope after the DB is closed: must error, must not
	// return a populated KnowledgeScope.
	got, err := registry.CreateKnowledgeScope(context.Background(), KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws-storage"},
		DisplayName: "Failure Bank",
	})
	if err == nil {
		t.Fatalf("expected storage error after Close, got nil (got scope %+v)", got)
	}
	if got.ScopeID != "" {
		t.Fatalf("expected zero-valued scope on error, got %+v", got)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "closed") &&
		!strings.Contains(strings.ToLower(err.Error()), "storage") {
		t.Fatalf("expected storage-related error message, got %v", err)
	}

	// GetKnowledgeScope after close: must error, must not return a
	// populated scope.
	got, err = registry.GetKnowledgeScope(context.Background(), ok.ScopeID)
	if err == nil {
		t.Fatalf("expected storage error on Get after Close, got nil (got scope %+v)", got)
	}
	if got.ScopeID != "" {
		t.Fatalf("expected zero-valued scope on Get error, got %+v", got)
	}

	// ListKnowledgeScopes after close: must error.
	scopes, _, err := registry.ListKnowledgeScopes(context.Background(), KnowledgeScopeFilter{OwnerKinds: []string{KnowledgeScopeOwnerKindWorkspace}})
	if err == nil {
		t.Fatalf("expected storage error on List after Close, got nil (got %d scopes)", len(scopes))
	}
}
