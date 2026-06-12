package cognition

import (
	"context"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
)

func TestAppPrivateCognitionAccessRequiresAdmittedFacade(t *testing.T) {
	c := newTestCognition(t)
	ctx := context.Background()

	writeAccess := validAppKnowledgeWriteAccess()
	scope, err := c.AppMemoryAccessService().CreateKnowledgeScope(ctx, writeAccess, KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "app.notes"},
		DisplayName: "App Notes",
	})
	if err != nil {
		t.Fatalf("app create knowledge scope: %v", err)
	}

	if _, err := c.KnowledgeScopeRegistry().CreateKnowledgeScope(ctx, KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "app.notes"},
		DisplayName: "Direct App Notes",
	}); err == nil || !strings.Contains(err.Error(), "AppMemoryAccessService") {
		t.Fatalf("direct app_private create must be denied, got %v", err)
	}
	if _, _, err := c.KnowledgeScopeRegistry().ListKnowledgeScopes(ctx, KnowledgeScopeFilter{
		Owners: []KnowledgeScopeOwner{{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "app.notes"}},
	}); err == nil || !strings.Contains(err.Error(), "AppMemoryAccessService") {
		t.Fatalf("direct app_private list must be denied, got %v", err)
	}

	page := knowledge.Page{
		PageID:    "page-app-1",
		ScopeID:   scope.ScopeID,
		Kind:      knowledge.ProjectionKindNote,
		Version:   1,
		Title:     "App page",
		Body:      []byte(`"app page body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	if err := c.KnowledgeService().Save(page); err == nil || !strings.Contains(err.Error(), "AppMemoryAccessService") {
		t.Fatalf("direct app_private knowledge save must be denied, got %v", err)
	}
	if err := c.AppMemoryAccessService().SaveKnowledge(ctx, writeAccess, page); err != nil {
		t.Fatalf("app save knowledge: %v", err)
	}
	loadedPage, err := c.AppMemoryAccessService().LoadKnowledge(ctx, validAppKnowledgeReadAccess(), scope.ScopeID, "page-app-1")
	if err != nil {
		t.Fatalf("app load knowledge: %v", err)
	}
	if loadedPage.AppWrite == nil || loadedPage.AppWrite.GrantRef != "grant-app-1" || loadedPage.AppWrite.RealmAuditEventID != "realm-audit-1" {
		t.Fatalf("knowledge app provenance not persisted: %+v", loadedPage.AppWrite)
	}

	record := memory.Record{
		RecordID:  "mem-app-1",
		ScopeID:   scope.ScopeID,
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"app memory"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	if err := c.MemoryService().Save(record); err == nil || !strings.Contains(err.Error(), "AppMemoryAccessService") {
		t.Fatalf("direct app_private memory save must be denied, got %v", err)
	}
	if err := c.AppMemoryAccessService().SaveMemory(ctx, validAppMemoryWriteAccess(), record); err != nil {
		t.Fatalf("app save memory: %v", err)
	}
	loadedRecord, err := c.AppMemoryAccessService().LoadMemory(ctx, validAppMemoryReadAccess(), scope.ScopeID, "mem-app-1")
	if err != nil {
		t.Fatalf("app load memory: %v", err)
	}
	if loadedRecord.AppProjection == nil || loadedRecord.AppProjection.ConversationAnchorRef != "conversation-anchor-1" {
		t.Fatalf("memory app projection provenance not persisted: %+v", loadedRecord.AppProjection)
	}

	if err := c.KnowledgeScopeRegistry().DeleteKnowledgeScope(ctx, scope.ScopeID); err == nil || !strings.Contains(err.Error(), "AppMemoryAccessService") {
		t.Fatalf("direct app_private delete must be denied, got %v", err)
	}
	if err := c.AppMemoryAccessService().DeleteKnowledgeScope(ctx, writeAccess, scope.ScopeID); err != nil {
		t.Fatalf("app delete knowledge scope: %v", err)
	}
}

func TestRuntimeKnowledgeBankScopeRequiresAdmittedFacade(t *testing.T) {
	c := newTestCognition(t)
	ctx := context.Background()
	scope, err := c.KnowledgeScopeRegistry().CreateKnowledgeScope(ctx, KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws-runtime-bank"},
		DisplayName: "Runtime Bank",
	})
	if err != nil {
		t.Fatalf("create runtime knowledge bank scope: %v", err)
	}
	page := knowledge.Page{
		PageID:    "page-runtime-bank-1",
		ScopeID:   scope.ScopeID,
		Kind:      knowledge.ProjectionKindNote,
		Version:   1,
		Title:     "Runtime bank page",
		Body:      []byte(`"runtime bank page body"`),
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	if err := c.KnowledgeService().Save(page); err == nil || !strings.Contains(err.Error(), "runtime_knowledge_bank") || !strings.Contains(err.Error(), "AppMemoryAccessService") {
		t.Fatalf("direct runtime knowledge bank save must be denied, got %v", err)
	}
	if err := c.AppMemoryAccessService().SaveKnowledge(ctx, validAppKnowledgeWriteAccess(), page); err != nil {
		t.Fatalf("app facade save knowledge: %v", err)
	}
}

func TestAppMemoryAccessDeniesMissingGrantAndProvenance(t *testing.T) {
	c := newTestCognition(t)
	access := validAppMemoryWriteAccess()
	access.Grant.Active = false
	err := c.AppMemoryAccessService().SaveMemory(context.Background(), access, memory.Record{
		RecordID:  "mem-deny",
		ScopeID:   "scope-deny",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"denied"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	})
	if err == nil || !strings.Contains(err.Error(), "active grant is required") {
		t.Fatalf("expected active grant denial, got %v", err)
	}

	access = validAppMemoryWriteAccess()
	access.TargetPersonaID = ""
	err = c.AppMemoryAccessService().SaveMemory(context.Background(), access, memory.Record{
		RecordID:  "mem-deny",
		ScopeID:   "scope-deny",
		Kind:      memory.RecordKindExperience,
		Version:   1,
		Content:   []byte(`{"summary":"denied"}`),
		Lifecycle: memory.RecordLifecycleActive,
		CreatedAt: ts,
		UpdatedAt: ts,
	})
	if err == nil || !strings.Contains(err.Error(), "session and persona binding") {
		t.Fatalf("expected persona/session denial, got %v", err)
	}
}

func validGrant() AppMemoryGrantEvidence {
	return AppMemoryGrantEvidence{
		GrantRef:          "grant-app-1",
		RealmAuditEventID: "realm-audit-1",
		Active:            true,
	}
}

func validAppKnowledgeWriteAccess() AppMemoryAccess {
	return AppMemoryAccess{
		PolicyClass:     AppMemoryPolicyKnowledgeWriteAdmitted,
		Grant:           validGrant(),
		SourceAppID:     "app.notes",
		KnowledgeBaseID: "kb-notes",
		AuditReason:     "test admitted knowledge write",
	}
}

func validAppKnowledgeReadAccess() AppMemoryAccess {
	return AppMemoryAccess{
		PolicyClass: AppMemoryPolicyKnowledgeReadBounded,
		Grant:       validGrant(),
		SourceAppID: "app.notes",
	}
}

func validAppMemoryWriteAccess() AppMemoryAccess {
	return AppMemoryAccess{
		PolicyClass:           AppMemoryPolicyMemoryWriteSessionScopedAdmitted,
		Grant:                 validGrant(),
		SourceAppID:           "app.notes",
		TargetPersonaID:       "persona-1",
		SessionRef:            "session-1",
		ConversationAnchorRef: "conversation-anchor-1",
		AuditReason:           "test admitted memory write",
	}
}

func validAppMemoryReadAccess() AppMemoryAccess {
	return AppMemoryAccess{
		PolicyClass:     AppMemoryPolicyMemoryReadPersonaScopedBounded,
		Grant:           validGrant(),
		SourceAppID:     "app.notes",
		TargetPersonaID: "persona-1",
	}
}
