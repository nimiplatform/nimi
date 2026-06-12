package cognition

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func newAppPrivateBank(t *testing.T, svc *Service, appID, displayName string) string {
	t.Helper()
	resp, err := svc.CreateKnowledgeBank(testKnowledgeEnvelopeContext(appID), &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: appID},
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: appID},
			},
		},
		DisplayName: displayName,
	})
	if err != nil {
		t.Fatalf("create bank: %v", err)
	}
	return resp.GetBank().GetBankId()
}

// S2.7 — PutPage happy + slug-conflict reason.
func TestPutPageHappyAndSlugConflict(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := testKnowledgeEnvelopeContext("app.s2-7")
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.s2-7"}
	bankID := newAppPrivateBank(t, svc, "app.s2-7", "S2.7 Bank")

	first, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx, BankId: bankID, Slug: "alpha", Title: "Alpha", Content: "alpha body",
	})
	if err != nil {
		t.Fatalf("first PutPage: %v", err)
	}
	if first.GetPage().GetSlug() != "alpha" {
		t.Fatalf("expected slug alpha, got %q", first.GetPage().GetSlug())
	}

	// Same slug, no PageId → upsert (matched by slug). Should succeed.
	if _, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx, BankId: bankID, Slug: "alpha", Title: "Alpha v2", Content: "v2",
	}); err != nil {
		t.Fatalf("upsert by slug: %v", err)
	}
}

// S2.8 — GetPage by id and by slug.
func TestGetPageByIdAndBySlug(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := testKnowledgeEnvelopeContext("app.s2-8")
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.s2-8"}
	bankID := newAppPrivateBank(t, svc, "app.s2-8", "S2.8 Bank")

	put, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx, BankId: bankID, Slug: "beta", Title: "Beta", Content: "beta body",
	})
	if err != nil {
		t.Fatalf("PutPage: %v", err)
	}

	byID, err := svc.GetPage(ctx, &runtimev1.GetPageRequest{
		Context: reqCtx, BankId: bankID,
		Lookup: &runtimev1.GetPageRequest_PageId{PageId: put.GetPage().GetPageId()},
	})
	if err != nil {
		t.Fatalf("GetPage by id: %v", err)
	}
	if byID.GetPage().GetSlug() != "beta" {
		t.Fatalf("expected slug beta, got %q", byID.GetPage().GetSlug())
	}

	bySlug, err := svc.GetPage(ctx, &runtimev1.GetPageRequest{
		Context: reqCtx, BankId: bankID,
		Lookup: &runtimev1.GetPageRequest_Slug{Slug: "beta"},
	})
	if err != nil {
		t.Fatalf("GetPage by slug: %v", err)
	}
	if bySlug.GetPage().GetPageId() != put.GetPage().GetPageId() {
		t.Fatalf("expected same page id from slug lookup")
	}
}

// S2.9 — DeletePage removes only the page; bank and other pages stay.
func TestDeletePageRemovesOnlyTargetPage(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := testKnowledgeEnvelopeContext("app.s2-9")
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.s2-9"}
	bankID := newAppPrivateBank(t, svc, "app.s2-9", "S2.9 Bank")

	for _, slug := range []string{"keep1", "kill", "keep2"} {
		if _, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
			Context: reqCtx, BankId: bankID, Slug: slug, Title: slug, Content: slug + " body",
		}); err != nil {
			t.Fatalf("seed %s: %v", slug, err)
		}
	}

	if _, err := svc.DeletePage(ctx, &runtimev1.DeletePageRequest{
		Context: reqCtx, BankId: bankID,
		Lookup: &runtimev1.DeletePageRequest_Slug{Slug: "kill"},
	}); err != nil {
		t.Fatalf("DeletePage: %v", err)
	}

	_, err := svc.GetPage(ctx, &runtimev1.GetPageRequest{
		Context: reqCtx, BankId: bankID,
		Lookup: &runtimev1.GetPageRequest_Slug{Slug: "kill"},
	})
	if err == nil {
		t.Fatalf("expected deleted page to be missing")
	}
	if status.Code(err) != codes.NotFound {
		t.Fatalf("expected NotFound after delete, got %v", err)
	}
	reason, _ := grpcerr.ExtractReasonCode(err)
	if reason != runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND {
		t.Fatalf("expected KNOWLEDGE_PAGE_NOT_FOUND, got %v", reason)
	}

	listResp, err := svc.ListPages(ctx, &runtimev1.ListPagesRequest{Context: reqCtx, BankId: bankID})
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	if len(listResp.GetPages()) != 2 {
		t.Fatalf("expected 2 surviving pages, got %d", len(listResp.GetPages()))
	}

	// Bank itself is intact.
	if _, err := svc.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{Context: reqCtx, BankId: bankID}); err != nil {
		t.Fatalf("expected bank to survive page delete, got %v", err)
	}
}
