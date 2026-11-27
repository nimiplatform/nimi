package agentsession

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type multiDeltaOverviewStream struct {
	grpc.ServerStream
	ctx    context.Context
	mu     sync.Mutex
	deltas []*runtimev1.SessionOverviewDelta
	notify chan struct{}
}

func (s *multiDeltaOverviewStream) Context() context.Context     { return s.ctx }
func (s *multiDeltaOverviewStream) SetHeader(metadata.MD) error  { return nil }
func (s *multiDeltaOverviewStream) SendHeader(metadata.MD) error { return nil }
func (s *multiDeltaOverviewStream) SetTrailer(metadata.MD)       {}
func (s *multiDeltaOverviewStream) Send(d *runtimev1.SessionOverviewDelta) error {
	s.mu.Lock()
	s.deltas = append(s.deltas, d)
	s.mu.Unlock()
	select {
	case s.notify <- struct{}{}:
	default:
	}
	return nil
}

func (s *multiDeltaOverviewStream) snapshot() []*runtimev1.SessionOverviewDelta {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*runtimev1.SessionOverviewDelta, len(s.deltas))
	copy(out, s.deltas)
	return out
}

func TestNamedBriefResolutionRefusalAndExactRecipientDelivery(t *testing.T) {
	var (
		mu              sync.Mutex
		resolvedSubject = ""
		resolvedErr     = ErrNamedRecipientUnavailable
		validSubjects   = map[string]bool{}
	)

	var milestones []SessionMilestone
	var milestoneMu sync.Mutex

	svc := newStage2Service(t, Options{
		NamedRecipientResolver: func(_ context.Context, _, appID string) (string, error) {
			mu.Lock()
			defer mu.Unlock()
			if appID != NamedHarnessAppID {
				return "", ErrNamedRecipientUnavailable
			}
			return resolvedSubject, resolvedErr
		},
		NamedRecipientVerifier: func(_ context.Context, _, subject, appID string) (bool, error) {
			mu.Lock()
			defer mu.Unlock()
			if appID != NamedHarnessAppID {
				return false, nil
			}
			return validSubjects[subject], nil
		},
		ReadSetQualifier: func(context.Context, string, string, string, int64) (bool, int64, error) {
			return true, 1, nil
		},
		BodyStepExecutor: func(_ context.Context, _ BodyStepExecutionInput, emitter BodyStepEmitter) (BodyStepExecutionResult, error) {
			_ = emitter.SendTextDelta("ok")
			return BodyStepExecutionResult{
				FinishReason:  "stop",
				AssistantText: "ok",
			}, nil
		},
		MilestoneHook: func(_ context.Context, m SessionMilestone) error {
			milestoneMu.Lock()
			milestones = append(milestones, m)
			milestoneMu.Unlock()
			return nil
		},
	})

	zhiyuRouteCtx := testCallerCtx("nimi.zhiyu", "subj-zhiyu-1", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit)

	// 1. Missing Harness recipient -> fail closed, no unbound brief accepted.
	_, err := svc.RouteAndSubmitInput(zhiyuRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:      "agent-xiaoman",
		RequestId:        "req-missing-harness",
		Text:             "帮我整理机密方案",
		HandoffBriefText: "目标：整理机密方案\n要点：\n- 私密词：苍穹玉兰",
		EntrySurface:     "zhiyu_handoff",
		TrustTierHint:    "trusted",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition when Harness unavailable, got %v", err)
	}

	// 2. Ambiguous Harness recipient -> fail closed with FailedPrecondition.
	mu.Lock()
	resolvedErr = ErrNamedRecipientAmbiguous
	mu.Unlock()
	_, err = svc.RouteAndSubmitInput(zhiyuRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:      "agent-xiaoman",
		RequestId:        "req-ambig-harness",
		Text:             "帮我整理机密方案",
		HandoffBriefText: "目标：整理机密方案",
		EntrySurface:     "zhiyu_handoff",
		TrustTierHint:    "trusted",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition when Harness ambiguous, got %v", err)
	}

	// 3. Over-budget brief (>4000 runes) -> fail closed InvalidArgument.
	mu.Lock()
	resolvedSubject = "subj-harness-orig"
	resolvedErr = nil
	validSubjects["subj-harness-orig"] = true
	mu.Unlock()
	_, err = svc.RouteAndSubmitInput(zhiyuRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:      "agent-xiaoman",
		RequestId:        "req-over-budget",
		Text:             "超长测试",
		HandoffBriefText: strings.Repeat("密", MaxHandoffBriefRunes+1),
		EntrySurface:     "zhiyu_handoff",
		TrustTierHint:    "trusted",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument on over-budget brief, got %v", err)
	}

	// 4. Another PC Body app is online while original Harness is offline.
	//    Handoff MUST queue DEFERRED_BODY_OFFLINE and NEVER deliver to the other PC Body app!
	otherRegCtx := testCallerCtx("com.other.pcbody", "subj-other-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	otherReg, err := svc.RegisterBodyCarrier(otherRegCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "other-inst",
	})
	if err != nil {
		t.Fatalf("other pc body register failed: %v", err)
	}

	privateTerm := "苍穹玉兰密钥"
	confirmedBrief := "目标：整理春季发布会桌面文档\n核心要点：\n- 私密代号：" + privateTerm
	handoffResp, err := svc.RouteAndSubmitInput(zhiyuRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:      "agent-xiaoman",
		RequestId:        "req-named-brief-1",
		Text:             "整理春季发布会桌面文档 " + privateTerm,
		HandoffBriefText: confirmedBrief,
		EntrySurface:     "zhiyu_handoff",
		TrustTierHint:    "trusted",
	})
	if err != nil {
		t.Fatalf("named brief submission failed: %v", err)
	}
	if handoffResp.GetOutcome() != runtimev1.RouteAndSubmitOutcome_ROUTE_AND_SUBMIT_OUTCOME_DEFERRED_BODY_OFFLINE {
		t.Fatalf("expected DEFERRED_BODY_OFFLINE while bound Harness is offline, got %v", handoffResp.GetOutcome())
	}
	handoffRef := handoffResp.GetResolvedWorkSessionRef()
	outboxID := handoffResp.GetOutboxId()
	if handoffRef == "" || outboxID == "" {
		t.Fatalf("expected valid session ref and outbox id, got %+v", handoffResp)
	}

	// Verify other PC Body app gets 0 intents on SubscribeBodyOutbox, cannot ACK, BodyStep, or ReportProjection!
	subCtx, subCancel := context.WithTimeout(
		testCallerCtx("com.other.pcbody", "subj-other-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCOutboxSubscribe),
		120*time.Millisecond,
	)
	otherOutboxStream := &fakeOutboxStream{ctx: subCtx, cancel: subCancel}
	_ = svc.SubscribeBodyOutbox(&runtimev1.SubscribeBodyOutboxRequest{
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          otherReg.GetLeaseEpoch(),
	}, otherOutboxStream)
	if len(otherOutboxStream.events) != 0 {
		t.Fatalf("unrelated PC Body app received restricted handoff outbox: %+v", otherOutboxStream.events)
	}
	otherAckCtx := testCallerCtx("com.other.pcbody", "subj-other-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCOutboxAck)
	if _, err := svc.AckBodyOutbox(otherAckCtx, &runtimev1.AckBodyOutboxRequest{
		OutboxId:            outboxID,
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          otherReg.GetLeaseEpoch(),
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied for other PC Body ACK, got %v", err)
	}
	otherStepCtx := testCallerCtx("com.other.pcbody", "subj-other-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCStepStream)
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      handoffRef,
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          otherReg.GetLeaseEpoch(),
		WorkingMessages: []*runtimev1.BodyWorkingMessage{
			{Role: "user", OutboxId: outboxID, ContentJson: `"hi"`},
		},
	}, &fakeBodyStepStream{ctx: otherStepCtx}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied for other PC Body step, got %v", err)
	}
	otherProjCtx := testCallerCtx("com.other.pcbody", "subj-other-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCProjectionReport)
	if _, err := svc.ReportBodySessionProjection(otherProjCtx, &runtimev1.ReportBodySessionProjectionRequest{
		WorkSessionRef:      handoffRef,
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          otherReg.GetLeaseEpoch(),
		ProjectionSeq:       1,
		Status:              "running",
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied for other PC Body projection, got %v", err)
	}

	// Unregister other PC Body app so another Harness registration can bind os.pc.workspace.
	otherUnregCtx := testCallerCtx("com.other.pcbody", "subj-other-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCUnregister)
	_, _ = svc.UnregisterBodyCarrier(otherUnregCtx, &runtimev1.UnregisterBodyCarrierRequest{
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          otherReg.GetLeaseEpoch(),
	})

	// 5. Same app_id (nimi.harness) re-registered under a NEW subject MUST NOT receive the old subject's brief!
	mu.Lock()
	validSubjects["subj-harness-rereg"] = true
	mu.Unlock()
	reregCtx := testCallerCtx("nimi.harness", "subj-harness-rereg", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	rereg, err := svc.RegisterBodyCarrier(reregCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "rereg-inst",
	})
	if err != nil {
		t.Fatalf("reregistered harness register failed: %v", err)
	}
	if len(rereg.GetPendingIntents()) != 0 {
		t.Fatalf("re-registered same app_id with new subject received original brief: %+v", rereg.GetPendingIntents())
	}
	reregAckCtx := testCallerCtx("nimi.harness", "subj-harness-rereg", DomainAgentBodyPC, localappop.OperationAgentBodyPCOutboxAck)
	if _, err := svc.AckBodyOutbox(reregAckCtx, &runtimev1.AckBodyOutboxRequest{
		OutboxId:            outboxID,
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          rereg.GetLeaseEpoch(),
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied for re-registered Harness subject ACK, got %v", err)
	}
	reregUnregCtx := testCallerCtx("nimi.harness", "subj-harness-rereg", DomainAgentBodyPC, localappop.OperationAgentBodyPCUnregister)
	_, _ = svc.UnregisterBodyCarrier(reregUnregCtx, &runtimev1.UnregisterBodyCarrierRequest{
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          rereg.GetLeaseEpoch(),
	})

	// 6. Original bound Harness subject (subj-harness-orig) comes online -> receives exact edited brief!
	origRegCtx := testCallerCtx("nimi.harness", "subj-harness-orig", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	origReg, err := svc.RegisterBodyCarrier(origRegCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "orig-inst",
	})
	if err != nil {
		t.Fatalf("original harness register failed: %v", err)
	}
	if len(origReg.GetPendingIntents()) != 1 {
		t.Fatalf("expected exactly 1 pending intent for original bound Harness, got %d", len(origReg.GetPendingIntents()))
	}
	var payloadObj map[string]any
	if err := json.Unmarshal([]byte(origReg.GetPendingIntents()[0].GetPayloadJson()), &payloadObj); err != nil {
		t.Fatalf("unmarshal intent payload: %v", err)
	}
	if got, _ := payloadObj["handoffBriefText"].(string); got != confirmedBrief {
		t.Fatalf("expected exact confirmed edited brief %q, got %q", confirmedBrief, got)
	}

	// Original Harness ACKs outbox and reports projection + milestone.
	origAckCtx := testCallerCtx("nimi.harness", "subj-harness-orig", DomainAgentBodyPC, localappop.OperationAgentBodyPCOutboxAck)
	ackResp, err := svc.AckBodyOutbox(origAckCtx, &runtimev1.AckBodyOutboxRequest{
		OutboxId:            outboxID,
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          origReg.GetLeaseEpoch(),
	})
	if err != nil || !ackResp.GetAcked() {
		t.Fatalf("original bound Harness ACK failed: resp=%+v err=%v", ackResp, err)
	}

	origProjCtx := testCallerCtx("nimi.harness", "subj-harness-orig", DomainAgentBodyPC, localappop.OperationAgentBodyPCProjectionReport)
	projResp, err := svc.ReportBodySessionProjection(origProjCtx, &runtimev1.ReportBodySessionProjectionRequest{
		WorkSessionRef:      handoffRef,
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          origReg.GetLeaseEpoch(),
		ProjectionSeq:       1,
		Status:              "running",
		Title:               "春季发布会秘密标题 " + privateTerm,
		WorkspaceRoot:       "/secret/workspace/" + privateTerm,
		LatestReceiptJson:   `{"detail":"含私密摘要 ` + privateTerm + `"}`,
		MilestoneKind:       "completed",
		DeliverablePaths:    []string{"/secret/" + privateTerm + ".md"},
		PendingAttention: &runtimev1.PendingAttentionInput{
			AttentionId:   "att-secret-1",
			AttentionKind: "approval_needed",
			SummaryJson:   `{"prompt":"确认写入 ` + privateTerm + `"}`,
		},
	})
	if err != nil || !projResp.GetApplied() {
		t.Fatalf("original bound Harness projection failed: resp=%+v err=%v", projResp, err)
	}

	// Verify milestone sent to Cognition is strictly content-free (empty TopicSummary & Deliverables)!
	milestoneMu.Lock()
	if len(milestones) != 1 {
		milestoneMu.Unlock()
		t.Fatalf("expected 1 milestone delivery, got %d", len(milestones))
	}
	if milestones[0].TopicSummary != "" || len(milestones[0].Deliverables) != 0 {
		m := milestones[0]
		milestoneMu.Unlock()
		t.Fatalf("restricted handoff milestone leaked brief content: %+v", m)
	}
	milestoneMu.Unlock()

	// 7. Revoke original Harness subject -> subsequent BodyStep / Projection / SideEffect / Outbox all fail closed!
	mu.Lock()
	validSubjects["subj-harness-orig"] = false
	mu.Unlock()
	if _, err := svc.ReportBodySessionProjection(origProjCtx, &runtimev1.ReportBodySessionProjectionRequest{
		WorkSessionRef:      handoffRef,
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          origReg.GetLeaseEpoch(),
		ProjectionSeq:       2,
		Status:              "completed",
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("revoked original Harness must be denied ReportBodySessionProjection, got %v", err)
	}
	origStepCtx := testCallerCtx("nimi.harness", "subj-harness-orig", DomainAgentBodyPC, localappop.OperationAgentBodyPCStepStream)
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      handoffRef,
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          origReg.GetLeaseEpoch(),
	}, &fakeBodyStepStream{ctx: origStepCtx}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("revoked original Harness must be denied StreamLocalAgentBodyStep, got %v", err)
	}
	origSideCtx := testCallerCtx("nimi.harness", "subj-harness-orig", DomainAgentBodyPC, localappop.OperationAgentBodyPCSideEffectAuthorize)
	sideResp, err := svc.AuthorizeBodySideEffect(origSideCtx, &runtimev1.AuthorizeBodySideEffectRequest{
		WorkSessionRef:      handoffRef,
		DeviceId:            "dev-pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          origReg.GetLeaseEpoch(),
		CallId:              "call-1",
		ToolName:            "write_file",
		ActionKind:          "file_write",
		PayloadHash:         "abc",
	})
	if err != nil || sideResp.GetAuthorized() || sideResp.GetDenyReason() != "named_recipient_unauthorized" {
		t.Fatalf("revoked original Harness must be denied side effect, got resp=%+v err=%v", sideResp, err)
	}
}

func TestNamedBriefOverviewOnlyIsolationSearchWatchAndRecall(t *testing.T) {
	ctx := context.Background()
	svc := newStage2Service(t, Options{
		NamedRecipientResolver: func(_ context.Context, _, appID string) (string, error) {
			if appID == NamedHarnessAppID {
				return "subj-harness-1", nil
			}
			return "", ErrNamedRecipientUnavailable
		},
		NamedRecipientVerifier: func(_ context.Context, _, subject, appID string) (bool, error) {
			return appID == NamedHarnessAppID && subject == "subj-harness-1", nil
		},
	})

	// Register Harness so handoff is online.
	hRegCtx := testCallerCtx("nimi.harness", "subj-harness-1", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	hReg, err := svc.RegisterBodyCarrier(hRegCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "h-1",
	})
	if err != nil {
		t.Fatalf("harness register: %v", err)
	}

	// Create 1 normal PC work session + 1 named restricted handoff session sharing a common term ("方案")
	// plus a unique private word ("碧玺密语") in the handoff.
	normalRouteCtx := testCallerCtxWithDomains("nimi.desktop", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit, DomainAgentLocal, DomainAgentSessionManage)
	normResp, err := svc.RouteAndSubmitInput(normalRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:  "agent-xiaoman",
		RequestId:    "req-norm-1",
		Text:         "公开迭代方案梳理",
		EntrySurface: "pc_work",
	})
	if err != nil {
		t.Fatalf("normal session route: %v", err)
	}
	normRef := normResp.GetResolvedWorkSessionRef()

	privateWord := "碧玺密语"
	zhiyuRouteCtx := testCallerCtx("nimi.zhiyu", "subj-zhiyu", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit)
	handoffResp, err := svc.RouteAndSubmitInput(zhiyuRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:      "agent-xiaoman",
		RequestId:        "req-handoff-priv-1",
		Text:             "私密方案 " + privateWord,
		HandoffBriefText: "目标：整理 " + privateWord + " 私密方案文档",
		EntrySurface:     "zhiyu_handoff",
		TrustTierHint:    "trusted",
	})
	if err != nil {
		t.Fatalf("handoff route: %v", err)
	}
	handoffRef := handoffResp.GetResolvedWorkSessionRef()

	updateCtx := testCallerCtxWithDomains("com.third.overview", "subj-overview", DomainAgentLocal, localappop.OperationAgentSessionUpdate, DomainAgentSessionManage, DomainAgentLocal)
	title := "relabel restricted work"
	if _, err := svc.UpdateSession(updateCtx, &runtimev1.UpdateSessionRequest{WorkSessionRef: handoffRef, Title: &title}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("restricted content was mutable through overview access: %v", err)
	}

	// Start WatchSessionOverview for an overview-only App BEFORE projection update to test both baseline AND live delta.
	watchCtx, watchCancel := context.WithCancel(
		testCallerCtxWithDomains("com.third.overview", "subj-overview", DomainAgentSessionManage, localappop.OperationAgentSessionOverviewWatch, DomainAgentSessionManage, DomainAgentLocal),
	)
	defer watchCancel()
	overviewStream := &multiDeltaOverviewStream{ctx: watchCtx, notify: make(chan struct{}, 8)}
	watchDone := make(chan error, 1)
	go func() {
		watchDone <- svc.WatchSessionOverview(&runtimev1.WatchSessionOverviewRequest{AgentHandle: "agent-xiaoman"}, overviewStream)
	}()

	select {
	case <-overviewStream.notify:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for overview baseline delta")
	}

	// Harness updates status + title + receipt + pending attention with privateWord.
	hProjCtx := testCallerCtx("nimi.harness", "subj-harness-1", DomainAgentBodyPC, localappop.OperationAgentBodyPCProjectionReport)
	if _, err := svc.ReportBodySessionProjection(hProjCtx, &runtimev1.ReportBodySessionProjectionRequest{
		WorkSessionRef:      handoffRef,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          hReg.GetLeaseEpoch(),
		ProjectionSeq:       1,
		Status:              "waiting_approval",
		Title:               "更新后的 " + privateWord,
		WorkspaceRoot:       "/private/" + privateWord,
		LatestReceiptJson:   `{"note":"` + privateWord + `"}`,
		PendingAttention: &runtimev1.PendingAttentionInput{
			AttentionId:   "att-watch-1",
			AttentionKind: "approval_needed",
			SummaryJson:   `{"secret":"` + privateWord + `"}`,
		},
	}); err != nil {
		t.Fatalf("harness projection: %v", err)
	}

	select {
	case <-overviewStream.notify:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for live overview delta")
	}
	watchCancel()
	if err := <-watchDone; err != nil && !errors.Is(err, context.Canceled) {
		t.Fatalf("stop overview watcher: %v", err)
	}

	// Inspect BOTH baseline & live deltas delivered to overview-only App:
	// Authorized status MUST be visible, private content MUST be completely redacted!
	deltas := overviewStream.snapshot()
	if len(deltas) < 2 {
		t.Fatalf("expected baseline + live delta, got %d", len(deltas))
	}
	sawLiveStatus := false
	for _, delta := range deltas {
		for _, rec := range delta.GetUpsertedSessions() {
			if rec.GetWorkSessionRef() == handoffRef {
				if rec.GetTitle() != "" || rec.GetWorkspaceRoot() != "" || rec.GetLatestReceiptJson() != "{}" {
					t.Fatalf("overview-only WatchSessionOverview leaked restricted content: %+v", rec)
				}
				if rec.GetStatus() == "waiting_approval" {
					sawLiveStatus = true
				}
			}
		}
		for _, att := range delta.GetAttentionItems() {
			if att.GetWorkSessionRef() == handoffRef && strings.Contains(att.GetSummaryJson(), privateWord) {
				t.Fatalf("overview-only WatchSessionOverview leaked restricted attention summary: %+v", att)
			}
		}
	}
	if !sawLiveStatus {
		t.Fatalf("overview-only WatchSessionOverview did not deliver authorized waiting_approval status")
	}

	// Overview-only App ListSessions without search -> sees BOTH sessions, restricted one content-free.
	ovListCtx := testCallerCtxWithDomains("com.third.overview", "subj-overview", DomainAgentSessionManage, localappop.OperationAgentSessionList, DomainAgentSessionManage, DomainAgentLocal)
	listAll, err := svc.ListSessions(ovListCtx, &runtimev1.ListSessionsRequest{AgentHandle: "agent-xiaoman"})
	if err != nil {
		t.Fatalf("overview ListSessions: %v", err)
	}
	if listAll.GetTotalVisibleCount() != 2 {
		t.Fatalf("expected 2 visible sessions in overview, got %d", listAll.GetTotalVisibleCount())
	}
	for _, item := range listAll.GetItems() {
		if item.GetWorkSessionRef() == handoffRef {
			if item.GetStatus() != "waiting_approval" || item.GetTitle() != "" || item.GetLatestReceiptJson() != "{}" || item.GetWorkspaceRoot() != "" {
				t.Fatalf("overview ListSessions must show authorized status without content: %+v", item)
			}
		}
	}

	// Overview-only App ListSessions searching private word -> 0 hits, TotalVisibleCount == 0!
	listPriv, err := svc.ListSessions(ovListCtx, &runtimev1.ListSessionsRequest{
		AgentHandle: "agent-xiaoman",
		SearchQuery: privateWord,
	})
	if err != nil {
		t.Fatalf("overview private search: %v", err)
	}
	if listPriv.GetTotalVisibleCount() != 0 || len(listPriv.GetItems()) != 0 {
		t.Fatalf("private search leaked restricted session to overview-only app: count=%d items=%+v", listPriv.GetTotalVisibleCount(), listPriv.GetItems())
	}

	// Overview-only App searching shared word "方案" -> ONLY matches normal session (count == 1)!
	listShared, err := svc.ListSessions(ovListCtx, &runtimev1.ListSessionsRequest{
		AgentHandle: "agent-xiaoman",
		SearchQuery: "方案",
	})
	if err != nil {
		t.Fatalf("overview shared search: %v", err)
	}
	if listShared.GetTotalVisibleCount() != 1 || len(listShared.GetItems()) != 1 || listShared.GetItems()[0].GetWorkSessionRef() != normRef {
		t.Fatalf("shared search must exclude restricted session from count/results for overview-only app: count=%d items=%+v", listShared.GetTotalVisibleCount(), listShared.GetItems())
	}

	// Overview-only App GetSession(IncludeRecentEvents=true) -> content-free record, no events.
	ovGetCtx := testCallerCtxWithDomains("com.third.overview", "subj-overview", DomainAgentSessionManage, localappop.OperationAgentSessionGet, DomainAgentSessionManage, DomainAgentLocal)
	getResp, err := svc.GetSession(ovGetCtx, &runtimev1.GetSessionRequest{
		WorkSessionRef:      handoffRef,
		IncludeRecentEvents: true,
	})
	if err != nil {
		t.Fatalf("overview GetSession: %v", err)
	}
	if getResp.GetWorkSessionRecord().GetTitle() != "" || getResp.GetWorkSessionRecord().GetLatestReceiptJson() != "{}" || len(getResp.GetRecentEvents()) != 0 {
		t.Fatalf("overview GetSession leaked content: %+v", getResp)
	}

	// Sender (Zhiyu) & Bound Harness CAN still see content!
	zhiyuGetCtx := testCallerCtx("nimi.zhiyu", "subj-zhiyu", DomainAgentLocal, localappop.OperationAgentSessionGet)
	zGet, err := svc.GetSession(zhiyuGetCtx, &runtimev1.GetSessionRequest{WorkSessionRef: handoffRef})
	if err != nil || !strings.Contains(zGet.GetWorkSessionRecord().GetTitle(), privateWord) {
		t.Fatalf("sender Zhiyu should still view its sent handoff content, got resp=%+v err=%v", zGet, err)
	}
	harnessGetCtx := testCallerCtx("nimi.harness", "subj-harness-1", DomainAgentSessionManage, localappop.OperationAgentSessionGet)
	hGet, err := svc.GetSession(harnessGetCtx, &runtimev1.GetSessionRequest{WorkSessionRef: handoffRef})
	if err != nil || !strings.Contains(hGet.GetWorkSessionRecord().GetTitle(), privateWord) {
		t.Fatalf("authorized bound Harness should view handoff content, got resp=%+v err=%v", hGet, err)
	}

	// Cross-session offline recall & eligible slot keys: restricted handoff MUST be excluded even for overview-only/home caller!
	ovDecision, _ := accountservice.AuthorizedLocalAppDecisionFromContext(ovListCtx)
	eligibleSlots, err := svc.EligibleOfflineRecallSlotKeys(ctx, ovDecision, "agent-xiaoman")
	if err != nil {
		t.Fatalf("EligibleOfflineRecallSlotKeys: %v", err)
	}
	for _, slot := range eligibleSlots {
		if slot == "session_ref:"+handoffRef {
			t.Fatalf("restricted handoff slot leaked into EligibleOfflineRecallSlotKeys: %v", eligibleSlots)
		}
	}
	frame, refs, err := svc.BuildOfflineSessionRecallInjection(ctx, ovDecision, "agent-xiaoman", []OfflineRecallPointer{
		{WorkSessionRef: handoffRef, TopicSummary: "legacy " + privateWord, Score: 10},
		{WorkSessionRef: normRef, TopicSummary: "公开迭代方案梳理", Score: 5},
	})
	if err != nil {
		t.Fatalf("BuildOfflineSessionRecallInjection: %v", err)
	}
	if strings.Contains(frame, privateWord) || strings.Contains(frame, handoffRef) {
		t.Fatalf("offline recall frame leaked restricted handoff into model input: %s", frame)
	}
	if len(refs) != 1 || refs[0] != normRef {
		t.Fatalf("expected only normal session ref recalled, got %v", refs)
	}
}

func TestNamedBriefLegacyMigrationFencesUnprovableSessionsOutboxAndMilestones(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "legacy-sessions.db")
	st, err := OpenStore(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	nowStr := formatRFC3339(time.Now().UTC())
	// Seed a simulated pre-upgrade legacy zhiyu_handoff session, queued outbox, and milestone with private content.
	if _, err := st.writeDB.ExecContext(ctx, `
		INSERT INTO runtime_session(
			work_session_ref, account_id, agent_binding, session_kind, owner_body_kind,
			device_id, publisher_scope_key, title, status, trust_tier, permission_mode,
			latest_receipt_json, topic_summary, last_active_at, created_at, updated_at,
			handoff_sender_subject, handoff_recipient_subject, handoff_recipient_app_id, content_restricted
		) VALUES (
			'ws_legacy_1', 'acct-1', 'agent-xiaoman', 'pc_work', 'os.pc.workspace',
			'local-default', 'subject:subj-zhiyu', '旧私密简报标题', 'queued_body_offline', 'trusted', 'plan-readonly',
			'{"secret":"legacy"}', '旧私密摘要', ?, ?, ?,
			'', '', '', 0
		)`, nowStr, nowStr, nowStr); err != nil {
		t.Fatalf("seed legacy session: %v", err)
	}
	if _, err := st.writeDB.ExecContext(ctx, `
		INSERT INTO runtime_body_outbox(
			outbox_id, account_id, device_id, capability_namespace, work_session_ref,
			agent_binding, command_kind, payload_json, payload_hash, state, created_at,
			recipient_subject, recipient_app_id, recipient_required
		) VALUES (
			'ob_legacy_1', 'acct-1', 'local-default', 'os.pc.workspace', 'ws_legacy_1',
			'agent-xiaoman', 1, '{"entrySurface":"zhiyu_handoff","handoffBriefText":"旧机密简报"}', 'h1', 'pending', ?,
			'', '', 0
		)`, nowStr); err != nil {
		t.Fatalf("seed legacy outbox: %v", err)
	}
	if _, err := st.writeDB.ExecContext(ctx, `
		INSERT INTO runtime_session_milestone(
			delivery_id, account_id, agent_binding, work_session_ref, body_kind, kind, summary, deliverables
		) VALUES (
			'ms_legacy_1', 'acct-1', 'agent-xiaoman', 'ws_legacy_1', 'os.pc.workspace', 'completed', '旧机密里程碑', '["/secret/file.md"]'
		)`); err != nil {
		t.Fatalf("seed legacy milestone: %v", err)
	}
	// Simulate a pre-upgrade database that predates named_handoff_isolation_v1.
	if _, err := st.writeDB.ExecContext(ctx, `DELETE FROM runtime_session_meta WHERE key = 'named_handoff_isolation_v1'`); err != nil {
		t.Fatalf("reset migration marker: %v", err)
	}
	if err := st.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	// Re-opening runs migrateNamedHandoffIsolation automatically.
	svc, err := Open(Options{
		DBPath: dbPath,
		NamedRecipientVerifier: func(context.Context, string, string, string) (bool, error) {
			return true, nil
		},
	})
	if err != nil {
		t.Fatalf("reopen service: %v", err)
	}
	defer func() { _ = svc.Close() }()

	row, err := svc.store.GetSession(ctx, "acct-1", "ws_legacy_1")
	if err != nil {
		t.Fatalf("load migrated legacy session: %v", err)
	}
	if !row.ContentRestricted || row.TopicSummary != "" || row.HandoffRecipientSubject != "" {
		t.Fatalf("legacy session not fenced properly: restricted=%v summary=%q recipient=%q", row.ContentRestricted, row.TopicSummary, row.HandoffRecipientSubject)
	}

	// Even a valid Harness carrier MUST NOT receive the unprovable legacy queued outbox!
	hRegCtx := testCallerCtx("nimi.harness", "subj-harness-any", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	hReg, err := svc.RegisterBodyCarrier(hRegCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "inst-1",
	})
	if err != nil {
		t.Fatalf("harness register: %v", err)
	}
	if len(hReg.GetPendingIntents()) != 0 {
		t.Fatalf("unprovable legacy queued handoff outbox was delivered to carrier: %+v", hReg.GetPendingIntents())
	}

	// Replaying pending legacy milestones MUST deliver scrubbed empty summary/deliverables!
	var delivered []SessionMilestone
	svc.SetMilestoneHook(func(_ context.Context, m SessionMilestone) error {
		delivered = append(delivered, m)
		return nil
	})
	if err := svc.deliverMilestones(ctx, "ws_legacy_1"); err != nil {
		t.Fatalf("deliverMilestones: %v", err)
	}
	if len(delivered) != 1 || delivered[0].TopicSummary != "" || len(delivered[0].Deliverables) != 0 {
		t.Fatalf("legacy milestone was not scrubbed on migration/replay: %+v", delivered)
	}
}
