package memoryv1

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// @nimi-authority: rule.nimi.cognition.runtime-bridge.memory-ai-result-disposition
// The existing operation owns both its outcome and AI disposition. No second
// outcome record is synchronized across generation changes or owner calls.
func (c *Core) retainEmbeddingOperation(ctx context.Context, operationID, bankRef, lifecycleRef string) error {
	result, err := c.db.ExecContext(ctx, `UPDATE memory_operation_routes SET ai_lifecycle_ref = ?, ai_disposition = 'retained', updated_at = ? WHERE operation_id = ? AND bank_ref = ? AND outcome = 'pending' AND (ai_disposition = 'none' OR (ai_disposition = 'retained' AND ai_lifecycle_ref = ?))`, lifecycleRef, formatTime(c.now()), operationID, bankRef, lifecycleRef)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return contractError(OutcomeConflict, "embedding_operation_fenced")
	}
	return nil
}

func (c *Core) finishEmbeddingOperation(ctx context.Context, operationID string, outcome Outcome, port EmbeddingPort) error {
	if outcome == "" {
		outcome = OutcomeFailed
	}
	_, err := c.db.ExecContext(ctx, `UPDATE memory_operation_routes SET ai_disposition = 'pending', outcome = ?, updated_at = ? WHERE operation_id = ? AND ai_disposition = 'retained'`, outcome, formatTime(c.now()), operationID)
	if err != nil {
		return fmt.Errorf("record embedding disposition: %w", err)
	}
	storedOutcome, _, err := c.resumeEmbeddingOperation(ctx, operationID, port)
	if err == nil && storedOutcome != outcome {
		return contractError(OutcomeConflict, "embedding_consumer_fenced")
	}
	return err
}

func (c *Core) resumeEmbeddingOperation(ctx context.Context, operationID string, port EmbeddingPort) (_ Outcome, _ bool, resultErr error) {
	var state string
	var outcome Outcome
	err := c.db.QueryRowContext(ctx, `SELECT ai_disposition, outcome FROM memory_operation_routes WHERE operation_id = ? AND ai_disposition <> 'none'`, operationID).Scan(&state, &outcome)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if state == "retained" {
		var resumable int
		if err := c.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM memory_operation_routes r JOIN memory_derived_generations g ON g.generation_ref = r.operation_id AND g.bank_ref = r.bank_ref JOIN memory_banks b ON b.bank_ref = r.bank_ref WHERE r.operation_id = ? AND r.operation_kind = 'embedding_build' AND r.outcome = 'pending' AND g.status IN ('building', 'ready') AND g.canonical_version = b.canonical_version AND g.lifecycle_ref = b.lifecycle_ref AND b.state = 'active'`, operationID).Scan(&resumable); err != nil {
			return "", true, err
		}
		if resumable == 1 {
			return "", false, nil
		}
		// Serialized operations cannot have another live consumer here. A previous
		// failed persistence attempt left this obligation for the current retry.
		outcome = OutcomeConflict
		if _, err := c.db.ExecContext(ctx, `UPDATE memory_operation_routes SET ai_disposition = 'pending', outcome = ? WHERE operation_id = ? AND ai_disposition = 'retained'`, outcome, operationID); err != nil {
			return outcome, true, err
		}
	}
	if state != "done" {
		if outcome == OutcomeReady || outcome == OutcomeNoHits {
			err = acknowledgeEmbeddingResult(ctx, port, operationID)
		} else {
			err = finalizeStaleEmbeddingResult(ctx, port, operationID)
		}
		if err != nil {
			return outcome, true, err
		}
		tx, err := c.db.BeginTx(ctx, nil)
		if err != nil {
			return outcome, true, err
		}
		defer func() {
			if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
				resultErr = errors.Join(resultErr, fmt.Errorf("rollback embedding disposition: %w", err))
			}
		}()
		if err := tx.QueryRowContext(ctx, `SELECT ai_disposition, outcome FROM memory_operation_routes WHERE operation_id = ?`, operationID).Scan(&state, &outcome); err != nil {
			return "", true, err
		}
		if state != "pending" && state != "done" {
			return "", true, contractError(OutcomeConflict, "embedding_disposition_state")
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memory_operation_routes SET ai_disposition = 'done', updated_at = ? WHERE operation_id = ? AND ai_disposition = 'pending'`, formatTime(c.now()), operationID); err != nil {
			return outcome, true, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memory_derived_generations SET status = 'failed' WHERE generation_ref = ? AND status = 'building'`, operationID); err != nil {
			return outcome, true, err
		}
		if err := tx.Commit(); err != nil {
			return outcome, true, err
		}
	}
	return outcome, true, nil
}

func (c *Core) ResumeEmbeddingDispositions(ctx context.Context, bankRef string, port EmbeddingPort) error {
	if !validOpaqueRef(bankRef) || port == nil {
		return contractError(OutcomeInvalid, "embedding_disposition")
	}
	rows, err := c.db.QueryContext(ctx, `SELECT operation_id FROM memory_operation_routes WHERE bank_ref = ? AND ai_disposition IN ('retained', 'pending') ORDER BY updated_at, operation_id`, bankRef)
	if err != nil {
		return err
	}
	var operations []string
	for rows.Next() {
		var operation string
		if err := rows.Scan(&operation); err != nil {
			return errors.Join(err, rows.Close())
		}
		operations = append(operations, operation)
	}
	if err := rows.Err(); err != nil {
		return errors.Join(err, rows.Close())
	}
	if err := rows.Close(); err != nil {
		return err
	}
	var result error
	for _, operation := range operations {
		if !c.claimEmbeddingOperation(operation) {
			continue
		}
		_, _, err := c.resumeEmbeddingOperation(ctx, operation, port)
		result = errors.Join(result, err)
		c.releaseEmbeddingOperation(operation)
	}
	return result
}

func fenceEmbeddingDispositionsTx(ctx context.Context, tx *sql.Tx, bankRef string) error {
	_, err := tx.ExecContext(ctx, `UPDATE memory_operation_routes SET ai_disposition = 'pending', outcome = 'conflict' WHERE bank_ref = ? AND ai_disposition IN ('retained', 'pending')`, bankRef)
	return err
}

func (c *Core) claimEmbeddingOperation(operationID string) bool {
	c.embeddingMu.Lock()
	defer c.embeddingMu.Unlock()
	if c.embeddingActive == nil {
		c.embeddingActive = make(map[string]bool)
	}
	if c.embeddingActive[operationID] {
		return false
	}
	c.embeddingActive[operationID] = true
	return true
}
func (c *Core) releaseEmbeddingOperation(operationID string) {
	c.embeddingMu.Lock()
	defer c.embeddingMu.Unlock()
	delete(c.embeddingActive, operationID)
}
