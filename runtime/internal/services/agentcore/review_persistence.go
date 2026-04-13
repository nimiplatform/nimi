package agentcore

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

type reviewPersistence interface {
	SavePreparedReviewRun(ctx context.Context, run ReviewRunRecord) error
	UpdateReviewRunStatus(ctx context.Context, reviewRunID string, statusValue string, failureMessage string) error
	RecordReviewFollowUp(ctx context.Context, run ReviewRunRecord) error
	GetReviewFollowUp(ctx context.Context, locator *runtimev1.MemoryBankLocator) (*ReviewFollowUpRecord, error)
	ListRecoverableReviewRuns(ctx context.Context) ([]ReviewRunRecord, error)
}

type sqliteReviewPersistence struct {
	backend *runtimepersistence.Backend
}

func newReviewPersistence(backend *runtimepersistence.Backend) reviewPersistence {
	if backend == nil {
		return nil
	}
	return sqliteReviewPersistence{backend: backend}
}

func (s sqliteReviewPersistence) SavePreparedReviewRun(ctx context.Context, run ReviewRunRecord) error {
	if strings.TrimSpace(run.ReviewRunID) == "" || strings.TrimSpace(run.AgentID) == "" || strings.TrimSpace(run.BankLocatorKey) == "" {
		return fmt.Errorf("review_run_id, agent_id, bank_locator_key are required")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if strings.TrimSpace(run.CreatedAt) == "" {
		run.CreatedAt = now
	}
	run.UpdatedAt = now
	if strings.TrimSpace(run.Status) == "" {
		run.Status = "prepared"
	}
	payload, err := json.Marshal(run.PreparedOutcomes)
	if err != nil {
		return err
	}
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT OR REPLACE INTO agentcore_review_run(review_run_id, agent_id, bank_locator_key, checkpoint_basis, status, prepared_outcomes_json, failure_message, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM agentcore_review_run WHERE review_run_id = ?), ?), ?)
		`, run.ReviewRunID, run.AgentID, run.BankLocatorKey, run.CheckpointBasis, run.Status, string(payload), run.FailureMessage, run.ReviewRunID, run.CreatedAt, run.UpdatedAt)
		return err
	})
}

func (s sqliteReviewPersistence) UpdateReviewRunStatus(ctx context.Context, reviewRunID string, statusValue string, failureMessage string) error {
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			UPDATE agentcore_review_run
			SET status = ?, failure_message = ?, updated_at = ?
			WHERE review_run_id = ?
		`, statusValue, failureMessage, time.Now().UTC().Format(time.RFC3339Nano), reviewRunID)
		return err
	})
}

func (s sqliteReviewPersistence) RecordReviewFollowUp(ctx context.Context, run ReviewRunRecord) error {
	completedAt := time.Now().UTC().Format(time.RFC3339Nano)
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT OR REPLACE INTO agentcore_review_followup(bank_locator_key, review_run_id, checkpoint_basis, completed_at)
			VALUES (?, ?, ?, ?)
		`, run.BankLocatorKey, run.ReviewRunID, run.CheckpointBasis, completedAt)
		return err
	})
}

func (s sqliteReviewPersistence) GetReviewFollowUp(ctx context.Context, locator *runtimev1.MemoryBankLocator) (*ReviewFollowUpRecord, error) {
	if locator == nil {
		return nil, nil
	}
	var record ReviewFollowUpRecord
	err := s.backend.DB().QueryRowContext(ctx, `
		SELECT bank_locator_key, review_run_id, checkpoint_basis, completed_at
		FROM agentcore_review_followup
		WHERE bank_locator_key = ?
	`, memoryservice.LocatorKey(locator)).Scan(&record.BankLocatorKey, &record.ReviewRunID, &record.CheckpointBasis, &record.CompletedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &record, nil
}

func (s sqliteReviewPersistence) ListRecoverableReviewRuns(ctx context.Context) ([]ReviewRunRecord, error) {
	rows, err := s.backend.DB().QueryContext(ctx, `
		SELECT review_run_id, agent_id, bank_locator_key, checkpoint_basis, status, prepared_outcomes_json, failure_message, created_at, updated_at
		FROM agentcore_review_run
		WHERE status IN ('prepared', 'memory_committed')
		ORDER BY created_at, review_run_id
	`)
	if err != nil {
		return nil, fmt.Errorf("load recoverable review runs: %w", err)
	}
	defer rows.Close()
	out := make([]ReviewRunRecord, 0)
	for rows.Next() {
		var run ReviewRunRecord
		var outcomesRaw string
		if err := rows.Scan(&run.ReviewRunID, &run.AgentID, &run.BankLocatorKey, &run.CheckpointBasis, &run.Status, &outcomesRaw, &run.FailureMessage, &run.CreatedAt, &run.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(outcomesRaw), &run.PreparedOutcomes); err != nil {
			return nil, err
		}
		out = append(out, run)
	}
	return out, rows.Err()
}
