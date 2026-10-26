package aitelemetry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type accountingGap struct {
	source string
	from   time.Time
	reason string
}
type accountingWrite struct {
	at          time.Time
	record      *Record
	encoded     []byte
	gap         *accountingGap
	operationID string
	usage       *runtimev1.UsageStats
	outcome     runtimev1.DesktopAICloudAttemptOutcome
	reasonCode  runtimev1.ReasonCode
}

// enqueueLocked never waits for the database or for queue capacity. The queue
// retains at most 1024 bounded records; dropping one makes coverage incomplete.
func (s *Store) enqueueLocked(write accountingWrite) error {
	select {
	case s.writes <- write:
		s.accepted++
		return nil
	default:
		err := fmt.Errorf("AI accounting writer capacity exceeded")
		s.noteWriteFailureLocked(err)
		return err
	}
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-accounting
func (s *Store) runWriter() {
	defer close(s.writerDone)
	for write := range s.writes {
		err := s.initialize(write.at)
		if err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			err = s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
				switch {
				case write.record != nil:
					return s.recordTx(ctx, tx, *write.record, write.encoded, write.at)
				case write.gap != nil:
					if err := insertGapTx(ctx, tx, write.gap.source, write.gap.from.UnixNano(), write.at.UnixNano(), write.gap.reason); err != nil {
						return err
					}
					return boundHistoryTx(ctx, tx)
				case write.operationID != "":
					return s.finishOperationTx(ctx, tx, write)
				default:
					return nil
				}
			})
			cancel()
		}
		if errors.Is(err, errIgnoredRevision) {
			err = nil
		}
		s.mu.Lock()
		if err != nil {
			s.noteWriteFailureLocked(err)
		}
		s.completed++
		close(s.progress)
		s.progress = make(chan struct{})
		s.mu.Unlock()
		if err != nil && s.logger != nil {
			s.logger.Warn("AI accounting is incomplete", "error", err)
		}
	}
	s.mu.RLock()
	initialized := s.initialized
	clean := !s.writeGap && len(s.active) == 0 && !s.activeOverflow && !s.recoveryIncomplete && s.completed == s.accepted
	ended := s.closeAt
	s.mu.RUnlock()
	var err error
	if initialized {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err = s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `UPDATE runtime_ai_accounting_generation SET ended_ns=?,clean=? WHERE generation_id=?`, ended.UnixNano(), clean, s.generation)
			return err
		})
		cancel()
	} else {
		err = fmt.Errorf("AI accounting generation was never durable")
	}
	if err != nil {
		s.mu.Lock()
		s.noteWriteFailureLocked(err)
		s.mu.Unlock()
	}
}

// Flush waits only for already accepted accounting writes. It is used by
// shutdown/verification, never by an AI dispatch or completion path.
func (s *Store) Flush(ctx context.Context) error {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	target := s.accepted
	s.mu.RUnlock()
	for {
		s.mu.RLock()
		done := s.completed >= target
		err := s.writerError
		changed := s.progress
		s.mu.RUnlock()
		if done {
			return err
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (s *Store) finishOperationTx(ctx context.Context, tx *sql.Tx, write accountingWrite) error {
	rows, err := tx.QueryContext(ctx, `SELECT record FROM runtime_ai_usage_attempt WHERE operation_id=?`, write.operationID)
	if err != nil {
		return err
	}
	var records []Record
	for rows.Next() {
		var encoded []byte
		if err := rows.Scan(&encoded); err != nil {
			_ = rows.Close()
			return err
		}
		record, err := decodeRecord(encoded)
		if err != nil {
			_ = rows.Close()
			return err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, record := range records {
		if !record.TerminalAt.IsZero() && write.usage == nil && write.outcome == runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_UNSPECIFIED {
			continue
		}
		record.Revision++
		if record.TerminalAt.IsZero() {
			record.TerminalAt = write.at
		}
		record.ObservedAt = write.at
		if len(records) == 1 && write.usage != nil && record.Usage == nil {
			record.Usage = cloneUsage(write.usage)
		}
		if len(records) == 1 && write.outcome != runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_UNSPECIFIED && (record.Outcome == runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_UNSPECIFIED || record.Outcome == runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_UNKNOWN) {
			record.Outcome, record.ReasonCode = write.outcome, write.reasonCode
		}
		encoded, err := json.Marshal(record)
		if err != nil {
			return err
		}
		if err := s.recordTx(ctx, tx, record, encoded, write.at); err != nil && !errors.Is(err, errIgnoredRevision) {
			return err
		}
	}
	return nil
}
