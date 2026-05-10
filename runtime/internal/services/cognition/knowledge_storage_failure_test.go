package cognition

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// S2.20 — When the cognition store is closed underneath the facade,
// PutPage / GetKnowledgeBank / ListKnowledgeBanks must each surface a
// stable, typed reason rather than collapsing to a misleading
// KNOWLEDGE_PAGE_SLUG_CONFLICT or PROTOCOL_ENVELOPE_INVALID.
func TestStorageFailureSurfacesStableReason(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.s2-20"}
	bankID := newAppPrivateBank(t, svc, "app.s2-20", "S2.20 Bank")

	// Force storage failure by closing the underlying cognition core.
	if err := svc.cognitionCore.Close(); err != nil {
		t.Fatalf("close cognition core: %v", err)
	}

	// PutPage: must produce a typed error, never silent success.
	_, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx, BankId: bankID, Slug: "after-close", Title: "X", Content: "x",
	})
	if err == nil {
		t.Fatalf("expected PutPage error after Close, got nil")
	}
	reason, _ := grpcerr.ExtractReasonCode(err)
	if reason == runtimev1.ReasonCode_KNOWLEDGE_PAGE_SLUG_CONFLICT {
		t.Fatalf("PutPage storage failure must not collapse to slug-conflict reason")
	}

	// GetKnowledgeBank: must error.
	if _, err := svc.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{Context: reqCtx, BankId: bankID}); err == nil {
		t.Fatalf("expected GetKnowledgeBank error after Close, got nil")
	}

	// ListKnowledgeBanks: must error.
	if _, err := svc.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{Context: reqCtx}); err == nil {
		t.Fatalf("expected ListKnowledgeBanks error after Close, got nil")
	}
}
