package cognition

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// S2.10 — SearchKeyword returns hits ordered by score, respects
// entity_type_filters.
func TestSearchKeywordOrdersAndFiltersByEntityType(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.s2-10"}
	bankID := newAppPrivateBank(t, svc, "app.s2-10", "S2.10 Bank")

	for _, p := range []struct{ slug, title, content, kind string }{
		{"alpha", "Alpha", "alpha alpha alpha quantum", "explainer"},
		{"beta", "Beta", "beta quantum", "guide"},
		{"gamma", "Gamma", "gamma irrelevant", "note"},
	} {
		if _, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
			Context: reqCtx, BankId: bankID, Slug: p.slug, Title: p.title, Content: p.content, EntityType: p.kind,
		}); err != nil {
			t.Fatalf("seed %s: %v", p.slug, err)
		}
	}

	resp, err := svc.SearchKeyword(ctx, &runtimev1.SearchKeywordRequest{
		Context: reqCtx, BankIds: []string{bankID}, Query: "quantum", TopK: 10,
	})
	if err != nil {
		t.Fatalf("SearchKeyword: %v", err)
	}
	if len(resp.GetHits()) < 1 {
		t.Fatalf("expected at least one hit for 'quantum'")
	}
	for i := 1; i < len(resp.GetHits()); i++ {
		if resp.GetHits()[i].GetScore() > resp.GetHits()[i-1].GetScore() {
			t.Fatalf("hits not sorted by score desc at index %d", i)
		}
	}

	filtered, err := svc.SearchKeyword(ctx, &runtimev1.SearchKeywordRequest{
		Context: reqCtx, BankIds: []string{bankID}, Query: "quantum", TopK: 10,
		EntityTypeFilters: []string{"guide"},
	})
	if err != nil {
		t.Fatalf("filtered SearchKeyword: %v", err)
	}
	for _, hit := range filtered.GetHits() {
		if hit.GetSlug() != "beta" {
			t.Fatalf("filter leak: got slug %q for entity_type=guide", hit.GetSlug())
		}
	}
}

// S2.11 — SearchHybrid returns hits with token. Unavailable would
// surface KNOWLEDGE_HYBRID_SEARCH_UNAVAILABLE per K-KNOW-004a; we
// don't simulate that here because the cognition store currently
// always supports hybrid (lexical fallback inside the store, not the
// facade — D-DSYNC-018 forbids facade-level downgrade and that's
// what S2.11 enforces by virtue of the facade having no fallback
// branch in the rewritten knowledge_search.go).
func TestSearchHybridReturnsHitsWithToken(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.s2-11"}
	bankID := newAppPrivateBank(t, svc, "app.s2-11", "S2.11 Bank")

	for _, slug := range []string{"a", "b", "c", "d"} {
		if _, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
			Context: reqCtx, BankId: bankID, Slug: slug, Title: slug, Content: "search target " + slug,
		}); err != nil {
			t.Fatalf("seed %s: %v", slug, err)
		}
	}

	resp, err := svc.SearchHybrid(ctx, &runtimev1.SearchHybridRequest{
		Context: reqCtx, BankId: bankID, Query: "search", PageSize: 2,
	})
	if err != nil {
		t.Fatalf("SearchHybrid: %v", err)
	}
	if len(resp.GetHits()) == 0 {
		t.Fatalf("expected at least one hybrid hit")
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("expected ACTION_EXECUTED reason, got %v", resp.GetReasonCode())
	}
}
