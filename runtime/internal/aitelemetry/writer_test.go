package aitelemetry

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type blockedWriterBackend struct {
	Backend
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (b *blockedWriterBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	b.once.Do(func() { close(b.entered) })
	<-b.release
	return b.Backend.WriteTx(ctx, fn)
}

func TestBlockedWriterDoesNotHoldLiveProjectionOrCompletion(t *testing.T) {
	s, backend, now := testOwner(t)
	blocked := &blockedWriterBackend{Backend: backend, entered: make(chan struct{}), release: make(chan struct{})}
	s.backend = blocked
	var release sync.Once
	defer release.Do(func() { close(blocked.release) })
	from := *now
	*now = now.Add(time.Second)
	attempt := s.Begin(testRecord("ignored", "account-a", *now).Facts)
	select {
	case <-blocked.entered:
	case <-time.After(time.Second):
		t.Fatal("writer did not enter the injected stall")
	}
	done := make(chan struct{})
	go func() {
		s.FinishOperation(attempt.record.OperationID, &runtimev1.UsageStats{InputTokens: 5})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("business completion waited for accounting I/O")
	}
	if s.Snapshot("account-a", 50).KnownActiveAttemptCount != 0 {
		t.Fatal("completed execution remained active behind writer")
	}
	*now = now.Add(time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	summary, err := s.Summary(ctx, "account-a", from, *now)
	if err != nil {
		t.Fatal(err)
	}
	if summary.TimeComplete {
		t.Fatal("pending writes were reported as complete coverage")
	}
	release.Do(func() { close(blocked.release) })
	flushOwner(t, s)
	summary, err = s.Summary(ctx, "account-a", from, *now)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Totals.AttemptCount != 1 || summary.Totals.InputTokens != 5 || !summary.TimeComplete {
		t.Fatalf("flushed owner result is wrong: %+v", summary)
	}
}

func TestEvictedAttemptTerminalClearsLiveStateWithoutResurrectingLedger(t *testing.T) {
	s, backend, now := testOwner(t)
	*now = now.Add(time.Second)
	attempt := s.Begin(testRecord("ignored", "account-a", *now).Facts)
	flushOwner(t, s)
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		var item bucketIdentity
		if err := tx.QueryRow(`SELECT account_id,bucket_ns,group_key FROM runtime_ai_usage_attempt WHERE attempt_id=?`, attempt.ID()).Scan(&item.account, &item.minute, &item.key); err != nil {
			return err
		}
		return deleteBucketTx(context.Background(), tx, item, true)
	}); err != nil {
		t.Fatal(err)
	}
	if s.Snapshot("account-a", 50).KnownActiveAttemptCount != 1 {
		t.Fatal("accounting eviction changed the real running owner")
	}
	invalid := attempt.record
	invalid.Revision++
	invalid.AccountID = "other-account"
	invalid.TerminalAt = now.Add(time.Second)
	if err := s.Record(invalid); err == nil {
		t.Fatal("foreign terminal attribution cleared a live attempt")
	}
	if s.Snapshot("account-a", 50).KnownActiveAttemptCount != 1 {
		t.Fatal("invalid terminal changed live state")
	}
	*now = now.Add(time.Second)
	attempt.Finish(&runtimev1.UsageStats{InputTokens: 3})
	if s.Snapshot("account-a", 50).KnownActiveAttemptCount != 0 {
		t.Fatal("real terminal was blocked by durable eviction")
	}
	flushOwner(t, s)
	var records int
	if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_ai_usage_attempt WHERE attempt_id=?`, attempt.ID()).Scan(&records); err != nil {
		t.Fatal(err)
	}
	if records != 0 {
		t.Fatal("terminal recreated the evicted accounting record")
	}
}

func TestCloseMarksCleanOnlyAfterPendingWritesDrain(t *testing.T) {
	s, backend, now := testOwner(t)
	blocked := &blockedWriterBackend{Backend: backend, entered: make(chan struct{}), release: make(chan struct{})}
	s.backend = blocked
	var release sync.Once
	defer release.Do(func() { close(blocked.release) })
	*now = now.Add(time.Second)
	attempt := s.Begin(testRecord("ignored", "account-a", *now).Facts)
	attempt.Finish(&runtimev1.UsageStats{InputTokens: 1})
	<-blocked.entered
	closed := make(chan error, 1)
	go func() { closed <- s.Close() }()
	select {
	case err := <-closed:
		t.Fatalf("close returned before accounting drained: %v", err)
	case <-time.After(30 * time.Millisecond):
	}
	var clean bool
	if err := backend.DB().QueryRow(`SELECT clean FROM runtime_ai_accounting_generation WHERE generation_id=?`, s.generation).Scan(&clean); err != nil {
		t.Fatal(err)
	}
	if clean {
		t.Fatal("generation was clean while a write was blocked")
	}
	release.Do(func() { close(blocked.release) })
	if err := <-closed; err != nil {
		t.Fatal(err)
	}
	if err := backend.DB().QueryRow(`SELECT clean FROM runtime_ai_accounting_generation WHERE generation_id=?`, s.generation).Scan(&clean); err != nil {
		t.Fatal(err)
	}
	if !clean {
		t.Fatal("successfully drained generation was not clean")
	}
}

func TestWriterQueueIsBoundedAndOverflowCannotBecomeComplete(t *testing.T) {
	s, backend, now := testOwner(t)
	blocked := &blockedWriterBackend{Backend: backend, entered: make(chan struct{}), release: make(chan struct{})}
	s.backend = blocked
	var release sync.Once
	defer release.Do(func() { close(blocked.release) })
	*now = now.Add(time.Second)
	first := testRecord("first", "account-a", *now)
	first.TerminalAt = *now
	if err := s.Record(first); err != nil {
		t.Fatal(err)
	}
	<-blocked.entered
	for index := 0; index < MaxPendingWrites; index++ {
		record := testRecord(fmt.Sprint(index), "account-a", *now)
		record.TerminalAt = *now
		if err := s.Record(record); err != nil {
			t.Fatalf("queue rejected admitted slot %d: %v", index, err)
		}
	}
	extra := testRecord("overflow", "account-a", *now)
	extra.TerminalAt = *now
	if err := s.Record(extra); err == nil {
		t.Fatal("unbounded writer queue accepted overflow")
	}
	if len(s.writes) != MaxPendingWrites {
		t.Fatalf("queue length=%d", len(s.writes))
	}
	release.Do(func() { close(blocked.release) })
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.Flush(ctx); err == nil {
		t.Fatal("queue loss was forgotten after successful later writes")
	}
	if err := s.Close(); err == nil {
		t.Fatal("queue loss allowed a clean shutdown claim")
	}
	var clean bool
	if err := backend.DB().QueryRow(`SELECT clean FROM runtime_ai_accounting_generation WHERE generation_id=?`, s.generation).Scan(&clean); err != nil {
		t.Fatal(err)
	}
	if clean {
		t.Fatal("generation with dropped writes was marked clean")
	}
}
