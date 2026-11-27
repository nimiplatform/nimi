package agentsession

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCronSkipsTwoHourFold(t *testing.T) {
	cron, err := parseFiveFieldCron("*/15 1,2 * * *", "Antarctica/Troll")
	if err != nil {
		t.Fatal(err)
	}
	// The first 02:45 is 00:45 UTC. The UTC+0 repetition is not a new occurrence.
	next, err := cron.nextAfter(time.Date(2026, 10, 25, 0, 45, 0, 0, time.UTC))
	want := time.Date(2026, 10, 26, 1, 0, 0, 0, time.UTC)
	if err != nil || !next.Equal(want) {
		t.Fatalf("next=%v err=%v want=%v", next, err, want)
	}
}

func TestStage3AlarmsZeroModelWakeCoalesceAutoSleepBudgetAndDisambiguation(t *testing.T) {
	clock := time.Now().UTC().Truncate(time.Second)
	llmInvocations := 0
	var delivered []string
	var nextDeliveryState = runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_PROVIDER_ACCEPTED
	deliverySeq := 0

	svc := newStage2Service(t, Options{
		Now:                       func() time.Time { return clock },
		DailyAlarmLLMBudgetTokens: 100,
		AlarmDeliverySender: func(_ context.Context, _ string, alarm *runtimev1.SessionAlarmRecord, channel, title, body string, _ time.Duration) AlarmDeliveryOutcome {
			deliverySeq++
			delivered = append(delivered, alarm.GetAlarmId()+":"+channel+":"+title+"|"+body)
			return AlarmDeliveryOutcome{
				ReceiptState:       nextDeliveryState,
				ProviderMessageRef: "im-msg-" + string(rune('0'+deliverySeq)),
				Detail:             "delivered",
			}
		},
		AlarmLLMRunner: func(_ context.Context, _ string, alarm *runtimev1.SessionAlarmRecord, reserve func(int64) error) (string, string, int64, error) {
			if err := reserve(90); err != nil {
				return "", "", 0, err
			}
			llmInvocations++
			return "LLM " + alarm.GetTemplateTitle(), "Synthesized body", 85, nil
		},
	})

	createCtx := testCallerCtx("com.parentos.app", "subj-parentos", DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmCreate)
	listParentCtx := testCallerCtx("com.parentos.app", "subj-parentos", DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmList)
	listOtherCtx := testCallerCtx("com.other.app", "subj-other", DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmList)
	updateParentCtx := testCallerCtx("com.parentos.app", "subj-parentos", DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmUpdate)
	desktopCreateCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmCreate)
	routeCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit)
	var replyTargets [2]string
	for i, label := range []string{"morning", "digest"} {
		res, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
			AgentHandle: "agent-family", RequestId: label, Text: label, EntrySurface: "new_session", WorkspaceRoot: "/work/" + label,
		})
		if err != nil || res.GetResolvedWorkSessionRef() == "" {
			t.Fatalf("create %s alarm target: %+v err=%v", label, res, err)
		}
		replyTargets[i] = res.GetResolvedWorkSessionRef()
	}

	// 1. Authorized App trigger delegation (app_delegation) upserts by (account, publisher, source_object_id) & isolates readers.
	vacTime := clock.Add(10 * time.Minute).Format(time.RFC3339)
	a1, err := svc.CreateAlarm(createCtx, &runtimev1.CreateAlarmRequest{
		AgentHandle:         "agent-family",
		AlarmKind:           runtimev1.AlarmKind_ALARM_KIND_APP_DELEGATION,
		FireAt:              vacTime,
		TimeZone:            "Asia/Shanghai",
		SourceObjectId:      "vaccine-dose-3",
		SourceObjectVersion: "v1",
		TemplateTitle:       "儿童疫苗提醒",
		TemplateBody:        "明天上午 9 点接种乙肝第三针",
		RequiresLlm:         false,
		DeliveryChannels:    []string{"desktop_notification", "wechat"},
	})
	if err != nil {
		t.Fatalf("CreateAlarm app_delegation: %v", err)
	}
	if a1.GetAlarm().GetSourcePublisher() != "subject:subj-parentos" || a1.GetAlarm().GetVersion() != 1 {
		t.Fatalf("unexpected alarm metadata: %+v", a1.GetAlarm())
	}

	// Re-submitting same source_object_id from same publisher updates in place with bumped version.
	a1Upsert, err := svc.CreateAlarm(createCtx, &runtimev1.CreateAlarmRequest{
		AgentHandle:         "agent-family",
		AlarmKind:           runtimev1.AlarmKind_ALARM_KIND_APP_DELEGATION,
		FireAt:              vacTime,
		TimeZone:            "Asia/Shanghai",
		SourceObjectId:      "vaccine-dose-3",
		SourceObjectVersion: "v2",
		TemplateTitle:       "儿童疫苗提醒（已更新）",
		TemplateBody:        "明天上午 9:30 接种乙肝第三针",
		RequiresLlm:         false,
		DeliveryChannels:    []string{"wechat"},
	})
	if err != nil {
		t.Fatalf("CreateAlarm upsert: %v", err)
	}
	if a1Upsert.GetAlarm().GetAlarmId() != a1.GetAlarm().GetAlarmId() || a1Upsert.GetAlarm().GetVersion() != 2 {
		t.Fatalf("expected in-place delegation upsert v2, got %+v", a1Upsert.GetAlarm())
	}

	// Reader isolation: com.other.app sees 0 alarms; com.parentos.app sees 1.
	otherList, err := svc.ListAlarms(listOtherCtx, &runtimev1.ListAlarmsRequest{})
	if err != nil || len(otherList.GetAlarms()) != 0 {
		t.Fatalf("other app must see 0 alarms, got %d err=%v", len(otherList.GetAlarms()), err)
	}
	parentList, err := svc.ListAlarms(listParentCtx, &runtimev1.ListAlarmsRequest{})
	if err != nil || len(parentList.GetAlarms()) != 1 {
		t.Fatalf("parentos must see 1 alarm, got %d err=%v", len(parentList.GetAlarms()), err)
	}

	// Optimistic concurrency check on UpdateAlarm.
	staleStatus := "paused"
	if _, err := svc.UpdateAlarm(updateParentCtx, &runtimev1.UpdateAlarmRequest{
		AlarmId:         a1.GetAlarm().GetAlarmId(),
		ExpectedVersion: 1, // stale! current is 2
		Status:          &staleStatus,
	}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition on stale expected_version, got %v", err)
	}

	// 2. Zero-model deterministic fire: fires without calling LLM!
	clock = clock.Add(12 * time.Minute)
	res1, err := svc.TickAlarms(context.Background(), clock)
	if err != nil || len(res1) != 1 {
		t.Fatalf("TickAlarms expected 1 fire, got %+v err=%v", res1, err)
	}
	if res1[0].UsedLLM || llmInvocations != 0 {
		t.Fatalf("zero-model alarm MUST NOT invoke LLM, llmInvocations=%d", llmInvocations)
	}
	if res1[0].StatusAfter != "completed" {
		t.Fatalf("one-shot alarm expected status completed, got %q", res1[0].StatusAfter)
	}

	// 3. One-shot alarm missed by > 24h expires cleanly without firing!
	expiredAlarm, err := svc.CreateAlarm(desktopCreateCtx, &runtimev1.CreateAlarmRequest{
		AgentHandle:   "agent-family",
		AlarmKind:     runtimev1.AlarmKind_ALARM_KIND_AT,
		FireAt:        clock.Add(-26 * time.Hour).Format(time.RFC3339),
		TimeZone:      "UTC",
		TemplateTitle: "Old reminder",
		TemplateBody:  "Should expire",
	})
	if err != nil {
		t.Fatalf("create expired alarm: %v", err)
	}
	expRes, err := svc.TickAlarms(context.Background(), clock)
	if err != nil || len(expRes) != 1 || !expRes[0].Expired || expRes[0].AlarmID != expiredAlarm.GetAlarm().GetAlarmId() {
		t.Fatalf("expected >24h missed one-shot to expire without firing, got %+v err=%v", expRes, err)
	}

	// 4. Recurring 5-field cron: wake coalescing after 5 days sleep fires AT MOST ONCE, and 3 unacked fires trigger auto-sleep!
	cronAlarm, err := svc.CreateAlarm(desktopCreateCtx, &runtimev1.CreateAlarmRequest{
		AgentHandle:          "agent-family",
		TargetWorkSessionRef: replyTargets[0],
		AlarmKind:            runtimev1.AlarmKind_ALARM_KIND_CRON,
		CronExpr:             "0 9 * * *",
		TimeZone:             "Asia/Shanghai",
		TemplateTitle:        "每日晨报",
		TemplateBody:         "按时喝水",
		DeliveryChannels:     []string{"wechat"},
	})
	if err != nil {
		t.Fatalf("create cron alarm: %v", err)
	}
	// Jump 5 full days ahead (host slept 5 days) -> must coalesce into exactly 1 fire!
	clock = clock.Add(5 * 24 * time.Hour)
	cronFire1, err := svc.TickAlarms(context.Background(), clock)
	if err != nil || len(cronFire1) != 1 || cronFire1[0].AutoSlept {
		t.Fatalf("expected coalesced single cron fire #1, got %+v err=%v", cronFire1, err)
	}
	// Immediately ticking again at same timestamp must fire 0 times (next_fire_at jumped past clock)!
	cronNoStorm, err := svc.TickAlarms(context.Background(), clock)
	if err != nil || len(cronNoStorm) != 0 {
		t.Fatalf("wake coalescing violated (storm detected): %+v err=%v", cronNoStorm, err)
	}

	// Advance 2 more days -> fire #2 and fire #3 (unack_streak reaches 3 -> auto-sleep!).
	clock = clock.Add(24 * time.Hour)
	cronFire2, err := svc.TickAlarms(context.Background(), clock)
	if err != nil || len(cronFire2) != 1 || cronFire2[0].AutoSlept {
		t.Fatalf("expected cron fire #2 active, got %+v err=%v", cronFire2, err)
	}
	clock = clock.Add(24 * time.Hour)
	cronFire3, err := svc.TickAlarms(context.Background(), clock)
	if err != nil || len(cronFire3) != 1 || !cronFire3[0].AutoSlept || cronFire3[0].StatusAfter != "sleeping" {
		t.Fatalf("expected cron fire #3 to trigger auto-sleep at unack_streak==3, got %+v err=%v", cronFire3, err)
	}

	// 5. Daily background LLM token budget cap (100 tokens): first LLM alarm uses 85 tokens from a 90-token reservation, second hits AGENT_ALARM_BUDGET_EXCEEDED!
	freshDesktopCreateCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID:            "acct-1",
		AppID:                "nimi.desktop",
		RegisteredAppSubject: "subj-home",
		TrustClass:           accountservice.LocalAppTrustClassBuiltIn,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  DomainAgentTriggerDelegate,
		ActivatedDomains:     DomainAgentSessionManage + "," + DomainAgentTriggerDelegate,
		Operation:            localappop.OperationAgentTriggerAlarmCreate,
		ExpiresAt:            clock.Add(time.Hour),
	})
	_, err = svc.CreateAlarm(freshDesktopCreateCtx, &runtimev1.CreateAlarmRequest{
		AgentHandle:          "agent-family",
		TargetWorkSessionRef: replyTargets[1],
		AlarmKind:            runtimev1.AlarmKind_ALARM_KIND_DELAY,
		DelaySeconds:         10,
		TemplateTitle:        "LLM Summary 1",
		TemplateBody:         "Digest",
		RequiresLlm:          true,
	})
	if err != nil {
		t.Fatalf("create llm alarm 1: %v", err)
	}
	_, err = svc.CreateAlarm(freshDesktopCreateCtx, &runtimev1.CreateAlarmRequest{
		AgentHandle:   "agent-family",
		AlarmKind:     runtimev1.AlarmKind_ALARM_KIND_DELAY,
		DelaySeconds:  20,
		TemplateTitle: "LLM Summary 2",
		TemplateBody:  "Digest 2",
		RequiresLlm:   true,
	})
	if err != nil {
		t.Fatalf("create llm alarm 2: %v", err)
	}
	clock = clock.Add(30 * time.Second)
	llmFires, err := svc.TickAlarms(context.Background(), clock)
	if err != nil || len(llmFires) != 2 {
		t.Fatalf("expected 2 llm alarms processed, got %+v err=%v", llmFires, err)
	}
	if !llmFires[0].UsedLLM || llmFires[0].BudgetExceeded {
		t.Fatalf("first LLM alarm should succeed within budget: %+v", llmFires[0])
	}
	if !llmFires[1].BudgetExceeded || llmFires[1].UsedLLM {
		t.Fatalf("second LLM alarm MUST fail closed with AGENT_ALARM_BUDGET_EXCEEDED: %+v", llmFires[1])
	}

	// 6. Reply-reference binding & multi-alarm two-choice disambiguation!
	// Both cronFire3 and llmFires[0] delivered within the last 6 hours.
	// With NO reply_to_message_ref -> MUST return AmbiguousAlarms (>= 2) and never guess!
	reader := accountservice.LocalAppCallerDecision{AccountID: "acct-1", ActivatedDomains: DomainAgentSessionManage}
	ambiguous, err := svc.resolveAlarmReplyTargets(context.Background(), reader, "agent-family", "", clock)
	if err != nil || len(ambiguous) != 2 {
		t.Fatalf("expected 2 choices without reply_to_message_ref, got %+v err=%v", ambiguous, err)
	}
	// With exact reply_to_message_ref from cronFire3 -> matches cronAlarm precisely!
	exactRef := cronFire3[0].Deliveries[0].ProviderMessageRef
	exact, err := svc.resolveAlarmReplyTargets(context.Background(), reader, "agent-family", exactRef, clock)
	if err != nil || len(exact) != 1 || exact[0].GetWorkSessionRef() != replyTargets[0] {
		t.Fatalf("expected exact match to cronAlarm %q, got %+v err=%v", cronAlarm.GetAlarm().GetAlarmId(), exact, err)
	}
}

func TestBoundAlarmContentAndReplyFollowCurrentSessionAccess(t *testing.T) {
	clock := time.Now().UTC().Truncate(time.Second)
	const agent = "agent-alarms"
	svc := newStage2Service(t, Options{
		Now: func() time.Time { return clock },
		NamedRecipientResolver: func(context.Context, string, string) (string, error) {
			return "harness-recipient", nil
		},
		NamedRecipientVerifier: func(_ context.Context, _, subject, appID string) (bool, error) {
			return subject == "harness-recipient" && appID == NamedHarnessAppID, nil
		},
	})
	svc.SetAlarmDeliverySender(func(_ context.Context, _ string, alarm *runtimev1.SessionAlarmRecord, _, title, body string, _ time.Duration) AlarmDeliveryOutcome {
		return svc.NotifyDesktopAlarm(alarm, title, body)
	})
	overview := func(domain string, op localappop.Operation) context.Context {
		return testCallerCtx("nimi.desktop", "overview-owner", domain, op)
	}
	sender := func(domain string, op localappop.Operation) context.Context {
		return testCallerCtxWithDomains("nimi.zhiyu", "brief-sender", domain, op, DomainAgentLocal, DomainAgentTriggerDelegate, DomainAgentSessionManage)
	}
	ordinary, err := svc.RouteAndSubmitInput(overview(DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit), &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle: agent, RequestId: "ordinary-alarm-session", Text: "Review the calendar", EntrySurface: "pc_work",
	})
	if err != nil || ordinary.GetResolvedWorkSessionRef() == "" {
		t.Fatalf("create ordinary session: %+v err=%v", ordinary, err)
	}
	handoff, err := svc.RouteAndSubmitInput(sender(DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit), &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle: agent, RequestId: "bound-alarm-handoff", Text: "Review draft", EntrySurface: "zhiyu_handoff",
		HandoffBriefText: "Review the confidential draft", TrustTierHint: "trusted",
	})
	if err != nil || handoff.GetResolvedWorkSessionRef() == "" {
		t.Fatalf("create handoff session: %+v err=%v", handoff, err)
	}
	handoffRef := handoff.GetResolvedWorkSessionRef()
	createAlarm := func(ctx context.Context, ref, title string) *runtimev1.SessionAlarmRecord {
		t.Helper()
		response, err := svc.CreateAlarm(ctx, &runtimev1.CreateAlarmRequest{
			AgentHandle: agent, TargetWorkSessionRef: ref, AlarmKind: runtimev1.AlarmKind_ALARM_KIND_DELAY, DelaySeconds: 1,
			TemplateTitle: title, TemplateBody: title, TemplatePayloadJson: `{"note":"review draft"}`,
		})
		if err != nil || response.GetAlarm() == nil {
			t.Fatalf("create bound reminder: %+v err=%v", response, err)
		}
		return response.GetAlarm()
	}
	fireAlarm := func() {
		t.Helper()
		clock = clock.Add(2 * time.Second)
		if result, err := svc.TickAlarms(context.Background(), clock); err != nil || len(result) != 1 {
			t.Fatalf("fire reminder: %+v err=%v", result, err)
		}
	}
	createAlarm(overview(DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmCreate), ordinary.GetResolvedWorkSessionRef(), "Calendar")
	fireAlarm()
	createPrivate := sender(DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmCreate)
	privateAlarm := createAlarm(createPrivate, handoffRef, "Private draft")
	overviewList := overview(DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmList)
	list, err := svc.ListAlarms(overviewList, &runtimev1.ListAlarmsRequest{TargetWorkSessionRef: handoffRef})
	if err != nil || len(list.GetAlarms()) != 1 {
		t.Fatalf("overview status: %+v err=%v", list, err)
	}
	projected := list.GetAlarms()[0]
	if projected.GetAlarmId() != privateAlarm.GetAlarmId() || projected.GetStatus() != "active" ||
		projected.GetTemplateTitle() != "" || projected.GetTemplateBody() != "" || projected.GetTemplatePayloadJson() != "{}" {
		t.Fatalf("overview should receive the reminder status without the template: %+v", projected)
	}

	newTitle := "Revised draft"
	overviewUpdate := overview(DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmUpdate)
	if _, err := svc.UpdateAlarm(overviewUpdate, &runtimev1.UpdateAlarmRequest{AlarmId: privateAlarm.GetAlarmId(), TemplateTitle: &newTitle}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("overview template edit must be denied: %v", err)
	}
	paused := "paused"
	pausedResult, err := svc.UpdateAlarm(overviewUpdate, &runtimev1.UpdateAlarmRequest{AlarmId: privateAlarm.GetAlarmId(), Status: &paused})
	if err != nil || pausedResult.GetAlarm().GetStatus() != "paused" || pausedResult.GetAlarm().GetTemplateTitle() != "" {
		t.Fatalf("overview should be able to pause without receiving the template: %+v err=%v", pausedResult, err)
	}
	active := "active"
	update, err := svc.UpdateAlarm(sender(DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmUpdate), &runtimev1.UpdateAlarmRequest{
		AlarmId: privateAlarm.GetAlarmId(), Status: &active, TemplateTitle: &newTitle,
	})
	if err != nil || update.GetAlarm().GetTemplateTitle() != newTitle {
		t.Fatalf("bound sender should be able to edit: %+v err=%v", update, err)
	}
	fireAlarm()
	attentionReader := accountservice.LocalAppCallerDecision{AccountID: "acct-1", ActivatedDomains: DomainAgentSessionManage}
	attention, err := svc.Store().ListPendingAttention(context.Background(), "acct-1", clock)
	if err != nil || len(attention) != 2 {
		t.Fatalf("read fired reminder attention: %+v err=%v", attention, err)
	}
	summaries := make(map[string]string, len(attention))
	for _, item := range attention {
		summaries[item.GetWorkSessionRef()] = svc.projectAttentionForReader(context.Background(), attentionReader, item).GetSummaryJson()
	}
	if summaries[handoffRef] != "{}" || !strings.Contains(summaries[ordinary.GetResolvedWorkSessionRef()], "Calendar") {
		t.Fatal("only notifications for content the reader may access should retain their summaries")
	}
	orphan := &runtimev1.PendingAttentionRecord{WorkSessionRef: "missing-target", SummaryJson: `{"note":"unresolved"}`}
	if got := svc.projectAttentionForReader(context.Background(), attentionReader, orphan); got.GetSummaryJson() != "{}" {
		t.Fatalf("unresolved notification must withhold its summary")
	}

	for range 5 {
		createAlarm(createPrivate, handoffRef, "Draft follow-up")
		fireAlarm()
	}
	reply, err := svc.RouteAndSubmitInput(overview(DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit), &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle: agent, RequestId: "reply-to-visible-alarm", Text: "推迟提醒",
	})
	if err != nil || reply.GetResolvedWorkSessionRef() != ordinary.GetResolvedWorkSessionRef() || reply.GetRouteReason() != "l1_alarm_reply_recent_single" {
		t.Fatalf("the lone visible older reminder should route directly: %+v err=%v", reply, err)
	}
}

func TestStage3OfflineTop2RecallAuthorizationBudgetAndTaintGate(t *testing.T) {
	svc := newStage2Service(t, Options{})
	routeCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit)

	// Create 3 trusted sessions + 1 untrusted external channel session.
	var refs []string
	for i := 0; i < 3; i++ {
		r, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
			AgentHandle:   "agent-work",
			RequestId:     "req-recall-" + string(rune('a'+i)),
			Text:          "工程交付项目 " + string(rune('A'+i)),
			WorkspaceRoot: `D:\work\proj-` + string(rune('a'+i)),
			EntrySurface:  "home",
		})
		if err != nil {
			t.Fatalf("create session %d: %v", i, err)
		}
		refs = append(refs, r.GetResolvedWorkSessionRef())
	}
	ext, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:   "agent-work",
		RequestId:     "req-recall-ext",
		Text:          "外部渠道消息",
		EntrySurface:  "channel:wechat:group-1",
		TrustTierHint: "external_channel",
	})
	if err != nil {
		t.Fatalf("create external session: %v", err)
	}

	pointers := []OfflineRecallPointer{
		{WorkSessionRef: ext.GetResolvedWorkSessionRef(), Score: 0.99}, // tainted -> must be excluded!
		{WorkSessionRef: refs[0], Score: 0.95},
		{WorkSessionRef: refs[1], Score: 0.90},
		{WorkSessionRef: refs[2], Score: 0.85}, // 3rd trusted -> excluded by Top-2 cap!
	}

	// Authorized session-manage reader: gets ONLY Top-2 trusted sessions, <= 1.5 KiB, and Harness is completely offline!
	desktopDecision := accountservice.LocalAppCallerDecision{
		AccountID:        "acct-1",
		AppID:            "nimi.desktop",
		ActivatedDomains: DomainAgentSessionManage,
	}
	frame, included, err := svc.BuildOfflineSessionRecallInjection(context.Background(), desktopDecision, "agent-work", pointers)
	if err != nil {
		t.Fatalf("BuildOfflineSessionRecallInjection desktop: %v", err)
	}
	if len(included) != 2 || included[0] != refs[0] || included[1] != refs[1] {
		t.Fatalf("expected Top-2 trusted refs [%s, %s], got %v", refs[0], refs[1], included)
	}
	if len(frame) == 0 || len(frame) > maxOfflineRecallBytes || !strings.Contains(frame, "<recalled_session_receipts_data>") {
		t.Fatalf("unexpected recall frame (len=%d): %q", len(frame), frame)
	}

	// Unauthorized third-party reader: MUST get empty frame (0 leaked titles!).
	otherDecision := accountservice.LocalAppCallerDecision{
		AccountID: "acct-1",
		AppID:     "com.untrusted.reader",
	}
	otherFrame, otherIncluded, err := svc.BuildOfflineSessionRecallInjection(context.Background(), otherDecision, "agent-work", pointers)
	if err != nil {
		t.Fatalf("BuildOfflineSessionRecallInjection unauthorized: %v", err)
	}
	if otherFrame != "" || len(otherIncluded) != 0 {
		t.Fatalf("unauthorized reader MUST receive 0 leaked pointers, got frame=%q included=%v", otherFrame, otherIncluded)
	}
}
