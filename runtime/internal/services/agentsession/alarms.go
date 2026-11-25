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
	"unicode/utf8"

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
	alarmClaimLeaseWindow            = 4 * time.Minute
	maxOfflineRecallPointers         = 2
	maxOfflineRecallBytes            = 1536 // 1.5 KiB hard ceiling per v2.1 03 §5.2
)

// AlarmDeliveryOutcome reports the honest four-state Integration receipt after
// delivering an alarm template to a channel (desktop notification / IM channel).
type AlarmDeliveryOutcome struct {
	desktopAttention   *runtimev1.PendingAttentionRecord
	ReceiptState       runtimev1.AlarmDeliveryReceiptState
	ProviderMessageRef string
	Detail             string
}

// AlarmDeliverySender delivers a rendered deterministic alarm template (or
// optional budgeted LLM output) to one target channel.
type AlarmDeliverySender func(ctx context.Context, accountID string, alarm *runtimev1.SessionAlarmRecord, channel, renderedTitle, renderedBody string, lateBy time.Duration) AlarmDeliveryOutcome

// AlarmLLMRunner runs optional background LLM synthesis when alarm.RequiresLlm == true.
type AlarmLLMRunner func(ctx context.Context, accountID string, alarm *runtimev1.SessionAlarmRecord, reserve func(int64) error) (renderedTitle, renderedBody string, tokensUsed int64, err error)

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
	if hasSessionManage(decision) {
		return true
	}
	// Delegated Apps ONLY see alarms owned by their exact RegisteredAppSubject.
	scopeKey := subjectScopeKey(decision)
	return scopeKey != "" && rec.GetSourcePublisher() != "" && rec.GetSourcePublisher() == scopeKey
}

// parseCronField parses a standard 5-field cron component supporting *, */step,
// n, n/step, a-b, a-b/step, and comma-separated lists.
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
		hasStep := false
		rangePart := part
		if idx := strings.IndexByte(part, '/'); idx >= 0 {
			hasStep = true
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
			start = v
			if hasStep {
				end = maxVal
			} else {
				end = v
			}
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
	minutes     map[int]bool
	hours       map[int]bool
	dom         map[int]bool
	domWildcard bool
	months      map[int]bool
	dow         map[int]bool
	dowWildcard bool
	loc         *time.Location
}

func isCronWildcardField(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	return trimmed == "*" || trimmed == "*/1"
}

func parseFiveFieldCron(expr, tzName string) (*parsedCron, error) {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return nil, fmt.Errorf("cron expression must have exactly 5 fields, got %d", len(fields))
	}
	tz := strings.TrimSpace(tzName)
	if tz == "" {
		return nil, fmt.Errorf("explicit IANA timezone is required")
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
	return &parsedCron{
		minutes:     mins,
		hours:       hrs,
		dom:         dom,
		domWildcard: isCronWildcardField(fields[2]),
		months:      months,
		dow:         dow,
		dowWildcard: isCronWildcardField(fields[4]),
		loc:         loc,
	}, nil
}

func (c *parsedCron) dayMatches(local time.Time) bool {
	domOK := c.dom[local.Day()]
	dowOK := c.dow[int(local.Weekday())]
	// Standard 5-field cron semantics: if both DOM and DOW are restricted, match EITHER (OR).
	if !c.domWildcard && !c.dowWildcard {
		return domOK || dowOK
	}
	return domOK && dowOK
}

// nextAfter returns the earliest minute strictly after `after` matching the cron
// expression in its explicit IANA timezone, advancing strictly monotonically in
// UTC so DST spring-forward/fall-back transitions can NEVER loop or double-fire
// a repeated fall-back wall-clock minute, with a 9-year horizon covering non-leap
// century boundaries (e.g. 2096 -> 2104 Feb 29).
func (c *parsedCron) nextAfter(after time.Time) (time.Time, error) {
	afterLocal := after.UTC().Truncate(time.Minute).In(c.loc)
	t := after.UTC().Truncate(time.Minute).Add(time.Minute)
	limit := t.Add(9 * 366 * 24 * time.Hour)
	for !t.After(limit) {
		local := t.In(c.loc)
		// Within a constant-offset interval local minutes advance linearly. Stop at
		// the actual transition instead of constructing an ambiguous local midnight.
		_, zoneEnd := local.ZoneBounds()
		wall := time.Date(local.Year(), local.Month(), local.Day(), local.Hour(), local.Minute(), 0, 0, time.UTC)
		var nextWall time.Time
		switch {
		case !c.months[int(local.Month())]:
			nextWall = time.Date(wall.Year(), wall.Month()+1, 1, 0, 0, 0, 0, time.UTC)
		case !c.dayMatches(local):
			nextWall = time.Date(wall.Year(), wall.Month(), wall.Day()+1, 0, 0, 0, 0, time.UTC)
		case !c.hours[local.Hour()]:
			nextWall = wall.Truncate(time.Hour).Add(time.Hour)
		}
		if !nextWall.IsZero() {
			next := t.Add(nextWall.Sub(wall))
			if zoneEnd.After(t) && zoneEnd.Before(next) {
				next = zoneEnd.UTC().Truncate(time.Minute)
				if next.Before(zoneEnd) {
					next = next.Add(time.Minute)
				}
			}
			t = next
			continue
		}
		if !c.minutes[local.Minute()] {
			t = t.Add(time.Minute)
			continue
		}
		// ZoneBounds gives the actual transition, including non-hour IANA folds.
		start, _ := local.ZoneBounds()
		_, offset := local.Zone()
		_, previous := start.Add(-time.Second).In(c.loc).Zone()
		fold := time.Duration(previous-offset) * time.Second
		if (!start.IsZero() && fold > 0 && t.Before(start.Add(fold))) || local.Format("2006-01-02 15:04") == afterLocal.Format("2006-01-02 15:04") {
			t = t.Add(time.Minute)
			continue
		}
		return t.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("no matching cron fire time within 9 years")
}

func scanAlarmRow(scanner interface{ Scan(dest ...any) error }) (*runtimev1.SessionAlarmRecord, string, error) {
	rec := &runtimev1.SessionAlarmRecord{}
	var (
		accountID        string
		alarmKind        int32
		requiresLLM      int
		channelsJSON     string
		lastReceiptState int32
		unackStreak      int32
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
	agentBinding, err := s.resolveAgentBinding(ctx, decision, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	// Only Apps with agent.session.manage (or agent.body.pc) may create direct
	// personal alarms or LLM-synthesized alarms; ordinary agent.trigger.delegate
	// Apps may ONLY create zero-model app_delegation triggers scoped to their subject.
	if !hasSessionManage(decision) {
		if req.GetAlarmKind() != runtimev1.AlarmKind_ALARM_KIND_APP_DELEGATION || req.GetRequiresLlm() {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
		}
	}
	tz := strings.TrimSpace(req.GetTimeZone())
	if tz == "" {
		if req.GetAlarmKind() == runtimev1.AlarmKind_ALARM_KIND_CRON || strings.TrimSpace(req.GetCronExpr()) != "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
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
		// Key delegated alarms strictly by Runtime's unforgeable RegisteredAppSubject.
		sourcePublisher = subjectScopeKey(decision)
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
	if err := s.validateAlarmDeliveryChannels(channels); err != nil {
		return nil, err
	}
	channelsJSON, _ := json.Marshal(channels)
	payloadJSON := strings.TrimSpace(req.GetTemplatePayloadJson())
	if payloadJSON == "" {
		payloadJSON = "{}"
	}

	targetRef := strings.TrimSpace(req.GetTargetWorkSessionRef())
	if targetRef != "" {
		sess, gErr := s.store.GetSession(ctx, decision.AccountID, targetRef)
		if errors.Is(gErr, errSessionNotFound) || gErr != nil || sess == nil || !readerCanAccessSession(decision, sess.Record) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
		}
	}

	rec := &runtimev1.SessionAlarmRecord{
		AlarmId:              newID("alarm"),
		AgentBinding:         agentBinding,
		TargetWorkSessionRef: targetRef,
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
	if errors.Is(err, errLeaseConflict) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	return &runtimev1.CreateAlarmResponse{Alarm: saved}, nil
}

func isStaleDelegationVersion(existingVersion, incomingVersion string) bool {
	prev := strings.TrimSpace(existingVersion)
	next := strings.TrimSpace(incomingVersion)
	if prev == "" || next == "" || prev == next {
		return false
	}
	// Compare integer/v-prefixed versions numerically when possible, else lexicographically.
	pNum, pErr := strconv.ParseInt(strings.TrimPrefix(strings.ToLower(prev), "v"), 10, 64)
	nNum, nErr := strconv.ParseInt(strings.TrimPrefix(strings.ToLower(next), "v"), 10, 64)
	if pErr == nil && nErr == nil {
		return nNum < pNum
	}
	return next < prev
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
	// Reject stale source_object_version and never silently resurrect user-cancelled/sleeping delegations!
	if rec.GetSourceObjectId() != "" && rec.GetSourcePublisher() != "" {
		var (
			existingID      string
			existingVersion int64
			existingStatus  string
			existingObjVer  string
		)
		err := tx.QueryRowContext(ctx, `
			SELECT alarm_id, version, status, source_object_version FROM runtime_session_alarm
			WHERE account_id = ? AND source_publisher = ? AND source_object_id = ?`,
			accountID, rec.GetSourcePublisher(), rec.GetSourceObjectId(),
		).Scan(&existingID, &existingVersion, &existingStatus, &existingObjVer)
		if err == nil {
			if isStaleDelegationVersion(existingObjVer, rec.GetSourceObjectVersion()) {
				return nil, errLeaseConflict
			}
			// Never allow re-submission with the same/older object version to revive cancelled or sleeping delegation.
			nextStatus := existingStatus
			if existingStatus == "cancelled" || existingStatus == "sleeping" {
				if strings.TrimSpace(rec.GetSourceObjectVersion()) == "" || strings.TrimSpace(rec.GetSourceObjectVersion()) == strings.TrimSpace(existingObjVer) {
					return nil, errLeaseConflict
				}
				// Even with a newer version, a user-cancelled delegation stays cancelled until explicitly re-enabled.
				if existingStatus == "cancelled" {
					return nil, errLeaseConflict
				}
				nextStatus = "active"
			} else {
				nextStatus = "active"
			}
			rec.AlarmId = existingID
			rec.Version = existingVersion + 1
			rec.Status = nextStatus
			if _, err := tx.ExecContext(ctx, `
				UPDATE runtime_session_alarm
				SET agent_binding = ?, target_work_session_ref = ?, alarm_kind = ?,
				    cron_expr = ?, time_zone = ?, source_object_version = ?,
				    template_title = ?, template_body = ?, template_payload_json = ?,
				    requires_llm = ?, delivery_channels_json = ?, status = ?,
				    next_fire_at = ?, version = ?, expires_at = ?, updated_at = ?
				WHERE alarm_id = ? AND account_id = ? AND version = ?`,
				rec.AgentBinding, rec.TargetWorkSessionRef, int32(rec.AlarmKind),
				rec.CronExpr, rec.TimeZone, rec.SourceObjectVersion,
				rec.TemplateTitle, rec.TemplateBody, rec.TemplatePayloadJson,
				reqLLM, channelsJSON, nextStatus, rec.NextFireAt, rec.Version, rec.ExpiresAt, nowStr,
				existingID, accountID, existingVersion,
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

func (s *Service) validateAlarmDeliveryChannels(channels []string) error {
	s.mu.Lock()
	check := s.supportedDeliveryChannel
	s.mu.Unlock()
	for _, ch := range channels {
		trimmed := strings.TrimSpace(ch)
		if trimmed == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		if check != nil && !check(trimmed) {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
		}
	}
	return nil
}

func (s *Service) ListAlarms(ctx context.Context, req *runtimev1.ListAlarmsRequest) (*runtimev1.ListAlarmsResponse, error) {
	decision, err := s.authorize(ctx, localappop.OperationAgentTriggerAlarmList)
	if err != nil {
		return nil, err
	}
	if req == nil {
		req = &runtimev1.ListAlarmsRequest{}
	}
	agentFilter := strings.TrimSpace(req.GetAgentHandle())
	if agentFilter != "" {
		resolved, rErr := s.resolveAgentBinding(ctx, decision, agentFilter)
		if rErr != nil {
			return nil, rErr
		}
		agentFilter = resolved
	}
	all, err := s.store.ListAlarms(ctx, decision.AccountID, agentFilter, req.GetTargetWorkSessionRef(), req.GetIncludeInactive())
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
	if errors.Is(err, errSessionNotFound) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !readerCanAccessAlarm(decision, existing) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if existing.GetStatus() == "cancelled" || existing.GetStatus() == "expired" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}
	if req.GetExpectedVersion() > 0 && existing.GetVersion() != req.GetExpectedVersion() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}

	now := s.now().UTC()
	if req.Status != nil {
		nextSt := strings.TrimSpace(req.GetStatus())
		switch nextSt {
		case "active", "paused", "sleeping", "cancelled":
			existing.Status = nextSt
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	}
	if req.TimeZone != nil {
		tz := strings.TrimSpace(req.GetTimeZone())
		if tz == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
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
		if req.GetRequiresLlm() && !hasSessionManage(decision) {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
		}
		existing.RequiresLlm = req.GetRequiresLlm()
	}
	if len(req.GetDeliveryChannels()) > 0 {
		if chErr := s.validateAlarmDeliveryChannels(req.GetDeliveryChannels()); chErr != nil {
			return nil, chErr
		}
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
	if errors.Is(err, errSessionNotFound) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	if !readerCanAccessAlarm(decision, existing) {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AGENT_SESSION_NOT_FOUND)
	}
	if req.GetExpectedVersion() > 0 && existing.GetVersion() != req.GetExpectedVersion() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}
	err = s.store.CancelAlarm(ctx, decision.AccountID, existing.GetAlarmId(), req.GetExpectedVersion(), s.now().UTC())
	if errors.Is(err, errLeaseConflict) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_SESSION_CONFLICT)
	}
	if err != nil {
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
			WHERE account_id = ? AND alarm_id = ? AND version = ? AND status NOT IN ('cancelled', 'expired')`,
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
			WHERE account_id = ? AND alarm_id = ? AND status NOT IN ('cancelled', 'expired')`,
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

func (st *Store) CancelAlarm(ctx context.Context, accountID, alarmID string, expectedVersion int64, now time.Time) error {
	var (
		res sql.Result
		err error
	)
	if expectedVersion > 0 {
		res, err = st.writeDB.ExecContext(ctx, `
			UPDATE runtime_session_alarm
			SET status = 'cancelled', claim_expires_at = '', version = version + 1, updated_at = ?
			WHERE account_id = ? AND alarm_id = ? AND version = ?`,
			formatRFC3339(now), accountID, alarmID, expectedVersion,
		)
	} else {
		res, err = st.writeDB.ExecContext(ctx, `
			UPDATE runtime_session_alarm
			SET status = 'cancelled', claim_expires_at = '', version = version + 1, updated_at = ?
			WHERE account_id = ? AND alarm_id = ?`,
			formatRFC3339(now), accountID, alarmID,
		)
	}
	if err != nil {
		return err
	}
	if expectedVersion > 0 {
		n, _ := res.RowsAffected()
		if n == 0 {
			return errLeaseConflict
		}
	}
	return nil
}

// reserveDailyAlarmLLMBudget atomically checks and reserves `reserveTokens` from
// the account's daily background LLM budget inside a single BEGIN IMMEDIATE write
// transaction so concurrent ticks can never exceed the hard daily cap.
func (st *Store) reserveDailyAlarmLLMBudget(ctx context.Context, accountID, day string, reserveTokens, dailyBudget int64) (bool, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	key := "alarm_llm_tokens:" + accountID + ":" + day
	var raw string
	var used int64
	err = tx.QueryRowContext(ctx, `SELECT value FROM runtime_session_meta WHERE key = ?`, key).Scan(&raw)
	if err == nil {
		used, _ = strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	if used >= dailyBudget || (reserveTokens > 0 && reserveTokens > dailyBudget-used) {
		return false, nil
	}
	nextUsed := used + reserveTokens
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO runtime_session_meta(key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, strconv.FormatInt(nextUsed, 10),
	); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func (st *Store) adjustDailyAlarmLLMBudget(ctx context.Context, accountID, day string, delta int64) error {
	if delta == 0 {
		return nil
	}
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	key := "alarm_llm_tokens:" + accountID + ":" + day
	var raw string
	var used int64
	err = tx.QueryRowContext(ctx, `SELECT value FROM runtime_session_meta WHERE key = ?`, key).Scan(&raw)
	if err == nil {
		used, _ = strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	nextUsed := used + delta
	if nextUsed < 0 {
		nextUsed = 0
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO runtime_session_meta(key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, strconv.FormatInt(nextUsed, 10),
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (st *Store) claimAlarmOccurrence(ctx context.Context, accountID, alarmID, occurrenceKey string, expectedVersion int64, nowUTC time.Time) (int64, bool, error) {
	nextVer := expectedVersion + 1
	nowStr := formatRFC3339(nowUTC)
	claimExpiresStr := formatRFC3339(nowUTC.Add(alarmClaimLeaseWindow))
	res, err := st.writeDB.ExecContext(ctx, `
		UPDATE runtime_session_alarm
		SET last_claimed_occurrence = ?, claim_expires_at = ?, version = ?, updated_at = ?
		WHERE account_id = ? AND alarm_id = ? AND version = ? AND status = 'active'
		  AND (last_claimed_occurrence != ? OR (claim_expires_at != '' AND claim_expires_at <= ?))`,
		occurrenceKey, claimExpiresStr, nextVer, nowStr, accountID, alarmID, expectedVersion, occurrenceKey, nowStr,
	)
	if err != nil {
		return expectedVersion, false, err
	}
	n, _ := res.RowsAffected()
	return nextVer, n == 1, nil
}

// TickAlarms evaluates all due active alarms as of `now` with:
//   - Atomic per-occurrence CAS claiming with crash-recovery lease expiry
//   - Zero-model deterministic template delivery by default (requires_llm == false)
//   - Honest four-state Integration delivery receipts (NEVER fabricating PROVIDER_ACCEPTED when sender == nil!)
//   - Wake coalescing (cron fires AT MOST once for missed intervals; one-shot expires after 24h)
//   - Fatigue auto-sleep at unack_streak >= 3 (incremented ONLY on successful delivery!)
//   - Atomic pre-execution daily background LLM token budget reservation when requires_llm == true
//
// @nimi-authority: rule.nimi.runtime.agent-participation.deterministic-alarms
func (s *Service) TickAlarms(ctx context.Context, now time.Time) ([]AlarmFireResult, error) {
	nowUTC := now.UTC()
	nowStr := formatRFC3339(nowUTC)
	rows, err := s.store.readDB.QueryContext(ctx, `
		SELECT `+alarmSelectColumns+`
		FROM runtime_session_alarm
		WHERE status = 'active' AND next_fire_at != '' AND next_fire_at <= ?
		  AND (last_claimed_occurrence != next_fire_at OR (claim_expires_at != '' AND claim_expires_at <= ?))
		ORDER BY next_fire_at ASC LIMIT 100`,
		nowStr, nowStr,
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

		// Atomically claim this exact occurrence via version CAS + crash-recovery lease.
		claimedVersion, claimed, claimErr := s.store.claimAlarmOccurrence(ctx, accID, alarm.GetAlarmId(), alarm.GetNextFireAt(), alarm.GetVersion(), nowUTC)
		if claimErr != nil || !claimed {
			continue
		}

		// Expiry check for explicit expires_at or > 24h missed one-shot alarms.
		if exp := strings.TrimSpace(alarm.GetExpiresAt()); exp != "" && nowUTC.After(parseRFC3339(exp)) {
			_, _ = s.store.writeDB.ExecContext(ctx, `UPDATE runtime_session_alarm SET status = 'expired', claim_expires_at = '', version = version + 1, updated_at = ? WHERE alarm_id = ? AND account_id = ? AND version = ?`, nowStr, alarm.GetAlarmId(), accID, claimedVersion)
			results = append(results, AlarmFireResult{AlarmID: alarm.GetAlarmId(), StatusAfter: "expired", Expired: true, LateBy: lateBy})
			continue
		}
		if !isRecurring && lateBy > alarmOneShotExpiryWindow {
			_, _ = s.store.writeDB.ExecContext(ctx, `UPDATE runtime_session_alarm SET status = 'expired', claim_expires_at = '', version = version + 1, updated_at = ? WHERE alarm_id = ? AND account_id = ? AND version = ?`, nowStr, alarm.GetAlarmId(), accID, claimedVersion)
			results = append(results, AlarmFireResult{AlarmID: alarm.GetAlarmId(), StatusAfter: "expired", Expired: true, LateBy: lateBy})
			continue
		}

		// Render content: zero-model template by default; optional atomically-reserved LLM when requires_llm == true.
		renderedTitle := alarm.GetTemplateTitle()
		renderedBody := alarm.GetTemplateBody()
		usedLLM := false
		tokensUsed := int64(0)
		budgetExceeded := false
		if alarm.GetRequiresLlm() && llmRunner != nil {
			var reserved int64
			reserve := func(tokens int64) error {
				if tokens <= 0 || reserved != 0 {
					return errors.New("invalid alarm budget reservation")
				}
				ok, err := s.store.reserveDailyAlarmLLMBudget(ctx, accID, dayKey, tokens, dailyBudget)
				if err != nil {
					return err
				}
				if !ok {
					budgetExceeded = true
					return errors.New("alarm budget exhausted")
				}
				reserved = tokens
				return nil
			}
			title, body, usage, runErr := llmRunner(ctx, accID, alarm, reserve)
			if usage > 0 && reserved > 0 {
				tokensUsed = usage
				if err := s.store.adjustDailyAlarmLLMBudget(ctx, accID, dayKey, usage-reserved); err != nil {
					return results, err
				}
			}
			// Unknown usage after dispatch retains the reservation across retries and restart.
			if runErr == nil && reserved > 0 {
				usedLLM = true
				if strings.TrimSpace(title) != "" {
					renderedTitle = title
				}
				if strings.TrimSpace(body) != "" {
					renderedBody = body
				}
			}
		}
		if budgetExceeded {
			_, _ = s.store.writeDB.ExecContext(ctx, `
				INSERT INTO runtime_alarm_delivery(delivery_id, alarm_id, account_id, channel, receipt_state, provider_message_ref, detail, fired_at, updated_at)
				VALUES (?, ?, ?, 'llm_budget', ?, '', 'AGENT_ALARM_BUDGET_EXCEEDED', ?, ?)`,
				newID("dlv"), alarm.GetAlarmId(), accID,
				int32(runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED), nowStr, nowStr,
			)
			nextStatus, nextFireStr := s.computePostFireSchedule(alarm, isRecurring, nowUTC, alarm.GetUnackStreak())
			_, _ = s.store.writeDB.ExecContext(ctx, `
				UPDATE runtime_session_alarm
				SET status = ?, next_fire_at = ?, last_receipt_state = ?, last_delivery_at = ?, claim_expires_at = '', version = version + 1, updated_at = ?
				WHERE alarm_id = ? AND account_id = ? AND version = ?`,
				nextStatus, nextFireStr, int32(runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED), nowStr, nowStr, alarm.GetAlarmId(), accID, claimedVersion,
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
		type deliveryRecord struct {
			channel string
			outcome AlarmDeliveryOutcome
		}
		var recordedDeliveries []deliveryRecord
		lastState := runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED
		anyDelivered := false
		for _, ch := range channels {
			var outcome AlarmDeliveryOutcome
			if sender != nil {
				outcome = sender(ctx, accID, alarm, ch, renderedTitle, renderedBody, lateBy)
				if outcome.ReceiptState == runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_UNSPECIFIED {
					outcome.ReceiptState = runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_EFFECT_UNKNOWN
				}
			} else {
				// Honest failure: NEVER fabricate PROVIDER_ACCEPTED when no delivery sender is wired!
				outcome = AlarmDeliveryOutcome{
					ReceiptState: runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED,
					Detail:       "alarm_delivery_sender_unavailable",
				}
			}
			if outcome.ReceiptState == runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_PROVIDER_ACCEPTED {
				anyDelivered = true
			}
			lastState = outcome.ReceiptState
			deliveries = append(deliveries, outcome)
			recordedDeliveries = append(recordedDeliveries, deliveryRecord{channel: ch, outcome: outcome})
		}

		// Only increment unack_streak when the reminder was actually delivered!
		nextUnack := alarm.GetUnackStreak()
		if anyDelivered {
			nextUnack++
		}
		nextStatus, nextFireStr := s.computePostFireSchedule(alarm, isRecurring, nowUTC, nextUnack)
		autoSlept := isRecurring && nextStatus == "sleeping"

		// Atomically commit delivery receipts + post-fire schedule inside ONE checked
		// SQLite transaction (using deterministic delivery_id per alarm+occurrence+channel)
		// so retries never create duplicate receipts or silently drop schedule advances.
		tx, txErr := s.store.writeDB.BeginTx(ctx, nil)
		if txErr != nil {
			return results, txErr
		}
		commitOK := false
		for _, rec := range recordedDeliveries {
			if att := rec.outcome.desktopAttention; att != nil {
				if err := putPendingAttention(ctx, tx, accID, att, nowUTC); err != nil {
					_ = tx.Rollback()
					return results, err
				}
			}
			detDeliveryID := fmt.Sprintf("dlv_%s_%s_%s", alarm.GetAlarmId(), alarm.GetNextFireAt(), strings.ToLower(strings.TrimSpace(rec.channel)))
			if _, execErr := tx.ExecContext(ctx, `
				INSERT INTO runtime_alarm_delivery(delivery_id, alarm_id, account_id, channel, receipt_state, provider_message_ref, detail, fired_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(delivery_id) DO UPDATE SET
					receipt_state = excluded.receipt_state,
					provider_message_ref = excluded.provider_message_ref,
					detail = excluded.detail,
					updated_at = excluded.updated_at`,
				detDeliveryID, alarm.GetAlarmId(), accID, rec.channel, int32(rec.outcome.ReceiptState),
				strings.TrimSpace(rec.outcome.ProviderMessageRef), strings.TrimSpace(rec.outcome.Detail), nowStr, nowStr,
			); execErr != nil {
				_ = tx.Rollback()
				return results, execErr
			}
		}
		updRes, updErr := tx.ExecContext(ctx, `
			UPDATE runtime_session_alarm
			SET status = ?, unack_streak = ?, next_fire_at = ?, last_receipt_state = ?, last_delivery_at = ?, claim_expires_at = '', version = version + 1, updated_at = ?
			WHERE alarm_id = ? AND account_id = ? AND version = ?`,
			nextStatus, nextUnack, nextFireStr, int32(lastState), nowStr, nowStr, alarm.GetAlarmId(), accID, claimedVersion,
		)
		if updErr != nil {
			_ = tx.Rollback()
			return results, updErr
		}
		affected, _ := updRes.RowsAffected()
		if affected == 1 {
			if err := tx.Commit(); err != nil {
				return results, err
			}
			commitOK = true
		} else {
			_ = tx.Rollback()
		}
		if !commitOK {
			continue
		}
		for _, delivery := range deliveries {
			if delivery.desktopAttention != nil {
				s.notifyOverviewChange(accID, nil, nil)
				break
			}
		}

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
	parsed, err := parseFiveFieldCron(alarm.GetCronExpr(), alarm.GetTimeZone())
	if err != nil {
		return "schedule_error", ""
	}
	nf, err := parsed.nextAfter(nowUTC)
	if err != nil {
		return "schedule_error", ""
	}
	nextFireStr = formatRFC3339(nf)
	if nextUnack >= alarmAutoSleepUnackThreshold {
		return "sleeping", nextFireStr
	}
	return "active", nextFireStr
}

func (s *Service) ResolveAlarmReplyTarget(ctx context.Context, accountID, agentBinding, replyToMessageRef string, now time.Time) (AlarmReplyResolution, error) {
	disclaimer := "Modifying this reminder updates only your personal alarm schedule and does not alter third-party App business bookings."
	if ref := strings.TrimSpace(replyToMessageRef); ref != "" {
		var alarmID string
		err := s.store.readDB.QueryRowContext(ctx, `
			SELECT d.alarm_id
			FROM runtime_alarm_delivery d
			JOIN runtime_session_alarm a ON a.alarm_id = d.alarm_id AND a.account_id = d.account_id
			WHERE d.account_id = ? AND d.provider_message_ref = ?
			  AND (? = '' OR a.agent_binding = ?)
			ORDER BY d.fired_at DESC LIMIT 1`,
			accountID, ref, strings.TrimSpace(agentBinding), strings.TrimSpace(agentBinding),
		).Scan(&alarmID)
		if err == nil && alarmID != "" {
			rec, getErr := s.store.GetAlarm(ctx, accountID, alarmID)
			if getErr == nil {
				return AlarmReplyResolution{MatchedAlarm: rec, Disclaimer: disclaimer}, nil
			}
		}
		// Explicit replyToMessageRef that does not match any alarm delivery must NOT
		// silently fall back to an unrelated recent alarm!
		return AlarmReplyResolution{Disclaimer: disclaimer}, nil
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
// @nimi-authority: rule.nimi.cognition.runtime-bridge.session-pointer-and-delete-session
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
		receipt := truncateUTF8ByBytes(strings.TrimSpace(sess.Record.GetLatestReceiptJson()), 512)
		item := entry{
			WorkSessionRef: ref,
			Title:          truncateUTF8ByBytes(sess.Record.GetTitle(), 120),
			Status:         sess.Record.GetStatus(),
			UpdatedAt:      sess.Record.GetUpdatedAt(),
			Receipt:        receipt,
		}
		candidateEntries := append(append([]entry(nil), entries...), item)
		candidateRaw, _ := json.Marshal(candidateEntries)
		candidateFrame := "<recalled_session_receipts_data>\n" + string(candidateRaw) + "\n</recalled_session_receipts_data>"
		if len(candidateFrame) > maxOfflineRecallBytes {
			break
		}
		entries = candidateEntries
		includedRefs = append(includedRefs, ref)
	}
	if len(entries) == 0 {
		return "", nil, nil
	}
	raw, _ := json.Marshal(entries)
	frame := "<recalled_session_receipts_data>\n" + string(raw) + "\n</recalled_session_receipts_data>"
	return frame, includedRefs, nil
}

func truncateUTF8ByBytes(s string, maxBytes int) string {
	if len(s) <= maxBytes {
		return s
	}
	if maxBytes <= 0 {
		return ""
	}
	n := 0
	for n < len(s) {
		_, size := utf8.DecodeRuneInString(s[n:])
		if size <= 0 || n+size > maxBytes {
			break
		}
		n += size
	}
	return s[:n]
}
