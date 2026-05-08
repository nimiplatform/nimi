package memory

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func TestMemoryServiceAcceleratorCleanupRetainsNewestFeedbackEventsAndPreservesSummary(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	bankKey := locatorKey(locator)
	for idx := 1; idx <= 70; idx++ {
		createdAt := time.Date(2026, 4, 1, 0, 0, idx, 0, time.UTC).Format(time.RFC3339Nano)
		if _, err := svc.PersistenceBackend().DB().Exec(`
			INSERT INTO memory_recall_feedback_event(feedback_id, bank_locator_key, target_kind, target_id, polarity, query_text, source_system, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, fmt.Sprintf("feedback-retain-%02d", idx), bankKey, recallFeedbackTargetRecord, record.GetMemoryId(), recallFeedbackHelpful, "query", "test", createdAt); err != nil {
			t.Fatalf("insert feedback event %d: %v", idx, err)
		}
	}
	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_recall_feedback_summary(bank_locator_key, target_kind, target_id, helpful_count, unhelpful_count, last_feedback_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, bankKey, recallFeedbackTargetRecord, record.GetMemoryId(), 70, 0, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert feedback summary: %v", err)
	}

	if err := svc.cleanupAcceleratorStateAt(ctx, time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("cleanupAcceleratorStateAt: %v", err)
	}

	var eventCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_recall_feedback_event
		WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
	`, bankKey, recallFeedbackTargetRecord, record.GetMemoryId()).Scan(&eventCount); err != nil {
		t.Fatalf("count feedback events: %v", err)
	}
	if eventCount != feedbackEventRetentionPerTarget {
		t.Fatalf("expected %d retained events, got %d", feedbackEventRetentionPerTarget, eventCount)
	}

	var oldestRetained string
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT feedback_id
		FROM memory_recall_feedback_event
		WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
		ORDER BY created_at ASC, feedback_id ASC
		LIMIT 1
	`, bankKey, recallFeedbackTargetRecord, record.GetMemoryId()).Scan(&oldestRetained); err != nil {
		t.Fatalf("load oldest retained event: %v", err)
	}
	if oldestRetained != "feedback-retain-07" {
		t.Fatalf("expected oldest retained event feedback-retain-07, got %q", oldestRetained)
	}

	var helpfulCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT helpful_count
		FROM memory_recall_feedback_summary
		WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
	`, bankKey, recallFeedbackTargetRecord, record.GetMemoryId()).Scan(&helpfulCount); err != nil {
		t.Fatalf("load feedback summary: %v", err)
	}
	if helpfulCount != 70 {
		t.Fatalf("expected summary helpful_count to remain 70, got %d", helpfulCount)
	}
}

func TestMemoryServiceAcceleratorCleanupDeletesOrphanedFeedbackSummary(t *testing.T) {
	t.Parallel()

	svc, locator, _ := newCanonicalTestMemoryRecord(t)
	bankKey := locatorKey(locator)
	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_recall_feedback_summary(bank_locator_key, target_kind, target_id, helpful_count, unhelpful_count, last_feedback_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, bankKey, recallFeedbackTargetNarrative, "nar-missing", 2, 1, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert orphan summary: %v", err)
	}

	if err := svc.cleanupAcceleratorStateAt(context.Background(), time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("cleanupAcceleratorStateAt: %v", err)
	}

	var count int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_recall_feedback_summary
		WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
	`, bankKey, recallFeedbackTargetNarrative, "nar-missing").Scan(&count); err != nil {
		t.Fatalf("count orphan summary rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected orphan summary row to be deleted, got %d", count)
	}
}

func TestMemoryServiceAcceleratorCleanupDeletesExpiredAliasRows(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	bankKey := locatorKey(locator)
	if err := svc.CommitCanonicalReview(ctx, "review-cleanup-alias", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-cleanup-active",
				Topic:           "cleanup topic",
				Content:         "cleanup content",
				SourceVersion:   "review-runtime",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(active narrative): %v", err)
	}

	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_narrative_alias(bank_locator_key, narrative_id, alias_norm, alias_display, helpful_count, unhelpful_count, status, updated_at)
		VALUES
			(?, ?, ?, ?, ?, ?, ?, ?),
			(?, ?, ?, ?, ?, ?, ?, ?),
			(?, ?, ?, ?, ?, ?, ?, ?),
			(?, ?, ?, ?, ?, ?, ?, ?)
	`,
		bankKey, "nar-cleanup-active", "old-candidate", "old-candidate", 1, 0, narrativeAliasStatusCandidate, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano),
		bankKey, "nar-cleanup-active", "old-suppressed", "old-suppressed", 1, 2, narrativeAliasStatusSuppressed, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano),
		bankKey, "nar-cleanup-active", "keep-active", "keep-active", 3, 0, narrativeAliasStatusActive, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano),
		bankKey, "nar-cleanup-missing", "missing-active", "missing-active", 3, 0, narrativeAliasStatusActive, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano),
	); err != nil {
		t.Fatalf("insert alias rows: %v", err)
	}

	if err := svc.cleanupAcceleratorStateAt(ctx, time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("cleanupAcceleratorStateAt: %v", err)
	}

	var remaining []string
	rows, err := svc.PersistenceBackend().DB().Query(`
		SELECT alias_norm
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ?
		ORDER BY alias_norm ASC
	`, bankKey, "nar-cleanup-active")
	if err != nil {
		t.Fatalf("query alias rows: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var aliasNorm string
		if err := rows.Scan(&aliasNorm); err != nil {
			t.Fatalf("scan alias row: %v", err)
		}
		remaining = append(remaining, aliasNorm)
	}
	if !slices.Equal(remaining, []string{"keep-active"}) {
		t.Fatalf("expected only active alias to remain, got %#v", remaining)
	}

	var missingCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, bankKey, "nar-cleanup-missing", "missing-active").Scan(&missingCount); err != nil {
		t.Fatalf("count orphan alias rows: %v", err)
	}
	if missingCount != 0 {
		t.Fatalf("expected orphan alias row to be deleted, got %d", missingCount)
	}
}

func TestMemoryServiceRecordRecallFeedbackTriggersAcceleratorCleanup(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	fixedNow := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return fixedNow }
	svc.acceleratorCleanupCooldown = 0

	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_recall_feedback_summary(bank_locator_key, target_kind, target_id, helpful_count, unhelpful_count, last_feedback_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, locatorKey(locator), recallFeedbackTargetNarrative, "nar-missing-on-write", 2, 1, fixedNow.Add(-48*time.Hour).Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert orphan summary: %v", err)
	}

	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-cleanup-write-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   record.GetMemoryId(),
		Polarity:   recallFeedbackHelpful,
		QueryText:  "cleanup trigger",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback: %v", err)
	}

	var count int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_recall_feedback_summary
		WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
	`, locatorKey(locator), recallFeedbackTargetNarrative, "nar-missing-on-write").Scan(&count); err != nil {
		t.Fatalf("count orphan summary rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected write-path cleanup to remove orphan summary row, got %d", count)
	}
}

func TestMemoryServiceCommitCanonicalReviewTriggersAcceleratorCleanup(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	fixedNow := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return fixedNow }
	svc.acceleratorCleanupCooldown = 0

	if err := svc.CommitCanonicalReview(ctx, "review-cleanup-trigger-seed", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-cleanup-trigger",
				Topic:           "cleanup trigger",
				Content:         "active narrative for cleanup trigger",
				SourceVersion:   "review-runtime",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(seed): %v", err)
	}

	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_narrative_alias(bank_locator_key, narrative_id, alias_norm, alias_display, helpful_count, unhelpful_count, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, locatorKey(locator), "nar-cleanup-trigger", "old-trigger-candidate", "old-trigger-candidate", 1, 0, narrativeAliasStatusCandidate, fixedNow.Add(-15*24*time.Hour).Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert stale alias row: %v", err)
	}

	if err := svc.CommitCanonicalReview(ctx, "review-cleanup-trigger-apply", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Truths: []TruthCandidate{
			{
				TruthID:         "truth-cleanup-trigger",
				Dimension:       "cognitive",
				Statement:       "cleanup trigger truth",
				NormalizedKey:   "cleanup-trigger-truth",
				Confidence:      0.8,
				SourceCount:     5,
				Status:          "candidate",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(apply): %v", err)
	}

	var count int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, locatorKey(locator), "nar-cleanup-trigger", "old-trigger-candidate").Scan(&count); err != nil {
		t.Fatalf("count stale alias rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected commit-path cleanup to remove stale alias row, got %d", count)
	}
}

func TestMemoryServiceAcceleratorCleanupCooldownLimitsOpportunisticRuns(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	baseNow := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	currentNow := baseNow
	svc.now = func() time.Time { return currentNow }
	svc.acceleratorCleanupCooldown = time.Hour
	svc.acceleratorCleanupMu.Lock()
	svc.lastAcceleratorCleanupAt = time.Time{}
	svc.acceleratorCleanupMu.Unlock()

	insertOrphanSummary := func(targetID string) {
		t.Helper()
		if _, err := svc.PersistenceBackend().DB().Exec(`
			INSERT INTO memory_recall_feedback_summary(bank_locator_key, target_kind, target_id, helpful_count, unhelpful_count, last_feedback_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, locatorKey(locator), recallFeedbackTargetNarrative, targetID, 1, 0, currentNow.Add(-48*time.Hour).Format(time.RFC3339Nano)); err != nil {
			t.Fatalf("insert orphan summary %s: %v", targetID, err)
		}
	}
	countSummary := func(targetID string) int {
		t.Helper()
		var count int
		if err := svc.PersistenceBackend().DB().QueryRow(`
			SELECT COUNT(1)
			FROM memory_recall_feedback_summary
			WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
		`, locatorKey(locator), recallFeedbackTargetNarrative, targetID).Scan(&count); err != nil {
			t.Fatalf("count orphan summary %s: %v", targetID, err)
		}
		return count
	}

	insertOrphanSummary("nar-cooldown-first")
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-cooldown-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   record.GetMemoryId(),
		Polarity:   recallFeedbackHelpful,
		QueryText:  "cooldown first",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(first): %v", err)
	}
	if count := countSummary("nar-cooldown-first"); count != 0 {
		t.Fatalf("expected first opportunistic cleanup to remove orphan summary, got %d rows", count)
	}

	insertOrphanSummary("nar-cooldown-second")
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-cooldown-2",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   record.GetMemoryId(),
		Polarity:   recallFeedbackHelpful,
		QueryText:  "cooldown second",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(second): %v", err)
	}
	if count := countSummary("nar-cooldown-second"); count != 1 {
		t.Fatalf("expected cooldown-limited write to skip cleanup, got %d rows", count)
	}

	currentNow = currentNow.Add(2 * time.Hour)
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-cooldown-3",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   record.GetMemoryId(),
		Polarity:   recallFeedbackHelpful,
		QueryText:  "cooldown third",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(third): %v", err)
	}
	if count := countSummary("nar-cooldown-second"); count != 0 {
		t.Fatalf("expected cleanup to resume after cooldown, got %d rows", count)
	}
}

func TestMemoryServiceStartupAcceleratorCleanupRemovesExpiredAliasRows(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New(first): %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	setManagedEmbeddingProfileForTest(svc, &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-startup-cleanup"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(context.Background(), locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_narrative(narrative_id, bank_locator_key, topic, content, source_version, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, "nar-startup-cleanup", locatorKey(locator), "startup", "stale alias cleanup", "review-runtime", "active", time.Now().UTC().Format(time.RFC3339Nano), time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert narrative: %v", err)
	}
	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_narrative_alias(bank_locator_key, narrative_id, alias_norm, alias_display, helpful_count, unhelpful_count, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, locatorKey(locator), "nar-startup-cleanup", "startup-old-candidate", "startup-old-candidate", 1, 0, narrativeAliasStatusCandidate, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert stale alias row: %v", err)
	}
	if err := svc.Close(); err != nil {
		t.Fatalf("Close(first): %v", err)
	}

	reopened, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New(reopen): %v", err)
	}
	closeMemoryServiceForTest(t, reopened)
	defer reopened.Close()

	var count int
	if err := reopened.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, locatorKey(locator), "nar-startup-cleanup", "startup-old-candidate").Scan(&count); err != nil {
		t.Fatalf("count alias rows after reopen: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected startup cleanup to remove stale alias row, got %d", count)
	}
}
