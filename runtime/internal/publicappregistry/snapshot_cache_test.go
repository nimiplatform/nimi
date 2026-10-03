package publicappregistry

import (
	"context"
	"errors"
	"sync"
	"testing"
)

type observedWaitContext struct {
	context.Context
	once    sync.Once
	waiting chan struct{}
}

func (ctx *observedWaitContext) Done() <-chan struct{} {
	ctx.once.Do(func() { close(ctx.waiting) })
	return ctx.Context.Done()
}

func TestSnapshotCacheCanceledLoaderDoesNotCancelAnotherCaller(t *testing.T) {
	for _, canceled := range []error{context.Canceled, context.DeadlineExceeded} {
		t.Run(canceled.Error(), func(t *testing.T) {
			var cache snapshotCache
			started, release := make(chan struct{}), make(chan struct{})
			owner := make(chan error, 1)
			go func() {
				_, err := cache.load(context.Background(), testRevisionA, func() (*Snapshot, error) {
					close(started)
					<-release
					return nil, canceled
				})
				owner <- err
			}()
			<-started
			ctx := &observedWaitContext{Context: context.Background(), waiting: make(chan struct{})}
			expected := &Snapshot{revision: testRevisionA}
			waiter := make(chan error, 1)
			go func() {
				got, err := cache.load(ctx, testRevisionA, func() (*Snapshot, error) { return expected, nil })
				if err == nil && got != expected {
					err = errors.New("waiter lost its snapshot")
				}
				waiter <- err
			}()
			<-ctx.waiting
			close(release)
			if err := <-owner; !errors.Is(err, canceled) {
				t.Fatalf("loader error: %v", err)
			}
			if err := <-waiter; err != nil {
				t.Fatalf("independent caller inherited loader cancellation: %v", err)
			}
		})
	}
}

func TestImmutableSnapshotReuseStillObservesCurrentPolicy(t *testing.T) {
	ctx := context.Background()
	descriptor := validDescriptorDocument()
	source := validMemorySource(t, testRevisionA, descriptor)
	client := &Client{source: source}
	snapshot, err := client.Load(ctx)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := snapshot.Resolve(ctx, descriptor.Candidate.AppID, "windows-x86_64", "windows", "x86_64")
	if err != nil {
		t.Fatal(err)
	}
	initialReads := len(source.reads)
	for range 3 {
		if _, err := client.Revalidate(ctx, resolved.Selector); err != nil {
			t.Fatal(err)
		}
		if _, err := client.RevalidateInstalled(ctx, resolved.Selector); err != nil {
			t.Fatal(err)
		}
	}
	if len(source.reads) != initialReads {
		t.Fatalf("immutable content was re-read: before=%d after=%d", initialReads, len(source.reads))
	}
	// A caller cannot modify the cached descriptor through the returned value.
	resolved.AppAccess[0] = "changed-by-caller"
	again, err := snapshot.Resolve(ctx, descriptor.Candidate.AppID, "windows-x86_64", "windows", "x86_64")
	if err != nil || again.AppAccess[0] == "changed-by-caller" {
		t.Fatalf("shared descriptor mutated: %v", err)
	}

	source.revision = testRevisionB
	index := validIndexDocument(descriptor)
	row := index.Apps[descriptor.Candidate.AppID]
	reason := "policy-updated"
	row.KillSwitch = KillSwitch{Active: true, Reason: &reason, Revision: 2}
	index.Apps[descriptor.Candidate.AppID] = row
	source.documents[indexDocumentPath] = mustJSON(t, index)
	_, err = client.Revalidate(ctx, resolved.Selector)
	var blocked *PolicyBlockedError
	if !errors.As(err, &blocked) || blocked.Revision != 2 {
		t.Fatalf("cached snapshot hid new policy: %v", err)
	}

	// Losing the current head must not fall back to either cached revision.
	source.revision = ""
	if _, err := client.Load(ctx); err == nil {
		t.Fatal("invalid current head was hidden by cache")
	}
}

func TestSnapshotCacheSharesLoadsAllowsCanceledWaitersAndRetriesFailures(t *testing.T) {
	var cache snapshotCache
	started, release, complete := make(chan struct{}), make(chan struct{}), make(chan struct{})
	expected := &Snapshot{revision: testRevisionA}
	go func() {
		defer close(complete)
		_, _ = cache.load(context.Background(), testRevisionA, func() (*Snapshot, error) {
			close(started)
			<-release
			return expected, nil
		})
	}()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	waiting := make(chan error, 1)
	go func() {
		_, err := cache.load(ctx, testRevisionA, func() (*Snapshot, error) {
			return nil, errors.New("duplicate load")
		})
		waiting <- err
	}()
	cancel()
	if err := <-waiting; !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled waiter: %v", err)
	}
	close(release)
	<-complete
	got, err := cache.load(context.Background(), testRevisionA, func() (*Snapshot, error) { t.Fatal("cache missed"); return nil, nil })
	if err != nil || got != expected {
		t.Fatalf("shared snapshot: %v", err)
	}
	failed := errors.New("read failed")
	if _, err := cache.load(context.Background(), testRevisionB, func() (*Snapshot, error) { return nil, failed }); !errors.Is(err, failed) {
		t.Fatal(err)
	}
	if _, err := cache.load(context.Background(), testRevisionB, func() (*Snapshot, error) { return &Snapshot{}, nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := cache.load(context.Background(), testRevisionC, func() (*Snapshot, error) { return &Snapshot{}, nil }); err != nil {
		t.Fatal(err)
	}
	if len(cache.entries) != 2 || cache.entries[testRevisionA] != nil {
		t.Fatal("historical snapshots were not evicted")
	}
}
