package cognition

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// S2.12 — AddLink across two different banks must reject.
// The cognition KnowledgeService.PutRelation enforces same-scope on
// from/to page; the cognition facade returns KNOWLEDGE_LINK_INVALID
// when PutRelation rejects.
func TestAddLinkCrossBankInvalid(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.s2-12"}
	bankA := newAppPrivateBank(t, svc, "app.s2-12", "Bank A")
	bankB := newAppPrivateBank(t, svc, "app.s2-12", "Bank B")

	pageA, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx, BankId: bankA, Slug: "a", Title: "A", Content: "x",
	})
	if err != nil {
		t.Fatalf("seed page A: %v", err)
	}
	pageB, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx, BankId: bankB, Slug: "b", Title: "B", Content: "y",
	})
	if err != nil {
		t.Fatalf("seed page B: %v", err)
	}

	// AddLink targeting bankA but pointing at a page id that exists
	// only in bankB. Cognition layer rejects the relation; the facade
	// surfaces KNOWLEDGE_LINK_INVALID.
	_, err = svc.AddLink(ctx, &runtimev1.AddLinkRequest{
		Context: reqCtx, BankId: bankA,
		FromPageId: pageA.GetPage().GetPageId(),
		ToPageId:   pageB.GetPage().GetPageId(),
		LinkType:   "supports",
	})
	if err == nil {
		t.Fatalf("expected cross-bank link to be rejected")
	}
	reason, _ := grpcerr.ExtractReasonCode(err)
	if reason != runtimev1.ReasonCode_KNOWLEDGE_LINK_INVALID {
		t.Fatalf("expected KNOWLEDGE_LINK_INVALID, got %v", reason)
	}
}

// S2.13 — RemoveLink + ListBacklinks reflect removal.
func TestRemoveLinkReflectedInBacklinks(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.s2-13"}
	bankID := newAppPrivateBank(t, svc, "app.s2-13", "S2.13 Bank")

	first, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx, BankId: bankID, Slug: "from", Title: "From", Content: "x",
	})
	if err != nil {
		t.Fatalf("seed from: %v", err)
	}
	second, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx, BankId: bankID, Slug: "to", Title: "To", Content: "y",
	})
	if err != nil {
		t.Fatalf("seed to: %v", err)
	}
	addResp, err := svc.AddLink(ctx, &runtimev1.AddLinkRequest{
		Context: reqCtx, BankId: bankID,
		FromPageId: first.GetPage().GetPageId(),
		ToPageId:   second.GetPage().GetPageId(),
		LinkType:   "extends",
	})
	if err != nil {
		t.Fatalf("AddLink: %v", err)
	}

	pre, err := svc.ListBacklinks(ctx, &runtimev1.ListBacklinksRequest{
		Context: reqCtx, BankId: bankID, ToPageId: second.GetPage().GetPageId(),
	})
	if err != nil {
		t.Fatalf("ListBacklinks pre: %v", err)
	}
	if len(pre.GetBacklinks()) != 1 {
		t.Fatalf("expected 1 backlink before remove, got %d", len(pre.GetBacklinks()))
	}

	if _, err := svc.RemoveLink(ctx, &runtimev1.RemoveLinkRequest{
		Context: reqCtx, BankId: bankID, LinkId: addResp.GetLink().GetLinkId(),
	}); err != nil {
		t.Fatalf("RemoveLink: %v", err)
	}

	post, err := svc.ListBacklinks(ctx, &runtimev1.ListBacklinksRequest{
		Context: reqCtx, BankId: bankID, ToPageId: second.GetPage().GetPageId(),
	})
	if err != nil {
		t.Fatalf("ListBacklinks post: %v", err)
	}
	if len(post.GetBacklinks()) != 0 {
		t.Fatalf("expected 0 backlinks after remove, got %d", len(post.GetBacklinks()))
	}
}
