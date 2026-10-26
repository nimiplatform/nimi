package aitelemetry

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type accountingReadPoint struct {
	generation                    string
	initialized, closed, writeGap bool
	accepted, completed           uint64
	sources                       []*runtimev1.DesktopAISourceCoverage
}

func (s *Store) readPoint() accountingReadPoint {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return accountingReadPoint{generation: s.generation, initialized: s.initialized, closed: s.closed, writeGap: s.writeGap, accepted: s.accepted, completed: s.completed, sources: s.sourceCoverageLocked()}
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-usage-summary
func (s *Store) Summary(ctx context.Context, accountID string, from, to time.Time) (*runtimev1.DesktopAIUsageSummary, error) {
	return s.summary(ctx, accountID, from, to, "")
}

func (s *Store) ConnectorSummary(ctx context.Context, accountID, connectorRef string, from, to time.Time) (*runtimev1.DesktopAIUsageSummary, error) {
	if connectorRef == "" {
		return nil, fmt.Errorf("connection reference is required")
	}
	return s.summary(ctx, accountID, from, to, connectorRef)
}

func (s *Store) summary(ctx context.Context, accountID string, from, to time.Time, connectorRef string) (*runtimev1.DesktopAIUsageSummary, error) {
	if accountID == "" || from.IsZero() || !from.Before(to) || to.Sub(from) > Retention {
		return nil, fmt.Errorf("AI usage requires an ordered interval of at most seven days")
	}
	point := s.readPoint()
	if !point.initialized || s.backend == nil || point.closed {
		return nil, fmt.Errorf("AI accounting is unavailable")
	}
	readAt := s.now().UTC()
	effectiveTo := to
	if readAt.Before(effectiveTo) {
		effectiveTo = readAt
	}
	result := &runtimev1.DesktopAIUsageSummary{GenerationId: point.generation, ReadAt: timestamppb.New(readAt), FromTime: timestamppb.New(from), ToTime: timestamppb.New(to), EffectiveTo: timestamppb.New(effectiveTo), GroupsComplete: true, SourceComplete: true, QuantityComplete: true, Totals: &runtimev1.DesktopAIUsageTotals{}, SourceCoverage: point.sources}
	result.AttributionComplete = true
	for _, source := range result.SourceCoverage {
		if !source.UsageComplete {
			result.SourceComplete = false
			result.PartialReasons = append(result.PartialReasons, "source_uncovered:"+source.Source)
		}
	}
	if !from.Before(effectiveTo) {
		result.QuantityComplete = false
		result.PartialReasons = append(result.PartialReasons, "interval_not_started")
		return result, nil
	}
	tx, err := s.backend.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("begin AI usage read: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	groups := make(map[string]aggregate)
	accumulate := func(key string, value aggregate) error {
		current, ok := groups[key]
		if !ok {
			current = aggregate{Source: value.Source, Capability: value.Capability, Models: value.Models, Route: value.Route}
		}
		if err := addAggregate(&current, value, 1); err != nil {
			return err
		}
		groups[key] = current
		return nil
	}
	if connectorRef != "" {
		// Existing retained attempts are already account/time bounded. Reading
		// their captured attribution avoids rewriting old aggregate identities.
		rows, err := tx.QueryContext(ctx, `SELECT record FROM runtime_ai_usage_attempt WHERE account_id=? AND started_ns>=? AND started_ns<? ORDER BY started_ns,attempt_id`, accountID, from.UnixNano(), effectiveTo.UnixNano())
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var encoded []byte
			if err := rows.Scan(&encoded); err != nil {
				_ = rows.Close()
				return nil, err
			}
			record, err := decodeRecord(encoded)
			if err != nil {
				_ = rows.Close()
				return nil, err
			}
			if record.Route != runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_CLOUD {
				continue
			}
			if record.ConnectorRef == "" {
				result.AttributionComplete = false
				continue
			}
			if record.ConnectorRef != connectorRef {
				continue
			}
			value, key, err := recordAggregate(record)
			if err != nil {
				_ = rows.Close()
				return nil, err
			}
			if err := accumulate(key, value); err != nil {
				_ = rows.Close()
				return nil, err
			}
		}
		err = rows.Err()
		_ = rows.Close()
		if err != nil {
			return nil, err
		}
		if !result.AttributionComplete {
			result.PartialReasons = append(result.PartialReasons, "connector_attribution_incomplete")
		}
	} else {
		fullFrom := from.UTC().Truncate(time.Minute)
		if fullFrom.Before(from) {
			fullFrom = fullFrom.Add(time.Minute)
		}
		fullTo := effectiveTo.UTC().Truncate(time.Minute)
		rows, err := tx.QueryContext(ctx, `SELECT group_key,record FROM runtime_ai_usage_minute WHERE account_id=? AND bucket_ns>=? AND bucket_ns<? ORDER BY bucket_ns,group_key`, accountID, fullFrom.UnixNano(), fullTo.UnixNano())
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var key string
			var encoded []byte
			if err := rows.Scan(&key, &encoded); err != nil {
				_ = rows.Close()
				return nil, err
			}
			var value aggregate
			if err := json.Unmarshal(encoded, &value); err != nil {
				_ = rows.Close()
				return nil, err
			}
			if err := accumulate(key, value); err != nil {
				_ = rows.Close()
				return nil, err
			}
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		// Only edge minutes need per-attempt timestamps. Calendar-midnight ranges
		// remain exact even when the query's read boundary is inside a minute.
		rows, err = tx.QueryContext(ctx, `SELECT record FROM runtime_ai_usage_attempt WHERE account_id=? AND started_ns>=? AND started_ns<? AND (started_ns<? OR started_ns>=?) ORDER BY started_ns,attempt_id`, accountID, from.UnixNano(), effectiveTo.UnixNano(), fullFrom.UnixNano(), fullTo.UnixNano())
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var encoded []byte
			if err := rows.Scan(&encoded); err != nil {
				_ = rows.Close()
				return nil, err
			}
			record, err := decodeRecord(encoded)
			if err != nil {
				_ = rows.Close()
				return nil, err
			}
			value, key, err := recordAggregate(record)
			if err != nil {
				_ = rows.Close()
				return nil, err
			}
			if err := accumulate(key, value); err != nil {
				_ = rows.Close()
				return nil, err
			}
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	total := aggregate{Totals: &runtimev1.DesktopAIUsageTotals{}}
	keys := make([]string, 0, len(groups))
	for key, value := range groups {
		keys = append(keys, key)
		if err := addAggregate(&total, value, 1); err != nil {
			return nil, err
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		left, right := groups[keys[i]], groups[keys[j]]
		if left.Totals.AttemptCount == right.Totals.AttemptCount {
			return keys[i] < keys[j]
		}
		return left.Totals.AttemptCount > right.Totals.AttemptCount
	})
	if len(keys) > MaxGroups {
		keys = keys[:MaxGroups]
		result.GroupsComplete = false
	}
	for _, key := range keys {
		result.Groups = append(result.Groups, groupProjection(groups[key]))
	}
	result.Totals = total.Totals
	result.Estimates = costProjections(total.Costs)
	result.QuantityComplete = total.Totals.PendingUsageCount == 0
	if !result.QuantityComplete {
		result.PartialReasons = append(result.PartialReasons, "usage_pending")
	}
	if total.Totals.UnpricedAttemptCount > 0 {
		result.PartialReasons = append(result.PartialReasons, "unpriced_usage")
	}
	if err := s.coverageTx(ctx, tx, result, from, effectiveTo, point); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("finish AI usage read: %w", err)
	}
	after := s.readPoint()
	if after.writeGap && !point.writeGap {
		result.TimeComplete = false
		result.PartialReasons = append(result.PartialReasons, "accounting_write_failure")
	}
	if point.accepted != point.completed || after.accepted != after.completed || after.accepted != point.accepted || after.completed != point.completed {
		result.TimeComplete = false
		found := false
		for _, reason := range result.PartialReasons {
			if reason == "accounting_pending_writes" {
				found = true
			}
		}
		if !found {
			result.PartialReasons = append(result.PartialReasons, "accounting_pending_writes")
		}
	}
	return result, nil
}

func (s *Store) coverageTx(ctx context.Context, tx *sql.Tx, result *runtimev1.DesktopAIUsageSummary, from, to time.Time, point accountingReadPoint) error {
	reasons := make(map[string]bool)
	for _, reason := range result.PartialReasons {
		reasons[reason] = true
	}
	var floor int64
	if err := tx.QueryRowContext(ctx, `SELECT coverage_from_ns FROM runtime_ai_accounting_boundary WHERE source='all'`).Scan(&floor); err != nil {
		return err
	}
	cursor := from.UnixNano()
	result.TimeComplete = true
	if cursor < floor {
		result.TimeComplete = false
		reasons["before_recording_or_retention"] = true
		cursor = floor
	}
	firstProven, lastProven := int64(0), int64(0)
	rows, err := tx.QueryContext(ctx, `SELECT generation_id,started_ns,ended_ns,clean FROM runtime_ai_accounting_generation WHERE started_ns<? AND (ended_ns=0 OR ended_ns>?) ORDER BY started_ns,generation_id`, to.UnixNano(), from.UnixNano())
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var started, ended int64
		var clean bool
		if err := rows.Scan(&id, &started, &ended, &clean); err != nil {
			_ = rows.Close()
			return err
		}
		live := id == point.generation && !point.closed
		if live {
			ended = to.UnixNano()
			clean = !point.writeGap && point.accepted == point.completed
		}
		if !clean {
			result.TimeComplete = false
			if live && point.accepted != point.completed {
				reasons["accounting_pending_writes"] = true
			} else {
				reasons["unclean_generation"] = true
			}
			continue
		}
		if started > cursor {
			result.TimeComplete = false
			reasons["coverage_gap"] = true
		}
		if ended > cursor {
			cursor = ended
		}
		if firstProven == 0 || started < firstProven {
			firstProven = started
		}
		if ended > lastProven {
			lastProven = ended
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if cursor < to.UnixNano() {
		result.TimeComplete = false
		reasons["coverage_gap"] = true
	}
	rows, err = tx.QueryContext(ctx, `SELECT DISTINCT reason FROM runtime_ai_accounting_gap WHERE from_ns<? AND to_ns>?`, to.UnixNano(), from.UnixNano())
	if err != nil {
		return err
	}
	for rows.Next() {
		var reason string
		if err := rows.Scan(&reason); err != nil {
			_ = rows.Close()
			return err
		}
		reasons[reason] = true
		result.TimeComplete = false
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if point.writeGap {
		result.TimeComplete = false
		reasons["accounting_write_failure"] = true
	}
	if firstProven != 0 {
		result.CoverageFrom = timestamppb.New(time.Unix(0, max(firstProven, from.UnixNano())).UTC())
	}
	if lastProven != 0 {
		result.CoverageTo = timestamppb.New(time.Unix(0, min(lastProven, to.UnixNano())).UTC())
	}
	result.PartialReasons = result.PartialReasons[:0]
	for reason := range reasons {
		result.PartialReasons = append(result.PartialReasons, reason)
	}
	sort.Strings(result.PartialReasons)
	return nil
}
