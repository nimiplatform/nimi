package cognition

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// S2.17 — DeleteKnowledgeBank cascades to scope + page + link +
// embedding + history + ingest. Layer 1 C1.6 already covers the
// nimi-cognition-side cascade including FTS leak. This test is the
// runtime-cognition-facade-side projection: after DeleteKnowledgeBank
// returns Ack, GetKnowledgeBank returns NOT_FOUND, ListPages on the
// dead bank returns NOT_FOUND, and ListBacklinks on the dead bank
// returns NOT_FOUND.
func TestDeleteKnowledgeBankCascadeFromFacade(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.s2-17"}
	bankID := newAppPrivateBank(t, svc, "app.s2-17", "S2.17 Bank")

	a, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx, BankId: bankID, Slug: "a", Title: "A", Content: "x",
	})
	if err != nil {
		t.Fatalf("seed a: %v", err)
	}
	b, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx, BankId: bankID, Slug: "b", Title: "B", Content: "y",
	})
	if err != nil {
		t.Fatalf("seed b: %v", err)
	}
	if _, err := svc.AddLink(ctx, &runtimev1.AddLinkRequest{
		Context: reqCtx, BankId: bankID,
		FromPageId: a.GetPage().GetPageId(),
		ToPageId:   b.GetPage().GetPageId(),
		LinkType:   "extends",
	}); err != nil {
		t.Fatalf("AddLink: %v", err)
	}

	if _, err := svc.DeleteKnowledgeBank(ctx, &runtimev1.DeleteKnowledgeBankRequest{
		Context: reqCtx, BankId: bankID,
	}); err != nil {
		t.Fatalf("DeleteKnowledgeBank: %v", err)
	}

	if _, err := svc.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{
		Context: reqCtx, BankId: bankID,
	}); err == nil {
		t.Fatalf("expected bank to be gone after delete")
	}
	if _, err := svc.ListPages(ctx, &runtimev1.ListPagesRequest{
		Context: reqCtx, BankId: bankID,
	}); err == nil {
		t.Fatalf("expected ListPages on dead bank to fail")
	}
	if _, err := svc.ListBacklinks(ctx, &runtimev1.ListBacklinksRequest{
		Context: reqCtx, BankId: bankID, ToPageId: b.GetPage().GetPageId(),
	}); err == nil {
		t.Fatalf("expected ListBacklinks on dead bank to fail")
	}
}
