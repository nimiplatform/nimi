package memory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"sort"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
)

type agentScopedDeletionContextKey struct{}

func TestDeleteAgentScopedBanksWithTxHookCommitsSharedTransaction(t *testing.T) {
	t.Parallel()

	svc := newAgentScopedDeletionTestService(t)
	ctx := context.WithValue(context.Background(), agentScopedDeletionContextKey{}, "shared-tx")
	agentID := "agent-shared-tx"
	core := agentScopedDeletionCoreLocator(agentID)
	dyadic := agentScopedDeletionDyadicLocator(agentID, "user-b")
	foreign := agentScopedDeletionCoreLocator("agent-foreign")
	for _, locator := range []*runtimev1.MemoryBankLocator{dyadic, foreign, core} {
		if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
			t.Fatalf("EnsureCanonicalBank(%s): %v", locatorKey(locator), err)
		}
		seedAgentScopedDeletionProjection(t, svc, locatorKey(locator))
	}

	expectedKeys := []string{locatorKey(core), locatorKey(dyadic)}
	sort.Strings(expectedKeys)
	sub := svc.addSubscriber(&runtimev1.SubscribeMemoryEventsRequest{})
	t.Cleanup(func() { svc.removeSubscriber(sub.id) })

	var hookKeys []string
	removedKeys, err := svc.DeleteAgentScopedBanksWithTxHook(ctx, agentID, func(hookCtx context.Context, tx *sql.Tx, keys []string) error {
		if got := hookCtx.Value(agentScopedDeletionContextKey{}); got != "shared-tx" {
			return fmt.Errorf("hook context value = %v", got)
		}
		if !slices.Equal(keys, expectedKeys) {
			return fmt.Errorf("hook keys = %v, want %v", keys, expectedKeys)
		}
		hookKeys = append([]string(nil), keys...)

		var bankCount int
		if err := tx.QueryRowContext(hookCtx, `
			SELECT COUNT(*) FROM memory_bank WHERE locator_key IN (?, ?)
		`, expectedKeys[0], expectedKeys[1]).Scan(&bankCount); err != nil {
			return fmt.Errorf("query memory bank count in hook: %w", err)
		}
		if bankCount != 0 {
			return fmt.Errorf("memory bank count in hook = %d, want 0", bankCount)
		}

		var projectionCount int
		if err := tx.QueryRowContext(hookCtx, `
			SELECT COUNT(*) FROM memory_review_checkpoint WHERE bank_locator_key IN (?, ?)
		`, expectedKeys[0], expectedKeys[1]).Scan(&projectionCount); err != nil {
			return fmt.Errorf("query projection count in hook: %w", err)
		}
		if projectionCount != 0 {
			return fmt.Errorf("memory projection count in hook = %d, want 0", projectionCount)
		}

		if _, err := tx.ExecContext(hookCtx, `
			INSERT INTO memory_meta(key, value) VALUES ('test_agent_deletion_committed', '1')
		`); err != nil {
			return fmt.Errorf("insert caller projection marker: %w", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("DeleteAgentScopedBanksWithTxHook: %v", err)
	}
	if !slices.Equal(removedKeys, expectedKeys) {
		t.Fatalf("removed keys = %v, want %v", removedKeys, expectedKeys)
	}
	if !slices.Equal(hookKeys, expectedKeys) {
		t.Fatalf("observed hook keys = %v, want %v", hookKeys, expectedKeys)
	}

	assertAgentScopedDeletionRowCount(t, svc, "memory_bank", "locator_key", expectedKeys, 0)
	assertAgentScopedDeletionRowCount(t, svc, "memory_review_checkpoint", "bank_locator_key", expectedKeys, 0)
	assertAgentScopedDeletionRowCount(t, svc, "memory_bank", "locator_key", []string{locatorKey(foreign)}, 1)
	assertAgentScopedDeletionRowCount(t, svc, "memory_review_checkpoint", "bank_locator_key", []string{locatorKey(foreign)}, 1)
	assertAgentScopedDeletionMetaValue(t, svc, "test_agent_deletion_committed", "1")

	gotEventKeys := make([]string, 0, len(expectedKeys))
	for range expectedKeys {
		select {
		case event := <-sub.ch:
			if event.GetEventType() != runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_BANK_DELETED {
				t.Fatalf("event type = %s, want BANK_DELETED", event.GetEventType())
			}
			gotEventKeys = append(gotEventKeys, locatorKey(event.GetBank()))
		default:
			t.Fatal("missing bank-deleted event after committed deletion")
		}
	}
	if !slices.Equal(gotEventKeys, expectedKeys) {
		t.Fatalf("event keys = %v, want %v", gotEventKeys, expectedKeys)
	}
	select {
	case event := <-sub.ch:
		t.Fatalf("unexpected extra event: %v", event)
	default:
	}
}

func TestDeleteAgentScopedBanksWithTxHookFailureRollsBackAllState(t *testing.T) {
	t.Parallel()

	svc := newAgentScopedDeletionTestService(t)
	ctx := context.Background()
	agentID := "agent-rollback"
	locator := agentScopedDeletionCoreLocator(agentID)
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	bankKey := locatorKey(locator)
	seedAgentScopedDeletionProjection(t, svc, bankKey)

	backlogKey := bankKey + "::memory-rollback"
	svc.mu.Lock()
	svc.replicationBacklog[backlogKey] = &ReplicationBacklogItem{
		BacklogKey: backlogKey,
		Locator:    cloneLocator(locator),
		MemoryID:   "memory-rollback",
		EnqueuedAt: time.Date(2026, 7, 11, 1, 2, 3, 0, time.UTC),
		Status:     replicationBacklogStatusPending,
	}
	if err := svc.persistLocked(); err != nil {
		svc.mu.Unlock()
		t.Fatalf("persist seeded backlog: %v", err)
	}
	previousSequence := svc.sequence
	svc.mu.Unlock()

	sub := svc.addSubscriber(&runtimev1.SubscribeMemoryEventsRequest{})
	t.Cleanup(func() { svc.removeSubscriber(sub.id) })
	sentinel := errors.New("caller projection delete failed")
	var hookObservedSnapshotRewrite bool

	removedKeys, err := svc.DeleteAgentScopedBanksWithTxHook(ctx, agentID, func(hookCtx context.Context, tx *sql.Tx, keys []string) error {
		if !slices.Equal(keys, []string{bankKey}) {
			return fmt.Errorf("hook keys = %v, want [%s]", keys, bankKey)
		}
		var persistedCount int
		if err := tx.QueryRowContext(hookCtx, `
			SELECT
				(SELECT COUNT(*) FROM memory_bank WHERE locator_key = ?) +
				(SELECT COUNT(*) FROM memory_replication_backlog WHERE locator_key = ?) +
				(SELECT COUNT(*) FROM memory_review_checkpoint WHERE bank_locator_key = ?)
		`, bankKey, bankKey, bankKey).Scan(&persistedCount); err != nil {
			return fmt.Errorf("query staged deletion state: %w", err)
		}
		hookObservedSnapshotRewrite = persistedCount == 0
		if _, err := tx.ExecContext(hookCtx, `
			INSERT INTO memory_meta(key, value) VALUES ('test_agent_deletion_rolled_back', 'should-not-commit')
		`); err != nil {
			return fmt.Errorf("insert rollback marker: %w", err)
		}
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("DeleteAgentScopedBanksWithTxHook error = %v, want sentinel", err)
	}
	if len(removedKeys) != 0 {
		t.Fatalf("removed keys on failed deletion = %v, want nil", removedKeys)
	}
	if !hookObservedSnapshotRewrite {
		t.Fatal("caller hook did not observe the staged snapshot/projection purge")
	}

	svc.mu.RLock()
	_, bankRestored := svc.banks[bankKey]
	backlog := cloneReplicationBacklogItem(svc.replicationBacklog[backlogKey])
	gotSequence := svc.sequence
	svc.mu.RUnlock()
	if !bankRestored {
		t.Fatal("in-memory bank was not restored after hook failure")
	}
	if backlog == nil || backlog.BacklogKey != backlogKey || backlog.MemoryID != "memory-rollback" {
		t.Fatalf("in-memory backlog was not restored: %#v", backlog)
	}
	if gotSequence != previousSequence {
		t.Fatalf("memory sequence = %d, want restored %d", gotSequence, previousSequence)
	}

	assertAgentScopedDeletionRowCount(t, svc, "memory_bank", "locator_key", []string{bankKey}, 1)
	assertAgentScopedDeletionRowCount(t, svc, "memory_replication_backlog", "locator_key", []string{bankKey}, 1)
	assertAgentScopedDeletionRowCount(t, svc, "memory_review_checkpoint", "bank_locator_key", []string{bankKey}, 1)
	assertAgentScopedDeletionMetaMissing(t, svc, "test_agent_deletion_rolled_back")
	select {
	case event := <-sub.ch:
		t.Fatalf("failed deletion broadcast an event: %v", event)
	default:
	}
}

func TestDeleteAgentScopedBanksWithTxHookRunsForZeroBankRetries(t *testing.T) {
	t.Parallel()

	svc := newAgentScopedDeletionTestService(t)
	ctx := context.WithValue(context.Background(), agentScopedDeletionContextKey{}, "zero-bank")
	svc.mu.RLock()
	previousSequence := svc.sequence
	svc.mu.RUnlock()
	sub := svc.addSubscriber(&runtimev1.SubscribeMemoryEventsRequest{})
	t.Cleanup(func() { svc.removeSubscriber(sub.id) })

	hookCalls := 0
	hook := func(hookCtx context.Context, tx *sql.Tx, keys []string) error {
		hookCalls++
		if got := hookCtx.Value(agentScopedDeletionContextKey{}); got != "zero-bank" {
			return fmt.Errorf("hook context value = %v", got)
		}
		if len(keys) != 0 {
			return fmt.Errorf("zero-bank hook keys = %v, want empty", keys)
		}
		if _, err := tx.ExecContext(hookCtx, `
			INSERT INTO memory_meta(key, value)
			VALUES ('test_zero_bank_hook_calls', '1')
			ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
		`); err != nil {
			return fmt.Errorf("increment zero-bank hook marker: %w", err)
		}
		return nil
	}

	for attempt := 1; attempt <= 2; attempt++ {
		removedKeys, err := svc.DeleteAgentScopedBanksWithTxHook(ctx, "agent-without-banks", hook)
		if err != nil {
			t.Fatalf("DeleteAgentScopedBanksWithTxHook attempt %d: %v", attempt, err)
		}
		if len(removedKeys) != 0 {
			t.Fatalf("attempt %d removed keys = %v, want empty", attempt, removedKeys)
		}
	}
	if hookCalls != 2 {
		t.Fatalf("hook calls = %d, want 2", hookCalls)
	}
	assertAgentScopedDeletionMetaValue(t, svc, "test_zero_bank_hook_calls", "2")

	removedKeys, err := svc.DeleteAgentScopedBanks(ctx, "agent-without-banks")
	if err != nil {
		t.Fatalf("legacy DeleteAgentScopedBanks zero-bank retry: %v", err)
	}
	if len(removedKeys) != 0 {
		t.Fatalf("legacy zero-bank removed keys = %v, want empty", removedKeys)
	}
	svc.mu.RLock()
	gotSequence := svc.sequence
	svc.mu.RUnlock()
	if gotSequence != previousSequence {
		t.Fatalf("zero-bank sequence = %d, want unchanged %d", gotSequence, previousSequence)
	}
	select {
	case event := <-sub.ch:
		t.Fatalf("zero-bank deletion broadcast an event: %v", event)
	default:
	}
}

func newAgentScopedDeletionTestService(t *testing.T) *Service {
	t.Helper()
	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	return svc
}

func agentScopedDeletionCoreLocator(agentID string) *runtimev1.MemoryBankLocator {
	return &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: agentID},
		},
	}
}

func agentScopedDeletionDyadicLocator(agentID, userID string) *runtimev1.MemoryBankLocator {
	return &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
		Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
			AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: agentID, UserId: userID},
		},
	}
}

func seedAgentScopedDeletionProjection(t *testing.T, svc *Service, bankKey string) {
	t.Helper()
	err := svc.PersistenceBackend().WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`
			INSERT INTO memory_review_checkpoint(bank_locator_key, checkpoint_json, updated_at)
			VALUES (?, '{}', '2026-07-11T00:00:00Z')
		`, bankKey)
		return err
	})
	if err != nil {
		t.Fatalf("seed memory_review_checkpoint[%s]: %v", bankKey, err)
	}
}

func assertAgentScopedDeletionRowCount(t *testing.T, svc *Service, table, column string, keys []string, want int) {
	t.Helper()
	if len(keys) == 0 {
		t.Fatal("row-count assertion requires at least one key")
	}
	args := stringsSliceToAny(keys)
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s IN (%s)", table, column, sqlPlaceholders(len(keys)))
	var got int
	if err := svc.PersistenceBackend().DB().QueryRow(query, args...).Scan(&got); err != nil {
		t.Fatalf("query %s.%s row count: %v", table, column, err)
	}
	if got != want {
		t.Fatalf("%s.%s row count for %v = %d, want %d", table, column, keys, got, want)
	}
}

func assertAgentScopedDeletionMetaValue(t *testing.T, svc *Service, key, want string) {
	t.Helper()
	var got string
	if err := svc.PersistenceBackend().DB().QueryRow(`SELECT value FROM memory_meta WHERE key = ?`, key).Scan(&got); err != nil {
		t.Fatalf("query memory_meta[%s]: %v", key, err)
	}
	if got != want {
		t.Fatalf("memory_meta[%s] = %q, want %q", key, got, want)
	}
}

func assertAgentScopedDeletionMetaMissing(t *testing.T, svc *Service, key string) {
	t.Helper()
	var value string
	err := svc.PersistenceBackend().DB().QueryRow(`SELECT value FROM memory_meta WHERE key = ?`, key).Scan(&value)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("memory_meta[%s] query error = %v, want sql.ErrNoRows (value=%q)", key, err, value)
	}
}
