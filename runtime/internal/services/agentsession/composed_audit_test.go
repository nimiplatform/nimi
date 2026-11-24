package agentsession

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestComposedEndpointSchedulerNoDeadlockAndPreemption(t *testing.T) {
	sched := scheduler.New(scheduler.Config{
		GlobalConcurrency: 2,
		PerAppConcurrency: 2,
	})

	p2Started := make(chan struct{})
	p2Preempted := atomic.Bool{}
	var activeOnEndpoint atomic.Int32
	var maxObservedConcurrent atomic.Int32

	svc := newStage2Service(t, Options{
		Scheduler: sched,
		ReadSetQualifier: func(_ context.Context, _, _, _ string, epoch int64) (bool, int64, error) {
			return true, epoch, nil
		},
		BodyStepExecutor: func(ctx context.Context, in BodyStepExecutionInput, _ BodyStepEmitter) (BodyStepExecutionResult, error) {
			adm, _ := scheduler.ExecutionAdmissionFromContext(ctx)
			release, _, err := sched.AcquireForEndpoint(ctx, in.EndpointKey, adm.Priority, adm.Preempt)
			if err != nil {
				return BodyStepExecutionResult{}, err
			}
			defer release()

			cur := activeOnEndpoint.Add(1)
			for {
				prev := maxObservedConcurrent.Load()
				if cur <= prev || maxObservedConcurrent.CompareAndSwap(prev, cur) {
					break
				}
			}
			defer activeOnEndpoint.Add(-1)

			if in.Purpose == runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION {
				close(p2Started)
				<-ctx.Done()
				p2Preempted.Store(true)
				return BodyStepExecutionResult{}, ctx.Err()
			}
			return BodyStepExecutionResult{
				FinishReason:  "stop",
				AssistantText: "foreground completed",
			}, nil
		},
	})

	regCtx := testCallerCtx("com.custom.pcbody", "subj-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	reg, err := svc.RegisterBodyCarrier(regCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-local",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "inst-local",
	})
	if err != nil {
		t.Fatalf("RegisterBodyCarrier: %v", err)
	}
	routeCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit)
	r1, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:   "agent-local-1",
		RequestId:     "req-sched-1",
		Text:          "task one",
		WorkspaceRoot: `D:\work\one`,
	})
	if err != nil {
		t.Fatalf("route 1: %v", err)
	}
	r2, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:   "agent-local-1",
		RequestId:     "req-sched-2",
		Text:          "task two",
		WorkspaceRoot: `D:\work\two`,
	})
	if err != nil {
		t.Fatalf("route 2: %v", err)
	}

	stepCtx := testCallerCtx("com.custom.pcbody", "subj-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCStepStream)
	// Start P2 compaction holding the single cap=1 local endpoint slot.
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		stP2 := &fakeBodyStepStream{ctx: stepCtx}
		_ = svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
			WorkSessionRef:      r1.GetResolvedWorkSessionRef(),
			DeviceId:            "dev-local",
			CapabilityNamespace: DefaultPCNamespace,
			LeaseEpoch:          reg.GetLeaseEpoch(),
			Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION,
			WorkingMessages:     []*runtimev1.BodyWorkingMessage{{Role: "user", ContentJson: `"compact me"`}},
		}, stP2)
	}()

	select {
	case <-p2Started:
	case <-time.After(2 * time.Second):
		t.Fatal("P2 compaction never acquired local endpoint")
	}

	// Launch P0 foreground inference on the same local endpoint: MUST preempt P2 and finish without deadlock!
	p0Done := make(chan error, 1)
	go func() {
		stP0 := &fakeBodyStepStream{ctx: stepCtx}
		p0Done <- svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
			WorkSessionRef:      r2.GetResolvedWorkSessionRef(),
			DeviceId:            "dev-local",
			CapabilityNamespace: DefaultPCNamespace,
			LeaseEpoch:          reg.GetLeaseEpoch(),
			Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
			WorkingMessages:     []*runtimev1.BodyWorkingMessage{{Role: "user", ContentJson: `"urgent foreground"`}},
		}, stP0)
	}()

	select {
	case err := <-p0Done:
		if err != nil {
			t.Fatalf("P0 foreground step failed: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("DEADLOCK: P0 foreground step failed to preempt P2 on cap=1 local endpoint")
	}
	wg.Wait()
	if !p2Preempted.Load() {
		t.Fatalf("expected P2 compaction to be cooperatively preempted")
	}
	if maxObservedConcurrent.Load() > 1 {
		t.Fatalf("endpoint cap=1 violated: observed %d concurrent executions", maxObservedConcurrent.Load())
	}
}

func TestComposedSingleAnchorRollingLedgerCompactionAndOnceOnlySideEffects(t *testing.T) {
	stepNum := 0
	svc := newStage2Service(t, Options{
		ReadSetQualifier: func(_ context.Context, _, _, _ string, epoch int64) (bool, int64, error) {
			return true, epoch, nil
		},
		BodyStepExecutor: func(_ context.Context, in BodyStepExecutionInput, emitter BodyStepEmitter) (BodyStepExecutionResult, error) {
			if in.Purpose == runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION {
				return BodyStepExecutionResult{
					FinishReason:      "stop",
					CompactionSummary: "Key milestone achieved",
				}, nil
			}
			stepNum++
			if stepNum == 1 {
				tc := &runtimev1.BodyToolCall{
					CallId:        "call_write_1",
					Name:          "write_file",
					ArgumentsJson: `{"path":"a.txt","content":"hi"}`,
				}
				_ = emitter.SendToolCall(tc)
				return BodyStepExecutionResult{
					FinishReason:    "tool_calls",
					AssistantText:   "writing a.txt",
					IssuedToolCalls: []*runtimev1.BodyToolCall{tc},
				}, nil
			}
			return BodyStepExecutionResult{
				FinishReason:  "stop",
				AssistantText: "all done",
			}, nil
		},
	})

	regCtx := testCallerCtx("com.custom.pcbody", "subj-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	reg, err := svc.RegisterBodyCarrier(regCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "inst-1",
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	routeCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit)
	writableRoute, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:       "agent-1",
		RequestId:         "req-ledger-w",
		Text:              "edit a.txt",
		WorkspaceRoot:     `D:\work\proj`,
		WorkspaceWritable: true,
	})
	if err != nil {
		t.Fatalf("route writable: %v", err)
	}
	roRoute, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:       "agent-1",
		RequestId:         "req-ledger-ro",
		Text:              "plan only",
		WorkspaceRoot:     `D:\work\readonly`,
		WorkspaceWritable: false,
	})
	if err != nil {
		t.Fatalf("route readonly: %v", err)
	}

	wsW := writableRoute.GetResolvedWorkSessionRef()
	wsRO := roRoute.GetResolvedWorkSessionRef()
	stepCtx := testCallerCtx("com.custom.pcbody", "subj-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCStepStream)
	authCtx := testCallerCtx("com.custom.pcbody", "subj-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCSideEffectAuthorize)

	// Step 1 on writable session
	u1 := &runtimev1.BodyWorkingMessage{Role: "user", ContentJson: `"edit a.txt"`}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsW,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{u1},
	}, &fakeBodyStepStream{ctx: stepCtx}); err != nil {
		t.Fatalf("step 1: %v", err)
	}

	// Step 1 on plan-readonly session + verify file_write is denied by permission_mode!
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsRO,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{{Role: "user", ContentJson: `"plan only"`}},
	}, &fakeBodyStepStream{ctx: stepCtx}); err != nil {
		t.Fatalf("readonly step 1: %v", err)
	}
	if resp, err := svc.AuthorizeBodySideEffect(authCtx, &runtimev1.AuthorizeBodySideEffectRequest{
		WorkSessionRef:      wsRO,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		CallId:              "call_write_1",
		ToolName:            "write_file",
		PayloadHash:         sha256HexString(`{"path":"a.txt","content":"hi"}`),
		ActionKind:          "file_write",
	}); err != nil || resp.GetAuthorized() {
		t.Fatalf("plan-readonly MUST deny file_write, got %+v err=%v", resp, err)
	}

	// Fail-closed AuthorizeBodySideEffect matrix on writable session
	validHash := sha256HexString(`{"content":"hi","path":"a.txt"}`) // canonical JCS order!
	badCases := []struct {
		name string
		req  *runtimev1.AuthorizeBodySideEffectRequest
	}{
		{"empty_tool_name", &runtimev1.AuthorizeBodySideEffectRequest{WorkSessionRef: wsW, DeviceId: "dev-1", CapabilityNamespace: DefaultPCNamespace, LeaseEpoch: reg.GetLeaseEpoch(), CallId: "call_write_1", ToolName: "", PayloadHash: validHash, ActionKind: "file_write"}},
		{"wrong_tool_name", &runtimev1.AuthorizeBodySideEffectRequest{WorkSessionRef: wsW, DeviceId: "dev-1", CapabilityNamespace: DefaultPCNamespace, LeaseEpoch: reg.GetLeaseEpoch(), CallId: "call_write_1", ToolName: "shell_exec", PayloadHash: validHash, ActionKind: "file_write"}},
		{"unknown_action_kind", &runtimev1.AuthorizeBodySideEffectRequest{WorkSessionRef: wsW, DeviceId: "dev-1", CapabilityNamespace: DefaultPCNamespace, LeaseEpoch: reg.GetLeaseEpoch(), CallId: "call_write_1", ToolName: "write_file", PayloadHash: validHash, ActionKind: "unlisted_kind"}},
		{"wrong_payload_hash", &runtimev1.AuthorizeBodySideEffectRequest{WorkSessionRef: wsW, DeviceId: "dev-1", CapabilityNamespace: DefaultPCNamespace, LeaseEpoch: reg.GetLeaseEpoch(), CallId: "call_write_1", ToolName: "write_file", PayloadHash: sha256HexString(`{"path":"evil.txt"}`), ActionKind: "file_write"}},
	}
	for _, tc := range badCases {
		resp, err := svc.AuthorizeBodySideEffect(authCtx, tc.req)
		if err != nil || resp.GetAuthorized() {
			t.Fatalf("%s MUST be denied, got resp=%+v err=%v", tc.name, resp, err)
		}
	}

	// Valid once-only consumption succeeds first time, denies second time!
	okResp, err := svc.AuthorizeBodySideEffect(authCtx, &runtimev1.AuthorizeBodySideEffectRequest{
		WorkSessionRef:      wsW,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		CallId:              "call_write_1",
		ToolName:            "write_file",
		PayloadHash:         validHash,
		ActionKind:          "file_write",
	})
	if err != nil || !okResp.GetAuthorized() {
		t.Fatalf("expected valid AuthorizeBodySideEffect to succeed, resp=%+v err=%v", okResp, err)
	}
	replayResp, err := svc.AuthorizeBodySideEffect(authCtx, &runtimev1.AuthorizeBodySideEffectRequest{
		WorkSessionRef:      wsW,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		CallId:              "call_write_1",
		ToolName:            "write_file",
		PayloadHash:         validHash,
		ActionKind:          "file_write",
	})
	if err != nil || replayResp.GetAuthorized() || replayResp.GetDenyReason() != "tool_call_already_consumed" {
		t.Fatalf("replay MUST be rejected as consumed, resp=%+v err=%v", replayResp, err)
	}

	// Tampering emitted assistant turn MUST be rejected by rolling LastStepMAC!
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsW,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages: []*runtimev1.BodyWorkingMessage{
			u1,
			{Role: "assistant", ContentJson: `"FORGED ASSISTANT TURN"`},
		},
	}, &fakeBodyStepStream{ctx: stepCtx}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("forged assistant turn MUST fail with FailedPrecondition, got %v", err)
	}

	// Exact emitted assistant + tool result + tail user message
	asst1 := buildAssistantWorkingMessage("writing a.txt", []*runtimev1.BodyToolCall{{
		CallId:        "call_write_1",
		Name:          "write_file",
		ArgumentsJson: `{"path":"a.txt","content":"hi"}`,
	}})
	tr1 := &runtimev1.BodyWorkingMessage{Role: "toolResult", ToolCallId: "call_write_1", ContentJson: `"written"`}
	uTail := &runtimev1.BodyWorkingMessage{Role: "user", ContentJson: `"next step"`}

	// COMPACTION smuggling a fabricated kept_tail NOT matching suffix of WorkingMessages MUST fail!
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsW,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{u1, asst1, tr1, uTail},
		KeptTailMessages:    []*runtimev1.BodyWorkingMessage{{Role: "user", ContentJson: `"SMUGGLED TAIL"`}},
	}, &fakeBodyStepStream{ctx: stepCtx}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("smuggled kept_tail MUST fail with FailedPrecondition, got %v", err)
	}

	// Valid COMPACTION with real suffix succeeds!
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsW,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{u1, asst1, tr1, uTail},
		KeptTailMessages:    []*runtimev1.BodyWorkingMessage{uTail},
	}, &fakeBodyStepStream{ctx: stepCtx}); err != nil {
		t.Fatalf("valid compaction failed: %v", err)
	}

	// Post-compaction Step 3 with pi-durable SUMMARY_PREFIX/SUMMARY_SUFFIX succeeds!
	summaryMsg := &runtimev1.BodyWorkingMessage{
		Role:        "user",
		ContentJson: piDurableSummaryPrefix + "Key milestone achieved" + piDurableSummarySuffix,
	}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsW,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{summaryMsg, uTail},
	}, &fakeBodyStepStream{ctx: stepCtx}); err != nil {
		t.Fatalf("post-compaction step 3 failed: %v", err)
	}

	// Post-compaction Step 4 tampering Step 3 assistant output MUST fail!
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsW,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages: []*runtimev1.BodyWorkingMessage{
			summaryMsg,
			uTail,
			{Role: "assistant", ContentJson: `"FORGED POST-COMPACTION OUTPUT"`},
		},
	}, &fakeBodyStepStream{ctx: stepCtx}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("post-compaction rolling MAC tamper MUST fail, got %v", err)
	}
}

func TestComposedReadSetInvalidationAckAdvancesEpochAndProjectionHardening(t *testing.T) {
	var currentEpoch int64 = 10
	svc := newStage2Service(t, Options{
		ReadSetQualifier: func(_ context.Context, _, _, _ string, lastEpoch int64) (bool, int64, error) {
			if lastEpoch > 0 && lastEpoch != currentEpoch {
				return false, currentEpoch, nil
			}
			return true, currentEpoch, nil
		},
		BodyStepExecutor: func(_ context.Context, _ BodyStepExecutionInput, _ BodyStepEmitter) (BodyStepExecutionResult, error) {
			return BodyStepExecutionResult{FinishReason: "stop", AssistantText: "ok"}, nil
		},
	})

	regCtx := testCallerCtx("com.custom.pcbody", "subj-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister)
	reg1, err := svc.RegisterBodyCarrier(regCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "inst-1",
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	routeCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit)
	routed, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:       "agent-1",
		RequestId:         "req-inv-1",
		Text:              "plan task",
		WorkspaceRoot:     `D:\work\proj`,
		WorkspaceWritable: false, // plan-readonly!
	})
	if err != nil {
		t.Fatalf("route: %v", err)
	}
	wsRef := routed.GetResolvedWorkSessionRef()
	stepCtx := testCallerCtx("com.custom.pcbody", "subj-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCStepStream)

	u1 := &runtimev1.BodyWorkingMessage{Role: "user", ContentJson: `"step 1"`}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsRef,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg1.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{u1},
	}, &fakeBodyStepStream{ctx: stepCtx}); err != nil {
		t.Fatalf("initial step: %v", err)
	}

	// Memory forgotten -> epoch advances to 42 -> step fails and enqueues INVALIDATE_MEMORY!
	currentEpoch = 42
	asst1 := buildAssistantWorkingMessage("ok", nil)
	u2 := &runtimev1.BodyWorkingMessage{Role: "user", ContentJson: `"step 2"`}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsRef,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg1.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{u1, asst1, u2},
	}, &fakeBodyStepStream{ctx: stepCtx}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected invalidation FailedPrecondition, got %v", err)
	}

	tombstones, _, err := svc.Store().ListPendingOutbox(context.Background(), "acct-1", "dev-1", DefaultPCNamespace)
	if err != nil || len(tombstones) != 1 {
		t.Fatalf("expected 1 INVALIDATE_MEMORY tombstone, got %+v err=%v", tombstones, err)
	}

	// ACK INVALIDATE_MEMORY -> advances ledger.ReadSetEpoch to 42 -> next step recovers cleanly!
	ackCtx := testCallerCtx("com.custom.pcbody", "subj-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCOutboxAck)
	if resp, err := svc.AckBodyOutbox(ackCtx, &runtimev1.AckBodyOutboxRequest{
		OutboxId:            tombstones[0].GetOutboxId(),
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg1.GetLeaseEpoch(),
	}); err != nil || !resp.GetAcked() {
		t.Fatalf("AckBodyOutbox: resp=%+v err=%v", resp, err)
	}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      wsRef,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg1.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{u1, asst1, u2},
	}, &fakeBodyStepStream{ctx: stepCtx}); err != nil {
		t.Fatalf("step after INVALIDATE_MEMORY ACK MUST recover cleanly, got %v", err)
	}

	// Body MUST NOT escalate permission_mode from plan-readonly -> workspace-edit via ReportBodySessionProjection!
	projCtx := testCallerCtx("com.custom.pcbody", "subj-pc", DomainAgentBodyPC, localappop.OperationAgentBodyPCProjectionReport)
	if _, err := svc.ReportBodySessionProjection(projCtx, &runtimev1.ReportBodySessionProjectionRequest{
		WorkSessionRef:      wsRef,
		DeviceId:            "dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg1.GetLeaseEpoch(),
		ProjectionSeq:       1,
		PermissionMode:      "workspace-edit",
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("Body permission_mode escalation MUST fail with PermissionDenied, got %v", err)
	}
}

func TestComposedZeroPrivilegeSubjectIsolationAndPagination(t *testing.T) {
	svc := newStage2Service(t, Options{})

	// Two subjects sharing the EXACT SAME app_id MUST be completely isolated!
	subjACtx := testCallerCtxWithDomains("com.shared.id", "subj-alpha", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit, DomainAgentLocal)
	subjBCtx := testCallerCtxWithDomains("com.shared.id", "subj-beta", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit, DomainAgentLocal)

	rA, err := svc.RouteAndSubmitInput(subjACtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:   "agent-1",
		RequestId:     "req-iso-a",
		Text:          "alpha private chat",
		EntrySurface:  "channel:im:room-1",
		TrustTierHint: "external_channel",
	})
	if err != nil {
		t.Fatalf("subjA route: %v", err)
	}
	if _, err := svc.RouteAndSubmitInput(subjBCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:   "agent-1",
		RequestId:     "req-iso-b",
		Text:          "beta private chat",
		EntrySurface:  "channel:im:room-1",
		TrustTierHint: "external_channel",
	}); err != nil {
		t.Fatalf("subjB route: %v", err)
	}

	listBCtx := testCallerCtxWithDomains("com.shared.id", "subj-beta", DomainAgentLocal, localappop.OperationAgentSessionList, DomainAgentLocal)
	listB, err := svc.ListSessions(listBCtx, &runtimev1.ListSessionsRequest{})
	if err != nil {
		t.Fatalf("listB: %v", err)
	}
	for _, item := range listB.GetItems() {
		if item.GetWorkSessionRef() == rA.GetResolvedWorkSessionRef() {
			t.Fatalf("subj-beta leaked subj-alpha session despite identical app_id!")
		}
	}

	// Pagination across 5 distinct sessions with PageSize=2
	adminRouteCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit)
	for i := 0; i < 5; i++ {
		if _, err := svc.RouteAndSubmitInput(adminRouteCtx, &runtimev1.RouteAndSubmitInputRequest{
			AgentHandle:   "agent-page",
			RequestId:     "req-page-" + string(rune('a'+i)),
			Text:          "paged work " + string(rune('a'+i)),
			WorkspaceRoot: `D:\work\p` + string(rune('a'+i)),
		}); err != nil {
			t.Fatalf("create paged %d: %v", i, err)
		}
	}
	adminListCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionList)
	seen := make(map[string]bool)
	token := ""
	pages := 0
	for {
		pages++
		resp, err := svc.ListSessions(adminListCtx, &runtimev1.ListSessionsRequest{
			AgentHandle: "agent-page",
			PageSize:    2,
			PageToken:   token,
		})
		if err != nil {
			t.Fatalf("ListSessions page %d: %v", pages, err)
		}
		for _, item := range resp.GetItems() {
			if seen[item.GetWorkSessionRef()] {
				t.Fatalf("duplicate session %q returned across pages", item.GetWorkSessionRef())
			}
			seen[item.GetWorkSessionRef()] = true
		}
		if resp.GetNextPageToken() == "" {
			break
		}
		token = resp.GetNextPageToken()
		if pages > 10 {
			t.Fatal("pagination loop did not terminate")
		}
	}
	if len(seen) != 5 {
		t.Fatalf("expected 5 unique sessions across pages, got %d", len(seen))
	}
}

func TestComposedHonestDesktopAlarmsAndFailClosedExternalChannels(t *testing.T) {
	clock := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	var svc *Service
	svc = newStage2Service(t, Options{
		Now: func() time.Time { return clock },
		SupportedDeliveryChannel: func(channel string) bool {
			switch strings.ToLower(strings.TrimSpace(channel)) {
			case "desktop_notification", "desktop", "home", "local":
				return true
			default:
				return false
			}
		},
		AlarmDeliverySender: func(ctx context.Context, accountID string, alarm *runtimev1.SessionAlarmRecord, channel, renderedTitle, renderedBody string, _ time.Duration) AlarmDeliveryOutcome {
			ref, err := svc.NotifyDesktopAlarm(ctx, accountID, alarm, renderedTitle, renderedBody)
			if err != nil {
				return AlarmDeliveryOutcome{ReceiptState: runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED, Detail: err.Error()}
			}
			return AlarmDeliveryOutcome{ReceiptState: runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_PROVIDER_ACCEPTED, ProviderMessageRef: ref}
		},
	})

	createCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmCreate)
	// Unconnected external IM channel MUST fail closed immediately at CreateAlarm!
	if _, err := svc.CreateAlarm(createCtx, &runtimev1.CreateAlarmRequest{
		AgentHandle:      "agent-1",
		AlarmKind:        runtimev1.AlarmKind_ALARM_KIND_DELAY,
		DelaySeconds:     10,
		TemplateTitle:    "WeChat reminder",
		DeliveryChannels: []string{"wechat"},
	}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("unconnected wechat channel MUST fail closed at CreateAlarm, got %v", err)
	}

	// Default desktop notification succeeds and delivers honestly via NotifyDesktopAlarm!
	created, err := svc.CreateAlarm(createCtx, &runtimev1.CreateAlarmRequest{
		AgentHandle:   "agent-1",
		AlarmKind:     runtimev1.AlarmKind_ALARM_KIND_DELAY,
		DelaySeconds:  5,
		TemplateTitle: "Desktop standup",
		TemplateBody:  "Time for standup",
	})
	if err != nil {
		t.Fatalf("CreateAlarm desktop: %v", err)
	}
	clock = clock.Add(10 * time.Second)
	fires, err := svc.TickAlarms(context.Background(), clock)
	if err != nil || len(fires) != 1 || len(fires[0].Deliveries) != 1 {
		t.Fatalf("TickAlarms: fires=%+v err=%v", fires, err)
	}
	if fires[0].Deliveries[0].ReceiptState != runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_PROVIDER_ACCEPTED {
		t.Fatalf("expected PROVIDER_ACCEPTED for desktop notification, got %+v", fires[0].Deliveries[0])
	}
	att, err := svc.Store().ListPendingAttention(context.Background(), "acct-1")
	if err != nil || len(att) != 1 || att[0].GetAttentionKind() != "alarm_reminder" {
		t.Fatalf("expected durable desktop alarm PendingAttentionRecord, got %+v err=%v", att, err)
	}

	// Unknown replyToMessageRef MUST NOT fall back to the recent alarm!
	res, err := svc.ResolveAlarmReplyTarget(context.Background(), "acct-1", "agent-1", "nonexistent-msg-ref", clock)
	if err != nil || res.MatchedAlarm != nil || len(res.AmbiguousAlarms) != 0 {
		t.Fatalf("unknown replyToMessageRef must NOT match unrelated alarm, got %+v err=%v", res, err)
	}

	// Cancelled alarm MUST NOT be revivable via UpdateAlarm!
	delCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmDelete)
	updCtx := testCallerCtx("nimi.desktop", "subj-home", DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmUpdate)
	if _, err := svc.DeleteAlarm(delCtx, &runtimev1.DeleteAlarmRequest{AlarmId: created.GetAlarm().GetAlarmId()}); err != nil {
		t.Fatalf("DeleteAlarm: %v", err)
	}
	revive := "active"
	if _, err := svc.UpdateAlarm(updCtx, &runtimev1.UpdateAlarmRequest{
		AlarmId: created.GetAlarm().GetAlarmId(),
		Status:  &revive,
	}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("cancelled alarm MUST NOT be revivable via UpdateAlarm, got %v", err)
	}
}
