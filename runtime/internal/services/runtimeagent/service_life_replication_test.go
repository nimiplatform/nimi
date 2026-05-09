package runtimeagent

import (
	"context"
	"fmt"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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
				Extensions:    completePromotionEvidence(t),
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
				Extensions:    completePromotionEvidence(t),
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
				Extensions:    completePromotionEvidence(t),
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
				Extensions:    completePromotionEvidence(t),
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
				Extensions:    completePromotionEvidence(t),
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
				Extensions:    completePromotionEvidence(t),
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
	followupDelay := 10 * time.Minute
	if err := svc.admitPendingHook("agent-loop-reschedule", newTestTimePendingHook(t, "hook-loop-reschedule", "agent-loop-reschedule", now.Add(-time.Second), now.Add(-2*time.Second))); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	// The follow-up HookIntent is emitted as new HookIntent proto-JSON with
	// trigger_family = TIME, trigger_detail.time.delay = followupDelay,
	// effect = FOLLOW_UP_TURN, admission_state = PROPOSED.
	svc.SetLifeTrackExecutor(NewAIBackedLifeTrackExecutor(&fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: fmt.Sprintf(`<life-turn><summary>try again later</summary><tokens-used>2</tokens-used><canonical-memory-candidates></canonical-memory-candidates><next-hook-intent trigger-family="TIME" effect="FOLLOW_UP_TURN" reason="try again later"><time delay="%ds"/></next-hook-intent></life-turn>`, int64(followupDelay.Seconds())),
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
			AgentId:              "agent-loop-reschedule",
			AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED,
		})
		return err == nil && len(resp.GetHooks()) == 1
	})

	entry, err := svc.agentByID("agent-loop-reschedule")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	if hookAdmissionState(entry.Hooks["hook-loop-reschedule"]) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED {
		t.Fatalf("expected original hook rescheduled, got %s", hookAdmissionState(entry.Hooks["hook-loop-reschedule"]))
	}
	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		AgentId:              "agent-loop-reschedule",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
	})
	if err != nil {
		t.Fatalf("ListPendingHooks(pending): %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 {
		t.Fatalf("expected one follow-up pending hook, got %d", len(pendingResp.GetHooks()))
	}
	if pendingResp.GetHooks()[0].GetIntent().GetIntentId() == "hook-loop-reschedule" {
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
	if err := svc.admitPendingHook("agent-loop-posture", newTestTimePendingHook(t, "hook-loop-posture", "agent-loop-posture", now.Add(-time.Second), now.Add(-2*time.Second))); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	svc.SetLifeTrackExecutor(NewAIBackedLifeTrackExecutor(&fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `<life-turn><behavioral-posture><posture-class>careful_support</posture-class><action-family>support</action-family><interrupt-mode>cautious</interrupt-mode><transition-reason>user seems discouraged</transition-reason><truth-basis-id>truth-1</truth-basis-id><truth-basis-id>truth-1</truth-basis-id><truth-basis-id>truth-2</truth-basis-id><status-text>staying close and careful</status-text></behavioral-posture><summary>posture updated</summary><tokens-used>4</tokens-used><canonical-memory-candidates></canonical-memory-candidates></life-turn>`,
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
			AgentId:              "agent-loop-posture",
			AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED,
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
	if err := svc.admitPendingHook("agent-loop-invalid", newTestTimePendingHook(t, "hook-loop-invalid", "agent-loop-invalid", now.Add(-time.Second), now.Add(-2*time.Second))); err != nil {
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
						Text: `<life-turn><summary>bad</summary><initiate-chat-intent><message>hello</message></initiate-chat-intent></life-turn>`,
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
			AgentId:              "agent-loop-invalid",
			AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED,
		})
		return err == nil && len(resp.GetHooks()) == 1
	})

	failedResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		AgentId:              "agent-loop-invalid",
		AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED,
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
			event.GetHook().GetFamily() == runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED &&
			event.GetHook().GetReasonCode() == runtimev1.ReasonCode_AI_OUTPUT_INVALID {
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
	if err := svc.admitPendingHook("agent-loop-invalid-posture", newTestTimePendingHook(t, "hook-loop-invalid-posture", "agent-loop-invalid-posture", now.Add(-time.Second), now.Add(-2*time.Second))); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	svc.SetLifeTrackExecutor(NewAIBackedLifeTrackExecutor(&fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `<life-turn><behavioral-posture><posture-class>bad</posture-class><action-family>freestyle</action-family><interrupt-mode>welcome</interrupt-mode><transition-reason>bad</transition-reason><status-text>bad</status-text></behavioral-posture><summary>bad</summary><tokens-used>2</tokens-used><canonical-memory-candidates></canonical-memory-candidates></life-turn>`,
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
			AgentId:              "agent-loop-invalid-posture",
			AdmissionStateFilter: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED,
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
