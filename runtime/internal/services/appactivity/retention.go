package appactivity

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

const retentionInterval = time.Hour

// StartRetention runs retention once at startup and then periodically until
// Close.
// @nimi-authority: rule.nimi.runtime.app-surface.r104
func (s *Service) StartRetention() {
	if !s.available() {
		return
	}
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		timer := time.NewTimer(10 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-s.lifecycleCtx.Done():
				return
			case <-timer.C:
			}
			if err := s.RunRetention(s.lifecycleCtx); err != nil && !errors.Is(err, ErrUnavailable) && s.lifecycleCtx.Err() == nil {
				s.logger.Warn("App activity retention failed", "error", err)
			}
			timer.Reset(retentionInterval)
		}
	}()
}

// RunRetention removes expired records with content-free removes and deletes
// retained changes older than the replay window, advancing each replay floor.
func (s *Service) RunRetention(ctx context.Context) error {
	if s == nil {
		return ErrUnavailable
	}
	// Serialize background writes with the root handoff. Foreground requests
	// and the Agent/Cognition producers are already drained by their owners.
	s.retentionMu.Lock()
	defer s.retentionMu.Unlock()
	if !s.available() {
		return ErrUnavailable
	}
	now := s.now().UTC()
	cutoff := now.Add(-RetentionWindow).UnixMilli()
	accounts, err := activityAccounts(ctx, s.backend.DB())
	if err != nil {
		return err
	}
	for _, accountID := range accounts {
		unavailable, err := s.unavailablePublishers(ctx, accountID)
		if err != nil {
			return err
		}
		changed := false
		err = s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
			expired, err := expiredRecordIDs(ctx, tx, accountID, cutoff, unavailable)
			if err != nil {
				return err
			}
			if len(expired) > 0 {
				changed = true
				if err := removeRecordsTx(ctx, tx, accountID, expired, false, now.UnixMilli()); err != nil {
					return err
				}
			}
			var maxPurged sql.NullInt64
			if err := tx.QueryRowContext(ctx,
				`SELECT MAX(change_seq) FROM runtime_app_activity_change WHERE account_id = ? AND committed_at_ms < ?`,
				accountID, cutoff).Scan(&maxPurged); err != nil {
				return fmt.Errorf("inspect expired App activity changes: %w", err)
			}
			if !maxPurged.Valid {
				return nil
			}
			if _, err := tx.ExecContext(ctx,
				`DELETE FROM runtime_app_activity_change WHERE account_id = ? AND change_seq <= ?`,
				accountID, maxPurged.Int64); err != nil {
				return fmt.Errorf("delete expired App activity changes: %w", err)
			}
			return raiseReplayFloorTx(ctx, tx, accountID, uint64(maxPurged.Int64))
		})
		if err != nil {
			return err
		}
		if changed {
			s.NotifyCommitted(accountID)
		}
	}
	return nil
}

func activityAccounts(ctx context.Context, q querier) ([]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT account_id FROM runtime_app_activity_account ORDER BY account_id`)
	if err != nil {
		return nil, fmt.Errorf("list App activity accounts: %w", err)
	}
	defer func() { _ = rows.Close() }()
	accounts := []string{}
	for rows.Next() {
		var accountID string
		if err := rows.Scan(&accountID); err != nil {
			return nil, err
		}
		accounts = append(accounts, accountID)
	}
	return accounts, rows.Err()
}

// unavailablePublishers reports App publishers of open todos whose
// registration is no longer active; their open todos enter historical
// retention.
func (s *Service) unavailablePublishers(ctx context.Context, accountID string) (map[string]bool, error) {
	rows, err := s.backend.DB().QueryContext(ctx,
		`SELECT DISTINCT publisher_ref FROM runtime_app_activity_record
		 WHERE account_id = ? AND publisher_kind = 'app' AND kind = 'todo' AND todo_state = 'open'`, accountID)
	if err != nil {
		return nil, fmt.Errorf("list App activity todo publishers: %w", err)
	}
	subjects := []string{}
	for rows.Next() {
		var subject string
		if err := rows.Scan(&subject); err != nil {
			_ = rows.Close()
			return nil, err
		}
		subjects = append(subjects, subject)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	unavailable := map[string]bool{}
	for _, subject := range subjects {
		facts, err := s.registrations.ActivitySource(ctx, subject)
		if err != nil || !facts.Active {
			unavailable[subject] = true
		}
	}
	return unavailable, nil
}

func expiredRecordIDs(ctx context.Context, tx *sql.Tx, accountID string, cutoff int64, unavailable map[string]bool) ([]string, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT activity_id, publisher_ref, kind, todo_state, published_at_ms, updated_at_ms, terminal_at_ms
		 FROM runtime_app_activity_record WHERE account_id = ?`, accountID)
	if err != nil {
		return nil, fmt.Errorf("scan App activity retention: %w", err)
	}
	defer func() { _ = rows.Close() }()
	expired := []string{}
	for rows.Next() {
		var activityID, publisherRef, kind, state string
		var publishedAt, updatedAt, terminalAt int64
		if err := rows.Scan(&activityID, &publisherRef, &kind, &state, &publishedAt, &updatedAt, &terminalAt); err != nil {
			return nil, err
		}
		switch {
		case kind == kindActivity && publishedAt < cutoff:
			expired = append(expired, activityID)
		case kind == kindTodo && terminalState(state) && terminalAt < cutoff:
			expired = append(expired, activityID)
		case kind == kindTodo && state == todoStateOpen && unavailable[publisherRef] && updatedAt < cutoff:
			expired = append(expired, activityID)
		}
	}
	return expired, rows.Err()
}
