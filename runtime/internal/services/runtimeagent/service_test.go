package runtimeagent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
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
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRuntimeAgentInitializeWriteQueryAndHooks(t *testing.T) {
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
		t.Fatalf("runtimeagent.New: %v", err)
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

	hookTime := time.Now().Add(5 * time.Minute)
	hook := &runtimev1.PendingHook{
		HookId: "hook-1",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{
					ScheduledFor: timestamppb.New(hookTime),
				},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{
					ScheduledFor: timestamppb.New(hookTime),
				},
			},
		},
		ScheduledFor: timestamppb.New(hookTime),
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

func TestRuntimeAgentAutonomyDefaultsOffWithoutImplicitEnable(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	initResp, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-autonomy-default-off",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 20,
		},
	})
	if err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	if initResp.GetAgent().GetAutonomy().GetEnabled() {
		t.Fatalf("expected default-off autonomy, got %#v", initResp.GetAgent().GetAutonomy())
	}
	if initResp.GetAgent().GetAutonomy().GetConfig().GetMode() != runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		t.Fatalf("expected OFF mode normalization, got %s", initResp.GetAgent().GetAutonomy().GetConfig().GetMode())
	}
}

func TestRuntimeAgentSetAutonomyConfigDoesNotImplicitlyEnable(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-autonomy-config",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	resp, err := svc.SetAutonomyConfig(ctx, &runtimev1.SetAutonomyConfigRequest{
		AgentId: "agent-autonomy-config",
		Config: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 10,
		},
	})
	if err != nil {
		t.Fatalf("SetAutonomyConfig: %v", err)
	}
	if resp.GetAutonomy().GetEnabled() {
		t.Fatalf("expected config-only update to remain disabled, got %#v", resp.GetAutonomy())
	}
	if resp.GetAutonomy().GetConfig().GetMode() != runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW {
		t.Fatalf("expected LOW mode, got %s", resp.GetAutonomy().GetConfig().GetMode())
	}
}

func TestRuntimeAgentEnableAutonomyNoopWhenModeOff(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-autonomy-noop",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	resp, err := svc.EnableAutonomy(ctx, &runtimev1.EnableAutonomyRequest{
		AgentId: "agent-autonomy-noop",
	})
	if err != nil {
		t.Fatalf("EnableAutonomy: %v", err)
	}
	if resp.GetAutonomy().GetEnabled() {
		t.Fatalf("expected OFF-mode enable to no-op, got %#v", resp.GetAutonomy())
	}
	if resp.GetAutonomy().GetConfig().GetMode() != runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		t.Fatalf("expected OFF mode, got %s", resp.GetAutonomy().GetConfig().GetMode())
	}
}

func TestRuntimeAgentEnableAutonomyActivatesConfiguredMode(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-autonomy-enable",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	if _, err := svc.SetAutonomyConfig(ctx, &runtimev1.SetAutonomyConfigRequest{
		AgentId: "agent-autonomy-enable",
		Config: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM,
			DailyTokenBudget: 20,
		},
	}); err != nil {
		t.Fatalf("SetAutonomyConfig: %v", err)
	}

	resp, err := svc.EnableAutonomy(ctx, &runtimev1.EnableAutonomyRequest{
		AgentId: "agent-autonomy-enable",
	})
	if err != nil {
		t.Fatalf("EnableAutonomy: %v", err)
	}
	if !resp.GetAutonomy().GetEnabled() {
		t.Fatalf("expected MEDIUM-mode autonomy to enable, got %#v", resp.GetAutonomy())
	}
	if resp.GetAutonomy().GetConfig().GetMode() != runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM {
		t.Fatalf("expected MEDIUM mode, got %s", resp.GetAutonomy().GetConfig().GetMode())
	}
}

func TestRuntimeAgentRunLifeTrackSweepAdmitsCadenceTickByMode(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name     string
		mode     runtimev1.AgentAutonomyMode
		expected time.Duration
	}{
		{name: "low", mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW, expected: 120 * time.Minute},
		{name: "medium", mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM, expected: 60 * time.Minute},
		{name: "high", mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_HIGH, expected: 30 * time.Minute},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc := newRuntimeAgentTestService(t)
			ctx := context.Background()
			agentID := "agent-cadence-" + tc.name
			if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
				AgentId: agentID,
				AutonomyConfig: &runtimev1.AgentAutonomyConfig{
					Mode: tc.mode,
				},
			}); err != nil {
				t.Fatalf("InitializeAgent: %v", err)
			}
			mustEnableAutonomy(t, svc, ctx, agentID)

			now := time.Now().UTC()
			if err := svc.runLifeTrackSweep(ctx, now); err != nil {
				t.Fatalf("runLifeTrackSweep: %v", err)
			}

			hook := mustFindPendingCadenceHook(t, svc, ctx, agentID)
			if got := hook.GetScheduledFor().AsTime().UTC(); !got.Equal(now.Add(tc.expected).UTC()) {
				t.Fatalf("expected cadence tick at %s, got %s", now.Add(tc.expected).UTC(), got)
			}
		})
	}
}

func TestRuntimeAgentRunLifeTrackSweepPrefersEarlierCallbackOverCadenceTick(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-earlier-callback",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-earlier-callback")

	now := time.Now().UTC()
	callbackAt := now.Add(30 * time.Minute)
	if err := svc.admitPendingHook("agent-earlier-callback", &runtimev1.PendingHook{
		HookId: "hook-earlier-callback",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{ScheduledFor: timestamppb.New(callbackAt)},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Reason:      "callback first",
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: timestamppb.New(callbackAt)},
			},
		},
		ScheduledFor: timestamppb.New(callbackAt),
	}); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	if err := svc.runLifeTrackSweep(ctx, now); err != nil {
		t.Fatalf("runLifeTrackSweep: %v", err)
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{AgentId: "agent-earlier-callback"})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 || pendingResp.GetHooks()[0].GetHookId() != "hook-earlier-callback" {
		t.Fatalf("expected only earlier callback hook to remain pending, got %#v", pendingResp.GetHooks())
	}
}

func TestRuntimeAgentRunLifeTrackSweepDelaysCadenceTickUntilSuppressionExpires(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-suppress-expiry",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-suppress-expiry")

	now := time.Now().UTC()
	expiresAt := now.Add(3 * time.Hour)
	callbackAt := now.Add(8 * time.Hour)
	if err := svc.admitPendingHook("agent-suppress-expiry", &runtimev1.PendingHook{
		HookId: "hook-sleep",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{ScheduledFor: timestamppb.New(callbackAt)},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind:        runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Reason:             "sleep",
			ExpiresAt:          timestamppb.New(expiresAt),
			CadenceInteraction: runtimev1.HookCadenceInteraction_HOOK_CADENCE_INTERACTION_SUPPRESS_BASE_TICK_UNTIL_EXPIRED,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: timestamppb.New(callbackAt)},
			},
		},
		ScheduledFor: timestamppb.New(callbackAt),
	}); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	if err := svc.runLifeTrackSweep(ctx, now); err != nil {
		t.Fatalf("runLifeTrackSweep: %v", err)
	}

	hook := mustFindPendingCadenceHook(t, svc, ctx, "agent-suppress-expiry")
	if got := hook.GetScheduledFor().AsTime().UTC(); !got.Equal(expiresAt.UTC()) {
		t.Fatalf("expected cadence tick at suppression expiry %s, got %s", expiresAt.UTC(), got)
	}
}

func TestRuntimeAgentExecuteDueHooksRespectsMinSpacingForEarlyCallback(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-min-spacing",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-min-spacing")

	now := time.Now().UTC()
	entry, err := svc.agentByID("agent-min-spacing")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	entry.Hooks["hook-last-turn"] = &runtimev1.PendingHook{
		HookId:       "hook-last-turn",
		Status:       runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED,
		ScheduledFor: timestamppb.New(now),
		AdmittedAt:   timestamppb.New(now),
	}
	if err := svc.updateAgent(entry); err != nil {
		t.Fatalf("updateAgent: %v", err)
	}

	tooEarly := now.Add(10 * time.Minute)
	if err := svc.admitPendingHook("agent-min-spacing", &runtimev1.PendingHook{
		HookId: "hook-too-early",
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{ScheduledFor: timestamppb.New(tooEarly)},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Reason:      "early callback",
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: timestamppb.New(tooEarly)},
			},
		},
		ScheduledFor: timestamppb.New(tooEarly),
	}); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	outcomes, err := svc.executeDueHooks(ctx, tooEarly, func(context.Context, *lifeTurnRequest) (*lifeTurnResult, error) {
		t.Fatal("executor should not run before min spacing")
		return nil, nil
	})
	if err != nil {
		t.Fatalf("executeDueHooks: %v", err)
	}
	if len(outcomes) != 1 || outcomes[0].GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED {
		t.Fatalf("expected early callback to be rescheduled, got %#v", outcomes)
	}
	expected := now.Add(60 * time.Minute).UTC()
	got := outcomes[0].GetRescheduled().GetNextIntent().GetScheduledTime().GetScheduledFor().AsTime().UTC()
	if !got.Equal(expected) {
		t.Fatalf("expected min spacing reschedule at %s, got %s", expected, got)
	}
}

func TestValidateNextHookIntentRejectsSuppressUntilExpiredWithoutExpiresAt(t *testing.T) {
	t.Parallel()

	err := validateNextHookIntent(&runtimev1.NextHookIntent{
		TriggerKind:        runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
		CadenceInteraction: runtimev1.HookCadenceInteraction_HOOK_CADENCE_INTERACTION_SUPPRESS_BASE_TICK_UNTIL_EXPIRED,
		Detail: &runtimev1.NextHookIntent_ScheduledTime{
			ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: timestamppb.Now()},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}

func TestRuntimeAgentExecuteDueHooksRejectsOffModeAgent(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-off-mode-gate",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	entry, err := svc.agentByID("agent-off-mode-gate")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	entry.Agent.Autonomy.Enabled = true
	if err := svc.updateAgent(entry); err != nil {
		t.Fatalf("updateAgent: %v", err)
	}

	now := time.Now().UTC()
	if err := svc.admitPendingHook("agent-off-mode-gate", &runtimev1.PendingHook{
		HookId: "hook-off-mode",
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

	outcomes, err := svc.executeDueHooks(ctx, now, func(context.Context, *lifeTurnRequest) (*lifeTurnResult, error) {
		t.Fatal("executor should not run when autonomy mode is off")
		return nil, nil
	})
	if err != nil {
		t.Fatalf("executeDueHooks: %v", err)
	}
	if len(outcomes) != 1 || outcomes[0].GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED {
		t.Fatalf("expected rejected outcome for OFF-mode agent, got %#v", outcomes)
	}
	if !strings.Contains(strings.ToLower(outcomes[0].GetRejected().GetMessage()), "mode is off") {
		t.Fatalf("expected OFF-mode rejection message, got %#v", outcomes[0].GetRejected())
	}
}

func TestRuntimeAgentRecordAgentMemoryRecallFeedbackAffectsQueryRanking(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}

	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId:     "agent-feedback",
		DisplayName: "Feedback Agent",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	writeResp, err := svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: "agent-feedback",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-feedback"},
					},
				},
				SourceEventId: "evt-feedback-1",
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{Observation: "alpha project note"},
					},
				},
			},
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-feedback"},
					},
				},
				SourceEventId: "evt-feedback-2",
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{Observation: "alpha project plan"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory: %v", err)
	}
	if len(writeResp.GetAccepted()) != 2 {
		t.Fatalf("expected 2 accepted memories, got %d", len(writeResp.GetAccepted()))
	}
	firstID := writeResp.GetAccepted()[0].GetRecord().GetMemoryId()
	secondID := writeResp.GetAccepted()[1].GetRecord().GetMemoryId()

	if err := svc.RecordAgentMemoryRecallFeedback(ctx, AgentMemoryRecallFeedback{
		FeedbackID: "agent-feedback-helpful-1",
		AgentID:    "agent-feedback",
		TargetKind: "record",
		TargetID:   secondID,
		Polarity:   "helpful",
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordAgentMemoryRecallFeedback(helpful): %v", err)
	}
	if err := svc.RecordAgentMemoryRecallFeedback(ctx, AgentMemoryRecallFeedback{
		FeedbackID: "agent-feedback-unhelpful-1",
		AgentID:    "agent-feedback",
		TargetKind: "record",
		TargetID:   firstID,
		Polarity:   "unhelpful",
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordAgentMemoryRecallFeedback(unhelpful): %v", err)
	}

	queryResp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		AgentId: "agent-feedback",
		Query:   "alpha",
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory: %v", err)
	}
	if len(queryResp.GetMemories()) < 2 {
		t.Fatalf("expected at least 2 memories, got %#v", queryResp.GetMemories())
	}
	if queryResp.GetMemories()[0].GetRecord().GetMemoryId() != secondID {
		t.Fatalf("expected helpful memory to rank first, got %#v", queryResp.GetMemories())
	}
	if queryResp.GetMemories()[1].GetRecord().GetMemoryId() != firstID {
		t.Fatalf("expected unhelpful memory to rank after helpful memory, got %#v", queryResp.GetMemories())
	}
}

func TestRuntimeAgentRecordAgentMemoryRecallFeedbackRejectsMismatchedBank(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}

	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId:     "agent-feedback-boundary",
		DisplayName: "Feedback Boundary Agent",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	err = svc.RecordAgentMemoryRecallFeedback(ctx, AgentMemoryRecallFeedback{
		FeedbackID: "agent-feedback-boundary-1",
		AgentID:    "agent-feedback-boundary",
		Bank: &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "someone-else"},
			},
		},
		TargetKind: "record",
		TargetID:   "memory-x",
		Polarity:   "helpful",
	})
	if err == nil {
		t.Fatal("expected mismatched bank validation error")
	}
	if !strings.Contains(err.Error(), "agent_core review bank must match agent_id") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRuntimeAgentImportsLegacyJSONIntoSQLiteAndRename(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	legacyPath := filepath.Join(dir, "runtime-agent-state.json")
	now := time.Now().UTC()
	agent := &runtimev1.AgentRecord{
		AgentId:         "agent-legacy",
		DisplayName:     "Legacy Agent",
		LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		Autonomy: &runtimev1.AgentAutonomyState{
			Enabled: true,
		},
		CreatedAt: timestamppb.New(now),
		UpdatedAt: timestamppb.New(now),
	}
	state := &runtimev1.AgentStateProjection{
		ExecutionState: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING,
		StatusText:     "legacy status",
		ActiveWorldId:  "world-legacy",
		UpdatedAt:      timestamppb.New(now),
	}
	scheduledFor := now.Add(3 * time.Minute)
	hook := &runtimev1.PendingHook{
		HookId: "hook-legacy",
		Status: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{
					ScheduledFor: timestamppb.New(scheduledFor),
				},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{
					ScheduledFor: timestamppb.New(scheduledFor),
				},
			},
		},
		ScheduledFor: timestamppb.New(scheduledFor),
		AdmittedAt:   timestamppb.New(now),
	}
	event := &runtimev1.AgentEvent{
		EventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK,
		Sequence:  3,
		AgentId:   agent.GetAgentId(),
		Timestamp: timestamppb.New(now),
		Detail: &runtimev1.AgentEvent_Hook{
			Hook: &runtimev1.AgentHookEventDetail{
				Outcome: &runtimev1.HookExecutionOutcome{
					HookId:     hook.GetHookId(),
					Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
					Trigger:    hook.GetTrigger(),
					ObservedAt: timestamppb.New(now),
				},
			},
		},
	}
	agentRaw, err := protojson.Marshal(agent)
	if err != nil {
		t.Fatalf("protojson.Marshal(agent): %v", err)
	}
	stateRaw, err := protojson.Marshal(state)
	if err != nil {
		t.Fatalf("protojson.Marshal(state): %v", err)
	}
	hookRaw, err := protojson.Marshal(hook)
	if err != nil {
		t.Fatalf("protojson.Marshal(hook): %v", err)
	}
	eventRaw, err := protojson.Marshal(event)
	if err != nil {
		t.Fatalf("protojson.Marshal(event): %v", err)
	}
	legacy := persistedRuntimeAgentState{
		SchemaVersion: runtimeAgentStateSchemaVersion,
		SavedAt:       now.Format(time.RFC3339Nano),
		Sequence:      event.GetSequence(),
		Agents: []persistedAgentState{
			{
				Agent: agentRaw,
				State: stateRaw,
				Hooks: []json.RawMessage{hookRaw},
			},
		},
		Events: []json.RawMessage{eventRaw},
	}
	raw, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatalf("json.MarshalIndent: %v", err)
	}
	if err := os.WriteFile(legacyPath, raw, 0o600); err != nil {
		t.Fatalf("os.WriteFile(runtime-agent-state.json): %v", err)
	}

	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(import): %v", err)
	}

	entry, err := svc.agentByID(agent.GetAgentId())
	if err != nil {
		t.Fatalf("agentByID(imported): %v", err)
	}
	if entry.State.GetStatusText() != "legacy status" {
		t.Fatalf("unexpected imported state: %#v", entry.State)
	}
	if len(entry.Hooks) != 1 || entry.Hooks["hook-legacy"] == nil {
		t.Fatalf("unexpected imported hooks: %#v", entry.Hooks)
	}
	if len(svc.events) != 1 || svc.events[0].GetSequence() != event.GetSequence() {
		t.Fatalf("unexpected imported events: %#v", svc.events)
	}
	if _, err := os.Stat(legacyPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected legacy runtime-agent file to be renamed, stat err=%v", err)
	}
	if _, err := os.Stat(legacyPath + ".wave4-imported.json.bak"); err != nil {
		t.Fatalf("expected imported runtime agent backup rename: %v", err)
	}
	if got, err := svc.runtimeAgentMetaValue(runtimeAgentMetaLegacyImportSourcePathKey); err != nil || got != legacyPath {
		t.Fatalf("unexpected import source path metadata: got=%q err=%v", got, err)
	}
	if got, err := svc.runtimeAgentMetaValue(runtimeAgentMetaLegacyImportSourceSchemaVersionKey); err != nil || got != "1" {
		t.Fatalf("unexpected import schema metadata: got=%q err=%v", got, err)
	}
	if got, err := svc.runtimeAgentMetaValue(runtimeAgentMetaLegacyImportSourceSHA256Key); err != nil || got == "" {
		t.Fatalf("expected import sha metadata, got=%q err=%v", got, err)
	}
	if got, err := svc.runtimeAgentMetaValue(runtimeAgentMetaLegacyImportedAtKey); err != nil || got == "" {
		t.Fatalf("expected import timestamp metadata, got=%q err=%v", got, err)
	}

	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(restart): %v", err)
	}
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(restart): %v", err)
	}
	entry, err = svc.agentByID(agent.GetAgentId())
	if err != nil {
		t.Fatalf("agentByID(restart): %v", err)
	}
	if len(entry.Hooks) != 1 {
		t.Fatalf("expected one imported hook after restart, got %#v", entry.Hooks)
	}
}

func TestRuntimeAgentColdStartHasNoTruthsOrPostureBasis(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-cold-start",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-cold-start"},
		},
	}
	truths, err := svc.memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 0 {
		t.Fatalf("expected no admitted truths on cold start, got %#v", truths)
	}
	posture, err := svc.GetBehavioralPosture(ctx, "agent-cold-start")
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture != nil {
		t.Fatalf("expected no posture basis on cold start, got %#v", posture)
	}
}

func TestRuntimeAgentBehavioralPosturePersistsAcrossRestart(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-posture",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	want := BehavioralPosture{
		AgentID:          "agent-posture",
		PostureClass:     "steady_support",
		ActionFamily:     "support",
		StatusText:       "steady and terse",
		TruthBasisIDs:    []string{"truth-1", "truth-2"},
		InterruptMode:    "cautious",
		TransitionReason: "user needs steady support",
		ModeID:           "support",
	}
	if err := svc.PutBehavioralPosture(ctx, want); err != nil {
		t.Fatalf("PutBehavioralPosture: %v", err)
	}

	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(restart): %v", err)
	}
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(restart): %v", err)
	}

	got, err := svc.GetBehavioralPosture(ctx, "agent-posture")
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if got == nil {
		t.Fatal("expected persisted posture")
	}
	if got.AgentID != want.AgentID || got.StatusText != want.StatusText || got.InterruptMode != want.InterruptMode || got.PostureClass != want.PostureClass || got.ActionFamily != want.ActionFamily || got.TransitionReason != want.TransitionReason || got.ModeID != want.ModeID {
		t.Fatalf("unexpected posture: %#v", got)
	}
	if len(got.TruthBasisIDs) != len(want.TruthBasisIDs) {
		t.Fatalf("unexpected truth basis ids: %#v", got.TruthBasisIDs)
	}
	for idx := range want.TruthBasisIDs {
		if got.TruthBasisIDs[idx] != want.TruthBasisIDs[idx] {
			t.Fatalf("unexpected truth basis ids: %#v", got.TruthBasisIDs)
		}
	}
}

func TestRuntimeAgentRecoversPreparedReviewRunAndCommitsMemory(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-review",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-review"},
		},
	}
	if _, err := memorySvc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	retainResp, err := memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "review source memory"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	sourceRecordID := retainResp.GetRecords()[0].GetMemoryId()
	outcomes := memoryservice.CanonicalReviewOutcomes{
		Narratives: []memoryservice.NarrativeCandidate{
			{
				NarrativeID:     "nar-review",
				Topic:           "source",
				Content:         "Review source memory is still relevant.",
				SourceVersion:   "v1",
				Status:          "active",
				SourceMemoryIDs: []string{sourceRecordID},
			},
		},
		Truths: []memoryservice.TruthCandidate{
			{
				TruthID:         "truth-review",
				Dimension:       "source",
				NormalizedKey:   "review:source",
				Statement:       "Review source memory remains relevant.",
				Confidence:      0.8,
				ReviewCount:     1,
				Status:          "admitted",
				SourceMemoryIDs: []string{sourceRecordID},
			},
		},
	}
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:      "review-run-1",
		AgentID:          "agent-review",
		BankLocatorKey:   memoryservice.LocatorKey(locator),
		CheckpointBasis:  sourceRecordID,
		PreparedOutcomes: outcomes,
	}); err != nil {
		t.Fatalf("SavePreparedReviewRun: %v", err)
	}

	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(restart): %v", err)
	}
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(restart): %v", err)
	}

	var statusValue string
	if err := svc.backend.DB().QueryRow(`SELECT status FROM runtime_agent_review_run WHERE review_run_id = ?`, "review-run-1").Scan(&statusValue); err != nil {
		t.Fatalf("load review run status: %v", err)
	}
	if statusValue != "completed" {
		t.Fatalf("expected completed review run, got %q", statusValue)
	}
	truths, err := memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 1 || truths[0].TruthID != "truth-review" {
		t.Fatalf("unexpected recovered truths: %#v", truths)
	}
	narratives, err := memorySvc.ListNarrativeContext(ctx, locator, "relevant", 5)
	if err != nil {
		t.Fatalf("ListNarrativeContext: %v", err)
	}
	if len(narratives) != 1 || narratives[0].GetNarrativeId() != "nar-review" {
		t.Fatalf("unexpected recovered narratives: %#v", narratives)
	}
	followUp, err := svc.GetReviewFollowUp(ctx, locator)
	if err != nil {
		t.Fatalf("GetReviewFollowUp: %v", err)
	}
	if followUp == nil || followUp.ReviewRunID != "review-run-1" || followUp.CheckpointBasis != sourceRecordID {
		t.Fatalf("unexpected review follow-up: %#v", followUp)
	}
}

func TestRuntimeAgentRecoveryDowngradesWave4TruthBelowAdmissionFloor(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-wave4-threshold",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-wave4-threshold"},
		},
	}
	if _, err := memorySvc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	retainResp, err := memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "shared project planning"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "ongoing collaboration cadence"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	sourceIDs := []string{
		retainResp.GetRecords()[0].GetMemoryId(),
		retainResp.GetRecords()[1].GetMemoryId(),
	}
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:     "review-run-wave4-threshold",
		AgentID:         "agent-wave4-threshold",
		BankLocatorKey:  memoryservice.LocatorKey(locator),
		CheckpointBasis: sourceIDs[1],
		PreparedOutcomes: memoryservice.CanonicalReviewOutcomes{
			Truths: []memoryservice.TruthCandidate{
				{
					TruthID:         "truth-wave4-threshold",
					Dimension:       "relational",
					NormalizedKey:   "relationship:cadence",
					Statement:       "The relationship cadence is becoming stable.",
					Confidence:      0.9,
					Status:          "admitted",
					SourceMemoryIDs: sourceIDs,
				},
			},
		},
	}); err != nil {
		t.Fatalf("SavePreparedReviewRun: %v", err)
	}

	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(restart): %v", err)
	}
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(restart): %v", err)
	}

	var truthStatus string
	if err := memorySvc.PersistenceBackend().DB().QueryRow(`
		SELECT status
		FROM agent_truth
		WHERE truth_id = ?
	`, "truth-wave4-threshold").Scan(&truthStatus); err != nil {
		t.Fatalf("load truth status: %v", err)
	}
	if truthStatus != "candidate" {
		t.Fatalf("expected relational truth to downgrade to candidate, got %q", truthStatus)
	}
	truths, err := memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 0 {
		t.Fatalf("expected no admitted truths after downgrade, got %#v", truths)
	}
}

func TestRuntimeAgentExecuteCanonicalReviewCommitsExecutorOutputs(t *testing.T) {
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
		Dimension:       32,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-canonical-review",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-canonical-review"},
		},
	}
	if _, err := memorySvc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	retainResp, err := memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "memory redesign review quality"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "review quality memory redesign"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "astronomy telescope note"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}

	var sawRequest *CanonicalReviewExecutorRequest
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		sawRequest = req
		return &CanonicalReviewExecutorResult{
			TokensUsed: 77,
			Outcomes: memoryservice.CanonicalReviewOutcomes{
				Narratives: []memoryservice.NarrativeCandidate{
					{
						NarrativeID:     "nar-exec-1",
						Topic:           "memory redesign",
						Content:         "The current focus remains memory redesign review quality.",
						SourceVersion:   "wave4",
						Status:          "active",
						SourceMemoryIDs: []string{req.Clusters[0].RecordIDs[0], req.Clusters[0].RecordIDs[1]},
					},
				},
				Truths: []memoryservice.TruthCandidate{
					{
						TruthID:         "truth-exec-1",
						Dimension:       "source",
						NormalizedKey:   "relationship:review-cadence",
						Statement:       "The agent and user are iterating closely on review quality.",
						Confidence:      0.9,
						Status:          "admitted",
						SourceMemoryIDs: []string{req.Clusters[0].RecordIDs[0], req.Clusters[0].RecordIDs[1], retainResp.GetRecords()[2].GetMemoryId(), req.Clusters[0].RecordIDs[0]},
					},
				},
				Relations: []memoryservice.RelationCandidate{
					{
						SourceID:     req.Clusters[0].RecordIDs[0],
						TargetID:     retainResp.GetRecords()[2].GetMemoryId(),
						RelationType: "thematic",
						Confidence:   0.9,
					},
				},
			},
		}, nil
	}))

	result, err := svc.ExecuteCanonicalReview(ctx, CanonicalReviewRequest{
		AgentID: "agent-canonical-review",
		Bank:    locator,
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("ExecuteCanonicalReview: %v", err)
	}
	if result.Skipped {
		t.Fatalf("expected review execution, got skipped result %#v", result)
	}
	if result.ClusterCount != 1 || result.LeftoverCount != 1 || result.NarrativeCount != 1 || result.TruthCount != 1 || result.TokensUsed != 77 {
		t.Fatalf("unexpected execution result: %#v", result)
	}
	if sawRequest == nil {
		t.Fatal("expected executor request to be captured")
	}
	if len(sawRequest.Clusters) != 1 || len(sawRequest.Clusters[0].RecordIDs) != 2 {
		t.Fatalf("expected one 2-record cluster, got %#v", sawRequest.Clusters)
	}
	if len(sawRequest.Leftovers) != 1 || sawRequest.Leftovers[0].GetMemoryId() != retainResp.GetRecords()[2].GetMemoryId() {
		t.Fatalf("expected astronomy record leftover, got %#v", sawRequest.Leftovers)
	}

	var reviewStatus string
	if err := svc.backend.DB().QueryRow(`SELECT status FROM runtime_agent_review_run WHERE review_run_id = ?`, result.ReviewRunID).Scan(&reviewStatus); err != nil {
		t.Fatalf("load review run status: %v", err)
	}
	if reviewStatus != "completed" {
		t.Fatalf("expected completed review run, got %q", reviewStatus)
	}
	truths, err := memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 1 || truths[0].TruthID != "truth-exec-1" || truths[0].Status != "admitted" {
		t.Fatalf("unexpected admitted truths: %#v", truths)
	}
	narratives, err := memorySvc.ListNarrativeContext(ctx, locator, "memory redesign", 5)
	if err != nil {
		t.Fatalf("ListNarrativeContext: %v", err)
	}
	if len(narratives) != 1 || narratives[0].GetNarrativeId() != "nar-exec-1" {
		t.Fatalf("unexpected narratives: %#v", narratives)
	}
	var relationCount int
	if err := memorySvc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(*)
		FROM memory_relation
		WHERE bank_locator_key = ? AND relation_type = 'thematic'
	`, memoryservice.LocatorKey(locator)).Scan(&relationCount); err != nil {
		t.Fatalf("count memory_relation: %v", err)
	}
	if relationCount != 1 {
		t.Fatalf("expected one persisted relation, got %d", relationCount)
	}
}

type canonicalReviewExecutorFunc func(context.Context, *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error)

func (fn canonicalReviewExecutorFunc) ExecuteCanonicalReview(ctx context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
	return fn(ctx, req)
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepRunsEligibleBankOncePerWindow(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-once")
	retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
		"memory redesign review quality",
		"review quality redesign memory",
	)

	executions := 0
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		executions++
		return &CanonicalReviewExecutorResult{
			TokensUsed: 5,
			Outcomes: memoryservice.CanonicalReviewOutcomes{
				Truths: []memoryservice.TruthCandidate{
					{
						TruthID:         fmt.Sprintf("truth-auto-once-%d", executions),
						Dimension:       "source",
						NormalizedKey:   fmt.Sprintf("auto:once:%d", executions),
						Statement:       "Automatic review scheduling ran.",
						Confidence:      0.9,
						ReviewCount:     1,
						Status:          "admitted",
						SourceMemoryIDs: append([]string(nil), req.Clusters[0].RecordIDs...),
					},
				},
			},
		}, nil
	}))

	sweepAt := time.Now().UTC().Add(-time.Hour)
	if err := svc.runCanonicalReviewSchedulingSweep(ctx, sweepAt); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep(first): %v", err)
	}
	if err := svc.runCanonicalReviewSchedulingSweep(ctx, sweepAt); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep(second): %v", err)
	}
	if executions != 1 {
		t.Fatalf("expected exactly one automatic review execution, got %d", executions)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 1 {
		t.Fatalf("expected one persisted review run, got %d", count)
	}
	followUp, err := svc.GetReviewFollowUp(ctx, locator)
	if err != nil {
		t.Fatalf("GetReviewFollowUp: %v", err)
	}
	if followUp == nil {
		t.Fatal("expected review follow-up after automatic review")
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepSuppressesRecentFollowUp(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-recent")
	recordIDs := retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
		"recent review source one",
		"recent review source two",
	)
	sweepAt := time.Now().UTC().Add(-time.Hour)
	persistReviewFollowUpForTest(t, svc, locator, "review-recent", recordIDs[len(recordIDs)-1], sweepAt.Add(-23*time.Hour))

	executions := 0
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		executions++
		return &CanonicalReviewExecutorResult{}, nil
	}))

	if err := svc.runCanonicalReviewSchedulingSweep(ctx, sweepAt); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
	}
	if executions != 0 {
		t.Fatalf("expected recent follow-up to suppress automatic review, got %d executions", executions)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 0 {
		t.Fatalf("expected no new review runs, got %d", count)
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepRunsExpiredFollowUp(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-expired")
	recordIDs := retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
		"expired review source one",
		"expired review source two",
	)
	sweepAt := time.Now().UTC().Add(-time.Hour)
	persistReviewFollowUpForTest(t, svc, locator, "review-expired", recordIDs[len(recordIDs)-1], sweepAt.Add(-25*time.Hour))

	executions := 0
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		executions++
		return &CanonicalReviewExecutorResult{
			Outcomes: memoryservice.CanonicalReviewOutcomes{
				Truths: []memoryservice.TruthCandidate{
					{
						TruthID:         "truth-auto-expired",
						Dimension:       "source",
						NormalizedKey:   "auto:expired",
						Statement:       "Expired follow-up permits a new automatic review.",
						Confidence:      0.9,
						ReviewCount:     1,
						Status:          "admitted",
						SourceMemoryIDs: append([]string(nil), req.Clusters[0].RecordIDs...),
					},
				},
			},
		}, nil
	}))

	if err := svc.runCanonicalReviewSchedulingSweep(ctx, sweepAt); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
	}
	if executions != 1 {
		t.Fatalf("expected expired follow-up to re-admit automatic review, got %d executions", executions)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 1 {
		t.Fatalf("expected one new review run, got %d", count)
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepDefersWithoutExecutor(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-no-exec")
	retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
		"executor missing source one",
		"executor missing source two",
	)

	if err := svc.runCanonicalReviewSchedulingSweep(ctx, time.Now().UTC().Add(-time.Hour)); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 0 {
		t.Fatalf("expected no automatic review run without executor, got %d", count)
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepSuppressesNonActiveAndNonIdle(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name   string
		mutate func(*Service) error
	}{
		{
			name: "non_active",
			mutate: func(svc *Service) error {
				entry, err := svc.agentByID("agent-review-scheduling-state")
				if err != nil {
					return err
				}
				entry.Agent.LifecycleStatus = runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED
				return svc.updateAgent(entry)
			},
		},
		{
			name: "non_idle",
			mutate: func(svc *Service) error {
				entry, err := svc.agentByID("agent-review-scheduling-state")
				if err != nil {
					return err
				}
				entry.State.ExecutionState = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE
				entry.State.UpdatedAt = timestamppb.New(time.Now().UTC())
				return svc.updateAgent(entry)
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			svc := newRuntimeAgentTestService(t)
			ctx := context.Background()
			locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-state")
			retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
				"state gate source one",
				"state gate source two",
			)
			executions := 0
			svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
				executions++
				return &CanonicalReviewExecutorResult{}, nil
			}))
			if err := tc.mutate(svc); err != nil {
				t.Fatalf("mutate agent state: %v", err)
			}
			if err := svc.runCanonicalReviewSchedulingSweep(ctx, time.Now().UTC().Add(-time.Hour)); err != nil {
				t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
			}
			if executions != 0 {
				t.Fatalf("expected automatic review suppression for %s, got %d executions", tc.name, executions)
			}
		})
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepSuppressesRecoverableRun(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-recoverable")
	recordIDs := retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
		"recoverable review source one",
		"recoverable review source two",
	)
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:     "review-run-auto-recoverable",
		AgentID:         "agent-review-scheduling-recoverable",
		BankLocatorKey:  memoryservice.LocatorKey(locator),
		CheckpointBasis: recordIDs[len(recordIDs)-1],
		PreparedOutcomes: memoryservice.CanonicalReviewOutcomes{
			Summary: "recoverable run should suppress duplicate automatic admission",
		},
	}); err != nil {
		t.Fatalf("SavePreparedReviewRun: %v", err)
	}

	executions := 0
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		executions++
		return &CanonicalReviewExecutorResult{}, nil
	}))

	if err := svc.runCanonicalReviewSchedulingSweep(ctx, time.Now().UTC().Add(-time.Hour)); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
	}
	if executions != 0 {
		t.Fatalf("expected recoverable review run to suppress automatic admission, got %d executions", executions)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 1 {
		t.Fatalf("expected only the recoverable review run to exist, got %d", count)
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepNoClustersNoOp(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-no-clusters")
	retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator, "single source cannot form a review cluster")

	executions := 0
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		executions++
		return &CanonicalReviewExecutorResult{}, nil
	}))

	if err := svc.runCanonicalReviewSchedulingSweep(ctx, time.Now().UTC().Add(-time.Hour)); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
	}
	if executions != 0 {
		t.Fatalf("expected no executor calls when no review clusters exist, got %d", executions)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 0 {
		t.Fatalf("expected no persisted review runs for no-cluster no-op, got %d", count)
	}
}

func initializeCanonicalReviewSchedulingAgent(t *testing.T, ctx context.Context, svc *Service, agentID string) *runtimev1.MemoryBankLocator {
	t.Helper()

	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{AgentId: agentID}); err != nil {
		t.Fatalf("InitializeAgent(%s): %v", agentID, err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: agentID},
		},
	}
	if _, err := svc.memorySvc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile(%s): %v", agentID, err)
	}
	return locator
}

func retainCanonicalReviewSchedulingInputs(t *testing.T, ctx context.Context, svc *Service, locator *runtimev1.MemoryBankLocator, observations ...string) []string {
	t.Helper()

	inputs := make([]*runtimev1.MemoryRecordInput, 0, len(observations))
	for _, observation := range observations {
		inputs = append(inputs, &runtimev1.MemoryRecordInput{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
			Payload: &runtimev1.MemoryRecordInput_Observational{
				Observational: &runtimev1.ObservationalMemoryRecord{Observation: observation},
			},
		})
	}
	retainResp, err := svc.memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank:    locator,
		Records: inputs,
	})
	if err != nil {
		t.Fatalf("Retain(%s): %v", memoryservice.LocatorKey(locator), err)
	}
	recordIDs := make([]string, 0, len(retainResp.GetRecords()))
	for _, record := range retainResp.GetRecords() {
		recordIDs = append(recordIDs, record.GetMemoryId())
	}
	return recordIDs
}

func persistReviewFollowUpForTest(t *testing.T, svc *Service, locator *runtimev1.MemoryBankLocator, reviewRunID string, checkpointBasis string, completedAt time.Time) {
	t.Helper()

	if _, err := svc.backend.DB().Exec(`
		INSERT OR REPLACE INTO runtime_agent_review_followup(bank_locator_key, review_run_id, checkpoint_basis, completed_at)
		VALUES (?, ?, ?, ?)
	`, memoryservice.LocatorKey(locator), reviewRunID, checkpointBasis, completedAt.UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("persist review follow-up: %v", err)
	}
}

func countReviewRunsForBank(t *testing.T, svc *Service, locator *runtimev1.MemoryBankLocator) int {
	t.Helper()

	var count int
	if err := svc.backend.DB().QueryRow(`
		SELECT COUNT(*)
		FROM runtime_agent_review_run
		WHERE bank_locator_key = ?
	`, memoryservice.LocatorKey(locator)).Scan(&count); err != nil {
		t.Fatalf("count review runs: %v", err)
	}
	return count
}

func TestAIBackedCanonicalReviewExecutorDecodesValidOutput(t *testing.T) {
	t.Parallel()

	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `{
  "summary": "review complete",
  "tokens_used": 42,
  "narratives": [
    {
      "narrative_id": "nar-ai-1",
      "topic": "review quality",
      "content": "The work remains focused on review quality.",
      "source_version": "wave4",
      "status": "active",
      "source_memory_ids": ["mem-1", "mem-2"]
    }
  ],
  "truths": [
    {
      "truth_id": "truth-ai-1",
      "dimension": "relational",
      "normalized_key": "relationship:review-quality",
      "statement": "The agent and user are collaborating on review quality.",
      "confidence": 0.91,
      "source_count": 2,
      "review_count": 1,
      "status": "admitted",
      "source_memory_ids": ["mem-1", "mem-3"]
    }
  ]
}`,
					},
				},
			},
		},
	}
	executor := NewAIBackedCanonicalReviewExecutor(fakeAI)

	result, err := executor.ExecuteCanonicalReview(context.Background(), &CanonicalReviewExecutorRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-review-ai"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "user-1"},
		Bank: &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-review-ai"},
			},
		},
		CheckpointBasis: "mem-0",
		Clusters: []memoryservice.ReviewTopicCluster{
			{RecordIDs: []string{"mem-1", "mem-2"}},
		},
		Leftovers: []*runtimev1.MemoryRecord{
			{MemoryId: "mem-3"},
		},
	})
	if err != nil {
		t.Fatalf("ExecuteCanonicalReview: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one AI request, got %d", len(fakeAI.requests))
	}
	if result.TokensUsed != 42 || result.Outcomes.Summary != "review complete" {
		t.Fatalf("unexpected canonical review result: %#v", result)
	}
	if len(result.Outcomes.Narratives) != 1 || result.Outcomes.Narratives[0].NarrativeID != "nar-ai-1" {
		t.Fatalf("unexpected narratives: %#v", result.Outcomes.Narratives)
	}
	if len(result.Outcomes.Truths) != 1 || result.Outcomes.Truths[0].TruthID != "truth-ai-1" {
		t.Fatalf("unexpected truths: %#v", result.Outcomes.Truths)
	}
}

func TestAIBackedCanonicalReviewExecutorRejectsInvalidOutput(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		output  string
		wantErr string
	}{
		{
			name:    "markdown",
			output:  "```json\n{}\n```",
			wantErr: "output invalid",
		},
		{
			name: "unknown_field",
			output: `{
  "summary": "bad",
  "narratives": [],
  "truths": [],
  "extra_field": []
}`,
			wantErr: "unknown field",
		},
		{
			name: "invalid_dimension",
			output: `{
  "summary": "bad",
  "narratives": [],
  "truths": [
    {
      "truth_id": "truth-bad-1",
      "dimension": "employment",
      "normalized_key": "bad:key",
      "statement": "bad",
      "confidence": 0.9,
      "source_memory_ids": ["mem-1"]
    }
  ]
}`,
			wantErr: "dimension must be relational, cognitive, value, or procedural",
		},
		{
			name: "invalid_relation_type",
			output: `{
  "summary": "bad",
  "narratives": [],
  "truths": [],
  "relations": [
    {
      "source_id": "mem-1",
      "target_id": "mem-2",
      "relation_type": "same_event",
      "confidence": 0.9
    }
  ]
}`,
			wantErr: "relation_type must be causal, emotional, or thematic",
		},
		{
			name: "narrative_from_leftover_only",
			output: `{
  "summary": "bad",
  "narratives": [
    {
      "narrative_id": "nar-bad-1",
      "topic": "singleton",
      "content": "bad singleton narrative",
      "source_memory_ids": ["mem-3", "mem-3"]
    }
  ],
  "truths": []
}`,
			wantErr: "must cite at least 2 distinct source_memory_ids",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			executor := NewAIBackedCanonicalReviewExecutor(&fakeLifeTurnAI{
				response: &runtimev1.ExecuteScenarioResponse{
					Output: &runtimev1.ScenarioOutput{
						Output: &runtimev1.ScenarioOutput_TextGenerate{
							TextGenerate: &runtimev1.TextGenerateOutput{Text: tt.output},
						},
					},
				},
			})
			_, err := executor.ExecuteCanonicalReview(context.Background(), &CanonicalReviewExecutorRequest{
				Agent: &runtimev1.AgentRecord{AgentId: "agent-review-ai"},
				State: &runtimev1.AgentStateProjection{ActiveUserId: "user-1"},
				Bank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-review-ai"},
					},
				},
				Clusters: []memoryservice.ReviewTopicCluster{
					{RecordIDs: []string{"mem-1", "mem-2"}},
				},
				Leftovers: []*runtimev1.MemoryRecord{
					{MemoryId: "mem-3"},
				},
			})
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestRuntimeAgentExecuteCanonicalReviewWithAIBackedExecutorAppliesWave4Normalization(t *testing.T) {
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
		Dimension:       32,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-canonical-review-ai",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-canonical-review-ai"},
		},
	}
	if _, err := memorySvc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	retainResp, err := memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "memory redesign review quality"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "review quality memory redesign"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "astronomy telescope note"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	svc.SetCanonicalReviewExecutor(NewAIBackedCanonicalReviewExecutor(&fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: fmt.Sprintf(`{
  "summary": "wave 4 review",
  "tokens_used": 64,
  "narratives": [
    {
      "narrative_id": "nar-ai-exec-1",
      "topic": "memory redesign",
      "content": "The current focus remains memory redesign review quality.",
      "source_version": "wave4",
      "status": "active",
      "source_memory_ids": ["%s", "%s"]
    }
  ],
  "truths": [
    {
      "truth_id": "truth-ai-exec-1",
      "dimension": "relational",
      "normalized_key": "relationship:review-cadence",
      "statement": "The agent and user are iterating closely on review quality.",
      "confidence": 0.9,
      "source_count": 2,
      "status": "admitted",
      "source_memory_ids": ["%s", "%s"]
    }
  ],
  "relations": [
    {
      "source_id": "%s",
      "target_id": "%s",
      "relation_type": "thematic",
      "confidence": 0.9
    }
  ]
}`, retainResp.GetRecords()[0].GetMemoryId(), retainResp.GetRecords()[1].GetMemoryId(), retainResp.GetRecords()[0].GetMemoryId(), retainResp.GetRecords()[1].GetMemoryId(), retainResp.GetRecords()[0].GetMemoryId(), retainResp.GetRecords()[2].GetMemoryId()),
					},
				},
			},
		},
	}))

	result, err := svc.ExecuteCanonicalReview(ctx, CanonicalReviewRequest{
		AgentID: "agent-canonical-review-ai",
		Bank:    locator,
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("ExecuteCanonicalReview: %v", err)
	}
	if result.Skipped {
		t.Fatalf("expected review execution, got skipped result %#v", result)
	}
	if result.NarrativeCount != 1 || result.TruthCount != 1 || result.LeftoverCount != 1 {
		t.Fatalf("unexpected execution result: %#v", result)
	}
	var reviewStatus string
	if err := svc.backend.DB().QueryRow(`SELECT status FROM runtime_agent_review_run WHERE review_run_id = ?`, result.ReviewRunID).Scan(&reviewStatus); err != nil {
		t.Fatalf("load review run status: %v", err)
	}
	if reviewStatus != "completed" {
		t.Fatalf("expected completed review run, got %q", reviewStatus)
	}
	var truthStatus string
	var sourceCount int32
	if err := memorySvc.PersistenceBackend().DB().QueryRow(`
		SELECT status, truth_json
		FROM agent_truth
		WHERE truth_id = ?
	`, "truth-ai-exec-1").Scan(&truthStatus, new(string)); err != nil {
		t.Fatalf("load truth row: %v", err)
	}
	truths, err := memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 0 {
		t.Fatalf("expected no admitted truths after Wave 4 normalization, got %#v", truths)
	}
	var truthJSON string
	if err := memorySvc.PersistenceBackend().DB().QueryRow(`SELECT truth_json FROM agent_truth WHERE truth_id = ?`, "truth-ai-exec-1").Scan(&truthJSON); err != nil {
		t.Fatalf("load truth json: %v", err)
	}
	var storedTruth memoryservice.TruthCandidate
	if err := json.Unmarshal([]byte(truthJSON), &storedTruth); err != nil {
		t.Fatalf("unmarshal stored truth: %v", err)
	}
	sourceCount = storedTruth.SourceCount
	if truthStatus != "candidate" || sourceCount != 2 {
		t.Fatalf("expected stored truth to downgrade to candidate with source_count=2, got status=%q source_count=%d truth=%#v", truthStatus, sourceCount, storedTruth)
	}
}

func TestRuntimeAgentRecoversMemoryCommittedReviewRunWithoutRecommittingMemory(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-review-committed",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-review-committed"},
		},
	}
	if _, err := memorySvc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	retainResp, err := memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "already committed source"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	sourceRecordID := retainResp.GetRecords()[0].GetMemoryId()
	outcomes := memoryservice.CanonicalReviewOutcomes{
		Truths: []memoryservice.TruthCandidate{
			{
				TruthID:         "truth-review-committed",
				Dimension:       "source",
				NormalizedKey:   "review:committed",
				Statement:       "Committed review truth.",
				Confidence:      0.9,
				ReviewCount:     1,
				Status:          "admitted",
				SourceMemoryIDs: []string{sourceRecordID},
			},
		},
	}
	if err := memorySvc.CommitCanonicalReview(ctx, "review-run-committed", locator, sourceRecordID, outcomes); err != nil {
		t.Fatalf("CommitCanonicalReview: %v", err)
	}
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:      "review-run-committed",
		AgentID:          "agent-review-committed",
		BankLocatorKey:   memoryservice.LocatorKey(locator),
		CheckpointBasis:  sourceRecordID,
		Status:           "memory_committed",
		PreparedOutcomes: outcomes,
	}); err != nil {
		t.Fatalf("SavePreparedReviewRun(memory_committed): %v", err)
	}

	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(restart): %v", err)
	}
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(restart): %v", err)
	}

	var statusValue string
	if err := svc.backend.DB().QueryRow(`SELECT status FROM runtime_agent_review_run WHERE review_run_id = ?`, "review-run-committed").Scan(&statusValue); err != nil {
		t.Fatalf("load review run status: %v", err)
	}
	if statusValue != "completed" {
		t.Fatalf("expected completed review run, got %q", statusValue)
	}
	var truthCount int
	if err := memorySvc.PersistenceBackend().DB().QueryRow(`SELECT COUNT(*) FROM agent_truth WHERE truth_id = ?`, "truth-review-committed").Scan(&truthCount); err != nil {
		t.Fatalf("count truths: %v", err)
	}
	if truthCount != 1 {
		t.Fatalf("expected one committed truth after replay, got %d", truthCount)
	}
	followUp, err := svc.GetReviewFollowUp(ctx, locator)
	if err != nil {
		t.Fatalf("GetReviewFollowUp: %v", err)
	}
	if followUp == nil || followUp.ReviewRunID != "review-run-committed" {
		t.Fatalf("unexpected review follow-up: %#v", followUp)
	}
}

func TestRuntimeAgentRecoveryFailClosesOnInvalidReviewLocatorKey(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	ctx := context.Background()
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:     "review-run-invalid-locator",
		AgentID:         "agent-invalid-locator",
		BankLocatorKey:  "broken::locator::key",
		CheckpointBasis: "mem-001",
		PreparedOutcomes: memoryservice.CanonicalReviewOutcomes{
			Summary: "should fail closed during recovery",
		},
	}); err != nil {
		t.Fatalf("SavePreparedReviewRun: %v", err)
	}

	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(restart): %v", err)
	}
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(restart): %v", err)
	}

	var statusValue string
	var failureMessage string
	if err := svc.backend.DB().QueryRow(`
		SELECT status, failure_message
		FROM runtime_agent_review_run
		WHERE review_run_id = ?
	`, "review-run-invalid-locator").Scan(&statusValue, &failureMessage); err != nil {
		t.Fatalf("load review run failure state: %v", err)
	}
	if statusValue != "failed" {
		t.Fatalf("expected failed review run, got %q", statusValue)
	}
	if !strings.Contains(failureMessage, "resolve bank locator") {
		t.Fatalf("expected locator resolution failure message, got %q", failureMessage)
	}

	var followUpCount int
	if err := svc.backend.DB().QueryRow(`
		SELECT COUNT(*)
		FROM runtime_agent_review_followup
		WHERE review_run_id = ?
	`, "review-run-invalid-locator").Scan(&followUpCount); err != nil {
		t.Fatalf("count review follow-ups: %v", err)
	}
	if followUpCount != 0 {
		t.Fatalf("expected no follow-up for failed recovery, got %d", followUpCount)
	}
}

func TestRuntimeAgentRecoveryWritesFollowUpExactlyOnceAcrossRestarts(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-followup-once",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-followup-once"},
		},
	}
	if _, err := memorySvc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	retainResp, err := memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "follow-up once source"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	sourceRecordID := retainResp.GetRecords()[0].GetMemoryId()
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:     "review-run-followup-once",
		AgentID:         "agent-followup-once",
		BankLocatorKey:  memoryservice.LocatorKey(locator),
		CheckpointBasis: sourceRecordID,
		PreparedOutcomes: memoryservice.CanonicalReviewOutcomes{
			Truths: []memoryservice.TruthCandidate{
				{
					TruthID:         "truth-followup-once",
					Dimension:       "source",
					NormalizedKey:   "followup:once",
					Statement:       "Follow-up should only be persisted once.",
					Confidence:      0.9,
					ReviewCount:     1,
					Status:          "admitted",
					SourceMemoryIDs: []string{sourceRecordID},
				},
			},
		},
	}); err != nil {
		t.Fatalf("SavePreparedReviewRun: %v", err)
	}

	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(first restart): %v", err)
	}
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(first restart): %v", err)
	}
	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(second backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(second restart): %v", err)
	}
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(third backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(second restart): %v", err)
	}

	var followUpCount int
	if err := svc.backend.DB().QueryRow(`
		SELECT COUNT(*)
		FROM runtime_agent_review_followup
		WHERE review_run_id = ?
	`, "review-run-followup-once").Scan(&followUpCount); err != nil {
		t.Fatalf("count review follow-ups: %v", err)
	}
	if followUpCount != 1 {
		t.Fatalf("expected exactly one follow-up row after repeated restarts, got %d", followUpCount)
	}
}

func TestRuntimeAgentHookLifecycleExecutionStateAndCursor(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
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

func TestRuntimeAgentWorldSharedQueryAndWriteUseActiveWorldID(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
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

func TestRuntimeAgentWorldSharedWriteFailsClosedForMissingOrMismatchedWorld(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
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

func TestRuntimeAgentExecuteDueHooksProducesTerminalOutcomes(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-exec",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 50,
			MinHookInterval:  durationpb.New(time.Nanosecond),
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-exec")

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

func TestRuntimeAgentExecuteDueHooksReschedulesBudgetExhaustedAgent(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	windowStart := timestamppb.New(time.Now().UTC().Add(-2 * time.Hour))
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-budget",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 10,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-budget")
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

func TestRuntimeAgentAdmitPendingHookFailsClosedWithoutExplicitNonTimeSchedule(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
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

func TestRuntimeAgentLifeTrackLoopRejectsDueHookWithoutExecutor(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-loop-reject",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 25,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-loop-reject")

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

	waitForRuntimeAgentCondition(t, 2*time.Second, func() bool {
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
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING {
		t.Fatalf("expected LIFE_PENDING after rejection because cadence tick is re-admitted, got %s", stateResp.GetState().GetExecutionState())
	}
}

func TestRuntimeAgentLifeTrackLoopEmitsCommittedHookMemoryAndBudgetEvents(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-loop-events",
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

	waitForRuntimeAgentCondition(t, 2*time.Second, func() bool {
		resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
			AgentId:      "agent-loop-events",
			StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED,
		})
		return err == nil && len(resp.GetHooks()) == 1
	})

	stream := newAgentEventCaptureStreamLimit(ctx, 5)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId: "agent-loop-events",
		Cursor:  encodeCursor(cursor),
	}, stream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents returned %v, want context.Canceled", err)
	}
	if len(stream.events) != 5 {
		t.Fatalf("expected 5 committed events after loop including the next cadence tick, got %d", len(stream.events))
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
	if stream.events[4].GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK ||
		stream.events[4].GetHook().GetOutcome().GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING {
		t.Fatalf("expected cadence pending hook event fifth, got %#v", stream.events[4])
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

func TestRuntimeAgentWriteLifeTurnCandidatesRejectsSameBatchSemanticContradiction(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-life-contradiction",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	entry, err := svc.agentByID("agent-life-contradiction")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}

	accepted, rejected := svc.writeLifeTurnCandidates(ctx, entry, &runtimev1.PendingHook{HookId: "hook-life-contradiction"}, []*lifeTurnMemoryCandidate{
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

func TestRuntimeAgentProjectsCommittedMemoryReplicationEvents(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
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

func TestRuntimeAgentIgnoresNonCanonicalMemoryReplicationUpdates(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
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

	waitForRuntimeAgentCondition(t, time.Second, func() bool {
		svc.mu.RLock()
		defer svc.mu.RUnlock()
		return svc.sequence == beforeSequence
	})
}

func TestRuntimeAgentProjectsBridgeDrivenMemoryReplicationEvents(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
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

	svc.memorySvc.SetReplicationBridgeAdapter(&runtimeAgentFakeBridgeAdapter{
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

	waitForRuntimeAgentCondition(t, 2*time.Second, func() bool {
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

func TestRuntimeAgentLifeTrackLoopReschedulesWithAIOutput(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-loop-reschedule",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 50,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-loop-reschedule")

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

	waitForRuntimeAgentCondition(t, 2*time.Second, func() bool {
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

func TestRuntimeAgentLifeTrackLoopPersistsBehavioralPostureFromAIOutput(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-loop-posture",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 25,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-loop-posture")

	now := time.Now().UTC()
	if err := svc.admitPendingHook("agent-loop-posture", &runtimev1.PendingHook{
		HookId: "hook-loop-posture",
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
						Text: `{"behavioral_posture":{"posture_class":"careful_support","action_family":"support","interrupt_mode":"cautious","transition_reason":"user seems discouraged","truth_basis_ids":["truth-1","truth-1","truth-2"],"status_text":"staying close and careful"},"summary":"posture updated","tokens_used":4,"canonical_memory_candidates":[],"next_hook_intent":null}`,
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

	waitForRuntimeAgentCondition(t, 2*time.Second, func() bool {
		resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
			AgentId:      "agent-loop-posture",
			StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED,
		})
		return err == nil && len(resp.GetHooks()) == 1
	})

	posture, err := svc.GetBehavioralPosture(ctx, "agent-loop-posture")
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture == nil {
		t.Fatal("expected persisted posture")
	}
	if posture.PostureClass != "careful_support" || posture.ActionFamily != "support" || posture.InterruptMode != "cautious" || posture.ModeID != "support" {
		t.Fatalf("unexpected posture values: %#v", posture)
	}
	if posture.StatusText != "staying close and careful" || posture.TransitionReason != "user seems discouraged" {
		t.Fatalf("unexpected posture text fields: %#v", posture)
	}
	if len(posture.TruthBasisIDs) != 2 || posture.TruthBasisIDs[0] != "truth-1" || posture.TruthBasisIDs[1] != "truth-2" {
		t.Fatalf("unexpected truth basis ids: %#v", posture.TruthBasisIDs)
	}
	stateResp, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{AgentId: "agent-loop-posture"})
	if err != nil {
		t.Fatalf("GetAgentState: %v", err)
	}
	if stateResp.GetState().GetStatusText() != "staying close and careful" {
		t.Fatalf("expected status_text projection update, got %#v", stateResp.GetState())
	}
}

func TestRuntimeAgentLifeTrackLoopFailsOnInvalidAIOutput(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-loop-invalid",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 25,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-loop-invalid")

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

	waitForRuntimeAgentCondition(t, 2*time.Second, func() bool {
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
	stream := newAgentEventCaptureStreamLimit(ctx, 3)
	if err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
		AgentId: "agent-loop-invalid",
		Cursor:  encodeCursor(cursor),
	}, stream); err != context.Canceled {
		t.Fatalf("SubscribeAgentEvents returned %v, want context.Canceled", err)
	}
	foundFailure := false
	for _, event := range stream.events {
		if event.GetEventType() == runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK &&
			event.GetHook().GetOutcome().GetStatus() == runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED &&
			event.GetHook().GetOutcome().GetFailed().GetReasonCode() == runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			foundFailure = true
			break
		}
	}
	if !foundFailure {
		t.Fatalf("expected AI_OUTPUT_INVALID failure event in %#v", stream.events)
	}
}

func TestRuntimeAgentLifeTrackLoopFailsOnInvalidBehavioralPostureOutput(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-loop-invalid-posture",
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
			DailyTokenBudget: 25,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-loop-invalid-posture")

	now := time.Now().UTC()
	if err := svc.admitPendingHook("agent-loop-invalid-posture", &runtimev1.PendingHook{
		HookId: "hook-loop-invalid-posture",
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
						Text: `{"behavioral_posture":{"posture_class":"bad","action_family":"freestyle","interrupt_mode":"welcome","transition_reason":"bad","status_text":"bad"},"summary":"bad","tokens_used":2,"canonical_memory_candidates":[],"next_hook_intent":null}`,
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

	waitForRuntimeAgentCondition(t, 2*time.Second, func() bool {
		resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
			AgentId:      "agent-loop-invalid-posture",
			StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED,
		})
		return err == nil && len(resp.GetHooks()) == 1
	})

	posture, err := svc.GetBehavioralPosture(ctx, "agent-loop-invalid-posture")
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture != nil {
		t.Fatalf("expected no committed posture after invalid output, got %#v", posture)
	}
}

func TestRuntimeAgentApplyChatTrackSidecarPersistsBehavioralPosture(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-chat-sidecar-posture",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	err := svc.ApplyChatTrackSidecar(ctx, "agent-chat-sidecar-posture", "chat-turn-posture", ChatTrackSidecarResult{
		PosturePatch: &BehavioralPosturePatch{
			PostureClass:     "careful_support",
			ActionFamily:     "support",
			InterruptMode:    "cautious",
			TransitionReason: "chat sidecar alignment",
			TruthBasisIDs:    []string{"truth-1", "truth-1", "truth-2"},
			StatusText:       "staying close and careful",
		},
	})
	if err != nil {
		t.Fatalf("ApplyChatTrackSidecar: %v", err)
	}

	posture, err := svc.GetBehavioralPosture(ctx, "agent-chat-sidecar-posture")
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture == nil {
		t.Fatal("expected persisted posture")
	}
	if posture.PostureClass != "careful_support" || posture.ActionFamily != "support" || posture.InterruptMode != "cautious" || posture.ModeID != "support" {
		t.Fatalf("unexpected posture values: %#v", posture)
	}
	if len(posture.TruthBasisIDs) != 2 || posture.TruthBasisIDs[0] != "truth-1" || posture.TruthBasisIDs[1] != "truth-2" {
		t.Fatalf("unexpected truth basis ids: %#v", posture.TruthBasisIDs)
	}
	stateResp, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{AgentId: "agent-chat-sidecar-posture"})
	if err != nil {
		t.Fatalf("GetAgentState: %v", err)
	}
	if stateResp.GetState().GetStatusText() != "staying close and careful" {
		t.Fatalf("expected status_text projection update, got %#v", stateResp.GetState())
	}
}

func TestRuntimeAgentApplyChatTrackSidecarRejectsInvalidBehavioralPosture(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-chat-sidecar-invalid",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	err := svc.ApplyChatTrackSidecar(ctx, "agent-chat-sidecar-invalid", "chat-turn-invalid", ChatTrackSidecarResult{
		PosturePatch: &BehavioralPosturePatch{
			PostureClass:  "bad",
			ActionFamily:  "freestyle",
			InterruptMode: "welcome",
			StatusText:    "bad",
		},
	})
	if err == nil {
		t.Fatal("expected invalid posture patch to fail")
	}

	posture, err := svc.GetBehavioralPosture(ctx, "agent-chat-sidecar-invalid")
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture != nil {
		t.Fatalf("expected no committed posture after invalid sidecar, got %#v", posture)
	}
}

func TestRuntimeAgentApplyChatTrackSidecarCancelsHooksAddsFollowUpAndWritesMemory(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-chat-sidecar-combined",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	scheduledFor := time.Now().Add(10 * time.Minute)
	if err := svc.admitPendingHook("agent-chat-sidecar-combined", &runtimev1.PendingHook{
		HookId: "hook-chat-sidecar-old",
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

	err := svc.ApplyChatTrackSidecar(ctx, "agent-chat-sidecar-combined", "chat-turn-combined", ChatTrackSidecarResult{
		CancelPendingHookIDs: []string{"hook-chat-sidecar-old"},
		NextHookIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{ScheduledFor: timestamppb.New(scheduledFor.Add(15 * time.Minute))},
			},
		},
		CanonicalMemoryCandidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-chat-sidecar-combined"},
					},
				},
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{Observation: "chat sidecar memory note"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("ApplyChatTrackSidecar: %v", err)
	}

	canceledResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		AgentId:      "agent-chat-sidecar-combined",
		StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(canceled): %v", err)
	}
	if len(canceledResp.GetHooks()) != 1 || canceledResp.GetHooks()[0].GetHookId() != "hook-chat-sidecar-old" {
		t.Fatalf("expected original hook canceled, got %#v", canceledResp.GetHooks())
	}
	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		AgentId:      "agent-chat-sidecar-combined",
		StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(pending): %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 {
		t.Fatalf("expected one follow-up pending hook, got %#v", pendingResp.GetHooks())
	}
	if pendingResp.GetHooks()[0].GetHookId() == "hook-chat-sidecar-old" {
		t.Fatal("expected follow-up hook to have a distinct id")
	}

	queryResp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		AgentId: "agent-chat-sidecar-combined",
		Query:   "chat sidecar memory",
		Limit:   5,
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory: %v", err)
	}
	if len(queryResp.GetMemories()) == 0 {
		t.Fatalf("expected sidecar memory write, got %#v", queryResp.GetMemories())
	}
}

func TestRuntimeAgentExecuteChatTrackSidecarWithAIBackedExecutorAppliesOutputs(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-chat-exec",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	scheduledFor := time.Now().Add(5 * time.Minute)
	if err := svc.admitPendingHook("agent-chat-exec", &runtimev1.PendingHook{
		HookId: "hook-chat-exec-old",
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

	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: fmt.Sprintf(`{"behavioral_posture":{"posture_class":"focused_support","action_family":"support","interrupt_mode":"focused","transition_reason":"chat sidecar","truth_basis_ids":["truth-a","truth-a","truth-b"],"status_text":"focused and present"},"cancel_pending_hook_ids":["hook-chat-exec-old"],"next_hook_intent":{"triggerKind":"HOOK_TRIGGER_KIND_SCHEDULED_TIME","reason":"follow up later","scheduledTime":{"scheduledFor":"%s"}},"canonical_memory_candidates":[{"canonical_class":"PUBLIC_SHARED","policy_reason":"chat_summary","record":{"kind":"MEMORY_RECORD_KIND_OBSERVATIONAL","observational":{"observation":"user asked about wave 6 chat posture patch"}}}]}`, scheduledFor.Add(10*time.Minute).Format(time.RFC3339)),
					},
				},
			},
		},
	}
	svc.SetChatTrackSidecarExecutor(NewAIBackedChatTrackSidecarExecutor(fakeAI))

	err := svc.ExecuteChatTrackSidecar(ctx, ChatTrackSidecarExecutionRequest{
		AgentID:       "agent-chat-exec",
		SourceEventID: "chat-turn-1",
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "please keep the agent focused and remember this request"},
		},
	})
	if err != nil {
		t.Fatalf("ExecuteChatTrackSidecar: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one AI request, got %d", len(fakeAI.requests))
	}

	posture, err := svc.GetBehavioralPosture(ctx, "agent-chat-exec")
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture == nil || posture.ModeID != "support" || posture.StatusText != "focused and present" {
		t.Fatalf("unexpected posture after chat sidecar execution: %#v", posture)
	}

	canceledResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		AgentId:      "agent-chat-exec",
		StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(canceled): %v", err)
	}
	if len(canceledResp.GetHooks()) != 1 || canceledResp.GetHooks()[0].GetHookId() != "hook-chat-exec-old" {
		t.Fatalf("expected canceled original hook, got %#v", canceledResp.GetHooks())
	}
	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		AgentId:      "agent-chat-exec",
		StatusFilter: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(pending): %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 {
		t.Fatalf("expected one follow-up hook, got %#v", pendingResp.GetHooks())
	}

	queryResp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		AgentId: "agent-chat-exec",
		Query:   "wave 6 posture patch",
		Limit:   5,
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory: %v", err)
	}
	if len(queryResp.GetMemories()) == 0 {
		t.Fatalf("expected chat sidecar memory write, got %#v", queryResp.GetMemories())
	}
}

func TestRuntimeAgentExecuteChatTrackSidecarWithAIBackedExecutorFailsClosedOnInvalidOutput(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-chat-exec-invalid",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	svc.SetChatTrackSidecarExecutor(NewAIBackedChatTrackSidecarExecutor(&fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `{"behavioral_posture":{"posture_class":"bad","action_family":"freestyle","interrupt_mode":"welcome","status_text":"bad"},"initiate_chat_intent":{"message":"hi"}}`,
					},
				},
			},
		},
	}))

	err := svc.ExecuteChatTrackSidecar(ctx, ChatTrackSidecarExecutionRequest{
		AgentID:       "agent-chat-exec-invalid",
		SourceEventID: "chat-turn-invalid",
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	})
	if err == nil {
		t.Fatal("expected invalid AI-backed chat sidecar output to fail")
	}

	posture, getErr := svc.GetBehavioralPosture(ctx, "agent-chat-exec-invalid")
	if getErr != nil {
		t.Fatalf("GetBehavioralPosture: %v", getErr)
	}
	if posture != nil {
		t.Fatalf("expected no committed posture after invalid AI output, got %#v", posture)
	}
}

func TestChatTrackSidecarPromptsFrameTranscriptAsEvidence(t *testing.T) {
	t.Parallel()

	systemPrompt, _, err := chatTrackSidecarPrompts(&ChatTrackSidecarExecutorRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-chat-prompt"},
		State: &runtimev1.AgentStateProjection{},
		Messages: []*runtimev1.ChatMessage{
			{Role: "user", Content: "I like cats. Actually, I like dogs."},
		},
	})
	if err != nil {
		t.Fatalf("chatTrackSidecarPrompts: %v", err)
	}
	if !strings.Contains(systemPrompt, "source evidence, not canonical memory truth by default") {
		t.Fatalf("expected prompt to frame transcript as evidence, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "absorb explicit same-window self-correction or contradiction before candidate emission") {
		t.Fatalf("expected prompt to require same-window correction absorption, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "emit [] or prefer OBSERVATIONAL over SEMANTIC") {
		t.Fatalf("expected prompt to prefer observational/no candidate when unstable, got %q", systemPrompt)
	}
}

func TestLifeTurnPromptsFrameEvidenceAsStabilizedCandidateInput(t *testing.T) {
	t.Parallel()

	systemPrompt, _, err := lifeTurnPrompts(&lifeTurnRequest{
		Agent:    &runtimev1.AgentRecord{AgentId: "agent-life-prompt"},
		State:    &runtimev1.AgentStateProjection{},
		Hook:     &runtimev1.PendingHook{HookId: "hook-life-prompt"},
		Autonomy: &runtimev1.AgentAutonomyState{},
	})
	if err != nil {
		t.Fatalf("lifeTurnPrompts: %v", err)
	}
	if !strings.Contains(systemPrompt, "source evidence, not canonical memory truth by default") {
		t.Fatalf("expected prompt to frame life-turn evidence as evidence, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "absorb explicit same-window self-correction or contradiction before candidate emission") {
		t.Fatalf("expected prompt to require same-window correction absorption, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "emit [] or prefer OBSERVATIONAL over SEMANTIC") {
		t.Fatalf("expected prompt to prefer observational/no candidate when unstable, got %q", systemPrompt)
	}
}

func TestChatTrackSidecarPromptsFrameCadenceInteractionAsBoundedHostOwnedHint(t *testing.T) {
	t.Parallel()

	systemPrompt, _, err := chatTrackSidecarPrompts(&ChatTrackSidecarExecutorRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-chat-cadence-prompt"},
		State: &runtimev1.AgentStateProjection{},
	})
	if err != nil {
		t.Fatalf("chatTrackSidecarPrompts: %v", err)
	}
	if !strings.Contains(systemPrompt, "runtime host still owns cadence truth") {
		t.Fatalf("expected prompt to keep cadence host-owned, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "SUPPRESS_BASE_TICK_UNTIL_EXPIRED") {
		t.Fatalf("expected prompt to admit bounded cadence interaction variants, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "always include expires_at") {
		t.Fatalf("expected prompt to require expires_at for expiry suppression, got %q", systemPrompt)
	}
}

func TestLifeTurnPromptsFrameCadenceInteractionAsBoundedHostOwnedHint(t *testing.T) {
	t.Parallel()

	systemPrompt, _, err := lifeTurnPrompts(&lifeTurnRequest{
		Agent:    &runtimev1.AgentRecord{AgentId: "agent-life-cadence-prompt"},
		State:    &runtimev1.AgentStateProjection{},
		Hook:     &runtimev1.PendingHook{HookId: "hook-life-prompt"},
		Autonomy: &runtimev1.AgentAutonomyState{},
	})
	if err != nil {
		t.Fatalf("lifeTurnPrompts: %v", err)
	}
	if !strings.Contains(systemPrompt, "runtime host still owns cadence truth") {
		t.Fatalf("expected prompt to keep cadence host-owned, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "SUPPRESS_BASE_TICK_UNTIL_FIRED") {
		t.Fatalf("expected prompt to admit bounded cadence interaction variants, got %q", systemPrompt)
	}
	if !strings.Contains(systemPrompt, "sleep, meditation, focused deep work") {
		t.Fatalf("expected prompt to scope suppression to sustained states, got %q", systemPrompt)
	}
}

func TestDecodeLifeTurnExecutorResultAcceptsCadenceInteractionIntent(t *testing.T) {
	t.Parallel()

	expiresAt := time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339)
	result, err := decodeLifeTurnExecutorResult(fmt.Sprintf(`{
		"summary":"sleeping",
		"tokens_used":1,
		"canonical_memory_candidates":[],
		"next_hook_intent":{
			"triggerKind":"HOOK_TRIGGER_KIND_SCHEDULED_TIME",
			"reason":"sleep",
			"expiresAt":"%s",
			"cadenceInteraction":"HOOK_CADENCE_INTERACTION_SUPPRESS_BASE_TICK_UNTIL_EXPIRED",
			"scheduledTime":{"scheduledFor":"%s"}
		}
	}`, expiresAt, expiresAt), 0)
	if err != nil {
		t.Fatalf("decodeLifeTurnExecutorResult: %v", err)
	}
	if result.NextHookIntent == nil || result.NextHookIntent.GetCadenceInteraction() != runtimev1.HookCadenceInteraction_HOOK_CADENCE_INTERACTION_SUPPRESS_BASE_TICK_UNTIL_EXPIRED {
		t.Fatalf("expected cadence interaction to round-trip, got %#v", result.NextHookIntent)
	}
}

func TestDecodeChatTrackSidecarExecutorResultRejectsSuppressUntilExpiredWithoutExpiresAt(t *testing.T) {
	t.Parallel()

	_, err := decodeChatTrackSidecarExecutorResult(`{
		"behavioral_posture":null,
		"cancel_pending_hook_ids":[],
		"next_hook_intent":{
			"triggerKind":"HOOK_TRIGGER_KIND_SCHEDULED_TIME",
			"reason":"sleep",
			"cadenceInteraction":"HOOK_CADENCE_INTERACTION_SUPPRESS_BASE_TICK_UNTIL_EXPIRED",
			"scheduledTime":{"scheduledFor":"2026-04-19T12:00:00Z"}
		},
		"canonical_memory_candidates":[]
	}`, &ChatTrackSidecarExecutorRequest{
		Agent:        &runtimev1.AgentRecord{AgentId: "agent-chat-cadence-decode"},
		State:        &runtimev1.AgentStateProjection{},
		PendingHooks: []*runtimev1.PendingHook{},
	})
	if err == nil || !strings.Contains(err.Error(), "next_hook_intent invalid") {
		t.Fatalf("expected bounded cadence interaction validation error, got %v", err)
	}
}

func TestRuntimeAgentConsumeChatTrackSidecarAppMessageExecutesIngressPayload(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-chat-sidecar-ingress",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `{"behavioral_posture":{"posture_class":"engaged","action_family":"engage","interrupt_mode":"welcome","transition_reason":"chat ingress","truth_basis_ids":["truth-1"],"status_text":"ready to engage"},"cancel_pending_hook_ids":[],"next_hook_intent":null,"canonical_memory_candidates":[]}`,
					},
				},
			},
		},
	}
	svc.SetChatTrackSidecarExecutor(NewAIBackedChatTrackSidecarExecutor(fakeAI))

	err := svc.ConsumeChatTrackSidecarAppMessage(ctx, &runtimev1.AppMessageEvent{
		ToAppId:     "runtime.agent.internal.chat_track_sidecar",
		MessageType: "agent.chat_track.sidecar_input.v1",
		Payload: &structpb.Struct{Fields: map[string]*structpb.Value{
			"agent_id":        structpb.NewStringValue("agent-chat-sidecar-ingress"),
			"source_event_id": structpb.NewStringValue("turn-sidecar-1"),
			"thread_id":       structpb.NewStringValue("thread-1"),
			"messages": structpb.NewListValue(&structpb.ListValue{Values: []*structpb.Value{
				structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
					"role":    structpb.NewStringValue("user"),
					"content": structpb.NewStringValue("please stay engaged"),
				}}),
				structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
					"role":    structpb.NewStringValue("assistant"),
					"content": structpb.NewStringValue("I will stay engaged."),
				}}),
			}}),
		}},
	})
	if err != nil {
		t.Fatalf("ConsumeChatTrackSidecarAppMessage: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one executor request, got %d", len(fakeAI.requests))
	}
	posture, err := svc.GetBehavioralPosture(ctx, "agent-chat-sidecar-ingress")
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture == nil || posture.ModeID != "engage" {
		t.Fatalf("expected engage posture, got %#v", posture)
	}
}

func TestRuntimeAgentApplyChatTrackSidecarRejectsSameBatchSemanticContradiction(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-chat-sidecar-contradiction",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	err := svc.ApplyChatTrackSidecar(ctx, "agent-chat-sidecar-contradiction", "chat-turn-contradiction", ChatTrackSidecarResult{
		CanonicalMemoryCandidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-chat-sidecar-contradiction"},
					},
				},
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
					Payload: &runtimev1.MemoryRecordInput_Semantic{
						Semantic: &runtimev1.SemanticMemoryRecord{
							Subject:   "user",
							Predicate: "likes",
							Object:    "cats",
						},
					},
				},
			},
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-chat-sidecar-contradiction"},
					},
				},
				Record: &runtimev1.MemoryRecordInput{
					Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
					Payload: &runtimev1.MemoryRecordInput_Semantic{
						Semantic: &runtimev1.SemanticMemoryRecord{
							Subject:   "user",
							Predicate: "likes",
							Object:    "dogs",
						},
					},
				},
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
	if !strings.Contains(err.Error(), "same-batch semantic contradiction") {
		t.Fatalf("expected contradiction rejection, got %v", err)
	}

	queryResp, queryErr := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		AgentId: "agent-chat-sidecar-contradiction",
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

func TestRuntimeAgentConsumeChatTrackSidecarAppMessageFailsClosedOnInvalidPayload(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	err := svc.ConsumeChatTrackSidecarAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:     "runtime.agent.internal.chat_track_sidecar",
		MessageType: "agent.chat_track.sidecar_input.v1",
		Payload: &structpb.Struct{Fields: map[string]*structpb.Value{
			"agent_id":           structpb.NewStringValue("agent-1"),
			"source_event_id":    structpb.NewStringValue("turn-1"),
			"thread_id":          structpb.NewStringValue("thread-1"),
			"behavioral_posture": structpb.NewStructValue(&structpb.Struct{}),
			"messages": structpb.NewListValue(&structpb.ListValue{Values: []*structpb.Value{
				structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
					"role":    structpb.NewStringValue("user"),
					"content": structpb.NewStringValue("hello"),
				}}),
			}}),
		}},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func newRuntimeAgentTestService(t *testing.T) *Service {
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
		t.Fatalf("runtimeagent.New: %v", err)
	}
	return svc
}

func mustEnableAutonomy(t *testing.T, svc *Service, ctx context.Context, agentID string) {
	t.Helper()
	resp, err := svc.EnableAutonomy(ctx, &runtimev1.EnableAutonomyRequest{
		AgentId: agentID,
	})
	if err != nil {
		t.Fatalf("EnableAutonomy(%s): %v", agentID, err)
	}
	if !resp.GetAutonomy().GetEnabled() {
		t.Fatalf("expected autonomy enabled for %s, got %#v", agentID, resp.GetAutonomy())
	}
}

func mustFindPendingCadenceHook(t *testing.T, svc *Service, ctx context.Context, agentID string) *runtimev1.PendingHook {
	t.Helper()
	resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{AgentId: agentID})
	if err != nil {
		t.Fatalf("ListPendingHooks(%s): %v", agentID, err)
	}
	for _, hook := range resp.GetHooks() {
		if hook != nil && hook.GetNextIntent() != nil && hook.GetNextIntent().GetReason() == autonomyCadenceHookReason {
			return hook
		}
	}
	t.Fatalf("expected pending cadence hook for %s, got %#v", agentID, resp.GetHooks())
	return nil
}

type runtimeAgentFakeBridgeAdapter struct {
	results map[string]*runtimev1.MemoryReplicationState
}

func (f *runtimeAgentFakeBridgeAdapter) SyncPendingMemory(_ context.Context, item *memoryservice.ReplicationBacklogItem) (*runtimev1.MemoryReplicationState, error) {
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

func waitForRuntimeAgentCondition(t *testing.T, timeout time.Duration, condition func() bool) {
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
