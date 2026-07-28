package cognition

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
)

func TestRuntimeBridgeKnowledgeScopeLifecycle(t *testing.T) {
	c, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer c.Close()

	ctx := context.Background()
	owner := KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "app-a"}
	createAuth := runtimeKnowledgeAuthorization(RuntimeAccessWrite, owner, "")
	scope, err := c.RuntimeBridge().CreateKnowledgeScope(ctx, createAuth, KnowledgeScopeDescriptor{
		Owner:       owner,
		DisplayName: "Runtime knowledge",
	})
	if err != nil {
		t.Fatalf("CreateKnowledgeScope: %v", err)
	}
	if _, err := c.KnowledgeScopeRegistry().CreateKnowledgeScope(ctx, KnowledgeScopeDescriptor{Owner: owner, DisplayName: "Direct"}); err == nil || !strings.Contains(err.Error(), "RuntimeBridge") {
		t.Fatalf("direct app_private create should require RuntimeBridge, got %v", err)
	}

	now := time.Now().UTC()
	page := knowledge.Page{
		PageID:    "page-1",
		ScopeID:   scope.ScopeID,
		Kind:      knowledge.ProjectionKindNote,
		Version:   1,
		Title:     "Page",
		Body:      json.RawMessage(`{"content":"runtime bridge"}`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: now,
		UpdatedAt: now,
	}
	writeAuth := runtimeKnowledgeAuthorization(RuntimeAccessWrite, owner, scope.ScopeID)
	if err := c.RuntimeBridge().SaveKnowledge(ctx, writeAuth, page); err != nil {
		t.Fatalf("SaveKnowledge: %v", err)
	}
	if err := c.KnowledgeService().Save(page); err == nil || !strings.Contains(err.Error(), "RuntimeBridge") {
		t.Fatalf("direct runtime scope write should require RuntimeBridge, got %v", err)
	}

	readAuth := runtimeKnowledgeAuthorization(RuntimeAccessRead, owner, scope.ScopeID)
	loaded, err := c.RuntimeBridge().LoadKnowledge(ctx, readAuth, scope.ScopeID, page.PageID)
	if err != nil {
		t.Fatalf("LoadKnowledge: %v", err)
	}
	if loaded.PageID != page.PageID {
		t.Fatalf("loaded page = %q, want %q", loaded.PageID, page.PageID)
	}

	if err := c.RuntimeBridge().DeleteKnowledgeScope(ctx, writeAuth, scope.ScopeID); err != nil {
		t.Fatalf("DeleteKnowledgeScope: %v", err)
	}
}

func TestRuntimeBridgeRejectsMissingAndCrossOwnerAuthorization(t *testing.T) {
	c, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer c.Close()

	ctx := context.Background()
	owner := KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "app-a"}
	scope, err := c.RuntimeBridge().CreateKnowledgeScope(ctx, runtimeKnowledgeAuthorization(RuntimeAccessWrite, owner, ""), KnowledgeScopeDescriptor{Owner: owner, DisplayName: "Runtime knowledge"})
	if err != nil {
		t.Fatalf("CreateKnowledgeScope: %v", err)
	}

	missing := runtimeKnowledgeAuthorization(RuntimeAccessRead, owner, scope.ScopeID)
	missing.Allowed = false
	if _, err := c.RuntimeBridge().ListKnowledge(ctx, missing, scope.ScopeID); !errorsIsRuntimeAuthorizationDenied(err) {
		t.Fatalf("missing authorization should deny, got %v", err)
	}

	crossOwner := runtimeKnowledgeAuthorization(
		RuntimeAccessRead,
		KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "app-b"},
		scope.ScopeID,
	)
	if _, err := c.RuntimeBridge().ListKnowledge(ctx, crossOwner, scope.ScopeID); !errorsIsRuntimeAuthorizationDenied(err) {
		t.Fatalf("cross-owner authorization should deny, got %v", err)
	}

	wrongScope := runtimeKnowledgeAuthorization(RuntimeAccessRead, owner, "another-scope")
	if _, err := c.RuntimeBridge().ListKnowledge(ctx, wrongScope, scope.ScopeID); !errorsIsRuntimeAuthorizationDenied(err) {
		t.Fatalf("wrong-scope authorization should deny, got %v", err)
	}
}

func runtimeKnowledgeAuthorization(mode RuntimeAccessMode, owner KnowledgeScopeOwner, scopeID string) RuntimeAuthorization {
	appID := strings.TrimSpace(owner.AppID)
	if appID == "" {
		appID = "runtime.test"
	}
	return RuntimeAuthorization{
		Allowed:   true,
		AccountID: "acct-1",
		AppID:     appID,
		Mode:      mode,
		ScopeID:   scopeID,
		Owner:     owner,
	}
}

func errorsIsRuntimeAuthorizationDenied(err error) bool {
	return err != nil && strings.Contains(err.Error(), errRuntimeAuthorizationDenied.Error())
}
