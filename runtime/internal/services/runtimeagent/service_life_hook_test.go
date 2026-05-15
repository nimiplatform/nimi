package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRuntimeAgentHookLifecycleExecutionStateAndCursor(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-lifecycle"),
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 20,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	svc.mu.RLock()
	cursor := svc.sequence
	svc.mu.RUnlock()

	now := time.Now().UTC()
	scheduledFor := now.Add(2 * time.Minute)
	if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-lifecycle"), newTestTimePendingHook(t, "hook-life-1", "agent-lifecycle", scheduledFor, now)); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	stateResp, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-lifecycle"), AgentId: "agent-lifecycle"})
	if err != nil {
		t.Fatalf("GetAgentState(pending): %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING {
		t.Fatalf("expected LIFE_PENDING, got %s", stateResp.GetState().GetExecutionState())
	}

	running, err := svc.markHookRunning(testRuntimeAgentLocalRef("agent-lifecycle"), "hook-life-1")
	if err != nil {
		t.Fatalf("markHookRunning: %v", err)
	}
	if running.GetIntent().GetAdmissionState() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING {
		t.Fatalf("expected running outcome, got %s", running.GetIntent().GetAdmissionState())
	}

	stateResp, err = svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-lifecycle"), AgentId: "agent-lifecycle"})
	if err != nil {
		t.Fatalf("GetAgentState(running): %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_RUNNING {
		t.Fatalf("expected LIFE_RUNNING, got %s", stateResp.GetState().GetExecutionState())
	}

	if _, err := svc.CancelHook(ctx, &runtimev1.CancelHookRequest{
		Context:  testRuntimeAgentIdentityContext("agent-lifecycle"),
		AgentId:  "agent-lifecycle",
		IntentId: "hook-life-1",
		Reason:   "operator stop",
	}); err != nil {
		t.Fatalf("CancelHook: %v", err)
	}

	stateResp, err = svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-lifecycle"), AgentId: "agent-lifecycle"})
	if err != nil {
		t.Fatalf("GetAgentState(canceled): %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
		t.Fatalf("expected IDLE after cancel, got %s", stateResp.GetState().GetExecutionState())
	}

	if _, err := svc.CancelHook(ctx, &runtimev1.CancelHookRequest{
		Context:  testRuntimeAgentIdentityContext("agent-lifecycle"),
		AgentId:  "agent-lifecycle",
		IntentId: "hook-life-1",
		Reason:   "double cancel",
	}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition on terminal cancel, got %v", err)
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context: testRuntimeAgentIdentityContext("agent-lifecycle"), AgentId: "agent-lifecycle"})
	if err != nil {
		t.Fatalf("ListPendingHooks(active): %v", err)
	}
	if len(pendingResp.GetHooks()) != 0 {
		t.Fatalf("expected no active hooks after cancel, got %d", len(pendingResp.GetHooks()))
	}

	canceledResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context:              testRuntimeAgentIdentityContext("agent-lifecycle"),
		AgentId:              "agent-lifecycle",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(canceled): %v", err)
	}
	if len(canceledResp.GetHooks()) != 1 {
		t.Fatalf("expected one canceled hook, got %d", len(canceledResp.GetHooks()))
	}

	hookStream := newAgentEventCaptureStreamLimit(ctx, 4)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		Context:      testRuntimeAgentIdentityContext("agent-lifecycle"),
		AgentId:      "agent-lifecycle",
		Cursor:       encodeCursor(cursor),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK},
	}, hookStream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents returned %v, want context.Canceled", err)
	}
	if len(hookStream.events) != 4 {
		t.Fatalf("expected 4 hook events from cursor backlog, got %d", len(hookStream.events))
	}
	wantHookFamilies := []runtimev1.HookAdmissionState{
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING,
		runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED,
	}
	for i, event := range hookStream.events {
		if got := event.GetHook().GetFamily(); got != wantHookFamilies[i] {
			t.Fatalf("unexpected hook family at index %d: got %s want %s", i, got, wantHookFamilies[i])
		}
	}

	stateStream := newAgentEventCaptureStreamLimit(ctx, 3)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		Context:      testRuntimeAgentIdentityContext("agent-lifecycle"),
		AgentId:      "agent-lifecycle",
		Cursor:       encodeCursor(cursor),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE},
	}, stateStream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(state) returned %v, want context.Canceled", err)
	}
	if len(stateStream.events) != 3 {
		t.Fatalf("expected 3 execution-state events from cursor backlog, got %d", len(stateStream.events))
	}
	wantExecutionStates := []runtimev1.AgentExecutionState{
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING,
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_RUNNING,
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE,
	}
	wantPreviousStates := []runtimev1.AgentExecutionState{
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE,
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING,
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_RUNNING,
	}
	for i, event := range stateStream.events {
		if event.GetState().GetFamily() != runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_EXECUTION_STATE_CHANGED {
			t.Fatalf("expected execution_state_changed at index %d, got %#v", i, event)
		}
		if got := event.GetState().GetCurrentExecutionState(); got != wantExecutionStates[i] {
			t.Fatalf("unexpected current execution state at index %d: got %s want %s", i, got, wantExecutionStates[i])
		}
		if got := event.GetState().GetPreviousExecutionState(); got != wantPreviousStates[i] {
			t.Fatalf("unexpected previous execution state at index %d: got %s want %s", i, got, wantPreviousStates[i])
		}
		if strings.TrimSpace(event.GetState().GetConversationAnchorId()) != "" ||
			strings.TrimSpace(event.GetState().GetOriginatingTurnId()) != "" ||
			strings.TrimSpace(event.GetState().GetOriginatingStreamId()) != "" {
			t.Fatalf("no-origin execution-state event must keep origin empty, got %#v", event.GetState())
		}
	}
}

func TestRuntimeAgentTerminateEmitsExecutionStateProjection(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-terminate-state"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	svc.mu.RLock()
	cursor := svc.sequence
	svc.mu.RUnlock()

	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-terminate-state"),
		AgentId: "agent-terminate-state",
		Reason:  "shutdown",
	}); err != nil {
		t.Fatalf("TerminateAgent: %v", err)
	}

	stateResp, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-terminate-state"), AgentId: "agent-terminate-state"})
	if err != nil {
		t.Fatalf("GetAgentState: %v", err)
	}
	if got := stateResp.GetState().GetExecutionState(); got != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_SUSPENDED {
		t.Fatalf("expected SUSPENDED after terminate, got %s", got)
	}

	stream := newAgentEventCaptureStreamLimit(ctx, 1)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		Context:      testRuntimeAgentIdentityContext("agent-terminate-state"),
		AgentId:      "agent-terminate-state",
		Cursor:       encodeCursor(cursor),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE},
	}, stream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(state) returned %v, want context.Canceled", err)
	}
	if len(stream.events) != 1 {
		t.Fatalf("expected 1 terminate execution-state event, got %d", len(stream.events))
	}
	detail := stream.events[0].GetState()
	if detail.GetFamily() != runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_EXECUTION_STATE_CHANGED {
		t.Fatalf("expected execution_state_changed on terminate, got %#v", stream.events[0])
	}
	if detail.GetCurrentExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_SUSPENDED {
		t.Fatalf("expected current_execution_state=SUSPENDED, got %s", detail.GetCurrentExecutionState())
	}
	if detail.GetPreviousExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
		t.Fatalf("expected previous_execution_state=IDLE, got %s", detail.GetPreviousExecutionState())
	}
	if strings.TrimSpace(detail.GetConversationAnchorId()) != "" ||
		strings.TrimSpace(detail.GetOriginatingTurnId()) != "" ||
		strings.TrimSpace(detail.GetOriginatingStreamId()) != "" {
		t.Fatalf("terminate execution-state event must not fabricate origin, got %#v", detail)
	}
}

func TestRuntimeAgentWorldSharedQueryAndWriteUseActiveWorldID(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-world"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	_, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context:          testRuntimeAgentIdentityContext("agent-world"),
		AgentId:          "agent-world",
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED},
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for world_shared query without state world, got %v", err)
	}

	if _, err := svc.UpdateAgentState(ctx, &runtimev1.UpdateAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-world"),
		AgentId: "agent-world",
		Mutations: []*runtimev1.AgentStateMutation{
			{
				Mutation: &runtimev1.AgentStateMutation_SetWorldContext{
					SetWorldContext: &runtimev1.AgentStateSetWorldContext{WorldId: "world-1"},
				},
			},
		},
	}); err != nil {
		t.Fatalf("UpdateAgentState(set world): %v", err)
	}

	writeResp, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		Context: testRuntimeAgentIdentityContext("agent-world"),
		AgentId: "agent-world",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
					Owner: &runtimev1.MemoryBankLocator_WorldShared{
						WorldShared: &runtimev1.WorldSharedBankOwner{
							WorldId: "world-1",
						},
					},
				},
				SourceEventId: "evt-world-1",
				Extensions:    completePromotionEvidence(t),
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
					Payload: &runtimev1.MemoryRecordInput_Semantic{
						Semantic: &runtimev1.SemanticMemoryRecord{
							Subject:   "Weather",
							Predicate: "is",
							Object:    "rainy",
						},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory: %v", err)
	}
	if len(writeResp.GetAccepted()) != 1 || len(writeResp.GetRejected()) != 0 {
		t.Fatalf("expected world_shared write acceptance, accepted=%d rejected=%d", len(writeResp.GetAccepted()), len(writeResp.GetRejected()))
	}
	if got := writeResp.GetAccepted()[0].GetSourceBank().GetWorldShared().GetWorldId(); got != "world-1" {
		t.Fatalf("unexpected world_shared bank world id: %s", got)
	}

	queryResp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context:          testRuntimeAgentIdentityContext("agent-world"),
		AgentId:          "agent-world",
		Query:            "What is the weather?",
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED},
		Limit:            10,
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory(world shared): %v", err)
	}
	if len(queryResp.GetMemories()) != 1 {
		t.Fatalf("expected 1 world_shared memory, got %d", len(queryResp.GetMemories()))
	}
	if queryResp.GetMemories()[0].GetSourceBank().GetWorldShared().GetWorldId() != "world-1" {
		t.Fatalf("unexpected queried world id: %s", queryResp.GetMemories()[0].GetSourceBank().GetWorldShared().GetWorldId())
	}
}

func TestRuntimeAgentWorldSharedWriteFailsClosedForMissingOrMismatchedWorld(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-world-fail"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	writeResp, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		Context: testRuntimeAgentIdentityContext("agent-world-fail"),
		AgentId: "agent-world-fail",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
					Owner: &runtimev1.MemoryBankLocator_WorldShared{
						WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: "world-1"},
					},
				},
				SourceEventId: "evt-world-fail-1",
				Extensions:    completePromotionEvidence(t),
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
					Payload: &runtimev1.MemoryRecordInput_Semantic{
						Semantic: &runtimev1.SemanticMemoryRecord{Subject: "State", Predicate: "is", Object: "missing"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory(missing world): %v", err)
	}
	if len(writeResp.GetAccepted()) != 0 || len(writeResp.GetRejected()) != 1 {
		t.Fatalf("expected world_shared rejection for missing world, accepted=%d rejected=%d", len(writeResp.GetAccepted()), len(writeResp.GetRejected()))
	}
	if !strings.Contains(writeResp.GetRejected()[0].GetMessage(), "active_world_id") {
		t.Fatalf("unexpected missing world rejection message: %s", writeResp.GetRejected()[0].GetMessage())
	}

	if _, err := svc.UpdateAgentState(ctx, &runtimev1.UpdateAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-world-fail"),
		AgentId: "agent-world-fail",
		Mutations: []*runtimev1.AgentStateMutation{
			{
				Mutation: &runtimev1.AgentStateMutation_SetWorldContext{
					SetWorldContext: &runtimev1.AgentStateSetWorldContext{WorldId: "world-1"},
				},
			},
		},
	}); err != nil {
		t.Fatalf("UpdateAgentState(set world): %v", err)
	}

	writeResp, err = svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		Context: testRuntimeAgentIdentityContext("agent-world-fail"),
		AgentId: "agent-world-fail",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
					Owner: &runtimev1.MemoryBankLocator_WorldShared{
						WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: "world-2"},
					},
				},
				SourceEventId: "evt-world-fail-2",
				Extensions:    completePromotionEvidence(t),
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
					Payload: &runtimev1.MemoryRecordInput_Semantic{
						Semantic: &runtimev1.SemanticMemoryRecord{Subject: "State", Predicate: "is", Object: "mismatch"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory(mismatched world): %v", err)
	}
	if len(writeResp.GetAccepted()) != 0 || len(writeResp.GetRejected()) != 1 {
		t.Fatalf("expected world_shared rejection for mismatched world, accepted=%d rejected=%d", len(writeResp.GetAccepted()), len(writeResp.GetRejected()))
	}
	if !strings.Contains(writeResp.GetRejected()[0].GetMessage(), "must match runtime-owned active_world_id") {
		t.Fatalf("unexpected mismatched world rejection message: %s", writeResp.GetRejected()[0].GetMessage())
	}
}

func TestRuntimeAgentExecuteDueHooksProducesTerminalOutcomes(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-exec"),
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 50,
			MinHookInterval:  durationpb.New(time.Nanosecond),
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-exec")

	admitBase := time.Now().UTC()
	mustAdmit := func(hook *runtimev1.PendingHook) {
		t.Helper()
		if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-exec"), hook); err != nil {
			t.Fatalf("admitPendingHook(%s): %v", hook.GetIntent().GetIntentId(), err)
		}
	}
	scheduled := func(id string) *runtimev1.PendingHook {
		return newTestTimePendingHook(t, id, "agent-exec", admitBase, admitBase)
	}
	mustAdmit(scheduled("hook-complete"))
	mustAdmit(scheduled("hook-fail"))
	mustAdmit(scheduled("hook-reschedule"))

	// Execute well after admit time so all three hooks are past their
	// normalized ScheduledFor (which pins to admit instant under clamped
	// delay of 0).
	now := admitBase.Add(time.Hour)
	outcomes, err := svc.executeDueHooks(ctx, now, func(_ context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
		switch req.Hook.GetIntent().GetIntentId() {
		case "hook-complete":
			return &lifeTurnResult{Summary: "life turn done", TokensUsed: 7}, nil
		case "hook-fail":
			return nil, &lifeTurnExecutionError{
				admissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED,
				reasonCode:     runtimev1.ReasonCode_AI_OUTPUT_INVALID,
				message:        "executor failed",
				retryable:      true,
				tokensUsed:     3,
			}
		case "hook-reschedule":
			return &lifeTurnResult{
				NextHookIntent: &runtimev1.HookIntent{
					IntentId:      "hook-reschedule-followup",
					AgentId:       "agent-exec",
					TriggerFamily: runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME,
					TriggerDetail: &runtimev1.HookTriggerDetail{
						Detail: &runtimev1.HookTriggerDetail_Time{
							Time: &runtimev1.HookTriggerTimeDetail{Delay: durationpb.New(10 * time.Minute)},
						},
					},
					Effect:         runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
					AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
					Reason:         "try later",
					NotBefore:      timestamppb.New(now.Add(10 * time.Minute)),
				},
				TokensUsed: 2,
			}, nil
		default:
			return nil, nil
		}
	})
	if err != nil {
		t.Fatalf("executeDueHooks: %v", err)
	}
	if len(outcomes) != 3 {
		t.Fatalf("expected 3 hook outcomes, got %d", len(outcomes))
	}

	statuses := map[string]runtimev1.HookAdmissionState{}
	for _, outcome := range outcomes {
		statuses[outcome.GetIntent().GetIntentId()] = outcome.GetIntent().GetAdmissionState()
	}
	if statuses["hook-complete"] != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED {
		t.Fatalf("expected completed admission_state, got %s", statuses["hook-complete"])
	}
	if statuses["hook-fail"] != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED {
		t.Fatalf("expected failed admission_state, got %s", statuses["hook-fail"])
	}
	if statuses["hook-reschedule"] != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED {
		t.Fatalf("expected rescheduled admission_state, got %s", statuses["hook-reschedule"])
	}

	stateResp, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-exec"), AgentId: "agent-exec"})
	if err != nil {
		t.Fatalf("GetAgentState: %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING {
		t.Fatalf("expected LIFE_PENDING because follow-up hook remains pending, got %s", stateResp.GetState().GetExecutionState())
	}

	entry, err := svc.agentByID(testRuntimeAgentLocalRef("agent-exec"))
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	if entry.Agent.GetAutonomy().GetUsedTokensInWindow() != 12 {
		t.Fatalf("expected used token accumulation to be 12, got %d", entry.Agent.GetAutonomy().GetUsedTokensInWindow())
	}
	if hookAdmissionState(entry.Hooks["hook-complete"]) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED {
		t.Fatalf("expected completed hook stored terminal state, got %s", hookAdmissionState(entry.Hooks["hook-complete"]))
	}
	if hookAdmissionState(entry.Hooks["hook-fail"]) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED {
		t.Fatalf("expected failed hook stored terminal state, got %s", hookAdmissionState(entry.Hooks["hook-fail"]))
	}
	if hookAdmissionState(entry.Hooks["hook-reschedule"]) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED {
		t.Fatalf("expected rescheduled hook stored terminal state, got %s", hookAdmissionState(entry.Hooks["hook-reschedule"]))
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context: testRuntimeAgentIdentityContext("agent-exec"), AgentId: "agent-exec"})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 {
		t.Fatalf("expected one follow-up pending hook, got %d", len(pendingResp.GetHooks()))
	}
	if pendingResp.GetHooks()[0].GetIntent().GetIntentId() == "hook-reschedule" {
		t.Fatal("expected reschedule to create a distinct follow-up hook id")
	}
}

func TestRuntimeAgentExecuteDueHooksReschedulesBudgetExhaustedAgent(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	windowStart := timestamppb.New(time.Now().UTC().Add(-2 * time.Hour))
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-budget"),
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 10,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-budget")
	entry, err := svc.agentByID(testRuntimeAgentLocalRef("agent-budget"))
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	entry.Agent.Autonomy.BudgetExhausted = true
	entry.Agent.Autonomy.UsedTokensInWindow = 10
	entry.Agent.Autonomy.WindowStartedAt = windowStart
	if err := svc.updateAgent(entry); err != nil {
		t.Fatalf("updateAgent(budget): %v", err)
	}

	admitBase := time.Now().UTC()
	if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-budget"), newTestTimePendingHook(t, "hook-budget", "agent-budget", admitBase, admitBase)); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	outcomes, err := svc.executeDueHooks(ctx, admitBase.Add(time.Hour), func(context.Context, *lifeTurnRequest) (*lifeTurnResult, error) {
		t.Fatal("executor should not run when budget is exhausted")
		return nil, nil
	})
	if err != nil {
		t.Fatalf("executeDueHooks: %v", err)
	}
	if len(outcomes) != 1 || outcomes[0].GetIntent().GetAdmissionState() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED {
		t.Fatalf("expected rescheduled outcome for exhausted budget, got %#v", outcomes)
	}
	// Follow-up pending hook must fire no earlier than the next budget
	// window start, i.e. windowStart + 24h.
	pendingAfter, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context: testRuntimeAgentIdentityContext("agent-budget"), AgentId: "agent-budget"})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	if len(pendingAfter.GetHooks()) == 0 {
		t.Fatalf("expected follow-up pending hook after budget reschedule")
	}
	if pendingAfter.GetHooks()[0].GetScheduledFor().AsTime().Before(windowStart.AsTime().Add(24 * time.Hour)) {
		t.Fatalf("expected reschedule no earlier than next budget window")
	}
}

// TestRuntimeAgentAdmitPendingHookFailsClosedWithoutExplicitNonTimeSchedule
// previously proved non-time (TURN_COMPLETED) triggers required an
// explicit schedule. Per K-AGCORE-041, TURN_COMPLETED is no longer
// admitted at all; validateHookIntent fails-closed on any trigger
// family outside {TIME, EVENT(user_idle|chat_ended)}. Coverage for the
// narrow-admission matrix lives in
// TestValidateHookIntentRejectsNonAdmittedMatrix above.
func TestRuntimeAgentAdmitPendingHookFailsClosedWithoutExplicitNonTimeSchedule(t *testing.T) {
	t.Skip("retired: HOOK_TRIGGER_KIND_TURN_COMPLETED is not admitted in K-AGCORE-041 v1 matrix")
}

// TestTriggerDetailFromIntentUserIdleNilSafe is retired: the helper
// `triggerDetailFromIntent` existed to translate NextHookIntent into a
// separate HookTriggerDetail container. The new vocabulary unifies
// trigger_detail inside HookIntent, so no translator is needed. The
// EVENT(user_idle) admission-matrix coverage is exercised directly via
// TestValidateHookIntentRejectsNonAdmittedMatrix.
func TestTriggerDetailFromIntentUserIdleNilSafe(t *testing.T) {
	t.Skip("retired: triggerDetailFromIntent helper removed with NextHookIntent hard cut")
}

func TestRuntimeAgentLifeTrackLoopRejectsDueHookWithoutExecutor(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-loop-reject"),
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 25,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-loop-reject")

	now := time.Now().UTC()
	if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-loop-reject"), newTestTimePendingHook(t, "hook-loop-reject", "agent-loop-reject", now.Add(-time.Second), now.Add(-2*time.Second))); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartLifeTrackLoop(loopCtx); err != nil {
		t.Fatalf("StartLifeTrackLoop: %v", err)
	}
	defer svc.StopLifeTrackLoop()

	waitForRuntimeAgentCondition(t, 2*time.Second, func() bool {
		resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
			Context:              testRuntimeAgentIdentityContext("agent-loop-reject"),
			AgentId:              "agent-loop-reject",
			AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED,
		})
		return err == nil && len(resp.GetHooks()) == 1
	})

	rejectedResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context:              testRuntimeAgentIdentityContext("agent-loop-reject"),
		AgentId:              "agent-loop-reject",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(rejected): %v", err)
	}
	if len(rejectedResp.GetHooks()) != 1 {
		t.Fatalf("expected one rejected hook, got %d", len(rejectedResp.GetHooks()))
	}

	stateResp, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-loop-reject"), AgentId: "agent-loop-reject"})
	if err != nil {
		t.Fatalf("GetAgentState: %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING {
		t.Fatalf("expected LIFE_PENDING after rejection because cadence tick is re-admitted, got %s", stateResp.GetState().GetExecutionState())
	}
}

func TestRuntimeAgentLifeTrackLoopEmitsCommittedHookMemoryAndBudgetEvents(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-loop-events"),
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 50,
			MaxTokensPerHook: 1,
			MinHookInterval:  durationpb.New(5 * time.Minute),
		},
		WorldId: "world-1",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-loop-events")
	if _, err := svc.UpdateAgentState(ctx, &runtimev1.UpdateAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-loop-events"),
		AgentId: "agent-loop-events",
		Mutations: []*runtimev1.AgentStateMutation{
			{
				Mutation: &runtimev1.AgentStateMutation_SetDyadicContext{
					SetDyadicContext: &runtimev1.AgentStateSetDyadicContext{UserId: "user-1"},
				},
			},
		},
	}); err != nil {
		t.Fatalf("UpdateAgentState: %v", err)
	}

	now := time.Now().UTC()
	if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-loop-events"), newTestTimePendingHook(t, "hook-loop-events", "agent-loop-events", now.Add(-time.Second), now.Add(-2*time.Second))); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	svc.mu.RLock()
	cursor := svc.sequence
	svc.mu.RUnlock()

	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `<life-turn><status-text>watching the world</status-text><summary>life turn complete</summary><tokens-used>999</tokens-used><canonical-memory-candidates><candidate canonical-class="WORLD_SHARED" policy-reason="world_fact"><observational><observation>Lanterns are lit</observation><source-ref>life-track</source-ref></observational></candidate><candidate canonical-class="DYADIC" policy-reason="broken"><semantic><subject>user</subject><predicate></predicate><object>prefers tea</object></semantic></candidate></canonical-memory-candidates></life-turn>`,
					},
				},
			},
			Usage: &runtimev1.UsageStats{
				InputTokens:  3,
				OutputTokens: 4,
			},
		},
	}
	svc.SetLifeTrackExecutor(NewAIBackedLifeTrackExecutor(fakeAI))

	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartLifeTrackLoop(loopCtx); err != nil {
		t.Fatalf("StartLifeTrackLoop: %v", err)
	}
	defer svc.StopLifeTrackLoop()

	waitForRuntimeAgentCondition(t, 2*time.Second, func() bool {
		resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
			Context:              testRuntimeAgentIdentityContext("agent-loop-events"),
			AgentId:              "agent-loop-events",
			AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED,
		})
		return err == nil && len(resp.GetHooks()) == 1
	})

	// Per K-AGCORE-042 the `family` field on AgentHookEventDetail is the
	// first-class discriminator for `runtime.agent.hook.*`. Running /
	// completed / pending events are asserted via `family` rather than
	// digging through `outcome.intent.admission_state`.
	// Wave 1 Exec Pack 3 adds a committed
	// `runtime.agent.state.status_text_changed` event for life-track status
	// mutations. The life-turn result here sets status_text="watching the
	// world"; runtime emits a STATE event alongside hook/memory/budget. Per
	// K-AGCORE-037 state_envelope this state event carries `agent_id` only;
	// origin linkage is absent because the triggering HookIntent in this
	// fixture has no conversation_anchor_id / originating_turn_id linkage.
	stream := newAgentEventCaptureStreamLimit(ctx, 9)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		Context: testRuntimeAgentIdentityContext("agent-loop-events"),
		AgentId: "agent-loop-events",
		Cursor:  encodeCursor(cursor),
	}, stream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents returned %v, want context.Canceled", err)
	}
	if len(stream.events) != 9 {
		t.Fatalf("expected 9 committed events after loop including execution-state closure, got %d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK ||
		stream.events[0].GetHook().GetFamily() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING {
		t.Fatalf("expected running hook event first, got %#v", stream.events[0])
	}
	if stream.events[1].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE ||
		stream.events[1].GetState().GetFamily() != runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_EXECUTION_STATE_CHANGED {
		t.Fatalf("expected LIFE_RUNNING execution_state_changed second, got %#v", stream.events[1])
	}
	if got := stream.events[1].GetState().GetCurrentExecutionState(); got != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_RUNNING {
		t.Fatalf("expected LIFE_RUNNING second, got %s", got)
	}
	if stream.events[2].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE ||
		stream.events[2].GetState().GetFamily() != runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_STATUS_TEXT_CHANGED {
		t.Fatalf("expected status_text_changed state event third, got %#v", stream.events[2])
	}
	if got := strings.TrimSpace(stream.events[2].GetState().GetCurrentStatusText()); got != "watching the world" {
		t.Fatalf("expected current_status_text='watching the world', got %q", got)
	}
	if stream.events[3].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK ||
		stream.events[3].GetHook().GetFamily() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED {
		t.Fatalf("expected completed hook event fourth, got %#v", stream.events[3])
	}
	if stream.events[4].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE ||
		stream.events[4].GetState().GetFamily() != runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_EXECUTION_STATE_CHANGED {
		t.Fatalf("expected IDLE execution_state_changed fifth, got %#v", stream.events[4])
	}
	if got := stream.events[4].GetState().GetCurrentExecutionState(); got != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
		t.Fatalf("expected IDLE fifth, got %s", got)
	}
	if stream.events[5].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY {
		t.Fatalf("expected memory event sixth, got %#v", stream.events[5])
	}
	if len(stream.events[5].GetMemory().GetAccepted()) != 1 || len(stream.events[5].GetMemory().GetRejected()) != 1 {
		t.Fatalf("expected one accepted life-turn memory, got %#v", stream.events[5].GetMemory())
	}
	if stream.events[6].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET {
		t.Fatalf("expected budget event seventh, got %#v", stream.events[6])
	}
	if stream.events[7].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK {
		t.Fatalf("expected cadence pending hook event eighth, got %#v", stream.events[7])
	}
	if stream.events[7].GetHook().GetFamily() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
		t.Fatalf("expected cadence hook family pending, got %s", stream.events[7].GetHook().GetFamily())
	}
	if stream.events[8].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE ||
		stream.events[8].GetState().GetFamily() != runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_EXECUTION_STATE_CHANGED {
		t.Fatalf("expected cadence LIFE_PENDING execution_state_changed ninth, got %#v", stream.events[8])
	}
	if got := stream.events[8].GetState().GetCurrentExecutionState(); got != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING {
		t.Fatalf("expected LIFE_PENDING ninth, got %s", got)
	}
	for _, idx := range []int{1, 2, 4, 8} {
		lifeState := stream.events[idx].GetState()
		if strings.TrimSpace(lifeState.GetConversationAnchorId()) != "" ||
			strings.TrimSpace(lifeState.GetOriginatingTurnId()) != "" ||
			strings.TrimSpace(lifeState.GetOriginatingStreamId()) != "" {
			t.Fatalf("runtime MUST NOT fabricate origin linkage on no-origin state event, got %#v", lifeState)
		}
	}

	entry, err := svc.agentByID(testRuntimeAgentLocalRef("agent-loop-events"))
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	if entry.Agent.GetAutonomy().GetUsedTokensInWindow() != 7 {
		t.Fatalf("expected used token accumulation to be 7, got %d", entry.Agent.GetAutonomy().GetUsedTokensInWindow())
	}
	if entry.State.GetStatusText() != "watching the world" {
		t.Fatalf("expected status text update, got %q", entry.State.GetStatusText())
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one AI execution request, got %d", len(fakeAI.requests))
	}
	if fakeAI.requests[0].GetSpec().GetTextGenerate().GetMaxTokens() == 1 {
		t.Fatal("max_tokens_per_hook should remain non-enforced on AI scenario request")
	}
}

func TestRuntimeAgentWriteLifeTurnCandidatesRejectsSameBatchSemanticContradiction(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-life-contradiction"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	entry, err := svc.agentByID(testRuntimeAgentLocalRef("agent-life-contradiction"))
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}

	accepted, rejected := svc.writeLifeTurnCandidates(ctx, entry, &runtimev1.PendingHook{Intent: &runtimev1.HookIntent{IntentId: "hook-life-contradiction"}}, []*lifeTurnMemoryCandidate{
		{
			CanonicalClass: "PUBLIC_SHARED",
			PolicyReason:   "self_report",
			RecordRaw:      []byte(`{"kind":"MEMORY_RECORD_KIND_SEMANTIC","semantic":{"subject":"user","predicate":"likes","object":"cats"}}`),
		},
		{
			CanonicalClass: "PUBLIC_SHARED",
			PolicyReason:   "self_report",
			RecordRaw:      []byte(`{"kind":"MEMORY_RECORD_KIND_SEMANTIC","semantic":{"subject":"user","predicate":"likes","object":"dogs"}}`),
		},
	}, time.Now().UTC())
	if len(accepted) != 0 {
		t.Fatalf("expected no accepted writes for conflicting batch, got %#v", accepted)
	}
	if len(rejected) != 2 {
		t.Fatalf("expected two rejected conflicting candidates, got %#v", rejected)
	}
	for _, rejection := range rejected {
		if rejection.GetReasonCode() != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			t.Fatalf("expected AI_OUTPUT_INVALID rejection, got %#v", rejection)
		}
		if !strings.Contains(rejection.GetMessage(), "same-batch semantic contradiction") {
			t.Fatalf("expected contradiction rejection message, got %#v", rejection)
		}
	}

	queryResp, queryErr := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context: testRuntimeAgentIdentityContext("agent-life-contradiction"),
		AgentId: "agent-life-contradiction",
		Query:   "likes",
		Limit:   5,
	})
	if queryErr != nil {
		t.Fatalf("QueryAgentMemory: %v", queryErr)
	}
	if len(queryResp.GetMemories()) != 0 {
		t.Fatalf("expected no memory writes after contradiction, got %#v", queryResp.GetMemories())
	}
}
