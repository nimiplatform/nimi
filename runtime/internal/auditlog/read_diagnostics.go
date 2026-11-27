package auditlog

import (
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	// defaultMaxReadDiagnosticKeys caps distinct in-memory lightweight read
	// diagnostic buckets so repeated calls with varying caller metadata cannot
	// grow process memory without bound (rule.nimi.runtime.rpc-foundations.r003).
	defaultMaxReadDiagnosticKeys = 512
	maxReadDiagnosticFieldBytes  = 128
)

// ReadDiagnosticInput records one ordinary, non-sensitive, successful read RPC
// on the lightweight in-memory diagnostic path instead of issuing a durable
// SQLite audit transaction. Never pass credentials, tokens, secrets, or raw
// payloads here (rule.nimi.runtime.rpc-foundations.r002).
type ReadDiagnosticInput struct {
	Timestamp  time.Time
	FullMethod string
	AppID      string
	Domain     string
	Operation  string
	Capability string
	CallerKind runtimev1.CallerKind
	TraceID    string
}

// ReadDiagnosticSummary is an aggregated in-memory observation bucket for
// ordinary successful read RPCs grouped by (FullMethod, AppID, CallerKind).
type ReadDiagnosticSummary struct {
	FullMethod  string
	Domain      string
	Operation   string
	Capability  string
	AppID       string
	CallerKind  runtimev1.CallerKind
	Count       uint64
	FirstSeenAt time.Time
	LastSeenAt  time.Time
	LastTraceID string
}

// ReadDiagnosticsSnapshot is a consistent point-in-time view of aggregated
// lightweight read observations in this Runtime process.
type ReadDiagnosticsSnapshot struct {
	TotalCount   uint64
	EvictedCount uint64
	Summaries    []ReadDiagnosticSummary
}

type readDiagnosticKey struct {
	fullMethod string
	appID      string
	callerKind runtimev1.CallerKind
}

type readDiagnosticTracker struct {
	mu           sync.RWMutex
	maxKeys      int
	totalCount   uint64
	evictedCount uint64
	entries      map[readDiagnosticKey]*ReadDiagnosticSummary
}

func newReadDiagnosticTracker(maxKeys int) readDiagnosticTracker {
	if maxKeys <= 0 {
		maxKeys = defaultMaxReadDiagnosticKeys
	}
	return readDiagnosticTracker{
		maxKeys: maxKeys,
		entries: make(map[readDiagnosticKey]*ReadDiagnosticSummary),
	}
}

func (t *readDiagnosticTracker) record(input ReadDiagnosticInput) {
	ts := input.Timestamp.UTC()
	if ts.IsZero() {
		ts = time.Now().UTC()
	}
	fullMethod := boundedReadDiagnosticField(input.FullMethod)
	appID := boundedReadDiagnosticField(input.AppID)
	domain := boundedReadDiagnosticField(input.Domain)
	operation := boundedReadDiagnosticField(input.Operation)
	capability := boundedReadDiagnosticField(input.Capability)
	traceID := boundedReadDiagnosticField(input.TraceID)

	key := readDiagnosticKey{
		fullMethod: fullMethod,
		appID:      appID,
		callerKind: input.CallerKind,
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	if t.entries == nil {
		t.entries = make(map[readDiagnosticKey]*ReadDiagnosticSummary)
	}
	if t.maxKeys <= 0 {
		t.maxKeys = defaultMaxReadDiagnosticKeys
	}
	t.totalCount++

	if existing, ok := t.entries[key]; ok {
		existing.Count++
		if ts.Before(existing.FirstSeenAt) {
			existing.FirstSeenAt = ts
		}
		if !ts.Before(existing.LastSeenAt) {
			existing.LastSeenAt = ts
			if traceID != "" {
				existing.LastTraceID = traceID
			}
		}
		if existing.Domain == "" {
			existing.Domain = domain
		}
		if existing.Operation == "" {
			existing.Operation = operation
		}
		if existing.Capability == "" {
			existing.Capability = capability
		}
		return
	}

	if len(t.entries) >= t.maxKeys {
		t.evictOldestLocked()
	}
	t.entries[key] = &ReadDiagnosticSummary{
		FullMethod:  fullMethod,
		Domain:      domain,
		Operation:   operation,
		Capability:  capability,
		AppID:       appID,
		CallerKind:  input.CallerKind,
		Count:       1,
		FirstSeenAt: ts,
		LastSeenAt:  ts,
		LastTraceID: traceID,
	}
}

func (t *readDiagnosticTracker) evictOldestLocked() {
	var (
		oldestKey   readDiagnosticKey
		oldestEntry *ReadDiagnosticSummary
	)
	for key, entry := range t.entries {
		if oldestEntry == nil ||
			entry.LastSeenAt.Before(oldestEntry.LastSeenAt) ||
			(entry.LastSeenAt.Equal(oldestEntry.LastSeenAt) && lessReadDiagnosticKey(key, oldestKey)) {
			oldestKey = key
			oldestEntry = entry
		}
	}
	if oldestEntry != nil {
		t.evictedCount += oldestEntry.Count
		delete(t.entries, oldestKey)
	}
}

func (t *readDiagnosticTracker) snapshot() ReadDiagnosticsSnapshot {
	t.mu.RLock()
	summaries := make([]ReadDiagnosticSummary, 0, len(t.entries))
	for _, entry := range t.entries {
		summaries = append(summaries, *entry)
	}
	out := ReadDiagnosticsSnapshot{
		TotalCount:   t.totalCount,
		EvictedCount: t.evictedCount,
		Summaries:    summaries,
	}
	t.mu.RUnlock()

	sort.Slice(out.Summaries, func(i, j int) bool {
		left, right := out.Summaries[i], out.Summaries[j]
		if left.FullMethod != right.FullMethod {
			return left.FullMethod < right.FullMethod
		}
		if left.AppID != right.AppID {
			return left.AppID < right.AppID
		}
		return left.CallerKind < right.CallerKind
	})
	return out
}

func lessReadDiagnosticKey(left readDiagnosticKey, right readDiagnosticKey) bool {
	if left.fullMethod != right.fullMethod {
		return left.fullMethod < right.fullMethod
	}
	if left.appID != right.appID {
		return left.appID < right.appID
	}
	return left.callerKind < right.callerKind
}

func boundedReadDiagnosticField(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) <= maxReadDiagnosticFieldBytes {
		return trimmed
	}
	return trimmed[:maxReadDiagnosticFieldBytes]
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.r003
// RecordLightweightRead records an ordinary, non-sensitive, successful read RPC
// in the bounded in-process diagnostic aggregator without touching the durable
// SQLite audit backend.
func (s *Store) RecordLightweightRead(input ReadDiagnosticInput) {
	if s == nil {
		return
	}
	s.readDiag.record(input)
}

// SnapshotLightweightReads returns a deterministic point-in-time snapshot of
// aggregated lightweight read diagnostics for this store.
func (s *Store) SnapshotLightweightReads() ReadDiagnosticsSnapshot {
	if s == nil {
		return ReadDiagnosticsSnapshot{}
	}
	return s.readDiag.snapshot()
}
