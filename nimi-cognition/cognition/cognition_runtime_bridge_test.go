package cognition

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/clock"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
)

func TestRuntimeBridgeKnowledgeScopeLifecycle(t *testing.T) {
	c, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() {
		if err := c.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
	})

	ctx := context.Background()
	owner := KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "app-a"}
	createAuth := runtimeKnowledgeAuthorization(RuntimeAuthorizationActionCreateBank, RuntimeBridgeOperationCreateKnowledgeScope, owner, "")
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
	writeAuth := runtimeKnowledgeAuthorization(RuntimeAuthorizationActionWritePage, RuntimeBridgeOperationSaveKnowledge, owner, scope.ScopeID)
	if err := c.RuntimeBridge().SaveKnowledge(ctx, writeAuth, page); err != nil {
		t.Fatalf("SaveKnowledge: %v", err)
	}
	if err := c.KnowledgeService().Save(page); err == nil || !strings.Contains(err.Error(), "RuntimeBridge") {
		t.Fatalf("direct runtime scope write should require RuntimeBridge, got %v", err)
	}

	readAuth := runtimeKnowledgeAuthorization(RuntimeAuthorizationActionReadPage, RuntimeBridgeOperationLoadKnowledge, owner, scope.ScopeID)
	loaded, err := c.RuntimeBridge().LoadKnowledge(ctx, readAuth, scope.ScopeID, page.PageID)
	if err != nil {
		t.Fatalf("LoadKnowledge: %v", err)
	}
	if loaded.PageID != page.PageID {
		t.Fatalf("loaded page = %q, want %q", loaded.PageID, page.PageID)
	}

	deleteAuth := runtimeKnowledgeAuthorization(RuntimeAuthorizationActionDeleteBank, RuntimeBridgeOperationDeleteKnowledgeScope, owner, scope.ScopeID)
	if err := c.RuntimeBridge().DeleteKnowledgeScope(ctx, deleteAuth, scope.ScopeID); err != nil {
		t.Fatalf("DeleteKnowledgeScope: %v", err)
	}
}

func TestRuntimeBridgeRejectsMissingAndCrossOwnerAuthorization(t *testing.T) {
	c, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() {
		if err := c.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
	})

	ctx := context.Background()
	owner := KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "app-a"}
	scope, err := c.RuntimeBridge().CreateKnowledgeScope(ctx, runtimeKnowledgeAuthorization(RuntimeAuthorizationActionCreateBank, RuntimeBridgeOperationCreateKnowledgeScope, owner, ""), KnowledgeScopeDescriptor{Owner: owner, DisplayName: "Runtime knowledge"})
	if err != nil {
		t.Fatalf("CreateKnowledgeScope: %v", err)
	}

	missing := runtimeKnowledgeAuthorization(RuntimeAuthorizationActionReadPage, RuntimeBridgeOperationListKnowledge, owner, scope.ScopeID)
	missing.Decision = ""
	if _, err := c.RuntimeBridge().ListKnowledge(ctx, missing, scope.ScopeID); !errorsIsRuntimeAuthorizationDenied(err) {
		t.Fatalf("missing authorization should deny, got %v", err)
	}

	crossOwner := runtimeKnowledgeAuthorization(
		RuntimeAuthorizationActionReadPage,
		RuntimeBridgeOperationListKnowledge,
		KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "app-b"},
		scope.ScopeID,
	)
	if _, err := c.RuntimeBridge().ListKnowledge(ctx, crossOwner, scope.ScopeID); !errorsIsRuntimeAuthorizationDenied(err) {
		t.Fatalf("cross-owner authorization should deny, got %v", err)
	}

	wrongScope := runtimeKnowledgeAuthorization(RuntimeAuthorizationActionReadPage, RuntimeBridgeOperationListKnowledge, owner, "another-scope")
	if _, err := c.RuntimeBridge().ListKnowledge(ctx, wrongScope, scope.ScopeID); !errorsIsRuntimeAuthorizationDenied(err) {
		t.Fatalf("wrong-scope authorization should deny, got %v", err)
	}

	loadOnly := runtimeKnowledgeAuthorization(RuntimeAuthorizationActionReadPage, RuntimeBridgeOperationLoadKnowledge, owner, scope.ScopeID)
	if _, err := c.RuntimeBridge().ListKnowledge(ctx, loadOnly, scope.ScopeID); !errorsIsRuntimeAuthorizationDenied(err) {
		t.Fatalf("cross-operation authorization reuse should deny, got %v", err)
	}

	writeOnly := runtimeKnowledgeAuthorization(RuntimeAuthorizationActionWritePage, RuntimeBridgeOperationSaveKnowledge, owner, scope.ScopeID)
	if _, err := c.RuntimeBridge().LoadKnowledge(ctx, writeOnly, scope.ScopeID, "missing"); !errorsIsRuntimeAuthorizationDenied(err) {
		t.Fatalf("cross read/write authorization reuse should deny, got %v", err)
	}

	wrongAction := runtimeKnowledgeAuthorization(RuntimeAuthorizationActionSearch, RuntimeBridgeOperationListKnowledge, owner, scope.ScopeID)
	if _, err := c.RuntimeBridge().ListKnowledge(ctx, wrongAction, scope.ScopeID); !errorsIsRuntimeAuthorizationDenied(err) {
		t.Fatalf("action mismatch should deny, got %v", err)
	}

	stale := runtimeKnowledgeAuthorization(RuntimeAuthorizationActionReadPage, RuntimeBridgeOperationListKnowledge, owner, scope.ScopeID)
	stale.ExpiresAt = time.Now().UTC().Add(-time.Second)
	if _, err := c.RuntimeBridge().ListKnowledge(ctx, stale, scope.ScopeID); !errorsIsRuntimeAuthorizationDenied(err) {
		t.Fatalf("stale authorization should deny, got %v", err)
	}
}

func TestRuntimeBridgeListKnowledgeScopesPreservesPaginationError(t *testing.T) {
	c, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() {
		if err := c.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
	})

	owner := KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "app-pagination"}
	auth := runtimeKnowledgeAuthorization(RuntimeAuthorizationActionReadBank, RuntimeBridgeOperationListKnowledgeScopes, owner, "")
	_, _, err = c.RuntimeBridge().ListKnowledgeScopes(context.Background(), auth, KnowledgeScopeFilter{
		OwnerKinds: []string{KnowledgeScopeOwnerKindAppPrivate},
		Owners:     []KnowledgeScopeOwner{owner},
		PageSize:   101,
	})
	if !errors.Is(err, ErrScopePaginationInvalid) {
		t.Fatalf("ListKnowledgeScopes error = %v, want ErrScopePaginationInvalid", err)
	}
}

func TestRuntimeBridgeDeleteKnowledgePageIsFreshAndAtomic(t *testing.T) {
	clk := clock.NewTestClock(ts)
	c, err := New(t.TempDir(), WithClock(clk))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })

	ctx := context.Background()
	owner := KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "app-delete-atomic"}
	scope, err := c.RuntimeBridge().CreateKnowledgeScope(
		ctx,
		runtimeKnowledgeAuthorizationAt(RuntimeAuthorizationActionCreateBank, RuntimeBridgeOperationCreateKnowledgeScope, owner, "", clk.Now()),
		KnowledgeScopeDescriptor{Owner: owner, DisplayName: "Atomic delete"},
	)
	if err != nil {
		t.Fatalf("CreateKnowledgeScope: %v", err)
	}
	page := func(id string, refs []artifactref.Ref) knowledge.Page {
		return knowledge.Page{
			PageID:       knowledge.PageID(id),
			ScopeID:      scope.ScopeID,
			Kind:         knowledge.ProjectionKindNote,
			Version:      1,
			Title:        id,
			Body:         json.RawMessage(`{"content":"atomic delete"}`),
			Lifecycle:    knowledge.ProjectionLifecycleActive,
			CreatedAt:    clk.Now(),
			UpdatedAt:    clk.Now(),
			ArtifactRefs: refs,
		}
	}
	writeAuth := runtimeKnowledgeAuthorizationAt(RuntimeAuthorizationActionWritePage, RuntimeBridgeOperationSaveKnowledge, owner, scope.ScopeID, clk.Now())
	for _, item := range []knowledge.Page{page("target", nil), page("related", nil)} {
		if err := c.RuntimeBridge().SaveKnowledge(ctx, writeAuth, item); err != nil {
			t.Fatalf("SaveKnowledge(%s): %v", item.PageID, err)
		}
	}
	relation := knowledge.Relation{
		ScopeID:      scope.ScopeID,
		FromPageID:   "related",
		ToPageID:     "target",
		RelationType: "supports",
		Strength:     artifactref.StrengthStrong,
		CreatedAt:    clk.Now(),
		UpdatedAt:    clk.Now(),
	}
	putRelationAuth := runtimeKnowledgeAuthorizationAt(RuntimeAuthorizationActionWriteLink, RuntimeBridgeOperationPutKnowledgeRelation, owner, scope.ScopeID, clk.Now())
	if err := c.RuntimeBridge().PutKnowledgeRelation(ctx, putRelationAuth, relation); err != nil {
		t.Fatalf("PutKnowledgeRelation: %v", err)
	}

	expiredDeleteAuth := runtimeKnowledgeAuthorizationAt(RuntimeAuthorizationActionDeletePage, RuntimeBridgeOperationDeleteKnowledgePage, owner, scope.ScopeID, clk.Now())
	clk.Advance(2 * time.Minute)
	if err := c.RuntimeBridge().DeleteKnowledgePage(ctx, expiredDeleteAuth, scope.ScopeID, "target"); !IsRuntimeAuthorizationDenied(err) {
		t.Fatalf("expired delete error = %v, want authorization denied", err)
	}
	assertRuntimeBridgePageAndRelation(t, c, clk.Now(), owner, scope.ScopeID, true, true)

	blockerRef := artifactref.Ref{
		FromKind:  artifactref.KindMemoryRecord,
		FromID:    "blocker",
		ToKind:    artifactref.KindKnowledgePage,
		ToID:      "target",
		Strength:  artifactref.StrengthStrong,
		Role:      "support",
		CreatedAt: clk.Now(),
		UpdatedAt: clk.Now(),
	}
	blocker := memory.Record{
		RecordID:     "blocker",
		ScopeID:      scope.ScopeID,
		Kind:         memory.RecordKindExperience,
		Content:      json.RawMessage(`{"summary":"delete blocker"}`),
		Lifecycle:    memory.RecordLifecycleActive,
		ArtifactRefs: []artifactref.Ref{blockerRef},
	}
	if err := c.memorySvc.saveInternal(blocker); err != nil {
		t.Fatalf("save blocker memory: %v", err)
	}
	freshDeleteAuth := runtimeKnowledgeAuthorizationAt(RuntimeAuthorizationActionDeletePage, RuntimeBridgeOperationDeleteKnowledgePage, owner, scope.ScopeID, clk.Now())
	if err := c.RuntimeBridge().DeleteKnowledgePage(ctx, freshDeleteAuth, scope.ScopeID, "target"); err == nil {
		t.Fatal("delete with non-relation blocker succeeded")
	}
	// The relation delete happens before blocker validation inside the same
	// transaction, so its continued presence proves rollback is atomic.
	assertRuntimeBridgePageAndRelation(t, c, clk.Now(), owner, scope.ScopeID, true, true)

	blocker.ArtifactRefs = nil
	if err := c.memorySvc.saveInternal(blocker); err != nil {
		t.Fatalf("clear blocker reference: %v", err)
	}
	if err := c.RuntimeBridge().DeleteKnowledgePage(ctx, freshDeleteAuth, scope.ScopeID, "target"); err != nil {
		t.Fatalf("DeleteKnowledgePage: %v", err)
	}
	assertRuntimeBridgePageAndRelation(t, c, clk.Now(), owner, scope.ScopeID, false, false)
}

func assertRuntimeBridgePageAndRelation(t *testing.T, c *Cognition, now time.Time, owner KnowledgeScopeOwner, scopeID string, wantPage bool, wantRelation bool) {
	t.Helper()
	loadAuth := runtimeKnowledgeAuthorizationAt(RuntimeAuthorizationActionReadPage, RuntimeBridgeOperationLoadKnowledge, owner, scopeID, now)
	_, pageErr := c.RuntimeBridge().LoadKnowledge(context.Background(), loadAuth, scopeID, "target")
	if wantPage && pageErr != nil {
		t.Fatalf("target page missing: %v", pageErr)
	}
	if !wantPage && !errors.Is(pageErr, ErrKnowledgePageNotFound) {
		t.Fatalf("target page error = %v, want ErrKnowledgePageNotFound", pageErr)
	}
	listAuth := runtimeKnowledgeAuthorizationAt(RuntimeAuthorizationActionReadLink, RuntimeBridgeOperationListKnowledgeRelations, owner, scopeID, now)
	relations, err := c.RuntimeBridge().ListKnowledgeRelations(context.Background(), listAuth, scopeID, "related")
	if err != nil {
		t.Fatalf("ListKnowledgeRelations: %v", err)
	}
	if got := len(relations) > 0; got != wantRelation {
		t.Fatalf("relation presence = %t, want %t", got, wantRelation)
	}
}

func runtimeKnowledgeAuthorization(action RuntimeAuthorizationAction, operation RuntimeBridgeOperation, owner KnowledgeScopeOwner, scopeID string) RuntimeAuthorization {
	return runtimeKnowledgeAuthorizationAt(action, operation, owner, scopeID, time.Now().UTC())
}

func runtimeKnowledgeAuthorizationAt(action RuntimeAuthorizationAction, operation RuntimeBridgeOperation, owner KnowledgeScopeOwner, scopeID string, now time.Time) RuntimeAuthorization {
	appID := strings.TrimSpace(owner.AppID)
	if appID == "" {
		appID = "runtime.test"
	}
	now = now.UTC()
	return RuntimeAuthorization{
		Decision:    RuntimeAuthorizationDecisionAllow,
		Action:      action,
		Operation:   operation,
		AccountID:   "acct-1",
		AppID:       appID,
		ScopeID:     scopeID,
		Owner:       owner,
		EvaluatedAt: now,
		ExpiresAt:   now.Add(time.Minute),
	}
}

func errorsIsRuntimeAuthorizationDenied(err error) bool {
	return err != nil && strings.Contains(err.Error(), errRuntimeAuthorizationDenied.Error())
}
