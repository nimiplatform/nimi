package memory

import (
	"context"
	"database/sql"
	"time"
)

const (
	feedbackEventRetentionPerTarget = 64
	narrativeAliasCandidateMaxAge   = 14 * 24 * time.Hour
	narrativeAliasSuppressedMaxAge  = 30 * 24 * time.Hour
)

func (s *Service) runAcceleratorCleanupBestEffort(ctx context.Context) {
	if s == nil || s.backend == nil {
		return
	}
	now := s.cleanupNow()
	s.acceleratorCleanupMu.Lock()
	s.lastAcceleratorCleanupAt = now
	s.acceleratorCleanupMu.Unlock()
	if err := s.cleanupAcceleratorStateAt(ctx, now); err != nil && s.logger != nil {
		s.logger.Warn("memory accelerator cleanup failed", "error", err)
	}
}

func (s *Service) maybeRunAcceleratorCleanup(ctx context.Context) {
	if s == nil || s.backend == nil {
		return
	}
	now := s.cleanupNow()
	s.acceleratorCleanupMu.Lock()
	if cooldown := s.acceleratorCleanupCooldown; cooldown > 0 && !s.lastAcceleratorCleanupAt.IsZero() && now.Sub(s.lastAcceleratorCleanupAt) < cooldown {
		s.acceleratorCleanupMu.Unlock()
		return
	}
	s.lastAcceleratorCleanupAt = now
	s.acceleratorCleanupMu.Unlock()
	if err := s.cleanupAcceleratorStateAt(ctx, now); err != nil && s.logger != nil {
		s.logger.Warn("memory accelerator cleanup failed", "error", err)
	}
}

func (s *Service) cleanupNow() time.Time {
	if s != nil && s.now != nil {
		return s.now().UTC()
	}
	return time.Now().UTC()
}

func (s *Service) cleanupAcceleratorStateAt(ctx context.Context, now time.Time) error {
	if s == nil || s.backend == nil {
		return nil
	}
	candidateBefore := now.Add(-narrativeAliasCandidateMaxAge).Format(time.RFC3339Nano)
	suppressedBefore := now.Add(-narrativeAliasSuppressedMaxAge).Format(time.RFC3339Nano)
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM memory_recall_feedback_event
			WHERE feedback_id IN (
				SELECT feedback_id
				FROM (
					SELECT feedback_id,
						ROW_NUMBER() OVER (
							PARTITION BY bank_locator_key, target_kind, target_id
							ORDER BY created_at DESC, feedback_id DESC
						) AS row_num
					FROM memory_recall_feedback_event
				)
				WHERE row_num > ?
			)
		`, feedbackEventRetentionPerTarget); err != nil {
			return err
		}

		if _, err := tx.ExecContext(ctx, `
			DELETE FROM memory_narrative_alias
			WHERE NOT EXISTS (
				SELECT 1
				FROM memory_narrative
				WHERE memory_narrative.narrative_id = memory_narrative_alias.narrative_id
					AND memory_narrative.bank_locator_key = memory_narrative_alias.bank_locator_key
					AND LOWER(TRIM(memory_narrative.status)) = 'active'
			)
			OR (status = ? AND updated_at < ?)
			OR (status = ? AND updated_at < ?)
		`, narrativeAliasStatusCandidate, candidateBefore, narrativeAliasStatusSuppressed, suppressedBefore); err != nil {
			return err
		}

		if _, err := tx.ExecContext(ctx, `
			DELETE FROM memory_recall_feedback_summary
			WHERE NOT EXISTS (
				SELECT 1
				FROM memory_recall_feedback_event
				WHERE memory_recall_feedback_event.bank_locator_key = memory_recall_feedback_summary.bank_locator_key
					AND memory_recall_feedback_event.target_kind = memory_recall_feedback_summary.target_kind
					AND memory_recall_feedback_event.target_id = memory_recall_feedback_summary.target_id
			)
			AND (
				(
					target_kind = ?
					AND NOT EXISTS (
						SELECT 1
						FROM memory_record
						WHERE memory_record.memory_id = memory_recall_feedback_summary.target_id
							AND memory_record.locator_key = memory_recall_feedback_summary.bank_locator_key
					)
				)
				OR (
					target_kind = ?
					AND NOT EXISTS (
						SELECT 1
						FROM memory_narrative
						WHERE memory_narrative.narrative_id = memory_recall_feedback_summary.target_id
							AND memory_narrative.bank_locator_key = memory_recall_feedback_summary.bank_locator_key
					)
				)
				OR target_kind NOT IN (?, ?)
			)
		`, recallFeedbackTargetRecord, recallFeedbackTargetNarrative, recallFeedbackTargetRecord, recallFeedbackTargetNarrative); err != nil {
			return err
		}
		return nil
	})
}
