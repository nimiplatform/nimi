package aitelemetry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"time"
)

var errIgnoredRevision = errors.New("AI accounting revision is already applied or expired")

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-retention
func (s *Store) recordTx(ctx context.Context, tx *sql.Tx, record Record, encoded []byte, now time.Time) error {
	var priorBytes []byte
	err := tx.QueryRowContext(ctx, `SELECT record FROM runtime_ai_usage_attempt WHERE attempt_id = ?`, record.ID).Scan(&priorBytes)
	previousExists := err == nil
	if err != nil && !noRows(err) {
		return err
	}
	var previous Record
	if previousExists {
		previous, err = decodeRecord(priorBytes)
		if err != nil {
			return err
		}
		if record.Revision <= previous.Revision {
			return errIgnoredRevision
		}
		if record.AccountID != previous.AccountID || !record.StartedAt.Equal(previous.StartedAt) || record.OperationID != previous.OperationID || record.Source != previous.Source || record.Price != previous.Price || record.ConnectorRef != previous.ConnectorRef {
			return fmt.Errorf("AI attempt immutable identity changed")
		}
		if !previous.TerminalAt.IsZero() && (record.TerminalAt.IsZero() || !record.TerminalAt.Equal(previous.TerminalAt)) {
			return errIgnoredRevision
		}
		if previous.Outcome >= runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_SUCCEEDED && previous.Outcome <= runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_CANCELLED && (record.Outcome != previous.Outcome || record.ReasonCode != previous.ReasonCode) {
			return errIgnoredRevision
		}
		if !previous.TerminalAt.IsZero() && now.After(previous.TerminalAt.Add(Retention)) {
			return errIgnoredRevision
		}
	} else {
		floor := now.Add(-Retention).UnixNano()
		var boundary sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT MAX(accept_from_ns) FROM runtime_ai_accounting_boundary WHERE source IN ('all', ?)`, record.Source.Kind).Scan(&boundary); err != nil {
			return err
		}
		if boundary.Valid && boundary.Int64 > floor {
			floor = boundary.Int64
		}
		if record.StartedAt.UnixNano() < floor {
			return errIgnoredRevision
		}
	}
	value, groupKey, err := recordAggregate(record)
	if err != nil {
		return err
	}
	bucket := record.StartedAt.UTC().Truncate(time.Minute).UnixNano()
	var aggregateBytes []byte
	var storedUntil int64
	err = tx.QueryRowContext(ctx, `SELECT record, retain_until_ns FROM runtime_ai_usage_minute WHERE account_id = ? AND bucket_ns = ? AND group_key = ?`, record.AccountID, bucket, groupKey).Scan(&aggregateBytes, &storedUntil)
	aggregateExists := err == nil
	if err != nil && !noRows(err) {
		return err
	}
	combined := aggregate{Source: value.Source, Capability: value.Capability, Models: value.Models, Route: value.Route}
	if aggregateExists {
		if err := json.Unmarshal(aggregateBytes, &combined); err != nil {
			return err
		}
	}
	if previousExists {
		old, oldKey, err := recordAggregate(previous)
		if err != nil {
			return err
		}
		if oldKey != groupKey || !aggregateExists {
			return fmt.Errorf("AI attempt attribution or retained aggregate changed")
		}
		if err := addAggregate(&combined, old, -1); err != nil {
			return err
		}
	}
	if err := addAggregate(&combined, value, 1); err != nil {
		return err
	}
	newAggregateBytes, err := json.Marshal(combined)
	if err != nil {
		return err
	}
	retainUntil := int64(0)
	if !record.TerminalAt.IsZero() {
		retainUntil = record.TerminalAt.Add(Retention).UnixNano()
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO runtime_ai_usage_attempt(attempt_id, account_id, source, operation_id, started_ns, terminal_ns, revision, bucket_ns, group_key, retain_until_ns, record_bytes, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(attempt_id) DO UPDATE SET terminal_ns=excluded.terminal_ns, revision=excluded.revision, retain_until_ns=excluded.retain_until_ns, record_bytes=excluded.record_bytes, record=excluded.record`, record.ID, record.AccountID, record.Source.Kind, record.OperationID, record.StartedAt.UnixNano(), timeNano(record.TerminalAt), record.Revision, bucket, groupKey, retainUntil, len(encoded), encoded); err != nil {
		return err
	}
	// A minute is pinned while any contained attempt is nonterminal, then
	// through the latest contained terminal correction deadline.
	var pending int
	var bucketUntil int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(CASE WHEN terminal_ns=0 THEN 1 ELSE 0 END),0), COALESCE(MAX(retain_until_ns),0) FROM runtime_ai_usage_attempt WHERE account_id=? AND bucket_ns=? AND group_key=?`, record.AccountID, bucket, groupKey).Scan(&pending, &bucketUntil); err != nil {
		return err
	}
	if pending > 0 {
		bucketUntil = 0
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO runtime_ai_usage_minute(account_id,bucket_ns,group_key,retain_until_ns,record_bytes,record) VALUES (?,?,?,?,?,?) ON CONFLICT(account_id,bucket_ns,group_key) DO UPDATE SET retain_until_ns=excluded.retain_until_ns,record_bytes=excluded.record_bytes,record=excluded.record`, record.AccountID, bucket, groupKey, bucketUntil, len(newAggregateBytes), newAggregateBytes); err != nil {
		return err
	}
	newAttempt, newAggregate := 0, 0
	if !previousExists {
		newAttempt = 1
	}
	if !aggregateExists {
		newAggregate = 1
	}
	if _, err := tx.ExecContext(ctx, `UPDATE runtime_ai_accounting_size SET attempt_rows=attempt_rows+?,aggregate_rows=aggregate_rows+?,payload_bytes=payload_bytes+? WHERE singleton=1`, newAttempt, newAggregate, len(encoded)-len(priorBytes)+len(newAggregateBytes)-len(aggregateBytes)); err != nil {
		return err
	}
	return s.enforceRetentionTx(ctx, tx, now)
}

func timeNano(value time.Time) int64 {
	if value.IsZero() {
		return 0
	}
	return value.UnixNano()
}

type bucketIdentity struct {
	account string
	minute  int64
	key     string
}

func (s *Store) enforceRetentionTx(ctx context.Context, tx *sql.Tx, now time.Time) error {
	rows, err := tx.QueryContext(ctx, `SELECT account_id,bucket_ns,group_key FROM runtime_ai_usage_minute WHERE retain_until_ns > 0 AND retain_until_ns < ?`, now.UnixNano())
	if err != nil {
		return err
	}
	var expired []bucketIdentity
	for rows.Next() {
		var item bucketIdentity
		if err := rows.Scan(&item.account, &item.minute, &item.key); err != nil {
			_ = rows.Close()
			return err
		}
		expired = append(expired, item)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range expired {
		if err := deleteBucketTx(ctx, tx, item, false); err != nil {
			return err
		}
	}
	for {
		var attempts, aggregates, bytes int64
		if err := tx.QueryRowContext(ctx, `SELECT attempt_rows,aggregate_rows,payload_bytes FROM runtime_ai_accounting_size WHERE singleton=1`).Scan(&attempts, &aggregates, &bytes); err != nil {
			return err
		}
		if attempts <= MaxRows && aggregates <= MaxRows && bytes <= MaxPayloadBytes {
			break
		}
		var item bucketIdentity
		if err := tx.QueryRowContext(ctx, `SELECT account_id,bucket_ns,group_key FROM runtime_ai_usage_minute ORDER BY CASE WHEN bucket_ns >= ? THEN 1 ELSE 0 END, CASE WHEN retain_until_ns = 0 THEN 1 ELSE 0 END, bucket_ns, account_id, group_key LIMIT 1`, now.Add(-48*time.Hour).UnixNano()).Scan(&item.account, &item.minute, &item.key); err != nil {
			return err
		}
		if err := deleteBucketTx(ctx, tx, item, true); err != nil {
			return err
		}
	}
	return boundHistoryTx(ctx, tx)
}

func deleteBucketTx(ctx context.Context, tx *sql.Tx, item bucketIdentity, forced bool) error {
	var attemptRows, attemptBytes, aggregateBytes int64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(record_bytes),0) FROM runtime_ai_usage_attempt WHERE account_id=? AND bucket_ns=? AND group_key=?`, item.account, item.minute, item.key).Scan(&attemptRows, &attemptBytes); err != nil {
		return err
	}
	if err := tx.QueryRowContext(ctx, `SELECT record_bytes FROM runtime_ai_usage_minute WHERE account_id=? AND bucket_ns=? AND group_key=?`, item.account, item.minute, item.key).Scan(&aggregateBytes); err != nil {
		return err
	}
	if forced {
		rows, err := tx.QueryContext(ctx, `SELECT source,MIN(started_ns),MAX(started_ns) FROM runtime_ai_usage_attempt WHERE account_id=? AND bucket_ns=? AND group_key=? GROUP BY source`, item.account, item.minute, item.key)
		if err != nil {
			return err
		}
		type boundary struct {
			source   string
			from, to int64
		}
		var boundaries []boundary
		for rows.Next() {
			var value boundary
			if err := rows.Scan(&value.source, &value.from, &value.to); err != nil {
				_ = rows.Close()
				return err
			}
			boundaries = append(boundaries, value)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, value := range boundaries {
			if _, err := tx.ExecContext(ctx, `INSERT INTO runtime_ai_accounting_boundary(source,accept_from_ns,coverage_from_ns) VALUES (?,?,0) ON CONFLICT(source) DO UPDATE SET accept_from_ns=MAX(accept_from_ns,excluded.accept_from_ns)`, value.source, value.to+1); err != nil {
				return err
			}
			if err := insertGapTx(ctx, tx, value.source, value.from, value.to+1, "capacity_eviction"); err != nil {
				return err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_ai_usage_attempt WHERE account_id=? AND bucket_ns=? AND group_key=?`, item.account, item.minute, item.key); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_ai_usage_minute WHERE account_id=? AND bucket_ns=? AND group_key=?`, item.account, item.minute, item.key); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE runtime_ai_accounting_size SET attempt_rows=attempt_rows-?,aggregate_rows=aggregate_rows-1,payload_bytes=payload_bytes-? WHERE singleton=1`, attemptRows, attemptBytes+aggregateBytes)
	return err
}

func boundHistoryTx(ctx context.Context, tx *sql.Tx) error {
	for _, table := range []struct{ name, key, end string }{{"runtime_ai_accounting_generation", "generation_id", "ended_ns"}, {"runtime_ai_accounting_gap", "id", "to_ns"}} {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+table.name).Scan(&count); err != nil {
			return err
		}
		if count <= MaxHistory {
			continue
		}
		query := `SELECT MAX(` + table.end + `) FROM (SELECT ` + table.end + ` FROM ` + table.name + ` WHERE ` + table.end + `>0 ORDER BY ` + table.end + `,` + table.key + ` LIMIT ?)`
		var floor sql.NullInt64
		if err := tx.QueryRowContext(ctx, query, count-MaxHistory).Scan(&floor); err != nil {
			return err
		}
		if !floor.Valid {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE runtime_ai_accounting_boundary SET coverage_from_ns=MAX(coverage_from_ns,?) WHERE source='all'`, floor.Int64); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table.name+` WHERE `+table.key+` IN (SELECT `+table.key+` FROM `+table.name+` WHERE `+table.end+`>0 ORDER BY `+table.end+`,`+table.key+` LIMIT ?)`, count-MaxHistory); err != nil {
			return err
		}
	}
	return nil
}
