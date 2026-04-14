package memory

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type persistTxHook func(context.Context, *sql.Tx) error

func sourceMemoryInvalidationCascadeHook(locator *runtimev1.MemoryBankLocator, memoryIDs []string, observedAt time.Time) persistTxHook {
	bankLocatorKey := locatorKey(locator)
	ids := uniqueTrimmedStrings(memoryIDs)
	if bankLocatorKey == "" || len(ids) == 0 {
		return nil
	}
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	} else {
		observedAt = observedAt.UTC()
	}
	now := observedAt.Format(time.RFC3339Nano)
	return func(ctx context.Context, tx *sql.Tx) error {
		narrativeIDs, err := selectDistinctIDs(ctx, tx, fmt.Sprintf(`
			SELECT DISTINCT narrative_id
			FROM narrative_source
			WHERE bank_locator_key = ? AND memory_id IN (%s)
		`, sqlPlaceholders(len(ids))), append([]any{bankLocatorKey}, stringsSliceToAny(ids)...)...)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, fmt.Sprintf(`
			UPDATE narrative_source
			SET is_active = 0,
				deactivated_at = COALESCE(deactivated_at, ?)
			WHERE bank_locator_key = ?
				AND memory_id IN (%s)
				AND is_active = 1
		`, sqlPlaceholders(len(ids))), append([]any{now, bankLocatorKey}, stringsSliceToAny(ids)...)...); err != nil {
			return fmt.Errorf("deactivate narrative_source rows: %w", err)
		}
		if err := updateNarrativeCascadeState(ctx, tx, bankLocatorKey, narrativeIDs, "invalidated", now); err != nil {
			return err
		}

		truthIDs, err := selectDistinctIDs(ctx, tx, fmt.Sprintf(`
			SELECT DISTINCT truth_id
			FROM truth_source
			WHERE bank_locator_key = ? AND memory_id IN (%s)
		`, sqlPlaceholders(len(ids))), append([]any{bankLocatorKey}, stringsSliceToAny(ids)...)...)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, fmt.Sprintf(`
			UPDATE truth_source
			SET is_active = 0,
				deactivated_at = COALESCE(deactivated_at, ?)
			WHERE bank_locator_key = ?
				AND memory_id IN (%s)
				AND is_active = 1
		`, sqlPlaceholders(len(ids))), append([]any{now, bankLocatorKey}, stringsSliceToAny(ids)...)...); err != nil {
			return fmt.Errorf("deactivate truth_source rows: %w", err)
		}
		if err := updateTruthCascadeState(ctx, tx, bankLocatorKey, truthIDs, "invalidated", now); err != nil {
			return err
		}

		relArgs := append([]any{bankLocatorKey}, stringsSliceToAny(ids)...)
		relArgs = append(relArgs, stringsSliceToAny(ids)...)
		if _, err := tx.ExecContext(ctx, fmt.Sprintf(`
			UPDATE memory_relation
			SET is_active = 0
			WHERE bank_locator_key = ?
				AND is_active = 1
				AND (
					source_id IN (%s)
					OR target_id IN (%s)
				)
		`, sqlPlaceholders(len(ids)), sqlPlaceholders(len(ids))), relArgs...); err != nil {
			return fmt.Errorf("deactivate memory_relation rows: %w", err)
		}
		return nil
	}
}

func updateNarrativeCascadeState(ctx context.Context, tx *sql.Tx, bankLocatorKey string, narrativeIDs []string, status string, now string) error {
	ids := uniqueTrimmedStrings(narrativeIDs)
	if tx == nil || bankLocatorKey == "" || len(ids) == 0 {
		return nil
	}
	args := append([]any{status, now, bankLocatorKey}, stringsSliceToAny(ids)...)
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`
		UPDATE memory_narrative
		SET status = ?, updated_at = ?
		WHERE bank_locator_key = ? AND narrative_id IN (%s)
	`, sqlPlaceholders(len(ids))), args...); err != nil {
		return fmt.Errorf("update memory_narrative status: %w", err)
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`
		DELETE FROM memory_narrative_embedding
		WHERE locator_key = ? AND narrative_id IN (%s)
	`, sqlPlaceholders(len(ids))), append([]any{bankLocatorKey}, stringsSliceToAny(ids)...)...); err != nil {
		return fmt.Errorf("delete memory_narrative_embedding rows: %w", err)
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`
		DELETE FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id IN (%s)
	`, sqlPlaceholders(len(ids))), append([]any{bankLocatorKey}, stringsSliceToAny(ids)...)...); err != nil {
		return fmt.Errorf("delete memory_narrative_alias rows: %w", err)
	}
	return nil
}

func updateTruthCascadeState(ctx context.Context, tx *sql.Tx, bankLocatorKey string, truthIDs []string, status string, now string) error {
	ids := uniqueTrimmedStrings(truthIDs)
	if tx == nil || bankLocatorKey == "" || len(ids) == 0 {
		return nil
	}
	args := append([]any{status, now, bankLocatorKey}, stringsSliceToAny(ids)...)
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`
		UPDATE agent_truth
		SET status = ?, updated_at = ?
		WHERE bank_locator_key = ? AND truth_id IN (%s)
	`, sqlPlaceholders(len(ids))), args...); err != nil {
		return fmt.Errorf("update agent_truth status: %w", err)
	}
	return nil
}

func selectDistinctIDs(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]string, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func stringsSliceToAny(input []string) []any {
	if len(input) == 0 {
		return nil
	}
	out := make([]any, 0, len(input))
	for _, item := range input {
		out = append(out, item)
	}
	return out
}
