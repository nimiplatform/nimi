package agentcore

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestAgentCoreInitializeWriteQueryAndHooks(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	memorySvc.SetManagedEmbeddingProfile(&runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})

	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("agentcore.New: %v", err)
	}

	ctx := context.Background()
	initResp, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId:     "agent-alpha",
		DisplayName: "Alpha",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 100,
			MaxTokensPerHook: 20,
		},
	})
	if err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	if initResp.GetAgent().GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		t.Fatalf("unexpected lifecycle status: %s", initResp.GetAgent().GetLifecycleStatus())
	}

	_, err = svc.UpdateAgentState(ctx, &runtimev1.UpdateAgentStateRequest{
		AgentId: "agent-alpha",
		Mutations: []*runtimev1.AgentStateMutation{
			{
				Mutation: &runtimev1.AgentStateMutation_SetDyadicContext{
					SetDyadicContext: &runtimev1.AgentStateSetDyadicContext{UserId: "user-1"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("UpdateAgentState: %v", err)
	}

	writeResp, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: "agent-alpha",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-alpha"},
					},
				},
				SourceEventId: "evt-1",
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
					Payload: &runtimev1.MemoryRecordInput_Semantic{
						Semantic: &runtimev1.SemanticMemoryRecord{
							Subject:   "Alice",
							Predicate: "works_at",
							Object:    "Nimi",
						},
					},
				},
			},
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
					Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
						AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: "agent-alpha", UserId: "user-1"},
					},
				},
				SourceEventId: "evt-2",
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{
							Observation: "User prefers terse responses",
						},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory: %v", err)
	}
	if len(writeResp.GetAccepted()) != 2 || len(writeResp.GetRejected()) != 0 {
		t.Fatalf("unexpected write result accepted=%d rejected=%d", len(writeResp.GetAccepted()), len(writeResp.GetRejected()))
	}

	queryResp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		AgentId: "agent-alpha",
		Query:   "What do you know?",
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory: %v", err)
	}
	if len(queryResp.GetMemories()) != 2 {
		t.Fatalf("expected 2 memories, got %d", len(queryResp.GetMemories()))
	}

	historyResp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		AgentId:          "agent-alpha",
		Query:            "",
		Limit:            10,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC},
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory history fallback: %v", err)
	}
	if len(historyResp.GetMemories()) != 1 {
		t.Fatalf("expected 1 dyadic history memory, got %d", len(historyResp.GetMemories()))
	}
	if historyResp.GetMemories()[0].GetCanonicalClass() != runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC {
		t.Fatalf("unexpected canonical class: %s", historyResp.GetMemories()[0].GetCanonicalClass())
	}

	hook := &runtimev1.PendingHook{
		HookId: "hook-1",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{
					ScheduledFor: timestamppb.New(time.Now().Add(5 * time.Minute)),
				},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{
					ScheduledFor: timestamppb.New(time.Now().Add(5 * time.Minute)),
				},
			},
		},
		ScheduledFor: timestamppb.New(time.Now().Add(5 * time.Minute)),
		AdmittedAt:   timestamppb.New(time.Now()),
	}
	if err := svc.admitPendingHook("agent-alpha", hook); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{AgentId: "agent-alpha"})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 || pendingResp.GetHooks()[0].GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING {
		t.Fatalf("unexpected pending hooks response: %#v", pendingResp.GetHooks())
	}

	cancelResp, err := svc.CancelHook(ctx, &runtimev1.CancelHookRequest{
		AgentId: "agent-alpha",
		HookId:  "hook-1",
		Reason:  "test cleanup",
	})
	if err != nil {
		t.Fatalf("CancelHook: %v", err)
	}
	if cancelResp.GetOutcome().GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED {
		t.Fatalf("unexpected hook outcome: %s", cancelResp.GetOutcome().GetStatus())
	}

	stream := newAgentEventCaptureStream(ctx)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId:      "agent-alpha",
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY},
	}, stream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents returned %v, want context.Canceled", err)
	}
	if len(stream.events) == 0 {
		t.Fatal("expected at least one memory event")
	}
	if stream.events[0].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY {
		t.Fatalf("unexpected event type: %s", stream.events[0].GetEventType())
	}
}

func TestAgentCoreHookLifecycleExecutionStateAndCursor(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-lifecycle",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 20,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	scheduledFor := timestamppb.New(time.Now().Add(2 * time.Minute))
	if err := svc.admitPendingHook("agent-lifecycle", &runtimev1.PendingHook{
		HookId: "hook-life-1",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{ScheduledFor: scheduledFor},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: scheduledFor},
			},
		},
	}); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	stateResp, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{AgentId: "agent-lifecycle"})
	if err != nil {
		t.Fatalf("GetAgentState(pending): %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING {
		t.Fatalf("expected LIFE_PENDING, got %s", stateResp.GetState().GetExecutionState())
	}

	svc.mu.RLock()
	cursor := svc.sequence
	svc.mu.RUnlock()

	running, err := svc.markHookRunning("agent-lifecycle", "hook-life-1")
	if err != nil {
		t.Fatalf("markHookRunning: %v", err)
	}
	if running.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING {
		t.Fatalf("expected running outcome, got %s", running.GetStatus())
	}

	stateResp, err = svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{AgentId: "agent-lifecycle"})
	if err != nil {
		t.Fatalf("GetAgentState(running): %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_RUNNING {
		t.Fatalf("expected LIFE_RUNNING, got %s", stateResp.GetState().GetExecutionState())
	}

	if _, err := svc.CancelHook(ctx, &runtimev1.CancelHookRequest{
		AgentId: "agent-lifecycle",
		HookId:  "hook-life-1",
		Reason:  "operator stop",
	}); err != nil {
		t.Fatalf("CancelHook: %v", err)
	}

	stateResp, err = svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{AgentId: "agent-lifecycle"})
	if err != nil {
		t.Fatalf("GetAgentState(canceled): %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
		t.Fatalf("expected IDLE after cancel, got %s", stateResp.GetState().GetExecutionState())
	}

	if _, err := svc.CancelHook(ctx, &runtimev1.CancelHookRequest{
		AgentId: "agent-lifecycle",
		HookId:  "hook-life-1",
		Reason:  "double cancel",
	}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition on terminal cancel, got %v", err)
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{AgentId: "agent-lifecycle"})
	if err != nil {
		t.Fatalf("ListPendingHooks(active): %v", err)
	}
	if len(pendingResp.GetHooks()) != 0 {
		t.Fatalf("expected no active hooks after cancel, got %d", len(pendingResp.GetHooks()))
	}

	canceledResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		AgentId:      "agent-lifecycle",
		StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(canceled): %v", err)
	}
	if len(canceledResp.GetHooks()) != 1 {
		t.Fatalf("expected one canceled hook, got %d", len(canceledResp.GetHooks()))
	}

	stream := newAgentEventCaptureStreamLimit(ctx, 2)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId:      "agent-lifecycle",
		Cursor:       encodeCursor(cursor),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK},
	}, stream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents returned %v, want context.Canceled", err)
	}
	if len(stream.events) != 2 {
		t.Fatalf("expected 2 hook events from cursor backlog, got %d", len(stream.events))
	}
	if stream.events[0].GetHook().GetOutcome().GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING {
		t.Fatalf("expected running hook event, got %s", stream.events[0].GetHook().GetOutcome().GetStatus())
	}
	if stream.events[1].GetHook().GetOutcome().GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED {
		t.Fatalf("expected canceled hook event, got %s", stream.events[1].GetHook().GetOutcome().GetStatus())
	}
}

func TestAgentCoreWorldSharedQueryAndWriteUseActiveWorldID(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-world",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	_, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		AgentId:          "agent-world",
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED},
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for world_shared query without state world, got %v", err)
	}

	if _, err := svc.UpdateAgentState(ctx, &runtimev1.UpdateAgentStateRequest{
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

func TestAgentCoreWorldSharedWriteFailsClosedForMissingOrMismatchedWorld(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-world-fail",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	writeResp, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
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

func TestAgentCoreExecuteDueHooksProducesTerminalOutcomes(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-exec",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 50,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	now := time.Now().UTC()
	mustAdmit := func(hook *runtimev1.PendingHook) {
		t.Helper()
		if err := svc.admitPendingHook("agent-exec", hook); err != nil {
			t.Fatalf("admitPendingHook(%s): %v", hook.GetHookId(), err)
		}
	}
	scheduled := func(id string) *runtimev1.PendingHook {
		return &runtimev1.PendingHook{
			HookId: id,
			Trigger: &runtimev1.HookTriggerDetail{
				TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
				Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
					ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{ScheduledFor: timestamppb.New(now.Add(-time.Minute))},
				},
			},
			NextIntent: &runtimev1.NextHookIntent{
				TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
				Detail: &runtimev1.NextHookIntent_ScheduledTime{
					ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: timestamppb.New(now.Add(-time.Minute))},
				},
			},
			ScheduledFor: timestamppb.New(now.Add(-time.Minute)),
		}
	}
	mustAdmit(scheduled("hook-complete"))
	mustAdmit(scheduled("hook-fail"))
	mustAdmit(scheduled("hook-reschedule"))

	outcomes, err := svc.executeDueHooks(ctx, now, func(_ context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
		switch req.Hook.GetHookId() {
		case "hook-complete":
			return &lifeTurnResult{Summary: "life turn done", TokensUsed: 7}, nil
		case "hook-fail":
			return nil, &lifeTurnExecutionError{
				status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED,
				reasonCode: runtimev1.ReasonCode_AI_OUTPUT_INVALID,
				message:    "executor failed",
				retryable:  true,
				tokensUsed: 3,
			}
		case "hook-reschedule":
			return &lifeTurnResult{
				NextHookIntent: &runtimev1.NextHookIntent{
					TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
					Reason:      "try later",
					Detail: &runtimev1.NextHookIntent_ScheduledTime{
						ScheduledTime: &runtimev1.ScheduledTimeHookIntent{
							ScheduledFor: timestamppb.New(now.Add(10 * time.Minute)),
						},
					},
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

	statuses := map[string]runtimev1.AgentHookStatus{}
	for _, outcome := range outcomes {
		statuses[outcome.GetHookId()] = outcome.GetStatus()
	}
	if statuses["hook-complete"] != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED {
		t.Fatalf("expected completed status, got %s", statuses["hook-complete"])
	}
	if statuses["hook-fail"] != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED {
		t.Fatalf("expected failed status, got %s", statuses["hook-fail"])
	}
	if statuses["hook-reschedule"] != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED {
		t.Fatalf("expected rescheduled status, got %s", statuses["hook-reschedule"])
	}

	stateResp, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{AgentId: "agent-exec"})
	if err != nil {
		t.Fatalf("GetAgentState: %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING {
		t.Fatalf("expected LIFE_PENDING because follow-up hook remains pending, got %s", stateResp.GetState().GetExecutionState())
	}

	entry, err := svc.agentByID("agent-exec")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	if entry.Agent.GetAutonomy().GetUsedTokensInWindow() != 12 {
		t.Fatalf("expected used token accumulation to be 12, got %d", entry.Agent.GetAutonomy().GetUsedTokensInWindow())
	}
	if entry.Hooks["hook-complete"].GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED {
		t.Fatalf("expected completed hook stored terminal state, got %s", entry.Hooks["hook-complete"].GetStatus())
	}
	if entry.Hooks["hook-fail"].GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED {
		t.Fatalf("expected failed hook stored terminal state, got %s", entry.Hooks["hook-fail"].GetStatus())
	}
	if entry.Hooks["hook-reschedule"].GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED {
		t.Fatalf("expected rescheduled hook stored terminal state, got %s", entry.Hooks["hook-reschedule"].GetStatus())
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{AgentId: "agent-exec"})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 {
		t.Fatalf("expected one follow-up pending hook, got %d", len(pendingResp.GetHooks()))
	}
	if pendingResp.GetHooks()[0].GetHookId() == "hook-reschedule" {
		t.Fatal("expected reschedule to create a distinct follow-up hook id")
	}
}

func TestAgentCoreExecuteDueHooksReschedulesBudgetExhaustedAgent(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	windowStart := timestamppb.New(time.Now().UTC().Add(-2 * time.Hour))
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-budget",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 10,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	entry, err := svc.agentByID("agent-budget")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	entry.Agent.Autonomy.BudgetExhausted = true
	entry.Agent.Autonomy.UsedTokensInWindow = 10
	entry.Agent.Autonomy.WindowStartedAt = windowStart
	if err := svc.updateAgent(entry); err != nil {
		t.Fatalf("updateAgent(budget): %v", err)
	}

	scheduledFor := time.Now().UTC().Add(-time.Minute)
	if err := svc.admitPendingHook("agent-budget", &runtimev1.PendingHook{
		HookId: "hook-budget",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{ScheduledFor: timestamppb.New(scheduledFor)},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: timestamppb.New(scheduledFor)},
			},
		},
		ScheduledFor: timestamppb.New(scheduledFor),
	}); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	outcomes, err := svc.executeDueHooks(ctx, time.Now().UTC(), func(context.Context, *lifeTurnRequest) (*lifeTurnResult, error) {
		t.Fatal("executor should not run when budget is exhausted")
		return nil, nil
	})
	if err != nil {
		t.Fatalf("executeDueHooks: %v", err)
	}
	if len(outcomes) != 1 || outcomes[0].GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED {
		t.Fatalf("expected rescheduled outcome for exhausted budget, got %#v", outcomes)
	}
	if outcomes[0].GetRescheduled().GetNextIntent().GetScheduledTime().GetScheduledFor().AsTime().Before(windowStart.AsTime().Add(24 * time.Hour)) {
		t.Fatalf("expected reschedule no earlier than next budget window")
	}
}

func TestAgentCoreAdmitPendingHookFailsClosedWithoutExplicitNonTimeSchedule(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-non-time",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 10,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	err := svc.admitPendingHook("agent-non-time", &runtimev1.PendingHook{
		HookId: "hook-turn-completed",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_TURN_COMPLETED,
			Detail: &runtimev1.HookTriggerDetail_TurnCompleted{
				TurnCompleted: &runtimev1.TurnCompletedTriggerDetail{
					TurnId: "turn-1",
					Track:  runtimev1.AgentTrackType_AGENT_TRACK_TYPE_LIFE,
				},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_TURN_COMPLETED,
			Detail: &runtimev1.NextHookIntent_TurnCompleted{
				TurnCompleted: &runtimev1.TurnCompletedHookIntent{
					AfterTurnId: "turn-1",
					Track:       runtimev1.AgentTrackType_AGENT_TRACK_TYPE_LIFE,
				},
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for implicit non-time schedule, got %v", err)
	}
}

func TestTriggerDetailFromIntentUserIdleNilSafe(t *testing.T) {
	t.Parallel()

	detail := triggerDetailFromIntent(&runtimev1.NextHookIntent{
		TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_USER_IDLE,
		Detail: &runtimev1.NextHookIntent_UserIdle{
			UserIdle: &runtimev1.UserIdleHookIntent{},
		},
	})
	if detail == nil || detail.GetUserIdle() == nil {
		t.Fatal("expected user idle trigger detail")
	}
	if detail.GetUserIdle().GetIdleFor() != nil {
		t.Fatal("expected nil idle_for to stay nil")
	}
}

func TestAgentCoreLifeTrackLoopRejectsDueHookWithoutExecutor(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-loop-reject",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 25,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	now := time.Now().UTC()
	if err := svc.admitPendingHook("agent-loop-reject", &runtimev1.PendingHook{
		HookId: "hook-loop-reject",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{ScheduledFor: timestamppb.New(now.Add(-time.Second))},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: timestamppb.New(now.Add(-time.Second))},
			},
		},
		ScheduledFor: timestamppb.New(now.Add(-time.Second)),
	}); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartLifeTrackLoop(loopCtx); err != nil {
		t.Fatalf("StartLifeTrackLoop: %v", err)
	}
	defer svc.StopLifeTrackLoop()

	waitForAgentCoreCondition(t, 2*time.Second, func() bool {
		resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
			AgentId:      "agent-loop-reject",
			StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED,
		})
		return err == nil && len(resp.GetHooks()) == 1
	})

	rejectedResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		AgentId:      "agent-loop-reject",
		StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(rejected): %v", err)
	}
	if len(rejectedResp.GetHooks()) != 1 {
		t.Fatalf("expected one rejected hook, got %d", len(rejectedResp.GetHooks()))
	}

	stateResp, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{AgentId: "agent-loop-reject"})
	if err != nil {
		t.Fatalf("GetAgentState: %v", err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
		t.Fatalf("expected IDLE after rejection, got %s", stateResp.GetState().GetExecutionState())
	}
}

func TestAgentCoreLifeTrackLoopEmitsCommittedHookMemoryAndBudgetEvents(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-loop-events",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 50,
			MaxTokensPerHook: 1,
			MinHookInterval:  durationpb.New(5 * time.Minute),
		},
		WorldId: "world-1",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	if _, err := svc.UpdateAgentState(ctx, &runtimev1.UpdateAgentStateRequest{
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
	if err := svc.admitPendingHook("agent-loop-events", &runtimev1.PendingHook{
		HookId: "hook-loop-events",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{ScheduledFor: timestamppb.New(now.Add(-time.Second))},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: timestamppb.New(now.Add(-time.Second))},
			},
		},
		ScheduledFor: timestamppb.New(now.Add(-time.Second)),
	}); err != nil {
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
						Text: `{"status_text":"watching the world","summary":"life turn complete","tokens_used":999,"canonical_memory_candidates":[{"canonical_class":"WORLD_SHARED","policy_reason":"world_fact","record":{"kind":"MEMORY_RECORD_KIND_OBSERVATIONAL","observational":{"observation":"Lanterns are lit","sourceRef":"life-track"}}},{"canonical_class":"DYADIC","policy_reason":"broken","record":{"kind":"MEMORY_RECORD_KIND_SEMANTIC","semantic":{"subject":"user","predicate":"","object":"prefers tea"}}}],"next_hook_intent":null}`,
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

	waitForAgentCoreCondition(t, 2*time.Second, func() bool {
		resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
			AgentId:      "agent-loop-events",
			StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED,
		})
		return err == nil && len(resp.GetHooks()) == 1
	})

	stream := newAgentEventCaptureStreamLimit(ctx, 4)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId: "agent-loop-events",
		Cursor:  encodeCursor(cursor),
	}, stream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents returned %v, want context.Canceled", err)
	}
	if len(stream.events) != 4 {
		t.Fatalf("expected 4 committed events after loop, got %d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK ||
		stream.events[0].GetHook().GetOutcome().GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING {
		t.Fatalf("expected running hook event first, got %#v", stream.events[0])
	}
	if stream.events[1].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK ||
		stream.events[1].GetHook().GetOutcome().GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED {
		t.Fatalf("expected completed hook event second, got %#v", stream.events[1])
	}
	if stream.events[2].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY {
		t.Fatalf("expected memory event third, got %#v", stream.events[2])
	}
	if len(stream.events[2].GetMemory().GetAccepted()) != 1 || len(stream.events[2].GetMemory().GetRejected()) != 1 {
		t.Fatalf("expected one accepted life-turn memory, got %#v", stream.events[2].GetMemory())
	}
	if stream.events[3].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET {
		t.Fatalf("expected budget event fourth, got %#v", stream.events[3])
	}

	entry, err := svc.agentByID("agent-loop-events")
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

func TestAgentCoreProjectsCommittedMemoryReplicationEvents(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-replication-a",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 20,
		},
		WorldId: "world-1",
	}); err != nil {
		t.Fatalf("InitializeAgent(agent-replication-a): %v", err)
	}
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-replication-b",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 20,
		},
		WorldId: "world-1",
	}); err != nil {
		t.Fatalf("InitializeAgent(agent-replication-b): %v", err)
	}
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-replication-c",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 20,
		},
		WorldId: "world-2",
	}); err != nil {
		t.Fatalf("InitializeAgent(agent-replication-c): %v", err)
	}
	if _, err := svc.UpdateAgentState(ctx, &runtimev1.UpdateAgentStateRequest{
		AgentId: "agent-replication-a",
		Mutations: []*runtimev1.AgentStateMutation{
			{
				Mutation: &runtimev1.AgentStateMutation_SetDyadicContext{
					SetDyadicContext: &runtimev1.AgentStateSetDyadicContext{UserId: "user-1"},
				},
			},
		},
	}); err != nil {
		t.Fatalf("UpdateAgentState(agent-replication-a): %v", err)
	}

	coreWrite, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: "agent-replication-a",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-replication-a"},
					},
				},
				SourceEventId: "evt-core",
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{
							Observation: "core memory",
						},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory(core): %v", err)
	}
	if len(coreWrite.GetAccepted()) != 1 {
		t.Fatalf("expected one accepted core memory, got %d", len(coreWrite.GetAccepted()))
	}
	dyadicWrite, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: "agent-replication-a",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
					Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
						AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: "agent-replication-a", UserId: "user-1"},
					},
				},
				SourceEventId: "evt-dyadic",
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{
							Observation: "dyadic memory",
						},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory(dyadic): %v", err)
	}
	if len(dyadicWrite.GetAccepted()) != 1 {
		t.Fatalf("expected one accepted dyadic memory, got %d", len(dyadicWrite.GetAccepted()))
	}
	worldWrite, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: "agent-replication-a",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
					Owner: &runtimev1.MemoryBankLocator_WorldShared{
						WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: "world-1"},
					},
				},
				SourceEventId: "evt-world",
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{
							Observation: "world memory",
						},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory(world): %v", err)
	}
	if len(worldWrite.GetAccepted()) != 1 {
		t.Fatalf("expected one accepted world memory, got %d", len(worldWrite.GetAccepted()))
	}

	svc.mu.RLock()
	cursorA := svc.sequence
	cursorB := svc.sequence
	cursorC := svc.sequence
	svc.mu.RUnlock()

	now := time.Now().UTC()
	if err := svc.memorySvc.ApplyReplicationObservation(coreWrite.GetAccepted()[0].GetSourceBank(), coreWrite.GetAccepted()[0].GetRecord().GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
		LocalVersion: coreWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
		BasisVersion: coreWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Synced{
			Synced: &runtimev1.MemoryReplicationSynced{
				RealmVersion: "realm-core",
				SyncedAt:     timestamppb.New(now),
			},
		},
	}, now); err != nil {
		t.Fatalf("ApplyReplicationObservation(core): %v", err)
	}
	if err := svc.memorySvc.ApplyReplicationObservation(dyadicWrite.GetAccepted()[0].GetSourceBank(), dyadicWrite.GetAccepted()[0].GetRecord().GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_CONFLICT,
		LocalVersion: dyadicWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
		BasisVersion: dyadicWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Conflict{
			Conflict: &runtimev1.MemoryReplicationConflict{
				ConflictId:     "conflict-dyadic",
				LocalVersion:   dyadicWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
				RemoteVersion:  "realm-dyadic",
				ConflictReason: "diverged",
				DetectedAt:     timestamppb.New(now),
			},
		},
	}, now); err != nil {
		t.Fatalf("ApplyReplicationObservation(dyadic): %v", err)
	}
	if err := svc.memorySvc.ApplyReplicationObservation(worldWrite.GetAccepted()[0].GetSourceBank(), worldWrite.GetAccepted()[0].GetRecord().GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED,
		LocalVersion: worldWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
		BasisVersion: worldWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Invalidation{
			Invalidation: &runtimev1.MemoryInvalidation{
				InvalidationId:     "inv-world",
				InvalidatedVersion: worldWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
				Authority:          "realm",
				InvalidationReason: "moderation",
				InvalidatedAt:      timestamppb.New(now),
			},
		},
	}, now); err != nil {
		t.Fatalf("ApplyReplicationObservation(world): %v", err)
	}

	streamA := newAgentEventCaptureStreamLimit(ctx, 3)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId:      "agent-replication-a",
		Cursor:       encodeCursor(cursorA),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_REPLICATION},
	}, streamA); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(agent A): %v", err)
	}
	if len(streamA.events) != 3 {
		t.Fatalf("expected three replication events for agent A, got %d", len(streamA.events))
	}
	if streamA.events[0].GetReplication().GetMemoryId() != coreWrite.GetAccepted()[0].GetRecord().GetMemoryId() {
		t.Fatalf("expected core replication event first, got %#v", streamA.events[0])
	}
	if streamA.events[1].GetReplication().GetMemoryId() != dyadicWrite.GetAccepted()[0].GetRecord().GetMemoryId() {
		t.Fatalf("expected dyadic replication event second, got %#v", streamA.events[1])
	}
	if streamA.events[2].GetReplication().GetMemoryId() != worldWrite.GetAccepted()[0].GetRecord().GetMemoryId() {
		t.Fatalf("expected world replication event third, got %#v", streamA.events[2])
	}

	streamB := newAgentEventCaptureStreamLimit(ctx, 1)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId:      "agent-replication-b",
		Cursor:       encodeCursor(cursorB),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_REPLICATION},
	}, streamB); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(agent B): %v", err)
	}
	if len(streamB.events) != 1 || streamB.events[0].GetReplication().GetMemoryId() != worldWrite.GetAccepted()[0].GetRecord().GetMemoryId() {
		t.Fatalf("expected only world replication event for agent B, got %#v", streamB.events)
	}

	streamC := newAgentEventCaptureStreamLimit(ctx, 1)
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
			AgentId:      "agent-replication-c",
			Cursor:       encodeCursor(cursorC),
			EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_REPLICATION},
		}, streamC)
	}()
	time.Sleep(100 * time.Millisecond)
	streamC.cancel()
	if err := <-done; err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(agent C): %v", err)
	}
	if len(streamC.events) != 0 {
		t.Fatalf("expected no replication events for agent C, got %#v", streamC.events)
	}
}

func TestAgentCoreIgnoresNonCanonicalMemoryReplicationUpdates(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-replication-ignore",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 20,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	svc.mu.RLock()
	beforeSequence := svc.sequence
	svc.mu.RUnlock()

	createResp, err := svc.memorySvc.CreateBank(ctx, &runtimev1.CreateBankRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app.test"},
		Locator: &runtimev1.PublicMemoryBankLocator{
			Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
				AppPrivate: &runtimev1.AppPrivateBankOwner{
					AccountId: "acct-1",
					AppId:     "app.test",
				},
			},
		},
		EmbeddingProfile: &runtimev1.MemoryEmbeddingProfile{
			Provider:        "local",
			ModelId:         "text-embedding-3-small",
			Dimension:       1536,
			DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
			Version:         "v1",
			MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
		},
		DisplayName: "App Memory",
	})
	if err != nil {
		t.Fatalf("CreateBank: %v", err)
	}
	retainResp, err := svc.memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: createResp.GetBank().GetLocator(),
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{
						Observation: "app private memory",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	if err := svc.memorySvc.ApplyReplicationObservation(createResp.GetBank().GetLocator(), retainResp.GetRecords()[0].GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
		LocalVersion: retainResp.GetRecords()[0].GetReplication().GetLocalVersion(),
		BasisVersion: retainResp.GetRecords()[0].GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Synced{
			Synced: &runtimev1.MemoryReplicationSynced{
				RealmVersion: "realm-app",
				SyncedAt:     timestamppb.New(time.Now().UTC()),
			},
		},
	}, time.Now().UTC()); err != nil {
		t.Fatalf("ApplyReplicationObservation: %v", err)
	}

	waitForAgentCoreCondition(t, time.Second, func() bool {
		svc.mu.RLock()
		defer svc.mu.RUnlock()
		return svc.sequence == beforeSequence
	})
}

func TestAgentCoreProjectsBridgeDrivenMemoryReplicationEvents(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-bridge-a",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 20,
		},
		WorldId: "world-1",
	}); err != nil {
		t.Fatalf("InitializeAgent(agent-bridge-a): %v", err)
	}
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-bridge-b",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 20,
		},
		WorldId: "world-1",
	}); err != nil {
		t.Fatalf("InitializeAgent(agent-bridge-b): %v", err)
	}
	if _, err := svc.UpdateAgentState(ctx, &runtimev1.UpdateAgentStateRequest{
		AgentId: "agent-bridge-a",
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

	coreWrite, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: "agent-bridge-a",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-bridge-a"},
					},
				},
				SourceEventId: "evt-bridge-core",
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{Observation: "bridge core memory"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory(core): %v", err)
	}
	dyadicWrite, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: "agent-bridge-a",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
					Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
						AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: "agent-bridge-a", UserId: "user-1"},
					},
				},
				SourceEventId: "evt-bridge-dyadic",
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{Observation: "bridge dyadic memory"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory(dyadic): %v", err)
	}
	worldWrite, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: "agent-bridge-a",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
					Owner: &runtimev1.MemoryBankLocator_WorldShared{
						WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: "world-1"},
					},
				},
				SourceEventId: "evt-bridge-world",
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{Observation: "bridge world memory"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory(world): %v", err)
	}

	svc.mu.RLock()
	cursorA := svc.sequence
	cursorB := svc.sequence
	svc.mu.RUnlock()

	svc.memorySvc.SetReplicationBridgeAdapter(&agentCoreFakeBridgeAdapter{
		results: map[string]*runtimev1.MemoryReplicationState{
			coreWrite.GetAccepted()[0].GetRecord().GetMemoryId(): {
				Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
				LocalVersion: coreWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
				BasisVersion: coreWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
				Detail: &runtimev1.MemoryReplicationState_Synced{
					Synced: &runtimev1.MemoryReplicationSynced{RealmVersion: "realm-core", SyncedAt: timestamppb.Now()},
				},
			},
			dyadicWrite.GetAccepted()[0].GetRecord().GetMemoryId(): {
				Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_CONFLICT,
				LocalVersion: dyadicWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
				BasisVersion: dyadicWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
				Detail: &runtimev1.MemoryReplicationState_Conflict{
					Conflict: &runtimev1.MemoryReplicationConflict{
						ConflictId:     "bridge-conflict",
						LocalVersion:   dyadicWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
						RemoteVersion:  "realm-dyadic",
						ConflictReason: "diverged",
						DetectedAt:     timestamppb.Now(),
					},
				},
			},
			worldWrite.GetAccepted()[0].GetRecord().GetMemoryId(): {
				Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED,
				LocalVersion: worldWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
				BasisVersion: worldWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
				Detail: &runtimev1.MemoryReplicationState_Invalidation{
					Invalidation: &runtimev1.MemoryInvalidation{
						InvalidationId:     "bridge-invalidation",
						InvalidatedVersion: worldWrite.GetAccepted()[0].GetRecord().GetReplication().GetLocalVersion(),
						Authority:          "realm",
						InvalidationReason: "moderation",
						InvalidatedAt:      timestamppb.Now(),
					},
				},
			},
		},
	})
	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.memorySvc.StartReplicationLoop(loopCtx); err != nil {
		t.Fatalf("StartReplicationLoop: %v", err)
	}
	t.Cleanup(svc.memorySvc.StopReplicationLoop)

	waitForAgentCoreCondition(t, 2*time.Second, func() bool {
		return len(svc.memorySvc.ListReplicationBacklog()) == 0
	})

	streamA := newAgentEventCaptureStreamLimit(ctx, 3)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId:      "agent-bridge-a",
		Cursor:       encodeCursor(cursorA),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_REPLICATION},
	}, streamA); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(agent-bridge-a): %v", err)
	}
	if len(streamA.events) != 3 {
		t.Fatalf("expected three bridge-driven replication events, got %d", len(streamA.events))
	}

	streamB := newAgentEventCaptureStreamLimit(ctx, 1)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId:      "agent-bridge-b",
		Cursor:       encodeCursor(cursorB),
		EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_REPLICATION},
	}, streamB); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents(agent-bridge-b): %v", err)
	}
	if len(streamB.events) != 1 || streamB.events[0].GetReplication().GetMemoryId() != worldWrite.GetAccepted()[0].GetRecord().GetMemoryId() {
		t.Fatalf("expected world replication event for agent-bridge-b, got %#v", streamB.events)
	}
}

func TestAgentCoreLifeTrackLoopReschedulesWithAIOutput(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-loop-reschedule",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 50,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	now := time.Now().UTC()
	followupAt := now.Add(10 * time.Minute)
	if err := svc.admitPendingHook("agent-loop-reschedule", &runtimev1.PendingHook{
		HookId: "hook-loop-reschedule",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{ScheduledFor: timestamppb.New(now.Add(-time.Second))},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: timestamppb.New(now.Add(-time.Second))},
			},
		},
		ScheduledFor: timestamppb.New(now.Add(-time.Second)),
	}); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	svc.SetLifeTrackExecutor(NewAIBackedLifeTrackExecutor(&fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: fmt.Sprintf(`{"summary":"try again later","tokens_used":2,"canonical_memory_candidates":[],"next_hook_intent":{"triggerKind":"HOOK_TRIGGER_KIND_SCHEDULED_TIME","reason":"try again later","scheduledTime":{"scheduledFor":"%s"}}}`, followupAt.Format(time.RFC3339)),
					},
				},
			},
		},
	}))

	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartLifeTrackLoop(loopCtx); err != nil {
		t.Fatalf("StartLifeTrackLoop: %v", err)
	}
	defer svc.StopLifeTrackLoop()

	waitForAgentCoreCondition(t, 2*time.Second, func() bool {
		resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
			AgentId:      "agent-loop-reschedule",
			StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED,
		})
		return err == nil && len(resp.GetHooks()) == 1
	})

	entry, err := svc.agentByID("agent-loop-reschedule")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	if entry.Hooks["hook-loop-reschedule"].GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED {
		t.Fatalf("expected original hook rescheduled, got %s", entry.Hooks["hook-loop-reschedule"].GetStatus())
	}
	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		AgentId:      "agent-loop-reschedule",
		StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(pending): %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 {
		t.Fatalf("expected one follow-up pending hook, got %d", len(pendingResp.GetHooks()))
	}
	if pendingResp.GetHooks()[0].GetHookId() == "hook-loop-reschedule" {
		t.Fatal("expected follow-up hook to have a distinct id")
	}
}

func TestAgentCoreLifeTrackLoopFailsOnInvalidAIOutput(t *testing.T) {
	t.Parallel()

	svc := newAgentCoreTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-loop-invalid",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 25,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	now := time.Now().UTC()
	if err := svc.admitPendingHook("agent-loop-invalid", &runtimev1.PendingHook{
		HookId: "hook-loop-invalid",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{ScheduledFor: timestamppb.New(now.Add(-time.Second))},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: timestamppb.New(now.Add(-time.Second))},
			},
		},
		ScheduledFor: timestamppb.New(now.Add(-time.Second)),
	}); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}
	svc.mu.RLock()
	cursor := svc.sequence
	svc.mu.RUnlock()

	svc.SetLifeTrackExecutor(NewAIBackedLifeTrackExecutor(&fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `{"summary":"bad","initiate_chat_intent":{"message":"hello"}}`,
					},
				},
			},
		},
	}))

	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartLifeTrackLoop(loopCtx); err != nil {
		t.Fatalf("StartLifeTrackLoop: %v", err)
	}
	defer svc.StopLifeTrackLoop()

	waitForAgentCoreCondition(t, 2*time.Second, func() bool {
		resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
			AgentId:      "agent-loop-invalid",
			StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED,
		})
		return err == nil && len(resp.GetHooks()) == 1
	})

	failedResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		AgentId:      "agent-loop-invalid",
		StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(failed): %v", err)
	}
	if len(failedResp.GetHooks()) != 1 {
		t.Fatalf("expected one failed hook, got %d", len(failedResp.GetHooks()))
	}
	stream := newAgentEventCaptureStreamLimit(ctx, 2)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId: "agent-loop-invalid",
		Cursor:  encodeCursor(cursor),
	}, stream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents returned %v, want context.Canceled", err)
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK {
		t.Fatalf("expected last event hook failure, got %#v", last)
	}
	if last.GetHook().GetOutcome().GetFailed().GetReasonCode() != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("expected AI_OUTPUT_INVALID, got %#v", last.GetHook().GetOutcome())
	}
}

func newAgentCoreTestService(t *testing.T) *Service {
	t.Helper()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	memorySvc.SetManagedEmbeddingProfile(&runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})

	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("agentcore.New: %v", err)
	}
	return svc
}

type agentCoreFakeBridgeAdapter struct {
	results map[string]*runtimev1.MemoryReplicationState
}

func (f *agentCoreFakeBridgeAdapter) SyncPendingMemory(_ context.Context, item *memoryservice.ReplicationBacklogItem) (*runtimev1.MemoryReplicationState, error) {
	if f == nil || f.results == nil {
		return nil, nil
	}
	state := f.results[item.MemoryID]
	if state == nil {
		return nil, nil
	}
	return proto.Clone(state).(*runtimev1.MemoryReplicationState), nil
}

type agentEventCaptureStream struct {
	ctx    context.Context
	cancel context.CancelFunc
	events []*runtimev1.AgentEvent
	max    int
}

func newAgentEventCaptureStream(parent context.Context) *agentEventCaptureStream {
	return newAgentEventCaptureStreamLimit(parent, 1)
}

func newAgentEventCaptureStreamLimit(parent context.Context, max int) *agentEventCaptureStream {
	ctx, cancel := context.WithCancel(parent)
	return &agentEventCaptureStream{ctx: ctx, cancel: cancel, max: max}
}

func (s *agentEventCaptureStream) SetHeader(metadata.MD) error  { return nil }
func (s *agentEventCaptureStream) SendHeader(metadata.MD) error { return nil }
func (s *agentEventCaptureStream) SetTrailer(metadata.MD)       {}
func (s *agentEventCaptureStream) Context() context.Context     { return s.ctx }
func (s *agentEventCaptureStream) SendMsg(any) error            { return nil }
func (s *agentEventCaptureStream) RecvMsg(any) error            { return nil }

func (s *agentEventCaptureStream) Send(event *runtimev1.AgentEvent) error {
	s.events = append(s.events, proto.Clone(event).(*runtimev1.AgentEvent))
	if s.max <= 0 || len(s.events) >= s.max {
		s.cancel()
	}
	return nil
}

type lifeTrackExecutorFunc func(context.Context, *lifeTurnRequest) (*lifeTurnResult, error)

func (f lifeTrackExecutorFunc) ExecuteLifeTrackHook(ctx context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
	return f(ctx, req)
}

type fakeLifeTurnAI struct {
	response *runtimev1.ExecuteScenarioResponse
	err      error
	requests []*runtimev1.ExecuteScenarioRequest
}

func (f *fakeLifeTurnAI) ExecuteScenario(_ context.Context, req *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
	f.requests = append(f.requests, proto.Clone(req).(*runtimev1.ExecuteScenarioRequest))
	if f.err != nil {
		return nil, f.err
	}
	if f.response == nil {
		return &runtimev1.ExecuteScenarioResponse{}, nil
	}
	return proto.Clone(f.response).(*runtimev1.ExecuteScenarioResponse), nil
}

func waitForAgentCoreCondition(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition not satisfied before timeout")
}
