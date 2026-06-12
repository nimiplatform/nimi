package cognition

import (
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// S2.19 — Concurrent PutPage on the same (bank, slug) is well-defined.
// The cognition store upserts by page_id (slug-matched lookups merge
// into the same page id), so concurrent writers should converge on a
// single live page row rather than producing duplicates. This guards
// against a TOCTOU regression where two writers each pick a fresh
// page_id because the resolveKnowledgePage(...) check raced ahead of
// the Save call.
func TestPutPageConcurrentSameSlugConvergesOrConflicts(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := testKnowledgeEnvelopeContext("app.s2-19")
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.s2-19"}
	bankID := newAppPrivateBank(t, svc, "app.s2-19", "S2.19 Bank")

	const workers = 6
	results := make([]string, workers)
	errs := make([]error, workers)

	var ready, done sync.WaitGroup
	start := make(chan struct{})
	ready.Add(workers)
	done.Add(workers)
	for i := 0; i < workers; i++ {
		i := i
		go func() {
			defer done.Done()
			ready.Done()
			<-start
			resp, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
				Context: reqCtx, BankId: bankID, Slug: "race", Title: "Race", Content: "body",
			})
			if err != nil {
				errs[i] = err
				return
			}
			results[i] = resp.GetPage().GetPageId()
		}()
	}
	ready.Wait()
	close(start)
	done.Wait()

	// Filter survivors. The current cognition Save layer commits every
	// upsert; what we guard against is a duplicate-page regression in
	// the runtime facade. After the race, ListPages must show <= 1
	// page with slug "race".
	listResp, err := svc.ListPages(ctx, &runtimev1.ListPagesRequest{Context: reqCtx, BankId: bankID})
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	matchCount := 0
	for _, page := range listResp.GetPages() {
		if page.GetSlug() == "race" {
			matchCount++
		}
	}
	if matchCount > 1 {
		t.Fatalf("expected <= 1 surviving page with slug=race after race, got %d (errs=%v results=%v)", matchCount, errs, results)
	}
}
