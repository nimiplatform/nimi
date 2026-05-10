package cognition

import (
	"context"
	"errors"
	"sync"
	"testing"

	_ "modernc.org/sqlite"
)

// C1.8 — Concurrent CreateKnowledgeScope on the same canonical owner
// must not produce duplicate registry rows; the loser receives the
// typed ErrScopeOwnerConflict, never a raw sqlite3 constraint error.
//
// This is the load-bearing invariant for the unique index. Without it,
// SQLite's WAL mode would let two transactions both think their unique
// constraint violation was the "first" hit, surface raw error strings
// to callers, and require ad-hoc string matching downstream.
func TestKnowledgeScopeRegistry_ConcurrentCreateNoDuplicates(t *testing.T) {
	c := newTestCognition(t)
	registry := c.KnowledgeScopeRegistry()

	const workers = 8
	desc := KnowledgeScopeDescriptor{
		Owner:       KnowledgeScopeOwner{Kind: KnowledgeScopeOwnerKindAppPrivate, AppID: "nimi.desktop"},
		DisplayName: "Race Bank",
	}

	results := make([]error, workers)
	scopes := make([]string, workers)

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
			scope, err := registry.CreateKnowledgeScope(context.Background(), desc)
			results[i] = err
			if err == nil {
				scopes[i] = scope.ScopeID
			}
		}()
	}

	ready.Wait()
	close(start)
	done.Wait()

	wins := 0
	losses := 0
	for i, err := range results {
		if err == nil {
			wins++
			if scopes[i] == "" {
				t.Fatalf("worker %d reported success but no scope id", i)
			}
			continue
		}
		if !errors.Is(err, ErrScopeOwnerConflict) {
			t.Fatalf("worker %d returned non-typed error: %v", i, err)
		}
		losses++
	}

	if wins != 1 {
		t.Fatalf("expected exactly 1 winner, got %d (losses=%d)", wins, losses)
	}
	if losses != workers-1 {
		t.Fatalf("expected %d losers, got %d", workers-1, losses)
	}

	// Cross-check against the registry: only one row exists for the
	// canonical owner.
	listed, _, err := registry.ListKnowledgeScopes(context.Background(), KnowledgeScopeFilter{
		Owners: []KnowledgeScopeOwner{desc.Owner},
	})
	if err != nil {
		t.Fatalf("list after race: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("expected 1 registry row after race, got %d", len(listed))
	}
}
