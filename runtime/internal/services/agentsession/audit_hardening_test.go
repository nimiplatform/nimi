package agentsession

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestAuditHardeningCapabilityIdempotencyCronDSTLedgerAndLeaseRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sessions#test.db")
	clock := time.Date(2026, 3, 8, 6, 30, 0, 0, time.UTC) // 01:30 EST in America/New_York (spring-forward DST!)
	svc := newStage2Service(t, Options{
		DBPath: dbPath,
		Now:    func() time.Time { return clock },
		ReadSetQualifier: func(_ context.Context, _, _, _ string, epoch int64) (bool, int64, error) {
			return true, epoch + 1, nil
		},
		BodyStepExecutor: func(_ context.Context, in BodyStepExecutionInput, emitter BodyStepEmitter) (BodyStepExecutionResult, error) {
			if in.Purpose == runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION {
				return BodyStepExecutionResult{
					FinishReason:      "stop",
					CompactionSummary: "Verified compaction summary",
				}, nil
			}
			tc := &runtimev1.BodyToolCall{CallId: "call_ok_1", Name: "write_file", ArgumentsJson: `{"path":"a.txt"}`}
			_ = emitter.SendToolCall(tc)
			return BodyStepExecutionResult{
				FinishReason:    "tool_calls",
				AssistantText:   "writing",
				IssuedToolCalls: []*runtimev1.BodyToolCall{tc},
			}, nil
		},
	})

	// 1. App WITHOUT activated agent.body.pc MUST be rejected from os.pc.* regardless of app_id!
	noCapRegCtx := testCallerCtxWithDomains("nimi.harness", "subj-spoof", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister, DomainAgentLocal)
	if _, err := svc.RegisterBodyCarrier(noCapRegCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "inst-spoof",
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("caller without activated agent.body.pc MUST be rejected, got %v", err)
	}

	// 2. Same request_id with DIFFERENT payload MUST fail with FailedPrecondition; different caller subject gets isolated namespace!
	desktopRouteCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit)
	firstRoute, err := svc.RouteAndSubmitInput(desktopRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:       "agent-1",
		RequestId:         "req-idem-1",
		Text:              "build project alpha",
		WorkspaceRoot:     `D:\work\alpha`,
		WorkspaceWritable: true,
		EntrySurface:      "home_omni",
	})
	if err != nil {
		t.Fatalf("first route failed: %v", err)
	}
	if _, err := svc.RouteAndSubmitInput(desktopRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:       "agent-1",
		RequestId:         "req-idem-1",
		Text:              "DIFFERENT TEXT MUST CONFLICT",
		WorkspaceRoot:     `D:\work\alpha`,
		WorkspaceWritable: true,
		EntrySurface:      "home_omni",
	}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition on same request_id with different payload, got %v", err)
	}
	// Different app reusing req-idem-1 MUST NOT read nimi.desktop's session record!
	otherRouteCtx := testCallerCtx("com.third.app", "subj-3p", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit)
	otherRoute, err := svc.RouteAndSubmitInput(otherRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:  "agent-1",
		RequestId:    "req-idem-1",
		Text:         "third party question",
		EntrySurface: "app",
	})
	if err != nil {
		t.Fatalf("other app route failed: %v", err)
	}
	if otherRoute.GetResolvedWorkSessionRef() == firstRoute.GetResolvedWorkSessionRef() {
		t.Fatalf("cross-app idempotency collision leaked desktop session ref!")
	}

	// 3. __general_inbox__ sentinel MUST succeed instead of returning 404!
	inboxRes, err := svc.RouteAndSubmitInput(desktopRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:          "agent-1",
		RequestId:            "req-sentinel-inbox",
		Text:                 "quick question",
		SelectedCandidateRef: "__general_inbox__",
		EntrySurface:         "home_omni",
	})
	if err != nil || inboxRes.GetSessionKind() != "general_inbox" {
		t.Fatalf("expected __general_inbox__ sentinel to route to general_inbox, got %+v err=%v", inboxRes, err)
	}

	// 4. SplitOrRedirectInput MUST authorize OperationAgentSessionSplitRedirect (NOT RouteSubmit)!
	splitCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionSplitRedirect)
	splitResp, err := svc.SplitOrRedirectInput(splitCtx, &runtimev1.SplitOrRedirectInputRequest{
		SourceWorkSessionRef: inboxRes.GetResolvedWorkSessionRef(),
		TargetSessionKind:    "pc_work",
		RequestId:            "req-split-1",
		Title:                "Split Task",
	})
	if err != nil || splitResp.GetTargetWorkSessionRef() == "" {
		t.Fatalf("SplitOrRedirectInput with SplitRedirect op failed: resp=%+v err=%v", splitResp, err)
	}

	// 5. Cron DST spring-forward (America/New_York 2026-03-08 02:00 does not exist!) MUST terminate fast & not loop!
	dstCron, err := parseFiveFieldCron("30 2 * * *", "America/New_York")
	if err != nil {
		t.Fatalf("parse DST cron: %v", err)
	}
	doneCh := make(chan time.Time, 1)
	go func() {
		nf, err := dstCron.nextAfter(clock)
		if err == nil {
			doneCh <- nf
		}
	}()
	select {
	case nf := <-doneCh:
		if !nf.After(clock) {
			t.Fatalf("expected DST nextAfter strictly after %v, got %v", clock, nf)
		}
	case <-time.After(time.Second):
		t.Fatal("Cron DST spring-forward entered infinite loop!")
	}

	// Feb 29 leap-year cron MUST find 2028-02-29 from 2026!
	leapCron, err := parseFiveFieldCron("0 9 29 2 *", "UTC")
	if err != nil {
		t.Fatalf("parse leap cron: %v", err)
	}
	leapNext, err := leapCron.nextAfter(clock)
	if err != nil || leapNext.Year() != 2028 || leapNext.Month() != time.February || leapNext.Day() != 29 {
		t.Fatalf("expected 2028-02-29 for leap-year cron, got %v err=%v", leapNext, err)
	}

	// 6. Alarm TickAlarms with nil AlarmDeliverySender MUST record REJECTED (zero pseudo-success) and NOT increment unack_streak!
	alarmCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmCreate)
	createdAlarm, err := svc.CreateAlarm(alarmCtx, &runtimev1.CreateAlarmRequest{
		AgentHandle:   "agent-1",
		AlarmKind:     runtimev1.AlarmKind_ALARM_KIND_DELAY,
		DelaySeconds:  1,
		TimeZone:      "UTC",
		TemplateTitle: "Honest receipt check",
		TemplateBody:  "No sender wired",
	})
	if err != nil {
		t.Fatalf("CreateAlarm: %v", err)
	}
	fires, err := svc.TickAlarms(context.Background(), clock.Add(5*time.Second))
	if err != nil || len(fires) != 1 || len(fires[0].Deliveries) != 1 {
		t.Fatalf("expected 1 alarm fire, got %+v err=%v", fires, err)
	}
	if fires[0].Deliveries[0].ReceiptState != runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED {
		t.Fatalf("nil sender MUST NOT fabricate PROVIDER_ACCEPTED, got %v", fires[0].Deliveries[0].ReceiptState)
	}
	afterAlarm, err := svc.Store().GetAlarm(context.Background(), "acct-1", createdAlarm.GetAlarm().GetAlarmId())
	if err != nil || afterAlarm.GetUnackStreak() != 0 {
		t.Fatalf("failed delivery must not increment unack_streak, got %d err=%v", afterAlarm.GetUnackStreak(), err)
	}

	// 7. Harness registration + BodyStep last_step_mac verification + AuthorizeBodySideEffect fail-closed + monotonic (lease_epoch, projection_seq) across restart!
	harnessRegCtx := testCallerCtx("nimi.harness", "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	reg1, err := svc.RegisterBodyCarrier(harnessRegCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "inst-1",
	})
	if err != nil {
		t.Fatalf("register harness epoch 1: %v", err)
	}
	wsRef := firstRoute.GetResolvedWorkSessionRef()
	// Drain pending tombstones/intents if any (none yet except NEW_INTENT).
	stepCtx := testCallerCtx("nimi.harness", "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCStepStream)
	st1 := &fakeBodyStepStream{ctx: stepCtx}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsRef,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg1.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{{Role: "user", ContentJson: `"step 1 message"`}},
	}, st1); err != nil {
		t.Fatalf("step 1 failed: %v", err)
	}
	// Tampering step 1 message on step 2 MUST fail with AGENT_SESSION_LEDGER_INVALID!
	stTamper := &fakeBodyStepStream{ctx: stepCtx}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsRef,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg1.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages: []*runtimev1.BodyWorkingMessage{
			{Role: "user", ContentJson: `"TAMPERED step 1"`},
			{Role: "user", ContentJson: `"step 2"`},
		},
	}, stTamper); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition on tampered last_step_mac prefix, got %v", err)
	}
	// AuthorizeBodySideEffect MUST reject empty call_id!
	authCtx := testCallerCtx("nimi.harness", "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCSideEffectAuthorize)
	emptyCallAuth, err := svc.AuthorizeBodySideEffect(authCtx, &runtimev1.AuthorizeBodySideEffectRequest{
		WorkSessionRef:      wsRef,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg1.GetLeaseEpoch(),
		PayloadHash:         sha256HexString("payload"),
		ActionKind:          "file_write",
	})
	if err != nil || emptyCallAuth.GetAuthorized() {
		t.Fatalf("expected empty call_id to fail closed, got %+v err=%v", emptyCallAuth, err)
	}
	// Report projection seq=10 under epoch 1, then restart carrier -> epoch 2 with projection_seq=1 MUST succeed!
	projCtx := testCallerCtx("nimi.harness", "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCProjectionReport)
	if resp, err := svc.ReportBodySessionProjection(projCtx, &runtimev1.ReportBodySessionProjectionRequest{
		WorkSessionRef:      wsRef,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg1.GetLeaseEpoch(),
		ProjectionSeq:       10,
		Status:              "active",
	}); err != nil || !resp.GetApplied() {
		t.Fatalf("epoch 1 seq 10 projection failed: %+v err=%v", resp, err)
	}
	reg2, err := svc.RegisterBodyCarrier(harnessRegCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "inst-2",
	})
	if err != nil || reg2.GetLeaseEpoch() <= reg1.GetLeaseEpoch() {
		t.Fatalf("register harness epoch 2 failed: %+v err=%v", reg2, err)
	}
	if resp, err := svc.ReportBodySessionProjection(projCtx, &runtimev1.ReportBodySessionProjectionRequest{
		WorkSessionRef:      wsRef,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg2.GetLeaseEpoch(),
		ProjectionSeq:       1, // reset to 1 after restart under newer lease_epoch!
		Status:              "active",
	}); err != nil || !resp.GetApplied() {
		t.Fatalf("epoch 2 seq 1 projection after restart MUST be accepted, got %+v err=%v", resp, err)
	}

	// 8. PurgeAgent cascades sessions + alarms + PURGE_AGENT tombstone!
	if err := svc.PurgeAgent(context.Background(), "acct-1", "agent-1"); err != nil {
		t.Fatalf("PurgeAgent: %v", err)
	}
	tombstones, _, err := svc.Store().ListPendingOutbox(context.Background(), "acct-1", "dev-1", DefaultPCNamespace)
	if err != nil {
		t.Fatalf("ListPendingOutbox: %v", err)
	}
	sawPurgeAgent := false
	for _, ts := range tombstones {
		if ts.GetCommandKind() == runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_AGENT && ts.GetAgentBinding() == "agent-1" {
			sawPurgeAgent = true
		}
	}
	if !sawPurgeAgent {
		t.Fatalf("expected PURGE_AGENT tombstone after PurgeAgent, got %+v", tombstones)
	}
}
