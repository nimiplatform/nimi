package grpcserver

import (
	"context"
	"slices"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"google.golang.org/grpc"
)

type activeRPC struct {
	id     uint64
	cancel context.CancelFunc
	signal *rpcctx.ShutdownSignal
	activeRPCSnapshot
}

type shutdownRecord struct {
	started          bool
	startedAt        time.Time
	activeAtStart    []activeRPCSnapshot
	cancelledMethods map[string]int
	completed        bool
}

type activeRPCRegistry struct {
	mu       sync.Mutex
	now      func() time.Time
	nextID   uint64
	entries  map[uint64]*activeRPC
	shutdown shutdownRecord
}

type ShutdownSummary struct {
	StartedAt            time.Time
	CompletedAt          time.Time
	Duration             time.Duration
	Forced               bool
	ActiveAtStart        []activeRPCSnapshot
	RemainingAtForceStop []activeRPCSnapshot
	ActiveByMethod       map[string]int
	CancelledByMethod    map[string]int
	RemainingByMethod    map[string]int
}

func newActiveRPCRegistry(nowFn func() time.Time) *activeRPCRegistry {
	if nowFn == nil {
		nowFn = func() time.Time { return time.Now().UTC() }
	}
	return &activeRPCRegistry{
		now:     nowFn,
		entries: make(map[uint64]*activeRPC),
	}
}

func (r *activeRPCRegistry) TrackUnary(ctx context.Context, method string) (context.Context, func()) {
	ctx, signal := withShutdownSignal(ctx)
	trackedCtx, cancel := context.WithCancel(ctx)
	id := r.register(&activeRPC{
		cancel: cancel,
		signal: signal,
		activeRPCSnapshot: activeRPCSnapshot{
			Method:         method,
			Category:       classifyUnaryCategory(method),
			Disposition:    classifyUnaryDisposition(method),
			StartedAt:      r.now(),
			LastActivityAt: r.now(),
			Stream:         false,
		},
	})
	return trackedCtx, func() {
		r.unregister(id)
	}
}

func (r *activeRPCRegistry) TrackStream(ctx context.Context, method string, info *grpc.StreamServerInfo) (context.Context, *rpcctx.ShutdownSignal, func(), func()) {
	ctx, signal := withShutdownSignal(ctx)
	trackedCtx, cancel := context.WithCancel(ctx)
	category, disposition := classifyRPCMethod(method, true)
	id := r.register(&activeRPC{
		cancel: cancel,
		signal: signal,
		activeRPCSnapshot: activeRPCSnapshot{
			Method:          method,
			Category:        category,
			Disposition:     disposition,
			StartedAt:       r.now(),
			LastActivityAt:  r.now(),
			Stream:          true,
			ClientStreaming: info != nil && info.IsClientStream,
			ServerStreaming: info == nil || info.IsServerStream,
		},
	})
	return trackedCtx, signal, func() {
			r.unregister(id)
		}, func() {
			r.touch(id)
		}
}

func classifyUnaryCategory(method string) string {
	category, _ := classifyRPCMethod(method, false)
	return category
}

func classifyUnaryDisposition(method string) rpcShutdownDisposition {
	_, disposition := classifyRPCMethod(method, false)
	return disposition
}

func (r *activeRPCRegistry) register(entry *activeRPC) uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextID++
	entry.id = r.nextID
	r.entries[entry.id] = entry
	if r.shutdown.started && entry.Disposition == rpcShutdownCancel {
		if entry.signal != nil {
			entry.signal.MarkServerShutdown()
		}
		r.shutdown.cancelledMethods[entry.Method]++
		entry.cancel()
	}
	return entry.id
}

func (r *activeRPCRegistry) unregister(id uint64) {
	r.mu.Lock()
	delete(r.entries, id)
	r.mu.Unlock()
}

func (r *activeRPCRegistry) touch(id uint64) {
	r.mu.Lock()
	if entry, ok := r.entries[id]; ok {
		entry.LastActivityAt = r.now()
	}
	r.mu.Unlock()
}

func (r *activeRPCRegistry) BeginShutdown() []activeRPCSnapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.shutdown.started {
		return cloneSnapshots(r.shutdown.activeAtStart)
	}
	r.shutdown.started = true
	r.shutdown.startedAt = r.now()
	r.shutdown.activeAtStart = r.snapshotLocked()
	r.shutdown.cancelledMethods = make(map[string]int)
	for _, entry := range r.entries {
		if entry.Disposition != rpcShutdownCancel {
			continue
		}
		if entry.signal != nil {
			entry.signal.MarkServerShutdown()
		}
		r.shutdown.cancelledMethods[entry.Method]++
		entry.cancel()
	}
	return cloneSnapshots(r.shutdown.activeAtStart)
}

func (r *activeRPCRegistry) CompleteShutdown(forced bool) ShutdownSummary {
	r.mu.Lock()
	defer r.mu.Unlock()
	completedAt := r.now()
	remaining := []activeRPCSnapshot{}
	if forced {
		remaining = r.snapshotLocked()
		r.entries = make(map[uint64]*activeRPC)
	}
	r.shutdown.completed = true
	return ShutdownSummary{
		StartedAt:            r.shutdown.startedAt,
		CompletedAt:          completedAt,
		Duration:             completedAt.Sub(r.shutdown.startedAt),
		Forced:               forced,
		ActiveAtStart:        cloneSnapshots(r.shutdown.activeAtStart),
		RemainingAtForceStop: cloneSnapshots(remaining),
		ActiveByMethod:       countSnapshotsByMethod(r.shutdown.activeAtStart),
		CancelledByMethod:    cloneCounts(r.shutdown.cancelledMethods),
		RemainingByMethod:    countSnapshotsByMethod(remaining),
	}
}

func (r *activeRPCRegistry) snapshotLocked() []activeRPCSnapshot {
	out := make([]activeRPCSnapshot, 0, len(r.entries))
	for _, entry := range r.entries {
		out = append(out, entry.activeRPCSnapshot)
	}
	slices.SortFunc(out, func(left, right activeRPCSnapshot) int {
		switch {
		case left.StartedAt.Before(right.StartedAt):
			return -1
		case left.StartedAt.After(right.StartedAt):
			return 1
		default:
			if left.Method < right.Method {
				return -1
			}
			if left.Method > right.Method {
				return 1
			}
			return 0
		}
	})
	return out
}

func countSnapshotsByMethod(items []activeRPCSnapshot) map[string]int {
	if len(items) == 0 {
		return map[string]int{}
	}
	counts := make(map[string]int)
	for _, item := range items {
		counts[item.Method]++
	}
	return counts
}

func cloneCounts(input map[string]int) map[string]int {
	if len(input) == 0 {
		return map[string]int{}
	}
	out := make(map[string]int, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func cloneSnapshots(items []activeRPCSnapshot) []activeRPCSnapshot {
	if len(items) == 0 {
		return []activeRPCSnapshot{}
	}
	out := make([]activeRPCSnapshot, len(items))
	copy(out, items)
	return out
}
