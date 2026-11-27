package auditlog

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type countingAuditBackend struct {
	inner   Backend
	writeTx atomic.Int64
}

func (b *countingAuditBackend) DB() *sql.DB {
	return b.inner.DB()
}

func (b *countingAuditBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	b.writeTx.Add(1)
	return b.inner.WriteTx(ctx, fn)
}

func TestRecordLightweightReadAggregatesWithoutTouchingSQLite(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	rawBackend, err := runtimepersistence.Open(nil, statePath)
	if err != nil {
		t.Fatalf("open Runtime persistence: %v", err)
	}
	t.Cleanup(func() { _ = rawBackend.Close() })

	backend := &countingAuditBackend{inner: rawBackend}
	store, err := Open(backend, nil, 64, 64)
	if err != nil {
		t.Fatalf("open audit store: %v", err)
	}
	// Reset after Open's startup retention reconciliation.
	backend.writeTx.Store(0)

	base := time.Date(2026, 11, 27, 10, 0, 0, 0, time.UTC)
	store.RecordLightweightRead(ReadDiagnosticInput{
		Timestamp:  base,
		FullMethod: "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth",
		AppID:      "nimi.desktop",
		Domain:     "runtime.audit",
		Operation:  "get_runtime_health",
		Capability: "runtime.audit.get_runtime_health",
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		TraceID:    "trace-health-1",
	})
	store.RecordLightweightRead(ReadDiagnosticInput{
		Timestamp:  base.Add(5 * time.Second),
		FullMethod: "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth",
		AppID:      "nimi.desktop",
		Domain:     "runtime.audit",
		Operation:  "get_runtime_health",
		Capability: "runtime.audit.get_runtime_health",
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		TraceID:    "trace-health-2",
	})
	store.RecordLightweightRead(ReadDiagnosticInput{
		Timestamp:  base.Add(2 * time.Second),
		FullMethod: "/grpc.health.v1.Health/Check",
		AppID:      "",
		Domain:     "runtime.rpc",
		Operation:  "check",
		Capability: "runtime.rpc.check",
		CallerKind: runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED,
		TraceID:    "trace-check-1",
	})

	if got := backend.writeTx.Load(); got != 0 {
		t.Fatalf("lightweight reads triggered %d SQLite WriteTx calls, want 0", got)
	}
	var rowCount int
	if err := rawBackend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_audit_event`).Scan(&rowCount); err != nil {
		t.Fatalf("count runtime_audit_event: %v", err)
	}
	if rowCount != 0 {
		t.Fatalf("runtime_audit_event row count = %d, want 0", rowCount)
	}

	snap := store.SnapshotLightweightReads()
	if snap.TotalCount != 3 || snap.EvictedCount != 0 {
		t.Fatalf("snapshot totals = total:%d evicted:%d, want total:3 evicted:0", snap.TotalCount, snap.EvictedCount)
	}
	if len(snap.Summaries) != 2 {
		t.Fatalf("summary bucket count = %d, want 2", len(snap.Summaries))
	}
	check := snap.Summaries[0]
	if check.FullMethod != "/grpc.health.v1.Health/Check" || check.Count != 1 || check.LastTraceID != "trace-check-1" {
		t.Fatalf("unexpected health check summary: %+v", check)
	}
	health := snap.Summaries[1]
	if health.FullMethod != "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth" ||
		health.Count != 2 ||
		!health.FirstSeenAt.Equal(base) ||
		!health.LastSeenAt.Equal(base.Add(5*time.Second)) ||
		health.LastTraceID != "trace-health-2" ||
		health.AppID != "nimi.desktop" ||
		health.CallerKind != runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE {
		t.Fatalf("unexpected runtime health summary: %+v", health)
	}
}

func TestRecordLightweightReadEnforcesKeyBoundAndFieldLength(t *testing.T) {
	store := New(16, 16)
	store.readDiag = newReadDiagnosticTracker(3)

	base := time.Date(2026, 11, 27, 11, 0, 0, 0, time.UTC)
	longTrace := strings.Repeat("t", maxReadDiagnosticFieldBytes+64)
	for i := 0; i < 6; i++ {
		store.RecordLightweightRead(ReadDiagnosticInput{
			Timestamp:  base.Add(time.Duration(i) * time.Second),
			FullMethod: "/grpc.health.v1.Health/Check",
			AppID:      fmt.Sprintf("app-%d", i),
			Domain:     "runtime.rpc",
			Operation:  "check",
			Capability: "runtime.rpc.check",
			TraceID:    longTrace,
		})
	}

	snap := store.SnapshotLightweightReads()
	if len(snap.Summaries) != 3 {
		t.Fatalf("bounded summary count = %d, want 3", len(snap.Summaries))
	}
	var retained uint64
	for _, summary := range snap.Summaries {
		retained += summary.Count
		if len(summary.LastTraceID) != maxReadDiagnosticFieldBytes {
			t.Fatalf("trace_id length = %d, want bounded %d", len(summary.LastTraceID), maxReadDiagnosticFieldBytes)
		}
		if summary.AppID == "app-0" || summary.AppID == "app-1" || summary.AppID == "app-2" {
			t.Fatalf("oldest bucket %q was not evicted", summary.AppID)
		}
	}
	if snap.TotalCount != 6 || snap.EvictedCount != 3 || snap.EvictedCount+retained != snap.TotalCount {
		t.Fatalf("bound accounting mismatch: total=%d evicted=%d retained=%d", snap.TotalCount, snap.EvictedCount, retained)
	}
}

func TestRecordLightweightReadConcurrentWithDurableWrites(t *testing.T) {
	store := New(512, 512)
	const readWorkers = 6
	const readsPerWorker = 40
	const writeWorkers = 4
	const writesPerWorker = 15

	var wg sync.WaitGroup
	for w := 0; w < readWorkers; w++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			for i := 0; i < readsPerWorker; i++ {
				store.RecordLightweightRead(ReadDiagnosticInput{
					Timestamp:  time.Now().UTC(),
					FullMethod: "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth",
					AppID:      fmt.Sprintf("app-%d", worker%2),
					Domain:     "runtime.audit",
					Operation:  "get_runtime_health",
					Capability: "runtime.audit.get_runtime_health",
					CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
					TraceID:    fmt.Sprintf("trace-r-%d-%d", worker, i),
				})
				_ = store.SnapshotLightweightReads()
			}
		}(w)
	}
	for w := 0; w < writeWorkers; w++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			for i := 0; i < writesPerWorker; i++ {
				if err := store.AppendEventChecked(&runtimev1.AuditEventRecord{
					AppId:      "nimi.desktop",
					Domain:     "runtime.connector",
					Operation:  fmt.Sprintf("connector.write.%d.%d", worker, i),
					ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
					Timestamp:  timestamppb.Now(),
				}); err != nil {
					t.Errorf("AppendEventChecked: %v", err)
				}
			}
		}(w)
	}
	wg.Wait()

	snap := store.SnapshotLightweightReads()
	if snap.TotalCount != readWorkers*readsPerWorker {
		t.Fatalf("lightweight total = %d, want %d", snap.TotalCount, readWorkers*readsPerWorker)
	}
	events, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.connector", PageSize: 200})
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	if len(events.GetEvents()) != writeWorkers*writesPerWorker {
		t.Fatalf("durable audit count = %d, want %d", len(events.GetEvents()), writeWorkers*writesPerWorker)
	}
}
