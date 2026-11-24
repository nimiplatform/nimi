package agentsession

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

const (
	defaultDailyAlarmLLMBudgetTokens = int64(50_000)
	alarmOneShotExpiryWindow         = 24 * time.Hour
	alarmAutoSleepUnackThreshold     = 3
	alarmRecentReplyWindow           = 6 * time.Hour
	maxOfflineRecallPointers         = 2
	maxOfflineRecallBytes            = 1536 // 1.5 KiB hard ceiling per v2.1 03 §5.2
)

// AlarmDeliveryOutcome reports the honest four-state Integration receipt after
// delivering an alarm template to a channel (desktop notification / IM channel).
type AlarmDeliveryOutcome struct {
	ReceiptState       runtimev1.AlarmDeliveryReceiptState
	ProviderMessageRef string
	Detail             string
}

// AlarmDeliverySender delivers a rendered deterministic alarm template (or
// optional budgeted LLM output) to one target channel.
type AlarmDeliverySender func(ctx context.Context, accountID string, alarm *runtimev1.SessionAlarmRecord, channel, renderedTitle, renderedBody string, lateBy time.Duration) AlarmDeliveryOutcome

// AlarmLLMRunner runs optional background LLM synthesis when alarm.RequiresLlm == true.
type AlarmLLMRunner func(ctx context.Context, accountID string, alarm *runtimev1.SessionAlarmRecord) (renderedTitle, renderedBody string, tokensUsed int64, err error)

// AlarmFireResult describes the deterministic outcome of firing one due alarm in TickAlarms.
type AlarmFireResult struct {
	AlarmID        string
	StatusAfter    string
	UsedLLM        bool
	TokensUsed     int64
	AutoSlept      bool
	Expired        bool
	BudgetExceeded bool
	LateBy         time.Duration
	Deliveries     []AlarmDeliveryOutcome
}

// AlarmReplyResolution binds a user's reply (e.g. "推到明天") to an exact alarm
// via reply_to_message_ref, or returns candidate alarms for explicit two-choice
// disambiguation when multiple concurrent alarms fired recently.
type AlarmReplyResolution struct {
	MatchedAlarm    *runtimev1.SessionAlarmRecord
	AmbiguousAlarms []*runtimev1.SessionAlarmRecord
	Disclaimer      string
}

func readerCanAccessAlarm(decision accountservice.LocalAppCallerDecision, rec *runtimev1.SessionAlarmRecord) bool {
	if rec == nil {
		return false
	}
	if decision.AppID == "nimi.desktop" || decision.AppID == CorePCBodyAppID {
		return true
	}
	// Third-party delegated Apps (agent.trigger.delegate) ONLY see their own published alarms.
	return rec.GetSourcePublisher() != "" && rec.GetSourcePublisher() == decision.AppID
}

// parseCronField parses a standard 5-field cron component supporting *, */step,
// n, a-b, a-b/step, and comma-separated lists.
func parseCronField(field string, minVal, maxVal int) (map[int]bool, error) {
	trimmed := strings.TrimSpace(field)
	if trimmed == "" {
		return nil, fmt.Errorf("empty cron field")
	}
	allowed := make(map[int]bool)
	parts := strings.Split(trimmed, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			return nil, fmt.Errorf("empty cron segment")
		}
		step := 1
		rangePart := part
		if idx := strings.IndexByte(part, '/'); idx >= 0 {
			rangePart = part[:idx]
			s, err := strconv.Atoi(strings.TrimSpace(part[idx+1:]))
			if err != nil || s <= 0 {
				return nil, fmt.Errorf("invalid cron step %q", part)
			}
			step = s
		}
		var start, end int
		if rangePart == "*" {
			start, end = minVal, maxVal
		} else if dash := strings.IndexByte(rangePart, '-'); dash >= 0 {
			a, err1 := strconv.Atoi(strings.TrimSpace(rangePart[:dash]))
			b, err2 := strconv.Atoi(strings.TrimSpace(rangePart[dash+1:]))
			if err1 != nil || err2 != nil || a < minVal || b > maxVal || a > b {
				return nil, fmt.Errorf("invalid cron range %q", part)
			}
			start, end = a, b
		} else {
			v, err := strconv.Atoi(strings.TrimSpace(rangePart))
			if err != nil || v < minVal || v > maxVal {
				return nil, fmt.Errorf("invalid cron value %q", part)
			}
			start, end = v, v
		}
		for v := start; v <= end; v += step {
			allowed[v] = true
		}
	}
	if len(allowed) == 0 {
		return nil, fmt.Errorf("cron field matched no values")
	}
	return allowed, nil
}

type parsedCron struct {
	minutes map[int]bool
	hours   map[int]bool
	dom     map[int]bool
	months  map[int]bool
	dow     map[int]bool
	loc     *time.Location
}

func parseFiveFieldCron(expr, tzName string) (*parsedCron, error) {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return nil, fmt.Errorf("cron expression must have exactly 5 fields, got %d", len(fields))
	}
	tz := strings.TrimSpace(tzName)
	if tz == "" {
		tz = "UTC"
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, fmt.Errorf("invalid IANA timezone %q: %w", tz, err)
	}
	mins, err := parseCronField(fields[0], 0, 59)
	if err != nil {
		return nil, err
	}
	hrs, err := parseCronField(fields[1], 0, 23)
	if err != nil {
		return nil, err
	}
	dom, err := parseCronField(fields[2], 1, 31)
	if err != nil {
		return nil, err
	}
	months, err := parseCronField(fields[3], 1, 12)
	if err != nil {
		return nil, err
	}
	dow, err := parseCronField(fields[4], 0, 7)
	if err != nil {
		return nil, err
	}
	if dow[7] {
		dow[0] = true
	}
	return &parsedCron{minutes: mins, hours: hrs, dom: dom, months: months, dow: dow, loc: loc}, nil
}

// nextAfter returns the earliest minute strictly after `after` matching the cron expression in its IANA timezone.
func (c *parsedCron) nextAfter(after time.Time) (time.Time, error) {
	t := after.In(c.loc).Truncate(time.Minute).Add(time.Minute)
	limit := t.Add(366 * 24 * time.Hour)
	for !t.After(limit) {
		if !c.months[int(t.Month())] {
			t = time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, c.loc)
			continue
		}
		if !c.dom[t.Day()] || !c.dow[int(t.Weekday())] {
			t = time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, c.loc)
			continue
		}
		if !c.hours[t.Hour()] {
			t = time.Date(t.Year(), t.Month(), t.Day(), t.Hour()+1, 0, 0, 0, c.loc)
			continue
		}
		if !c.minutes[t.Minute()] {
			t = t.Add(time.Minute)
			continue
		}
		return t.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("no matching cron fire time within 366 days")
}

func scanAlarmRow(scanner interface{ Scan(dest ...any) error }) (*runtimev1.SessionAlarmRecord, string, error) {
	rec := &runtimev1.SessionAlarmRecord{}
	var (
		accountID         string
		alarmKind         int32
		requiresLLM       int
		channelsJSON      string
		lastReceiptState  int32
		unackStreak       int32
	)
	err := scanner.Scan(
		&rec.AlarmId,
		&accountID,
		&rec.AgentBinding,
		&rec.TargetWorkSessionRef,
		&alarmKind,
		&rec.CronExpr,
		&rec.TimeZone,
		&rec.SourcePublisher,
		&rec.SourceObjectId,
		&rec.SourceObjectVersion,
		&rec.TemplateTitle,
		&rec.TemplateBody,
		&rec.TemplatePayloadJson,
		&requiresLLM,
		&channelsJSON,
		&rec.Status,
		&unackStreak,
		&rec.NextFireAt,
		&rec.Version,
		&rec.ExpiresAt,
		&lastReceiptState,
		&rec.LastDeliveryAt,
	)
	if err != nil {
		return nil, "", err
	}
	rec.AlarmKind = runtimev1.AlarmKind(alarmKind)
	rec.RequiresLlm = requiresLLM != 0
	rec.UnackStreak = unackStreak
	rec.LastReceiptState = runtimev1.AlarmDeliveryReceiptState(lastReceiptState)
	if strings.TrimSpace(channelsJSON) != "" {
		_ = json.Unmarshal([]byte(channelsJSON), &rec.DeliveryChannels)
	}
	return rec, accountID, nil
}

const alarmSelectColumns = `
	alarm_id, account_id, agent_binding, target_work_session_ref, alarm_kind,
	cron_expr, time_zone, source_publisher, source_object_id, source_object_version,
	template_title, template_body, template_payload_json, requires_llm,
	delivery_channels_json, status, unack_streak, next_fire_at, version,
	expires_at, last_receipt_state, last_delivery_at`

// CreateAlarm creates a deterministic alarm (`at`, `delay`, `cron`) or an
// authorized App trigger delegation (`app_delegation`, NEVER abusing app.activity).
// @nimi-authority: rule.nimi.runtime.agent-participation.deterministic-alarms
func (s *Service) CreateAlarm(ctx context.Context, req *runtimev1.CreateAlarmRequest) (*runtimev1.CreateAlarmResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentTriggerAlarmCreate)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetAgentHandle()) == "" || req.GetAlarmKind() == runtimev1.AlarmKind_ALARM_KIND_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	now := s.now().UTC()
	tz := strings.TrimSpace(req.GetTimeZone())
	if tz == "" {
		tz = "UTC"
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	var nextFire time.Time
	cronExpr := strings.TrimSpace(req.GetCronExpr())
	sourcePublisher := ""
	sourceObjectID := strings.TrimSpace(req.GetSourceObjectId())
	sourceObjectVersion := strings.TrimSpace(req.GetSourceObjectVersion())

	switch req.GetAlarmKind() {
	case runtimev1.AlarmKind_ALARM_KIND_AT:
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(req.GetFireAt()))
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		nextFire = t.UTC()
	case runtimev1.AlarmKind_ALARM_KIND_DELAY:
		if req.GetDelaySeconds() <= 0 {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		nextFire = now.Add(time.Duration(req.GetDelaySeconds()) * time.Second)
	case runtimev1.AlarmKind_ALARM_KIND_CRON:
		parsed, err := parseFiveFieldCron(cronExpr, tz)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		nextFire, err = parsed.nextAfter(now)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.AlarmKind_ALARM_KIND_APP_DELEGATION:
		if sourceObjectID == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		sourcePublisher = decision.AppID
		if rawAt := strings.TrimSpace(req.GetFireAt()); rawAt != "" {
			t, err := time.Parse(time.RFC3339, rawAt)
			if err != nil {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
			nextFire = t.UTC()
		} else if cronExpr != "" {
			parsed, err := parseFiveFieldCron(cronExpr, tz)
			if err != nil {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
			nextFire, err = parsed.nextAfter(now)
			if err != nil {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
		} else if req.GetDelaySeconds() > 0 {
			nextFire = now.Add(time.Duration(req.GetDelaySeconds()) * time.Second)
		} else {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	channels := req.GetDeliveryChannels()
	if len(channels) == 0 {
		channels = []string{"desktop_notification"}
	}
	channelsJSON, _ := json.Marshal(channels)
	payloadJSON := strings.TrimSpace(req.GetTemplatePayloadJson())
	if payloadJSON == "" {
		payloadJSON = "{}"
	}

	rec := &runtimev1.SessionAlarmRecord{
		AlarmId:              newID("alarm"),
		AgentBinding:         strings.TrimSpace(req.GetAgentHandle()),
		TargetWorkSessionRef: strings.TrimSpace(req.GetTargetWorkSessionRef()),
		AlarmKind:            req.GetAlarmKind(),
		CronExpr:             cronExpr,
		TimeZone:             tz,
		SourcePublisher:      sourcePublisher,
		SourceObjectId:       sourceObjectID,
		SourceObjectVersion:  sourceObjectVersion,
		TemplateTitle:        strings.TrimSpace(req.GetTemplateTitle()),
		TemplateBody:         strings.TrimSpace(req.GetTemplateBody()),
		TemplatePayloadJson:  payloadJSON,
		RequiresLlm:          req.GetRequiresLlm(),
		DeliveryChannels:     channels,
		Status:               "active",
		UnackStreak:          0,
		NextFireAt:           formatRFC3339(nextFire),
		Version:              1,
		ExpiresAt:            strings.TrimSpace(req.GetExpiresAt()),
		LastReceiptState:     runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_UNSPECIFIED,
	}

	saved, err := s.store.UpsertAlarm(ctx, decision.AccountID, rec, string(channelsJSON), now)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	return &runtimev1.CreateAlarmResponse{Alarm: saved}, nil
}

func (st *Store) UpsertAlarm(ctx context.Context, accountID string, rec *runtimev1.SessionAlarmRecord, channelsJSON string, now time.Time) (*runtimev1.SessionAlarmRecord, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	nowStr := formatRFC3339(now)
	reqLLM := 0
	if rec.GetRequiresLlm() {
		reqLLM = 1
	}

	// Idempotent upsert for app_delegation keyed by (account_id, source_publisher, source_object_id).
	if rec.GetSourceObjectId() != "" && rec.GetSourcePublisher() != "" {
		var existingID string
		var existingVersion int64
		err := tx.QueryRowContext(ctx, `
			SELECT alarm_id, version FROM runtime_session_alarm
			WHERE account_id = ? AND source_publisher = ? AND source_object_id = ?`,
			accountID, rec.GetSourcePublisher(), rec.GetSourceObjectId(),
		).Scan(&existingID, &existingVersion)
		if err == nil {
			rec.AlarmId = existingID
			rec.Version = existingVersion + 1
			if _, err := tx.ExecContext(ctx, `
				UPDATE runtime_session_alarm
				SET agent_binding = ?, target_work_session_ref = ?, alarm_kind = ?,
				    cron_expr = ?, time_zone = ?, source_object_version = ?,
				    template_title = ?, template_body = ?, template_payload_json = ?,
				    requires_llm = ?, delivery_channels_json = ?, status = 'active',
				    unack_streak = 0, next_fire_at = ?, version = ?, expires_at = ?, updated_at = ?
				WHERE alarm_id = ? AND account_id = ?`,
				rec.AgentBinding, rec.TargetWorkSessionRef, int32(rec.AlarmKind),
				rec.CronExpr, rec.TimeZone, rec.SourceObjectVersion,
				rec.TemplateTitle, rec.TemplateBody, rec.TemplatePayloadJson,
				reqLLM, channelsJSON, rec.NextFireAt, rec.Version, rec.ExpiresAt, nowStr,
				existingID, accountID,
			); err != nil {
				return nil, err
			}
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return rec, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO runtime_session_alarm(
			alarm_id, account_id, agent_binding, target_work_session_ref, alarm_kind,
			cron_expr, time_zone, source_publisher, source_object_id, source_object_version,
			template_title, template_body, template_payload_json, requires_llm,
			delivery_channels_json, status, unack_streak, next_fire_at, version,
			expires_at, last_receipt_state, last_delivery_at, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, 1, ?, 0, '', ?, ?)`,
		rec.AlarmId, accountID, rec.AgentBinding, rec.TargetWorkSessionRef, int32(rec.AlarmKind),
		rec.CronExpr, rec.TimeZone, rec.SourcePublisher, rec.SourceObjectId, rec.SourceObjectVersion,
		rec.TemplateTitle, rec.TemplateBody, rec.TemplatePayloadJson, reqLLM,
		channelsJSON, rec.NextFireAt, rec.ExpiresAt, nowStr, nowStr,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) ListAlarms(ctx context.Context, req *runtimev1.ListAlarmsRequest) (*runtimev1.ListAlarmsResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentTriggerAlarmList)
	if err != nil {
		return nil, err
	}
	if req == nil {
		req = &runtimev1.ListAlarmsRequest{}
	}
	all, err := s.store.ListAlarms(ctx, decision.AccountID, req.GetAgentHandle(), req.GetTargetWorkSessionRef(), req.GetIncludeInactive())
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	var visible []*runtimev1.SessionAlarmRecord
	for _, rec := range all {
		if readerCanAccessAlarm(decision, rec) {
			visible = append(visible, rec)
		}
	}
	return &runtimev1.ListAlarmsResponse{Alarms: visible}, nil
}

func (st *Store) ListAlarms(ctx context.Context, accountID, agentBinding, targetWorkSessionRef string, includeInactive bool) ([]*runtimev1.SessionAlarmRecord, error) {
	where := []string{`account_id = ?`}
	args := []any{accountID}
	if strings.TrimSpace(agentBinding) != "" {
		where = append(where, `agent_binding = ?`)
		args = append(args, strings.TrimSpace(agentBinding))
	}
	if strings.TrimSpace(targetWorkSessionRef) != "" {
		where = append(where, `target_work_session_ref = ?`)
		args = append(args, strings.TrimSpace(targetWorkSessionRef))
	}
	if !includeInactive {
		where = append(where, `status IN ('active', 'sleeping', 'paused')`)
	}
	rows, err := st.readDB.QueryContext(ctx,
		`SELECT `+alarmSelectColumns+` FROM runtime_session_alarm WHERE `+strings.Join(where, " AND ")+` ORDER BY next_fire_at ASC`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*runtimev1.SessionAlarmRecord
	for rows.Next() {
		rec, _, err := scanAlarmRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *Service) UpdateAlarm(ctx context.Context, req *runtimev1.UpdateAlarmRequest) (*runtimev1.UpdateAlarmResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentTriggerAlarmUpdate)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetAlarmId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	existing, err := s.store.GetAlarm(ctx, decision.AccountID, strings.TrimSpace(req.GetAlarmId()))
	if errors.Is(err, errSessionNotFound) || !readerCanAccessAlarm(decision, existing) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if req.GetExpectedVersion() > 0 && existing.GetVersion() != req.GetExpectedVersion() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}

	now := s.now().UTC()
	if req.Status != nil {
		existing.Status = strings.TrimSpace(req.GetStatus())
	}
	if req.TimeZone != nil {
		tz := strings.TrimSpace(req.GetTimeZone())
		if _, err := time.LoadLocation(tz); err != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		existing.TimeZone = tz
	}
	if req.FireAt != nil {
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(req.GetFireAt()))
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		existing.NextFireAt = formatRFC3339(t.UTC())
	}
	if req.CronExpr != nil {
		parsed, err := parseFiveFieldCron(req.GetCronExpr(), existing.GetTimeZone())
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		nextFire, err := parsed.nextAfter(now)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		existing.CronExpr = strings.TrimSpace(req.GetCronExpr())
		existing.NextFireAt = formatRFC3339(nextFire)
	}
	if req.SourceObjectVersion != nil {
		existing.SourceObjectVersion = strings.TrimSpace(req.GetSourceObjectVersion())
	}
	if req.TemplateTitle != nil {
		existing.TemplateTitle = strings.TrimSpace(req.GetTemplateTitle())
	}
	if req.TemplateBody != nil {
		existing.TemplateBody = strings.TrimSpace(req.GetTemplateBody())
	}
	if req.TemplatePayloadJson != nil {
		existing.TemplatePayloadJson = strings.TrimSpace(req.GetTemplatePayloadJson())
	}
	if req.RequiresLlm != nil {
		existing.RequiresLlm = req.GetRequiresLlm()
	}
	if len(req.GetDeliveryChannels()) > 0 {
		existing.DeliveryChannels = append([]string(nil), req.GetDeliveryChannels()...)
	}
	if req.GetResetUnackStreak() {
		existing.UnackStreak = 0
		if existing.Status == "sleeping" {
			existing.Status = "active"
		}
	}

	updated, err := s.store.UpdateAlarmWithVersion(ctx, decision.AccountID, existing, req.GetExpectedVersion(), now)
	if errors.Is(err, errLeaseConflict) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	return &runtimev1.UpdateAlarmResponse{Alarm: updated}, nil
}

func (s *Service) DeleteAlarm(ctx context.Context, req *runtimev1.DeleteAlarmRequest) (*runtimev1.DeleteAlarmResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentTriggerAlarmDelete)
	if err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.GetAlarmId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	existing, err := s.store.GetAlarm(ctx, decision.AccountID, strings.TrimSpace(req.GetAlarmId()))
	if errors.Is(err, errSessionNotFound) || !readerCanAccessAlarm(decision, existing) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if req.GetExpectedVersion() > 0 && existing.GetVersion() != req.GetExpectedVersion() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}
	if err := s.store.CancelAlarm(ctx, decision.AccountID, existing.GetAlarmId(), s.now().UTC()); err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	return &runtimev1.DeleteAlarmResponse{AlarmId: existing.GetAlarmId(), Deleted: true}, nil
}

func (st *Store) GetAlarm(ctx context.Context, accountID, alarmID string) (*runtimev1.SessionAlarmRecord, error) {
	row := st.readDB.QueryRowContext(ctx,
		`SELECT `+alarmSelectColumns+` FROM runtime_session_alarm WHERE account_id = ? AND alarm_id = ?`,
		accountID, alarmID,
	)
	rec, _, err := scanAlarmRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errSessionNotFound
	}
	return rec, err
}

func (st *Store) UpdateAlarmWithVersion(ctx context.Context, accountID string, rec *runtimev1.SessionAlarmRecord, expectedVersion int64, now time.Time) (*runtimev1.SessionAlarmRecord, error) {
	channelsJSON, _ := json.Marshal(rec.GetDeliveryChannels())
	reqLLM := 0
	if rec.GetRequiresLlm() {
		reqLLM = 1
	}
	nextVersion := rec.Version + 1
	var (
		res sql.Result
		err error
	)
	if expectedVersion > 0 {
		res, err = st.writeDB.ExecContext(ctx, `
			UPDATE runtime_session_alarm
			SET status = ?, cron_expr = ?, time_zone = ?, source_object_version = ?,
			    template_title = ?, template_body = ?, template_payload_json = ?,
			    requires_llm = ?, delivery_channels_json = ?, unack_streak = ?,
			    next_fire_at = ?, version = ?, updated_at = ?
			WHERE account_id = ? AND alarm_id = ? AND version = ?`,
			rec.Status, rec.CronExpr, rec.TimeZone, rec.SourceObjectVersion,
			rec.TemplateTitle, rec.TemplateBody, rec.TemplatePayloadJson,
			reqLLM, string(channelsJSON), rec.UnackStreak,
			rec.NextFireAt, nextVersion, formatRFC3339(now),
			accountID, rec.AlarmId, expectedVersion,
		)
	} else {
		res, err = st.writeDB.ExecContext(ctx, `
			UPDATE runtime_session_alarm
			SET status = ?, cron_expr = ?, time_zone = ?, source_object_version = ?,
			    template_title = ?, template_body = ?, template_payload_json = ?,
			    requires_llm = ?, delivery_channels_json = ?, unack_streak = ?,
			    next_fire_at = ?, version = ?, updated_at = ?
			WHERE account_id = ? AND alarm_id = ?`,
			rec.Status, rec.CronExpr, rec.TimeZone, rec.SourceObjectVersion,
			rec.TemplateTitle, rec.TemplateBody, rec.TemplatePayloadJson,
			reqLLM, string(channelsJSON), rec.UnackStreak,
			rec.NextFireAt, nextVersion, formatRFC3339(now),
			accountID, rec.AlarmId,
		)
	}
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, errLeaseConflict
	}
	rec.Version = nextVersion
	return rec, nil
}

func (st *Store) CancelAlarm(ctx context.Context, accountID, alarmID string, now time.Time) error {
	_, err := st.writeDB.ExecContext(ctx, `
		UPDATE runtime_session_alarm
		SET status = 'cancelled', version = version + 1, updated_at = ?
		WHERE account_id = ? AND alarm_id = ?`,
		formatRFC3339(now), accountID, alarmID,
	)
	return err
}

func (st *Store) dailyAlarmLLMTokensUsed(ctx context.Context, accountID string, day string) (int64, error) {
	key := "alarm_llm_tokens:" + accountID + ":" + day
	var raw string
	err := st.readDB.QueryRowContext(ctx, `SELECT value FROM runtime_session_meta WHERE key = ?`, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	v, _ := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	return v, nil
}

func (st *Store) addDailyAlarmLLMTokensUsed(ctx context.Context, accountID string, day string, delta int64) error {
	if delta <= 0 {
		return nil
	}
	current, err := st.dailyAlarmLLMTokensUsed(ctx, accountID, day)
	if err != nil {
		return err
	}
	key := "alarm_llm_tokens:" + accountID + ":" + day
	_, err = st.writeDB.ExecContext(ctx, `
		INSERT INTO runtime_session_meta(key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, strconv.FormatInt(current+delta, 10),
	)
	return err
}

// TickAlarms evaluates all due active alarms as of `now` with:
//   - Zero-model deterministic template delivery by default (requires_llm == false)
//   - Wake coalescing (cron fires AT MOST once for missed intervals; one-shot expires after 24h)
//   - Fatigue auto-sleep at unack_streak >= 3
//   - Daily background LLM token budget enforcement when requires_llm == true
//   - Honest four-state Integration delivery receipts persisted to runtime_alarm_delivery
//
// @nimi-authority: rule.nimi.runtime.agent-participation.deterministic-alarms
func (s *Service) TickAlarms(ctx context.Context, now time.Time) ([]AlarmFireResult, error) {
	nowUTC := now.UTC()
	nowStr := formatRFC3339(nowUTC)
	rows, err := s.store.readDB.QueryContext(ctx, `
		SELECT `+alarmSelectColumns+`
		FROM runtime_session_alarm
		WHERE status = 'active' AND next_fire_at != '' AND next_fire_at <= ?
		ORDER BY next_fire_at ASC LIMIT 100`,
		nowStr,
	)
	if err != nil {
		return nil, err
	}
	type dueItem struct {
		alarm     *runtimev1.SessionAlarmRecord
		accountID string
	}
	var due []dueItem
	for rows.Next() {
		rec, accID, scanErr := scanAlarmRow(rows)
		if scanErr != nil {
			_ = rows.Close()
			return nil, scanErr
		}
		due = append(due, dueItem{alarm: rec, accountID: accID})
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	s.mu.Lock()
	sender := s.alarmDeliverySender
	llmRunner := s.alarmLLMRunner
	dailyBudget := s.dailyAlarmLLMBudgetTokens
	s.mu.Unlock()
	if dailyBudget <= 0 {
		dailyBudget = defaultDailyAlarmLLMBudgetTokens
	}

	dayKey := nowUTC.Format("2006-01-02")
	var results []AlarmFireResult

	for _, item := range due {
		alarm := item.alarm
		accID := item.accountID
		scheduledAt := parseRFC3339(alarm.GetNextFireAt())
		lateBy := nowUTC.Sub(scheduledAt)
		if lateBy < 0 {
			lateBy = 0
		}
		isRecurring := alarm.GetAlarmKind() == runtimev1.AlarmKind_ALARM_KIND_CRON || (alarm.GetAlarmKind() == runtimev1.AlarmKind_ALARM_KIND_APP_DELEGATION && strings.TrimSpace(alarm.GetCronExpr()) != "")

		// Expiry check for explicit expires_at or > 24h missed one-shot alarms.
		if exp := strings.TrimSpace(alarm.GetExpiresAt()); exp != "" && nowUTC.After(parseRFC3339(exp)) {
			_, _ = s.store.writeDB.ExecContext(ctx, `UPDATE runtime_session_alarm SET status = 'expired', version = version + 1, updated_at = ? WHERE alarm_id = ?`, nowStr, alarm.GetAlarmId())
			results = append(results, AlarmFireResult{AlarmID: alarm.GetAlarmId(), StatusAfter: "expired", Expired: true, LateBy: lateBy})
			continue
		}
		if !isRecurring && lateBy > alarmOneShotExpiryWindow {
			_, _ = s.store.writeDB.ExecContext(ctx, `UPDATE runtime_session_alarm SET status = 'expired', version = version + 1, updated_at = ? WHERE alarm_id = ?`, nowStr, alarm.GetAlarmId())
			results = append(results, AlarmFireResult{AlarmID: alarm.GetAlarmId(), StatusAfter: "expired", Expired: true, LateBy: lateBy})
			continue
		}

		// Render content: zero-model template by default; optional budgeted LLM only when requires_llm == true.
		renderedTitle := alarm.GetTemplateTitle()
		renderedBody := alarm.GetTemplateBody()
		usedLLM := false
		tokensUsed := int64(0)
		budgetExceeded := false
		if alarm.GetRequiresLlm() {
			usedToday, _ := s.store.dailyAlarmLLMTokensUsed(ctx, accID, dayKey)
			if usedToday >= dailyBudget {
				budgetExceeded = true
			} else if llmRunner != nil {
				t, b, toks, llmErr := llmRunner(ctx, accID, alarm)
				if llmErr == nil {
					if strings.TrimSpace(t) != "" {
						renderedTitle = t
					}
					if strings.TrimSpace(b) != "" {
						renderedBody = b
					}
					usedLLM = true
					tokensUsed = toks
					_ = s.store.addDailyAlarmLLMTokensUsed(ctx, accID, dayKey, toks)
				}
			}
		}
		if budgetExceeded {
			// Record honest rejected delivery receipt and advance schedule without spinning.
			_, _ = s.store.writeDB.ExecContext(ctx, `
				INSERT INTO runtime_alarm_delivery(delivery_id, alarm_id, account_id, channel, receipt_state, provider_message_ref, detail, fired_at, updated_at)
				VALUES (?, ?, ?, 'llm_budget', ?, '', 'AGENT_ALARM_BUDGET_EXCEEDED', ?, ?)`,
				newID("dlv"), alarm.GetAlarmId(), accID,
				int32(runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED), nowStr, nowStr,
			)
			nextStatus, nextFireStr := s.computePostFireSchedule(alarm, isRecurring, nowUTC, alarm.GetUnackStreak())
			_, _ = s.store.writeDB.ExecContext(ctx, `
				UPDATE runtime_session_alarm
				SET status = ?, next_fire_at = ?, last_receipt_state = ?, last_delivery_at = ?, version = version + 1, updated_at = ?
				WHERE alarm_id = ?`,
				nextStatus, nextFireStr, int32(runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED), nowStr, nowStr, alarm.GetAlarmId(),
			)
			results = append(results, AlarmFireResult{
				AlarmID:        alarm.GetAlarmId(),
				StatusAfter:    nextStatus,
				BudgetExceeded: true,
				LateBy:         lateBy,
				Deliveries:     []AlarmDeliveryOutcome{{ReceiptState: runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED, Detail: "AGENT_ALARM_BUDGET_EXCEEDED"}},
			})
			continue
		}

		if lateBy >= time.Minute {
			renderedBody = fmt.Sprintf("%s (delayed by %dm)", renderedBody, int(lateBy.Minutes()))
		}

		channels := alarm.GetDeliveryChannels()
		if len(channels) == 0 {
			channels = []string{"desktop_notification"}
		}
		var deliveries []AlarmDeliveryOutcome
		lastState := runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_PROVIDER_ACCEPTED
		for _, ch := range channels {
			var outcome AlarmDeliveryOutcome
			if sender != nil {
				outcome = sender(ctx, accID, alarm, ch, renderedTitle, renderedBody, lateBy)
				if outcome.ReceiptState == runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_UNSPECIFIED {
					outcome.ReceiptState = runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_EFFECT_UNKNOWN
				}
			} else {
				outcome = AlarmDeliveryOutcome{
					ReceiptState:       runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_PROVIDER_ACCEPTED,
					ProviderMessageRef: newID("msg"),
					Detail:             "local_template_delivered",
				}
			}
			lastState = outcome.ReceiptState
			deliveries = append(deliveries, outcome)
			_, _ = s.store.writeDB.ExecContext(ctx, `
				INSERT INTO runtime_alarm_delivery(delivery_id, alarm_id, account_id, channel, receipt_state, provider_message_ref, detail, fired_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				newID("dlv"), alarm.GetAlarmId(), accID, ch, int32(outcome.ReceiptState),
				strings.TrimSpace(outcome.ProviderMessageRef), strings.TrimSpace(outcome.Detail), nowStr, nowStr,
			)
		}

		nextUnack := alarm.GetUnackStreak() + 1
		nextStatus, nextFireStr := s.computePostFireSchedule(alarm, isRecurring, nowUTC, nextUnack)
		autoSlept := isRecurring && nextStatus == "sleeping"
		_, _ = s.store.writeDB.ExecContext(ctx, `
			UPDATE runtime_session_alarm
			SET status = ?, unack_streak = ?, next_fire_at = ?, last_receipt_state = ?, last_delivery_at = ?, version = version + 1, updated_at = ?
			WHERE alarm_id = ?`,
			nextStatus, nextUnack, nextFireStr, int32(lastState), nowStr, nowStr, alarm.GetAlarmId(),
		)

		results = append(results, AlarmFireResult{
			AlarmID:     alarm.GetAlarmId(),
			StatusAfter: nextStatus,
			UsedLLM:     usedLLM,
			TokensUsed:  tokensUsed,
			AutoSlept:   autoSlept,
			LateBy:      lateBy,
			Deliveries:  deliveries,
		})
	}
	return results, nil
}

func (s *Service) computePostFireSchedule(alarm *runtimev1.SessionAlarmRecord, isRecurring bool, nowUTC time.Time, nextUnack int32) (status string, nextFireStr string) {
	if !isRecurring {
		return "completed", ""
	}
	// Wake coalescing: compute strictly next fire strictly AFTER nowUTC so multiple missed intervals fire at most once!
	nextFireStr = ""
	if parsed, err := parseFiveFieldCron(alarm.GetCronExpr(), alarm.GetTimeZone()); err == nil {
		if nf, err := parsed.nextAfter(nowUTC); err == nil {
			nextFireStr = formatRFC3339(nf)
		}
	}
	if nextUnack >= alarmAutoSleepUnackThreshold {
		return "sleeping", nextFireStr
	}
	return "active", nextFireStr
}

// ResolveAlarmReplyTarget resolves which alarm a user's external/IM reply refers
// to: first by exact reply_to_message_ref in runtime_alarm_delivery; if omitted
// and >= 2 alarms delivered within the recent window, returns all candidates for
// explicit two-choice confirmation without guessing.
func (s *Service) ResolveAlarmReplyTarget(ctx context.Context, accountID, agentBinding, replyToMessageRef string, now time.Time) (AlarmReplyResolution, error) {
	disclaimer := "Modifying this reminder updates only your personal alarm schedule and does not alter third-party App business bookings."
	if ref := strings.TrimSpace(replyToMessageRef); ref != "" {
		var alarmID string
		err := s.store.readDB.QueryRowContext(ctx, `
			SELECT alarm_id FROM runtime_alarm_delivery
			WHERE account_id = ? AND provider_message_ref = ?
			ORDER BY fired_at DESC LIMIT 1`,
			accountID, ref,
		).Scan(&alarmID)
		if err == nil && alarmID != "" {
			rec, getErr := s.store.GetAlarm(ctx, accountID, alarmID)
			if getErr == nil {
				return AlarmReplyResolution{MatchedAlarm: rec, Disclaimer: disclaimer}, nil
			}
		}
	}

	cutoff := formatRFC3339(now.UTC().Add(-alarmRecentReplyWindow))
	rows, err := s.store.readDB.QueryContext(ctx, `
		SELECT DISTINCT `+alarmSelectColumns+`
		FROM runtime_session_alarm
		WHERE account_id = ? AND agent_binding = ?
		  AND last_delivery_at != '' AND last_delivery_at >= ?
		  AND status IN ('active', 'sleeping', 'completed')
		ORDER BY last_delivery_at DESC LIMIT 5`,
		accountID, strings.TrimSpace(agentBinding), cutoff,
	)
	if err != nil {
		return AlarmReplyResolution{}, err
	}
	defer func() { _ = rows.Close() }()
	var recent []*runtimev1.SessionAlarmRecord
	for rows.Next() {
		rec, _, scanErr := scanAlarmRow(rows)
		if scanErr != nil {
			return AlarmReplyResolution{}, scanErr
		}
		recent = append(recent, rec)
	}
	if err := rows.Err(); err != nil {
		return AlarmReplyResolution{}, err
	}
	if len(recent) == 1 {
		return AlarmReplyResolution{MatchedAlarm: recent[0], Disclaimer: disclaimer}, nil
	}
	if len(recent) >= 2 {
		return AlarmReplyResolution{AmbiguousAlarms: recent, Disclaimer: disclaimer}, nil
	}
	return AlarmReplyResolution{Disclaimer: disclaimer}, nil
}

// OfflineRecallPointer represents a recalled Cognition v5 session_ref pointer.
type OfflineRecallPointer struct {
	WorkSessionRef string
	TopicSummary   string
	Score          float64
}

// BuildOfflineSessionRecallInjection performs Stage 3's two-phase offline
// secondary receipt lookup from sessions.db:
//   - Authorizes each pointer against current reader, Agent binding, trust tier, and non-deleted state
//   - Reads latest_receipt_json directly from sessions.db (works 100% offline with Harness closed!)
//   - Caps to Top-2 pointers and <= 1.5 KiB total non-instruction data frame
//
// @nimi-authority: rule.nimi.runtime.memory-world.session-pointer-recall
func (s *Service) BuildOfflineSessionRecallInjection(
	ctx context.Context,
	decision accountservice.LocalAppCallerDecision,
	agentBinding string,
	pointers []OfflineRecallPointer,
) (string, []string, error) {
	if len(pointers) == 0 {
		return "", nil, nil
	}
	sorted := append([]OfflineRecallPointer(nil), pointers...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].Score > sorted[j].Score
	})

	type entry struct {
		WorkSessionRef string `json:"workSessionRef"`
		Title          string `json:"title"`
		Status         string `json:"status"`
		UpdatedAt      string `json:"updatedAt"`
		Receipt        string `json:"latestReceipt"`
	}

	var entries []entry
	var includedRefs []string
	totalBytes := 0

	for _, ptr := range sorted {
		if len(entries) >= maxOfflineRecallPointers {
			break
		}
		ref := strings.TrimSpace(ptr.WorkSessionRef)
		if ref == "" {
			continue
		}
		sess, err := s.store.GetSession(ctx, decision.AccountID, ref)
		if err != nil || sess == nil || sess.DeletedAt != "" {
			continue
		}
		if strings.TrimSpace(agentBinding) != "" && sess.Record.GetAgentBinding() != strings.TrimSpace(agentBinding) {
			continue
		}
		if !readerCanAccessSession(decision, sess.Record) {
			// Unauthorized pointer titles MUST NEVER enter model context!
			continue
		}
		if sess.Record.GetTrustTier() != "trusted" || sess.Record.GetSessionKind() == "channel_external" {
			// Taint-gated external/untrusted channel receipts are never injected into trusted recall.
			continue
		}
		receipt := strings.TrimSpace(sess.Record.GetLatestReceiptJson())
		if len(receipt) > 512 {
			receipt = receipt[:512]
		}
		item := entry{
			WorkSessionRef: ref,
			Title:          sess.Record.GetTitle(),
			Status:         sess.Record.GetStatus(),
			UpdatedAt:      sess.Record.GetUpdatedAt(),
			Receipt:        receipt,
		}
		encoded, _ := json.Marshal(item)
		if totalBytes+len(encoded) > maxOfflineRecallBytes-96 {
			break
		}
		totalBytes += len(encoded)
		entries = append(entries, item)
		includedRefs = append(includedRefs, ref)
	}
	if len(entries) == 0 {
		return "", nil, nil
	}
	raw, _ := json.Marshal(entries)
	frame := "<recalled_session_receipts_data>\n" + string(raw) + "\n</recalled_session_receipts_data>"
	if len(frame) > maxOfflineRecallBytes {
		frame = frame[:maxOfflineRecallBytes]
	}
	return frame, includedRefs, nil
}
