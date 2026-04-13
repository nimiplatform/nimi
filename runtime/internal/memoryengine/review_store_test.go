package memoryengine

import (
	"context"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

func TestSQLiteCanonicalReviewStoreCommitIsIdempotentAndQueryable(t *testing.T) {
	t.Parallel()

	store, scope, record := newTestReviewStore(t)
	ctx := context.Background()
	req := CommitCanonicalReviewRequest{
		ReviewRunID:     "review-store-1",
		Scope:           scope,
		CheckpointBasis: record.GetMemoryId(),
		Outcomes: ReviewOutcomes{
			Narratives: []NarrativeRecord{
				{
					NarrativeID:     "nar-1",
					Topic:           "employment",
					Content:         "Alice still works at Nimi.",
					SourceVersion:   "v1",
					Status:          "active",
					SourceMemoryIDs: []string{record.GetMemoryId()},
				},
			},
			Truths: []TruthRecord{
				{
					TruthID:         "truth-1",
					Dimension:       "employment",
					NormalizedKey:   "alice:works_at",
					Statement:       "Alice works at Nimi.",
					Confidence:      0.9,
					ReviewCount:     1,
					LastReviewAt:    time.Now().UTC().Format(time.RFC3339Nano),
					Status:          "admitted",
					SourceMemoryIDs: []string{record.GetMemoryId()},
				},
			},
		},
	}
	if err := store.CommitCanonicalReview(ctx, req); err != nil {
		t.Fatalf("CommitCanonicalReview(first): %v", err)
	}
	if err := store.CommitCanonicalReview(ctx, req); err != nil {
		t.Fatalf("CommitCanonicalReview(idempotent): %v", err)
	}
	if err := store.CommitCanonicalReview(ctx, CommitCanonicalReviewRequest{
		ReviewRunID:     req.ReviewRunID,
		Scope:           scope,
		CheckpointBasis: record.GetMemoryId(),
		Outcomes: ReviewOutcomes{
			Summary: "different outcome payload",
		},
	}); err == nil {
		t.Fatal("expected review_run_id hash mismatch to fail")
	}

	truths, err := store.ListAdmittedTruths(ctx, scope)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 1 || truths[0].TruthID != "truth-1" {
		t.Fatalf("unexpected truths: %#v", truths)
	}

	checkpoint, err := store.GetReviewCheckpoint(ctx, scope)
	if err != nil {
		t.Fatalf("GetReviewCheckpoint: %v", err)
	}
	if checkpoint == nil || checkpoint.LastReviewRun != req.ReviewRunID || checkpoint.Checkpoint != record.GetMemoryId() {
		t.Fatalf("unexpected checkpoint: %#v", checkpoint)
	}

	narratives, err := store.ListNarrativeContext(ctx, scope, "Alice works at Nimi", 5)
	if err != nil {
		t.Fatalf("ListNarrativeContext: %v", err)
	}
	if len(narratives) != 1 || narratives[0].GetNarrativeId() != "nar-1" {
		t.Fatalf("unexpected narratives: %#v", narratives)
	}
	if got := narratives[0].GetSourceMemoryIds(); len(got) != 1 || got[0] != record.GetMemoryId() {
		t.Fatalf("unexpected narrative sources: %#v", got)
	}
}

func TestSQLiteCanonicalReviewStoreFiltersReviewInputsByCheckpoint(t *testing.T) {
	t.Parallel()

	store, scope, _ := newTestReviewStore(t)
	ctx := context.Background()

	inputs, err := store.ListCanonicalReviewInputs(ctx, scope, "mem-001", 10)
	if err != nil {
		t.Fatalf("ListCanonicalReviewInputs: %v", err)
	}
	if len(inputs) != 2 {
		t.Fatalf("expected 2 filtered inputs, got %#v", inputs)
	}
	if inputs[0].GetMemoryId() != "mem-010" || inputs[1].GetMemoryId() != "mem-020" {
		t.Fatalf("unexpected filtered inputs: %#v", inputs)
	}
}

func newTestReviewStore(t *testing.T) (CanonicalReviewStore, ScopeDescriptor, *runtimev1.MemoryRecord) {
	t.Helper()

	backend, err := runtimepersistence.Open(slog.Default(), filepath.Join(t.TempDir(), "local-state.json"))
	if err != nil {
		t.Fatalf("Open backend: %v", err)
	}
	t.Cleanup(func() {
		_ = backend.Close()
	})
	scope := ScopeDescriptor{
		Kind: ScopeSingleton,
		Principals: []ScopePrincipal{
			{Role: RoleAgent, ID: "agent-1"},
		},
	}
	record := &runtimev1.MemoryRecord{MemoryId: "mem-010"}
	store := NewSQLiteCanonicalReviewStore(backend, func(ctx context.Context, input ScopeDescriptor, limit int) ([]*runtimev1.MemoryRecord, error) {
		if _, err := NormalizeScope(input); err != nil {
			return nil, err
		}
		return []*runtimev1.MemoryRecord{
			{MemoryId: "mem-001"},
			record,
			{MemoryId: "mem-020"},
		}, nil
	})
	if store == nil {
		t.Fatal("expected canonical review store")
	}
	return store, scope, record
}
