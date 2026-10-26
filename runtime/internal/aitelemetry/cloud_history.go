package aitelemetry

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var ErrCloudHistoryCursor = errors.New("invalid cloud history cursor")

type cloudHistoryCursor struct {
	Scope   string `json:"scope"`
	Upper   int64  `json:"upper"`
	Started int64  `json:"started"`
	ID      string `json:"id"`
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-cloud-connection-observation
func (s *Store) CloudHistory(ctx context.Context, account, connector string, from, to time.Time, size int, token string) (*runtimev1.ListDesktopAICloudHistoryResponse, error) {
	if account == "" || from.IsZero() || !from.Before(to) || to.Sub(from) > Retention || size < 0 || size > 100 || len(connector) > 512 || strings.TrimSpace(connector) != connector {
		return nil, fmt.Errorf("invalid bounded cloud history query")
	}
	if size == 0 {
		size = 20
	}
	point := s.readPoint()
	if !point.initialized || s.backend == nil || point.closed {
		return nil, fmt.Errorf("AI accounting is unavailable")
	}
	readAt := s.now().UTC()
	upper := to
	if upper.After(readAt) {
		upper = readAt
	}
	identity, _ := json.Marshal([]string{account, connector, from.UTC().Format(time.RFC3339Nano), to.UTC().Format(time.RFC3339Nano)})
	digest := sha256.Sum256(identity)
	scope := hex.EncodeToString(digest[:])
	var cursor cloudHistoryCursor
	if token != "" {
		if len(token) > 2048 {
			return nil, ErrCloudHistoryCursor
		}
		raw, err := base64.RawURLEncoding.DecodeString(token)
		if err != nil || json.Unmarshal(raw, &cursor) != nil || cursor.Scope != scope || cursor.Upper > upper.UnixNano() || cursor.Upper <= from.UnixNano() || cursor.Started < from.UnixNano() || cursor.Started >= cursor.Upper || cursor.ID == "" || len(cursor.ID) > 128 {
			return nil, ErrCloudHistoryCursor
		}
		upper = time.Unix(0, cursor.Upper).UTC()
	}
	response := &runtimev1.ListDesktopAICloudHistoryResponse{ReadAt: timestamppb.New(readAt), AttributionComplete: true, RecordsComplete: true}
	if !from.Before(upper) {
		response.RecordsComplete = false
		response.PartialReasons = []string{"interval_not_started"}
		return response, nil
	}
	tx, err := s.backend.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT record FROM runtime_ai_usage_attempt WHERE account_id=? AND started_ns>=? AND started_ns<? ORDER BY started_ns DESC,attempt_id DESC`, account, from.UnixNano(), upper.UnixNano())
	if err != nil {
		return nil, err
	}
	var last Record
	hasMore := false
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
			response.AttributionComplete = false
		}
		if connector != "" && record.ConnectorRef != connector {
			continue
		}
		if token != "" && (record.StartedAt.UnixNano() > cursor.Started || record.StartedAt.UnixNano() == cursor.Started && record.ID >= cursor.ID) {
			continue
		}
		if len(response.Attempts) >= size {
			hasMore = true
			continue
		}
		response.Attempts = append(response.Attempts, cloudAttemptProjection(record))
		last = record
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return nil, err
	}
	if hasMore {
		raw, _ := json.Marshal(cloudHistoryCursor{Scope: scope, Upper: upper.UnixNano(), Started: last.StartedAt.UnixNano(), ID: last.ID})
		response.NextPageToken = base64.RawURLEncoding.EncodeToString(raw)
	}
	coverage := &runtimev1.DesktopAIUsageSummary{}
	if err := s.coverageTx(ctx, tx, coverage, from, upper, point); err != nil {
		return nil, err
	}
	response.RecordsComplete = coverage.TimeComplete && response.AttributionComplete
	response.PartialReasons = append(response.PartialReasons, coverage.PartialReasons...)
	if !response.AttributionComplete {
		response.PartialReasons = append(response.PartialReasons, "connector_attribution_incomplete")
	}
	for _, source := range point.sources {
		if !source.UsageComplete {
			response.RecordsComplete = false
			response.PartialReasons = append(response.PartialReasons, "source_uncovered:"+source.Source)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	after := s.readPoint()
	if after.accepted != point.accepted || after.completed != point.completed || point.accepted != point.completed || after.writeGap {
		response.RecordsComplete = false
		response.PartialReasons = append(response.PartialReasons, "accounting_pending_or_failed_writes")
	}
	return response, nil
}

func cloudAttemptProjection(record Record) *runtimev1.DesktopAICloudAttempt {
	outcome := record.Outcome
	if record.TerminalAt.IsZero() {
		outcome = runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_RUNNING
		if record.ObservationUnknown {
			outcome = runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_UNKNOWN
		}
	} else if outcome == runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_UNSPECIFIED {
		outcome = runtimev1.DesktopAICloudAttemptOutcome_DESKTOP_AI_CLOUD_ATTEMPT_OUTCOME_UNKNOWN
	}
	result := &runtimev1.DesktopAICloudAttempt{AttemptId: record.ID, ConnectorRef: record.ConnectorRef, SourceKind: record.Source.Kind,
		SourceId: record.Source.ID, SourceLabel: record.Source.Label, ParentWorkId: record.Source.ParentID, ParentWorkKind: record.Source.ParentKind,
		Capability: record.Capability, Models: cloneFacts(record.Facts).Models, StartedAt: timestamppb.New(record.StartedAt), ObservedAt: timestamppb.New(record.ObservedAt),
		Outcome: outcome, ReasonCode: record.ReasonCode, UsageMeasured: record.Usage != nil, Usage: cloneUsage(record.Usage)}
	if !record.TerminalAt.IsZero() {
		result.FinishedAt = timestamppb.New(record.TerminalAt)
	}
	return result
}
