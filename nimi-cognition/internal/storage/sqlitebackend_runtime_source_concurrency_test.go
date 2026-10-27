package storage

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRuntimeSourceConcurrentRebuildsCommitCompleteGenerations(t *testing.T) {
	backend, err := NewRuntimeSourceBackend(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	const scopes, generations = 16, 3
	start := make(chan struct{})
	var workers sync.WaitGroup
	for index := range scopes {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			scopeID := fmt.Sprintf("scope-%d", index)
			units := []RuntimeSourceUnit{{
				UnitID: "unit", Category: "biography_event", SourcePath: "profile.biography",
				SourceRef: RuntimeSourceRef{Kind: "worldCharacter", WorldID: "world-1", RefID: scopeID, SchemaVersion: "realm.world-character-core/v1", ContentHash: strings.Repeat("c", 64)},
				Text:      "Owner source", ProvenanceRefs: []string{"realm:source"}, Priority: 1,
			}}
			for generation := 1; generation <= generations; generation++ {
				state, err := backend.ReplaceRuntimeSourceCorpus(scopeID, strings.Repeat("a", 64), strings.Repeat("b", 64), units, nil, "building", "", 0, 0, time.Now())
				if err != nil {
					t.Errorf("%s begin generation %d: %v", scopeID, generation, err)
					return
				}
				if _, err := backend.ReplaceRuntimeSourceCorpus(scopeID, state.SnapshotIdentity, state.PartitionIdentity, units, nil, "unconfigured", "", 0, state.Generation, time.Now()); err != nil {
					t.Errorf("%s complete generation %d: %v", scopeID, generation, err)
					return
				}
			}
		}()
	}
	close(start)
	workers.Wait()
	if t.Failed() {
		return
	}
	for index := range scopes {
		state, err := backend.InspectRuntimeSourceState(context.Background(), fmt.Sprintf("scope-%d", index))
		if err != nil || state.Generation != generations || state.Status != "unconfigured" || state.UnitCount != 1 {
			t.Fatalf("incomplete committed source: %+v, err=%v", state, err)
		}
	}
}
