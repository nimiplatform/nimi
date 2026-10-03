package publicappregistry

import (
	"context"
	"errors"
	"sync"
)

// Cache only immutable commit contents. Load still resolves main on every
// call, so a cached revision cannot hide a new policy or a Registry outage.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
type snapshotCache struct {
	mu        sync.Mutex
	entries   map[string]*snapshotLoad
	completed []string
}

type snapshotLoad struct {
	done     chan struct{}
	snapshot *Snapshot
	err      error
}

func (cache *snapshotCache) load(ctx context.Context, revision string, load func() (*Snapshot, error)) (*Snapshot, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		cache.mu.Lock()
		entry := cache.entries[revision]
		if entry == nil {
			break // Keep the lock until this caller registers its load.
		}
		cache.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-entry.done:
			// A shared read uses its initiating caller's lifetime. A stop or
			// timeout there must not cancel another App's independent launch.
			// Failed entries are removed before done closes, so retry admission
			// with this caller's context instead of retaining that cancellation.
			if errors.Is(entry.err, context.Canceled) || errors.Is(entry.err, context.DeadlineExceeded) {
				continue
			}
			return entry.snapshot, entry.err
		}
	}
	entry := &snapshotLoad{done: make(chan struct{})}
	if cache.entries == nil {
		cache.entries = make(map[string]*snapshotLoad)
	}
	cache.entries[revision] = entry
	cache.mu.Unlock()

	entry.snapshot, entry.err = load()
	cache.mu.Lock()
	if entry.err != nil {
		delete(cache.entries, revision)
	} else {
		cache.completed = append(cache.completed, revision)
		// Current and previously observed revisions cover normal revalidation
		// without retaining every historical Registry snapshot indefinitely.
		if len(cache.completed) > 2 {
			delete(cache.entries, cache.completed[0])
			cache.completed = cache.completed[1:]
		}
	}
	close(entry.done)
	cache.mu.Unlock()
	return entry.snapshot, entry.err
}
