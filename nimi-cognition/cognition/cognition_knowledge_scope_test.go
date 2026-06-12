package cognition

import (
	"context"
	"errors"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

// C1.1 — CreateKnowledgeScope rejects unknown owner kind.
func TestKnowledgeScopeRegistry_CreateRejectsUnknownOwnerKind(t *testing.T) {
	c := newTestCognition(t)
	registry := c.KnowledgeScopeRegistry()
	_, err := registry.CreateKnowledgeScope(context.Background(), KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: "agent_core", AppID: "nimi.desktop"},
		DisplayName: "X",
	})
	if err == nil {
		t.Fatalf("expected error for unknown owner kind, got nil")
	}
	if !strings.Contains(err.Error(), "invalid owner kind") {
		t.Fatalf("expected invalid owner kind error, got %v", err)
	}
}

// C1.2 — CreateKnowledgeScope rejects empty owner key / display name.
func TestKnowledgeScopeRegistry_CreateRejectsEmptyOwnerKeyOrDisplayName(t *testing.T) {
	c := newTestCognition(t)
	registry := c.KnowledgeScopeRegistry()

	_, err := registry.CreateKnowledgeScope(context.Background(), KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: ""},
		DisplayName: "X",
	})
	if err == nil || !strings.Contains(err.Error(), "app_id is required") {
		t.Fatalf("expected app_id required error, got %v", err)
	}

	_, err = registry.CreateKnowledgeScope(context.Background(), KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "nimi.desktop"},
		DisplayName: "   ",
	})
	if err == nil || !strings.Contains(err.Error(), "display_name is required") {
		t.Fatalf("expected display_name required error, got %v", err)
	}

	_, err = registry.CreateKnowledgeScope(context.Background(), KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindWorkspace, WorkspaceID: ""},
		DisplayName: "Y",
	})
	if err == nil || !strings.Contains(err.Error(), "workspace_id is required") {
		t.Fatalf("expected workspace_id required error, got %v", err)
	}

	// Cross-field guard: app_private must not also set workspace_id.
	_, err = registry.CreateKnowledgeScope(context.Background(), KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "nimi.desktop", WorkspaceID: "ws-1"},
		DisplayName: "Z",
	})
	if err == nil || !strings.Contains(err.Error(), "app_private owner must not set workspace_id") {
		t.Fatalf("expected app_private cross-field guard error, got %v", err)
	}
}

// C1.3 — CreateKnowledgeScope returns ErrScopeOwnerConflict on duplicate
// (scope_kind, owner_kind, owner_key, display_name).
func TestKnowledgeScopeRegistry_CreateRejectsDuplicate(t *testing.T) {
	c := newTestCognition(t)
	registry := c.KnowledgeScopeRegistry()

	desc := KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws-desktop"},
		DisplayName: "Product Notes",
	}
	first, err := registry.CreateKnowledgeScope(context.Background(), desc)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	if first.ScopeID == "" {
		t.Fatalf("expected scope id from first create")
	}

	_, err = registry.CreateKnowledgeScope(context.Background(), desc)
	if err == nil {
		t.Fatalf("expected duplicate to fail, got nil")
	}
	if !errors.Is(err, ErrScopeOwnerConflict) {
		t.Fatalf("expected ErrScopeOwnerConflict, got %v", err)
	}

	// Different display_name on the same owner is allowed.
	desc2 := desc
	desc2.DisplayName = "Product Notes (Archived)"
	if _, err := registry.CreateKnowledgeScope(context.Background(), desc2); err != nil {
		t.Fatalf("expected different display_name to succeed, got %v", err)
	}
}

// C1.4 — GetKnowledgeScope returns typed not-found.
func TestKnowledgeScopeRegistry_GetReturnsTypedNotFound(t *testing.T) {
	c := newTestCognition(t)
	registry := c.KnowledgeScopeRegistry()
	_, err := registry.GetKnowledgeScope(context.Background(), "nonexistent01JXYZ12345678901234567")
	if err == nil {
		t.Fatalf("expected error for missing scope, got nil")
	}
	if !errors.Is(err, ErrScopeNotFound) {
		t.Fatalf("expected ErrScopeNotFound, got %v", err)
	}
}

// C1.5 — ListKnowledgeScopes filters by owner kind / key with stable
// pagination. PageSize causes deterministic continuation token issuance
// and consumption.
func TestKnowledgeScopeRegistry_ListFiltersAndPaginates(t *testing.T) {
	c := newTestCognition(t)
	registry := c.KnowledgeScopeRegistry()

	// Seed 3 workspace scopes for ws-desktop + 2 workspace scopes for ws-7.
	for _, name := range []string{"AAA Bank", "BBB Bank", "CCC Bank"} {
		if _, err := registry.CreateKnowledgeScope(context.Background(), KnowledgeScopeDescriptor{
			Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws-desktop"},
			DisplayName: name,
		}); err != nil {
			t.Fatalf("seed workspace bank %s: %v", name, err)
		}
	}
	for _, name := range []string{"WS One", "WS Two"} {
		if _, err := registry.CreateKnowledgeScope(context.Background(), KnowledgeScopeDescriptor{
			Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws-7"},
			DisplayName: name,
		}); err != nil {
			t.Fatalf("seed workspace bank %s: %v", name, err)
		}
	}

	// Filter by owner identity.
	desktopScopes, _, err := registry.ListKnowledgeScopes(context.Background(), KnowledgeScopeFilter{
		Owners: []KnowledgeScopeOwner{{Kind: KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws-desktop"}},
	})
	if err != nil {
		t.Fatalf("list desktop workspace: %v", err)
	}
	if len(desktopScopes) != 3 {
		t.Fatalf("expected 3 workspace scopes, got %d", len(desktopScopes))
	}
	for _, s := range desktopScopes {
		if s.OwnerKey != "workspace:ws-desktop" {
			t.Fatalf("expected owner_key workspace:ws-desktop, got %s", s.OwnerKey)
		}
	}

	// Filter by owner identity (canonicalized).
	wsScopes, _, err := registry.ListKnowledgeScopes(context.Background(), KnowledgeScopeFilter{
		Owners: []KnowledgeScopeOwner{{Kind: KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws-7"}},
	})
	if err != nil {
		t.Fatalf("list workspace: %v", err)
	}
	if len(wsScopes) != 2 {
		t.Fatalf("expected 2 workspace scopes for ws-7, got %d", len(wsScopes))
	}

	// Pagination: page size 2 over 5 total.
	page1, token, err := registry.ListKnowledgeScopes(context.Background(), KnowledgeScopeFilter{OwnerKinds: []string{KnowledgeScopeOwnerKindWorkspace}, PageSize: 2})
	if err != nil {
		t.Fatalf("page1: %v", err)
	}
	if len(page1) != 2 {
		t.Fatalf("expected 2 results in page1, got %d", len(page1))
	}
	if token == "" {
		t.Fatalf("expected continuation token after page1")
	}
	page2, token2, err := registry.ListKnowledgeScopes(context.Background(), KnowledgeScopeFilter{OwnerKinds: []string{KnowledgeScopeOwnerKindWorkspace}, PageSize: 2, PageToken: token})
	if err != nil {
		t.Fatalf("page2: %v", err)
	}
	if len(page2) != 2 {
		t.Fatalf("expected 2 results in page2, got %d", len(page2))
	}
	page3, token3, err := registry.ListKnowledgeScopes(context.Background(), KnowledgeScopeFilter{OwnerKinds: []string{KnowledgeScopeOwnerKindWorkspace}, PageSize: 2, PageToken: token2})
	if err != nil {
		t.Fatalf("page3: %v", err)
	}
	if len(page3) != 1 {
		t.Fatalf("expected 1 result in page3, got %d", len(page3))
	}
	if token3 != "" {
		t.Fatalf("expected empty continuation token after final page, got %q", token3)
	}

	// No skipping/duplicating: union of pages equals the full list, with
	// each scope id appearing exactly once.
	seen := map[string]int{}
	for _, batch := range [][]KnowledgeScope{page1, page2, page3} {
		for _, s := range batch {
			seen[s.ScopeID]++
		}
	}
	if len(seen) != 5 {
		t.Fatalf("expected 5 unique scope ids across pages, got %d", len(seen))
	}
	for id, count := range seen {
		if count != 1 {
			t.Fatalf("scope %s appeared %d times across pages", id, count)
		}
	}
}
