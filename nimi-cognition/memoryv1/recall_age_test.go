package memoryv1

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

type ageTestEmbeddings struct{}

func (ageTestEmbeddings) AcknowledgeConsumed(context.Context, string) error { return nil }
func (ageTestEmbeddings) FinalizeStale(context.Context, string) error       { return nil }

func (ageTestEmbeddings) Embed(_ context.Context, q AIEmbeddingRequest) (AIEmbeddingResult, error) {
	v := AIEmbeddingResult{SpaceID: q.EmbeddingSpaceRef, Dimension: 2}
	for _, text := range q.Inputs {
		vec := []float64{1, 0}
		if strings.Contains(text, "fresh") {
			vec = []float64{0.9, 0.43}
		}
		v.Vectors = append(v.Vectors, vec)
	}
	return v, nil
}
func TestRecallAgeRanksWithoutForgettingOrSwitchingBoundRoutes(t *testing.T) {
	ctx := context.Background()
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	core, err := Open(t.TempDir(), WithClock(func() time.Time { return at }))
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := core.Close(); err != nil {
			t.Error(err)
		}
	}()
	bank := ensureTestBank(t, core, "age-bank")
	add := func(bank EnsureBankResult, seq uint64, id, text string, day time.Time) string {
		req := testCommit(bank, seq, id, "remember-"+id, text)
		req.CommittedAt = day
		if _, err := core.ReceiveCommittedEvent(ctx, req); err != nil {
			t.Fatal(err)
		}
		result, err := core.ExecuteRemember(ctx, req.OperationID)
		if err != nil || len(result.AffectedMemoryRefs) != 1 {
			t.Fatalf("remember %q: %+v %v", text, result, err)
		}
		return result.AffectedMemoryRefs[0]
	}
	old := add(bank, 1, "original", "I like jasmine jasmine tea", at.AddDate(-2, 0, 0))
	fresh := add(bank, 2, "newer", "I like fresh jasmine tea", at)
	other := ensureTestBank(t, core, "another-agent")
	add(other, 1, "private", "I like private jasmine jasmine tea", at)
	both := CapabilitySnapshot{Available: []Capability{CapabilityFTSIndex, CapabilityVectorIndex, CapabilityTextEmbed}, ConfigRevision: 1, EmbeddingSpaceRef: "age-space"}
	fts := CapabilitySnapshot{Available: []Capability{CapabilityFTSIndex}}
	check := func(req RecallRequest, want ...string) {
		t.Helper()
		got, err := core.Recall(ctx, req, ageTestEmbeddings{})
		if err != nil || len(got.Hits) != len(want) {
			t.Fatalf("%s: %+v %v", req.OperationID, got, err)
		}
		for i, id := range want {
			if got.Hits[i].MemoryRef != id || got.Hits[i].BankRef != bank.BankRef {
				t.Fatalf("%s: hit %d = %+v", req.OperationID, i, got.Hits[i])
			}
		}
	}
	bindOld := func(op string, p PipelineName, rev string, cap CapabilitySnapshot) RecallRequest {
		req := testRecallRequest(bank, op, "jasmine", 2, cap)
		_, err := core.bindRoute(ctx, routeBindingRequest{OperationID: op, OperationKind: "recall", BankRef: bank.BankRef, Pipeline: p, AlgorithmRevision: rev, Snapshot: cap, OperationRequest: recallRouteRequest{BindingRef: req.BindingRef, LifecycleRef: req.LifecycleRef, Subject: req.Subject, Query: req.Query, Limit: req.Limit}})
		if err != nil {
			t.Fatal(err)
		}
		return req
	}
	oldFTS := bindOld("pinned-fts", PipelineRecallFTS, "fts-2", both)
	if _, err := core.RebuildEmbedding(ctx, "build-age", bank.BankRef, both, ageTestEmbeddings{}); err != nil {
		t.Fatal(err)
	}
	check(oldFTS, old, fresh)
	check(bindOld("pinned-vector", PipelineRecallEmbedding, "embedding-1", both), old, fresh)
	newFTS := testRecallRequest(bank, "age-fts", "jasmine", 2, fts)
	newVec := testRecallRequest(bank, "age-vec", "jasmine", 2, both)
	check(newFTS, fresh, old)
	check(newVec, fresh, old)
	at = at.AddDate(10, 0, 0)
	check(newFTS, fresh, old)
	check(testRecallRequest(bank, "later", "jasmine", 2, fts), old, fresh)
	_, err = core.ForgetExact(ctx, ForgetRequest{OperationID: "explicit-forget", BindingRef: bank.BindingRef, BankRef: bank.BankRef, LifecycleRef: bank.LifecycleRef, Confirmed: true, TargetMemoryRefs: []string{old}})
	if err != nil {
		t.Fatal(err)
	}
	check(testRecallRequest(bank, "after-forget", "jasmine", 2, fts), fresh)
}

func TestFTSAgeRankingIgnoresForeignCorpusFrequencies(t *testing.T) {
	ctx := context.Background()
	clock := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	core, err := Open(t.TempDir(), WithClock(func() time.Time { return clock }))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := core.Close(); err != nil {
			t.Error(err)
		}
	})
	bank := ensureTestBank(t, core, "lexical-private")
	other := ensureTestBank(t, core, "foreign-stats")
	rememberText(t, core, bank, 1, "I like river hiking")
	clock = clock.Add(time.Minute)
	forest := rememberText(t, core, bank, 2, "I like forest hiking")
	for i, op := range []string{"before", "after"} {
		if i == 1 {
			for j := 1; j <= 10; j++ {
				req := testCommit(other, uint64(j), fmt.Sprintf("foreign-%d", j), fmt.Sprintf("foreign-op-%d", j), fmt.Sprintf("I like forest route %d", j))
				if _, err := core.ReceiveCommittedEvent(ctx, req); err != nil {
					t.Fatal(err)
				}
				if _, err := core.ExecuteRemember(ctx, req.OperationID); err != nil {
					t.Fatal(err)
				}
			}
		}
		hits, err := core.Recall(ctx, testRecallRequest(bank, op, "river forest", 1, CapabilitySnapshot{Available: []Capability{CapabilityFTSIndex}}), nil)
		if err != nil || len(hits.Hits) != 1 || hits.Hits[0].MemoryRef != forest {
			t.Fatalf("%s: %+v %v", op, hits, err)
		}
	}
}
