package agentsession

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
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

type fakeOverviewStream struct {
	grpc.ServerStream
	ctx    context.Context
	cancel context.CancelFunc
	deltas []*runtimev1.SessionOverviewDelta
}

func (f *fakeOverviewStream) Context() context.Context    { return f.ctx }
func (f *fakeOverviewStream) SetHeader(metadata.MD) error  { return nil }
func (f *fakeOverviewStream) SendHeader(metadata.MD) error { return nil }
func (f *fakeOverviewStream) SetTrailer(metadata.MD)       {}
func (f *fakeOverviewStream) Send(d *runtimev1.SessionOverviewDelta) error {
	f.deltas = append(f.deltas, d)
	if f.cancel != nil {
		f.cancel()
	}
	return nil
}

type fakeBrainEventStream struct {
	grpc.ServerStream
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	events []*runtimev1.BrainSessionEventEnvelope
	target int
}

func (f *fakeBrainEventStream) Context() context.Context    { return f.ctx }
func (f *fakeBrainEventStream) SetHeader(metadata.MD) error  { return nil }
func (f *fakeBrainEventStream) SendHeader(metadata.MD) error { return nil }
func (f *fakeBrainEventStream) SetTrailer(metadata.MD)       {}
func (f *fakeBrainEventStream) Send(ev *runtimev1.BrainSessionEventEnvelope) error {
	f.mu.Lock()
	f.events = append(f.events, ev)
	n := len(f.events)
	f.mu.Unlock()
	if f.target > 0 && n >= f.target && f.cancel != nil {
		f.cancel()
	}
	return nil
}

func callerCtxWithExactDomains(appID, subject, opCap string, op localappop.Operation, activatedCSV string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AppID:                appID,
		AccountID:            "acct-1",
		RegisteredAppSubject: subject,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		Operation:            op,
		OperationCapability:  opCap,
		ActivatedDomains:     activatedCSV,
		TrustClass:           accountservice.LocalAppTrustClassUserImported,
		ExpiresAt:            time.Now().UTC().Add(time.Hour),
	})
}

func TestAuditForkCCapabilityOrthogonalityAndSingleSubjectLeaseFence(t *testing.T) {
	svc := newStage2Service(t, Options{})

	// Subject A (app.alpha) creates a session with agent.local only.
	routeA := callerCtxWithExactDomains("app.alpha", "subj-alpha", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit, DomainAgentLocal)
	respA, err := svc.RouteAndSubmitInput(routeA, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:  "agent-1",
		RequestId:    "req-alpha-1",
		Text:         "private alpha note",
		EntrySurface: "app.alpha",
	})
	if err != nil {
		t.Fatalf("alpha RouteAndSubmitInput: %v", err)
	}
	alphaRef := respA.GetResolvedWorkSessionRef()

	// Subject B (app.pcbody) has agent.local + agent.body.pc WITHOUT agent.session.manage.
	// It MUST NOT see, get, or delete Subject A's session, nor route writable workspaces!
	listB := callerCtxWithExactDomains("app.pcbody", "subj-pcbody", DomainAgentLocal, localappop.OperationAgentSessionList, DomainAgentLocal+","+DomainAgentBodyPC)
	listed, err := svc.ListSessions(listB, &runtimev1.ListSessionsRequest{AgentHandle: "agent-1"})
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(listed.GetItems()) != 0 {
		t.Fatalf("agent.body.pc WITHOUT agent.session.manage leaked cross-publisher sessions: %+v", listed.GetItems())
	}

	delB := callerCtxWithExactDomains("app.pcbody", "subj-pcbody", DomainAgentLocal, localappop.OperationAgentSessionDelete, DomainAgentLocal+","+DomainAgentBodyPC)
	if _, err := svc.DeleteSession(delB, &runtimev1.DeleteSessionRequest{WorkSessionRef: alphaRef, Confirmed: true}); status.Code(err) != codes.NotFound {
		t.Fatalf("agent.body.pc WITHOUT agent.session.manage must NOT delete other publisher session, got %v", err)
	}

	routeWriteB := callerCtxWithExactDomains("app.pcbody", "subj-pcbody", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit, DomainAgentLocal+","+DomainAgentBodyPC)
	if _, err := svc.RouteAndSubmitInput(routeWriteB, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:       "agent-1",
		RequestId:         "req-pcbody-write",
		Text:              "edit repo",
		WorkspaceRoot:     "/repo",
		WorkspaceWritable: true,
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("agent.body.pc WITHOUT agent.session.manage must NOT route writable workspace, got %v", err)
	}

	// Single-active-subject lease fence: Subject B registers on device "pc-a";
	// Subject C (another agent.body.pc app) MUST be rejected even on a DIFFERENT device "pc-b"!
	regB := callerCtxWithExactDomains("app.pcbody", "subj-pcbody", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister, DomainAgentBodyPC)
	if _, err := svc.RegisterBodyCarrier(regB, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "pc-a",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "inst-a",
	}); err != nil {
		t.Fatalf("RegisterBodyCarrier subj-pcbody: %v", err)
	}
	regC := callerCtxWithExactDomains("app.rival", "subj-rival", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister, DomainAgentBodyPC)
	if _, err := svc.RegisterBodyCarrier(regC, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "pc-b",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "inst-b",
	}); status.Code(err) != codes.PermissionDenied && status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("competing subject on different device_id MUST fail with lease conflict, got %v", err)
	}

	// Option A: WatchSessionOverview baseline must report active_pc_carrier_app_id == "app.pcbody" (NOT hardcoded nimi.harness!).
	watchBaseCtx, watchCancel := context.WithCancel(callerCtxWithExactDomains("app.home", "subj-home", DomainAgentSessionManage, localappop.OperationAgentSessionOverviewWatch, DomainAgentLocal+","+DomainAgentSessionManage))
	defer watchCancel()
	ovStream := &fakeOverviewStream{ctx: watchBaseCtx, cancel: watchCancel}
	_ = svc.WatchSessionOverview(&runtimev1.WatchSessionOverviewRequest{}, ovStream)
	if len(ovStream.deltas) == 0 || !ovStream.deltas[0].GetCarrierOnline() || ovStream.deltas[0].GetActivePcCarrierAppId() != "app.pcbody" {
		t.Fatalf("expected Option A active_pc_carrier_app_id=app.pcbody, got %+v", ovStream.deltas)
	}
}

func TestAuditDeleteSessionCrashRecoveryAndRetry(t *testing.T) {
	var failCleanup atomic.Bool
	failCleanup.Store(true)
	var cleanupCalls atomic.Int32

	svc := newStage2Service(t, Options{
		MemoryCleanupHook: func(_ context.Context, _, _, _ string) (uint32, error) {
			cleanupCalls.Add(1)
			if failCleanup.Load() {
				return 0, errors.New("simulated memory.db transient error")
			}
			return 2, nil
		},
	})

	routeCtx := callerCtxWithExactDomains("app.home", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit, DomainAgentLocal+","+DomainAgentSessionManage)
	routed, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:       "agent-1",
		RequestId:         "req-del-1",
		Text:              "build app",
		WorkspaceRoot:     "/ws",
		WorkspaceWritable: true,
	})
	if err != nil {
		t.Fatalf("RouteAndSubmitInput: %v", err)
	}
	ref := routed.GetResolvedWorkSessionRef()

	// First DeleteSession marks session 'deleting' then fails at Cognition cleanup.
	delCtx := callerCtxWithExactDomains("app.home", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionDelete, DomainAgentLocal+","+DomainAgentSessionManage)
	if _, err := svc.DeleteSession(delCtx, &runtimev1.DeleteSessionRequest{WorkSessionRef: ref, Confirmed: true}); status.Code(err) != codes.Internal {
		t.Fatalf("expected Internal error on simulated Cognition failure, got %v", err)
	}

	// Session must be invisible to normal GetSession but visible to DeleteSession retry!
	if _, err := svc.Store().GetSession(context.Background(), "acct-1", ref); !errors.Is(err, errSessionNotFound) {
		t.Fatalf("expected normal GetSession to hide deleting row, got %v", err)
	}

	// Retry DeleteSession after transient error clears -> MUST succeed and enqueue PURGE_SESSION!
	failCleanup.Store(false)
	delResp, err := svc.DeleteSession(delCtx, &runtimev1.DeleteSessionRequest{WorkSessionRef: ref, Confirmed: true})
	if err != nil || !delResp.GetDeleted() || delResp.GetForgottenMemoryCount() != 2 || delResp.GetOutboxId() == "" {
		t.Fatalf("DeleteSession retry from 'deleting' MUST converge, got resp=%+v err=%v", delResp, err)
	}
	if cleanupCalls.Load() != 2 {
		t.Fatalf("expected 2 cleanup attempts, got %d", cleanupCalls.Load())
	}

	// Also test RecoverPendingDeletions directly on a second session stuck in 'deleting'.
	routed2, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:       "agent-1",
		RequestId:         "req-del-2",
		Text:              "second task",
		WorkspaceRoot:     "/ws2",
		WorkspaceWritable: true,
	})
	if err != nil {
		t.Fatalf("RouteAndSubmitInput 2: %v", err)
	}
	failCleanup.Store(true)
	_, _ = svc.DeleteSession(delCtx, &runtimev1.DeleteSessionRequest{WorkSessionRef: routed2.GetResolvedWorkSessionRef(), Confirmed: true})
	failCleanup.Store(false)
	if err := svc.RecoverPendingDeletions(context.Background()); err != nil {
		t.Fatalf("RecoverPendingDeletions: %v", err)
	}
	stillDeleting, err := svc.Store().ListDeletingSessions(context.Background())
	if err != nil || len(stillDeleting) != 0 {
		t.Fatalf("expected 0 sessions stuck in deleting after recovery, got %+v err=%v", stillDeleting, err)
	}
}

func TestAuditToolGrantNoUnconsumeAndStepReplayAcrossStreamDrop(t *testing.T) {
	var stepInvocations atomic.Int32
	svc := newStage2Service(t, Options{
		ReadSetQualifier: func(_ context.Context, _, _, _ string, epoch int64) (bool, int64, error) {
			return true, epoch, nil
		},
		BodyStepExecutor: func(_ context.Context, in BodyStepExecutionInput, emitter BodyStepEmitter) (BodyStepExecutionResult, error) {
			n := stepInvocations.Add(1)
			if in.Purpose == runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION {
				// Simulate bad model trying to emit empty summary on compaction
				return BodyStepExecutionResult{FinishReason: "stop", CompactionSummary: ""}, nil
			}
			if n == 1 {
				// Emit tool call containing HTML/JSX characters `<`, `>`, `&&`!
				call := &runtimev1.BodyToolCall{
					CallId:        "call_html_1",
					Name:          "write",
					ArgumentsJson: `{"content":"<div>a && b</div>","path":"App.tsx"}`,
				}
				_ = emitter.SendToolCall(call)
				return BodyStepExecutionResult{
					FinishReason:    "tool_calls",
					AssistantText:   "Writing App.tsx",
					IssuedToolCalls: []*runtimev1.BodyToolCall{call},
				}, nil
			}
			// Step 2: model repeats call_html_1 — MUST NOT un-consume call_html_1!
			dupCall := &runtimev1.BodyToolCall{
				CallId:        "call_html_1",
				Name:          "write",
				ArgumentsJson: `{"content":"<div>a && b</div>","path":"App.tsx"}`,
			}
			_ = emitter.SendToolCall(dupCall)
			return BodyStepExecutionResult{
				FinishReason:    "stop",
				AssistantText:   "Done",
				IssuedToolCalls: []*runtimev1.BodyToolCall{dupCall},
			}, nil
		},
	})

	regCtx := callerCtxWithExactDomains("app.harness", "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister, DomainAgentLocal+","+DomainAgentSessionManage+","+DomainAgentBodyPC)
	reg, err := svc.RegisterBodyCarrier(regCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "pc-dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "inst-1",
	})
	if err != nil {
		t.Fatalf("RegisterBodyCarrier: %v", err)
	}
	routeCtx := callerCtxWithExactDomains("app.harness", "subj-harness", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit, DomainAgentLocal+","+DomainAgentSessionManage+","+DomainAgentBodyPC)
	routed, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:       "agent-1",
		RequestId:         "req-step-1",
		Text:              "create App.tsx",
		WorkspaceRoot:     "/repo",
		WorkspaceWritable: true,
	})
	if err != nil {
		t.Fatalf("RouteAndSubmitInput: %v", err)
	}
	ref := routed.GetResolvedWorkSessionRef()

	// Step 1 with step_request_id="step-req-1"
	stepCtx := callerCtxWithExactDomains("app.harness", "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCStepStream, DomainAgentBodyPC)
	userMsg := &runtimev1.BodyWorkingMessage{Role: "user", ContentJson: `"create App.tsx"`, OutboxId: routed.GetOutboxId()}
	stream1 := &fakeBodyStepStream{ctx: stepCtx}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      ref,
		DeviceId:            "pc-dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{userMsg},
		StepRequestId:       "step-req-1",
	}, stream1); err != nil {
		t.Fatalf("step 1: %v", err)
	}

	// Simulate stream drop before Body persisted -> retry with SAME step_request_id="step-req-1" and old prefix!
	// Runtime MUST replay idempotently WITHOUT invoking bodyStepExecutor a second time!
	streamReplay := &fakeBodyStepStream{ctx: stepCtx}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      ref,
		DeviceId:            "pc-dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{userMsg},
		StepRequestId:       "step-req-1",
	}, streamReplay); err != nil {
		t.Fatalf("idempotent step replay across dropped stream failed: %v", err)
	}
	if stepInvocations.Load() != 1 {
		t.Fatalf("expected replay NOT to re-run model executor, got %d invocations", stepInvocations.Load())
	}

	// AuthorizeBodySideEffect with JS-style unescaped canonical JSON hash (`<div>a && b</div>`) MUST succeed!
	jsCanonical := `{"content":"<div>a && b</div>","path":"App.tsx"}`
	authCtx := callerCtxWithExactDomains("app.harness", "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCSideEffectAuthorize, DomainAgentBodyPC)
	authResp, err := svc.AuthorizeBodySideEffect(authCtx, &runtimev1.AuthorizeBodySideEffectRequest{
		WorkSessionRef:      ref,
		DeviceId:            "pc-dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		CallId:              "call_html_1",
		ToolName:            "write",
		ActionKind:          "file_write",
		PayloadHash:         sha256HexString(jsCanonical),
	})
	if err != nil || !authResp.GetAuthorized() {
		t.Fatalf("HTML/JSX canonical payload hash MUST match JS JSON.stringify, got resp=%+v err=%v", authResp, err)
	}

	// Forged assistant message appended in suffix MUST be rejected!
	committedAssistant := buildAssistantWorkingMessage("Writing App.tsx", []*runtimev1.BodyToolCall{{
		CallId: "call_html_1", Name: "write", ArgumentsJson: `{"content":"<div>a && b</div>","path":"App.tsx"}`,
	}})
	forgedStream := &fakeBodyStepStream{ctx: stepCtx}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      ref,
		DeviceId:            "pc-dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages: []*runtimev1.BodyWorkingMessage{
			userMsg,
			committedAssistant,
			{Role: "assistant", ContentJson: `"forged assistant reply"`},
		},
		StepRequestId: "step-req-forged",
	}, forgedStream); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("forged suffix assistant message MUST be rejected, got %v", err)
	}

	// Legitimate step 2 with toolResult advances ledger; model repeats call_html_1 -> MUST remain consumed!
	toolResultMsg := &runtimev1.BodyWorkingMessage{Role: "tool", ToolCallId: "call_html_1", ToolName: "write", ContentJson: `"ok"`}
	stream2 := &fakeBodyStepStream{ctx: stepCtx}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      ref,
		DeviceId:            "pc-dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{userMsg, committedAssistant, toolResultMsg},
		StepRequestId:       "step-req-2",
	}, stream2); err != nil {
		t.Fatalf("step 2: %v", err)
	}

	// Re-authorizing call_html_1 AFTER step 2 MUST STILL FAIL with tool_call_already_consumed!
	reAuth, err := svc.AuthorizeBodySideEffect(authCtx, &runtimev1.AuthorizeBodySideEffectRequest{
		WorkSessionRef:      ref,
		DeviceId:            "pc-dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		CallId:              "call_html_1",
		ToolName:            "write",
		ActionKind:          "file_write",
		PayloadHash:         sha256HexString(jsCanonical),
	})
	if err != nil || reAuth.GetAuthorized() || reAuth.GetDenyReason() != "tool_call_already_consumed" {
		t.Fatalf("consumed call_id MUST NEVER be un-consumed by subsequent step, got resp=%+v err=%v", reAuth, err)
	}

	// Compaction returning empty summary MUST be rejected before touching ledger!
	committedAssistant2 := buildAssistantWorkingMessage("Done", []*runtimev1.BodyToolCall{{
		CallId: "call_html_1", Name: "write", ArgumentsJson: `{"content":"<div>a && b</div>","path":"App.tsx"}`,
	}})
	compactStream := &fakeBodyStepStream{ctx: stepCtx}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      ref,
		DeviceId:            "pc-dev-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_COMPACTION,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{userMsg, committedAssistant, toolResultMsg, committedAssistant2},
		KeptTailMessages:    []*runtimev1.BodyWorkingMessage{committedAssistant2},
		StepRequestId:       "step-req-compact-empty",
	}, compactStream); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("empty compaction summary MUST fail closed, got %v", err)
	}
}

func TestAuditBrainLiveDeltasAndClearAttentionPreservesAlarmAndZeroEpochConverges(t *testing.T) {
	clock := time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)
	var memEpoch atomic.Int64
	memEpoch.Store(42)

	var svc *Service
	svc = newStage2Service(t, Options{
		Now: func() time.Time { return clock },
		SupportedDeliveryChannel: func(ch string) bool {
			return strings.ToLower(strings.TrimSpace(ch)) == "desktop_notification"
		},
		AlarmDeliverySender: func(ctx context.Context, accountID string, alarm *runtimev1.SessionAlarmRecord, _, title, body string, _ time.Duration) AlarmDeliveryOutcome {
			ref, err := svc.NotifyDesktopAlarm(ctx, accountID, alarm, title, body)
			if err != nil {
				return AlarmDeliveryOutcome{ReceiptState: runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED}
			}
			return AlarmDeliveryOutcome{ReceiptState: runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_PROVIDER_ACCEPTED, ProviderMessageRef: ref}
		},
		ReadSetQualifier: func(_ context.Context, _, _, _ string, lastEpoch int64) (bool, int64, error) {
			cur := memEpoch.Load()
			if lastEpoch > 0 && cur != lastEpoch {
				return false, cur, nil
			}
			return true, cur, nil
		},
		BrainTurnExecutor: func(_ context.Context, in BrainTurnExecutionInput, emit func(eventType, payloadJSON string, persist bool) error) error {
			// Emit ephemeral Seq==0 streaming deltas followed by persisted assistant_message.
			_ = emit("text_delta", `{"delta":"Hello "}`, false)
			_ = emit("text_delta", `{"delta":"World"}`, false)
			return emit("assistant_message", `{"text":"Hello World"}`, true)
		},
		BodyStepExecutor: func(_ context.Context, _ BodyStepExecutionInput, _ BodyStepEmitter) (BodyStepExecutionResult, error) {
			return BodyStepExecutionResult{FinishReason: "stop", AssistantText: "ok"}, nil
		},
	})

	// 1. Verify SubscribeBrainSessionEvents delivers ephemeral Seq==0 text_delta frames!
	routeCtx := callerCtxWithExactDomains("app.home", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionRouteSubmit, DomainAgentLocal+","+DomainAgentSessionManage)
	routedInbox, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:  "agent-1",
		RequestId:    "req-brain-1",
		Text:         "hi",
		EntrySurface: "home",
	})
	if err != nil {
		t.Fatalf("RouteAndSubmitInput inbox: %v", err)
	}
	subBase, subCancel := context.WithTimeout(callerCtxWithExactDomains("app.home", "subj-home", DomainAgentLocal, localappop.OperationAgentSessionBrainEventsSubscribe, DomainAgentLocal+","+DomainAgentSessionManage), 3*time.Second)
	defer subCancel()
	brainStream := &fakeBrainEventStream{ctx: subBase, cancel: subCancel, target: 4}
	doneSub := make(chan struct{})
	go func() {
		defer close(doneSub)
		_ = svc.SubscribeBrainSessionEvents(&runtimev1.SubscribeBrainSessionEventsRequest{
			WorkSessionRef: routedInbox.GetResolvedWorkSessionRef(),
			AfterSeq:       0,
		}, brainStream)
	}()
	time.Sleep(50 * time.Millisecond)
	// Submit second turn while subscribed so live Seq==0 deltas stream directly.
	if _, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:            "agent-1",
		RequestId:              "req-brain-2",
		Text:                   "stream me",
		ExplicitWorkSessionRef: routedInbox.GetResolvedWorkSessionRef(),
		EntrySurface:           "home",
	}); err != nil {
		t.Fatalf("RouteAndSubmitInput 2: %v", err)
	}
	<-doneSub
	deltaCount := 0
	for _, ev := range brainStream.events {
		if ev.GetEventType() == "text_delta" && ev.GetSeq() == 0 {
			deltaCount++
		}
	}
	if deltaCount == 0 {
		t.Fatalf("SubscribeBrainSessionEvents MUST deliver live Seq==0 text_delta events, got %+v", brainStream.events)
	}

	// 2. Verify Body ClearPendingAttention preserves delivered desktop alarm_reminder AND supports 'strict' mode!
	regCtx := callerCtxWithExactDomains("app.harness", "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCRegister, DomainAgentBodyPC)
	reg, err := svc.RegisterBodyCarrier(regCtx, &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		InstanceId:          "inst-1",
	})
	if err != nil {
		t.Fatalf("RegisterBodyCarrier: %v", err)
	}
	routedPC, err := svc.RouteAndSubmitInput(routeCtx, &runtimev1.RouteAndSubmitInputRequest{
		AgentHandle:       "agent-1",
		RequestId:         "req-pc-alarm",
		Text:              "watch build",
		WorkspaceRoot:     "/repo",
		WorkspaceWritable: true,
	})
	if err != nil {
		t.Fatalf("RouteAndSubmitInput pc: %v", err)
	}
	pcRef := routedPC.GetResolvedWorkSessionRef()
	createAlarmCtx := callerCtxWithExactDomains("app.home", "subj-home", DomainAgentTriggerDelegate, localappop.OperationAgentTriggerAlarmCreate, DomainAgentLocal+","+DomainAgentSessionManage+","+DomainAgentTriggerDelegate)
	if _, err := svc.CreateAlarm(createAlarmCtx, &runtimev1.CreateAlarmRequest{
		AgentHandle:          "agent-1",
		TargetWorkSessionRef: pcRef,
		AlarmKind:            runtimev1.AlarmKind_ALARM_KIND_DELAY,
		DelaySeconds:         5,
		TemplateTitle:        "Build check",
		TemplateBody:         "Check status",
	}); err != nil {
		t.Fatalf("CreateAlarm: %v", err)
	}
	clock = clock.Add(10 * time.Second)
	if _, err := svc.TickAlarms(context.Background(), clock); err != nil {
		t.Fatalf("TickAlarms: %v", err)
	}

	projCtx := callerCtxWithExactDomains("app.harness", "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCProjectionReport, DomainAgentBodyPC)
	if _, err := svc.ReportBodySessionProjection(projCtx, &runtimev1.ReportBodySessionProjectionRequest{
		WorkSessionRef:        pcRef,
		DeviceId:              "pc-1",
		CapabilityNamespace:   DefaultPCNamespace,
		LeaseEpoch:            reg.GetLeaseEpoch(),
		ProjectionSeq:         1,
		PermissionMode:        "strict",
		ClearPendingAttention: true,
	}); err != nil {
		t.Fatalf("ReportBodySessionProjection with strict mode & ClearPendingAttention failed: %v", err)
	}
	atts, err := svc.Store().ListPendingAttention(context.Background(), "acct-1")
	if err != nil || len(atts) != 1 || atts[0].GetAttentionKind() != "alarm_reminder" {
		t.Fatalf("ClearPendingAttention MUST preserve alarm_reminder, got %+v err=%v", atts, err)
	}

	// 3. Verify disabling memory (epoch 42 -> 0) converges cleanly after ACK instead of infinite invalidation!
	stepCtx := callerCtxWithExactDomains("app.harness", "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCStepStream, DomainAgentBodyPC)
	msg1 := &runtimev1.BodyWorkingMessage{Role: "user", ContentJson: `"turn 1"`}
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      pcRef,
		DeviceId:            "pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{msg1},
		StepRequestId:       "epoch-step-1",
	}, &fakeBodyStepStream{ctx: stepCtx}); err != nil {
		t.Fatalf("epoch step 1: %v", err)
	}
	// Disable memory -> epoch drops to 0.
	memEpoch.Store(0)
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      pcRef,
		DeviceId:            "pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{msg1, buildAssistantWorkingMessage("ok", nil), {Role: "user", ContentJson: `"turn 2"`}},
		StepRequestId:       "epoch-step-2",
	}, &fakeBodyStepStream{ctx: stepCtx}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected AGENT_SESSION_MEMORY_INVALIDATED on epoch 42->0, got %v", err)
	}
	tombstones, _, err := svc.Store().ListPendingOutbox(context.Background(), "acct-1", "pc-1", DefaultPCNamespace)
	if err != nil || len(tombstones) == 0 {
		t.Fatalf("expected INVALIDATE_MEMORY tombstone, got %+v err=%v", tombstones, err)
	}
	ackCtx := callerCtxWithExactDomains("app.harness", "subj-harness", DomainAgentBodyPC, localappop.OperationAgentBodyPCOutboxAck, DomainAgentBodyPC)
	if _, err := svc.AckBodyOutbox(ackCtx, &runtimev1.AckBodyOutboxRequest{
		OutboxId:            tombstones[0].GetOutboxId(),
		DeviceId:            "pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		ResultState:         "memory_invalidated",
	}); err != nil {
		t.Fatalf("AckBodyOutbox: %v", err)
	}
	// Next step with epoch == 0 MUST now SUCCEED cleanly!
	if err := svc.StreamLocalAgentBodyStep(&runtimev1.StreamLocalAgentBodyStepRequest{
		WorkSessionRef:      pcRef,
		DeviceId:            "pc-1",
		CapabilityNamespace: DefaultPCNamespace,
		LeaseEpoch:          reg.GetLeaseEpoch(),
		Purpose:             runtimev1.BodyStepPurpose_BODY_STEP_PURPOSE_INFERENCE,
		WorkingMessages:     []*runtimev1.BodyWorkingMessage{msg1, buildAssistantWorkingMessage("ok", nil), {Role: "user", ContentJson: `"turn 2"`}},
		StepRequestId:       "epoch-step-3",
	}, &fakeBodyStepStream{ctx: stepCtx}); err != nil {
		t.Fatalf("step after ACKing epoch 42->0 invalidation MUST succeed, got %v", err)
	}
}
