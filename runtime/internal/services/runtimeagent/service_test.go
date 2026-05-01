package runtimeagent

import (
	"context"
	"encoding/json"
	"errors"
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
	"google.golang.org/protobuf/types/known/timestamppb"
)

func closeRuntimeAgentMemoryServiceForTest(t *testing.T, svc *memoryservice.Service) {
	t.Helper()
	t.Cleanup(func() {
		if svc == nil {
			return
		}
		if err := svc.Close(); err != nil {
			t.Fatalf("memory.Close: %v", err)
		}
	})
}

func closeRuntimeAgentServiceForTest(t *testing.T, svc *Service) {
	t.Helper()
	t.Cleanup(func() {
		if svc != nil {
			svc.Close()
		}
	})
}

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
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
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
	closeRuntimeAgentServiceForTest(t, svc)

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

	hookNow := time.Now()
	hookTime := hookNow.Add(5 * time.Minute)
	hook := newTestTimePendingHook(t, "hook-1", "agent-alpha", hookTime, hookNow)
	if err := svc.admitPendingHook("agent-alpha", hook); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{AgentId: "agent-alpha"})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 || pendingResp.GetHooks()[0].GetIntent().GetAdmissionState() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
		t.Fatalf("unexpected pending hooks response: %#v", pendingResp.GetHooks())
	}

	cancelResp, err := svc.CancelHook(ctx, &runtimev1.CancelHookRequest{
		AgentId:  "agent-alpha",
		IntentId: "hook-1",
		Reason:   "test cleanup",
	})
	if err != nil {
		t.Fatalf("CancelHook: %v", err)
	}
	if cancelResp.GetOutcome().GetIntent().GetAdmissionState() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED {
		t.Fatalf("unexpected hook outcome: %s", cancelResp.GetOutcome().GetIntent().GetAdmissionState())
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

func TestRuntimeAgentSubscribeAgentEventsRejectsMissingAgentID(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{}, newAgentEventCaptureStream(context.Background()))
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for missing agent_id, got %v", err)
	}
	if !strings.Contains(err.Error(), "agent_id is required") {
		t.Fatalf("expected explicit agent_id failure, got %v", err)
	}
}

func TestRuntimeAgentSubscribeAgentEventsSendsHeadersBeforeFirstEvent(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream := newAgentEventCaptureStreamLimit(ctx, 0)
	stream.headerSent = make(chan struct{}, 1)
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
			AgentId:      "agent-empty-stream",
			EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK},
		}, stream)
	}()

	select {
	case <-stream.headerSent:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("expected subscribe agent events to send headers before first event")
	}

	cancel()

	select {
	case err := <-done:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatalf("SubscribeAgentEvents returned unexpected error after cancel: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("SubscribeAgentEvents did not stop after context cancellation")
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

func TestRuntimeAgentSetPresentationProfilePersistsAndClearsMetadata(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-presentation-profile",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	resp, err := svc.SetAgentPresentationProfile(ctx, &runtimev1.SetAgentPresentationProfileRequest{
		AgentId: "agent-presentation-profile",
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_LIVE2D,
				AvatarAssetRef:        "  avatar://airi/live2d/main  ",
				ExpressionProfileRef:  " expressions://airi/default ",
				IdlePreset:            " idle.soft ",
				InteractionPolicyRef:  " interaction://airi/v1 ",
				DefaultVoiceReference: " voice://airi/default ",
			},
		},
	})
	if err != nil {
		t.Fatalf("SetAgentPresentationProfile(set): %v", err)
	}
	if got := resp.GetProfile().GetAvatarAssetRef(); got != "avatar://airi/live2d/main" {
		t.Fatalf("unexpected normalized avatar_asset_ref: %q", got)
	}

	agentResp, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{AgentId: "agent-presentation-profile"})
	if err != nil {
		t.Fatalf("GetAgent: %v", err)
	}
	presentation := agentResp.GetAgent().GetMetadata().GetFields()["presentationProfile"].GetStructValue().GetFields()
	if got := presentation["backendKind"].GetStringValue(); got != "live2d" {
		t.Fatalf("unexpected backendKind metadata: %q", got)
	}
	if got := presentation["avatarAssetRef"].GetStringValue(); got != "avatar://airi/live2d/main" {
		t.Fatalf("unexpected avatarAssetRef metadata: %q", got)
	}
	if got := presentation["defaultVoiceReference"].GetStringValue(); got != "voice://airi/default" {
		t.Fatalf("unexpected defaultVoiceReference metadata: %q", got)
	}

	clearResp, err := svc.SetAgentPresentationProfile(ctx, &runtimev1.SetAgentPresentationProfileRequest{
		AgentId: "agent-presentation-profile",
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Clear{
			Clear: &runtimev1.ClearAgentPresentationProfile{},
		},
	})
	if err != nil {
		t.Fatalf("SetAgentPresentationProfile(clear): %v", err)
	}
	if clearResp.GetProfile() != nil {
		t.Fatalf("expected cleared profile response, got %#v", clearResp.GetProfile())
	}

	clearedAgentResp, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{AgentId: "agent-presentation-profile"})
	if err != nil {
		t.Fatalf("GetAgent after clear: %v", err)
	}
	if metadata := clearedAgentResp.GetAgent().GetMetadata(); metadata != nil {
		if _, ok := metadata.GetFields()["presentationProfile"]; ok {
			t.Fatalf("expected presentationProfile metadata removed, got %#v", metadata)
		}
	}
}

func TestRuntimeAgentSetPresentationProfileRejectsInvalidProfiles(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		AgentId: "agent-presentation-profile-invalid",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	_, err := svc.SetAgentPresentationProfile(ctx, &runtimev1.SetAgentPresentationProfileRequest{
		AgentId: "agent-presentation-profile-invalid",
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:    runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_UNSPECIFIED,
				AvatarAssetRef: "avatar://invalid",
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid backend to fail with InvalidArgument, got %v", err)
	}

	_, err = svc.SetAgentPresentationProfile(ctx, &runtimev1.SetAgentPresentationProfileRequest{
		AgentId: "agent-presentation-profile-invalid",
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:    runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
				AvatarAssetRef: "   ",
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected empty avatar_asset_ref to fail with InvalidArgument, got %v", err)
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
	if err := svc.admitPendingHook("agent-earlier-callback", newTestTimePendingHookWithReason(t, "hook-earlier-callback", "agent-earlier-callback", "callback first", callbackAt, now)); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	if err := svc.runLifeTrackSweep(ctx, now); err != nil {
		t.Fatalf("runLifeTrackSweep: %v", err)
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{AgentId: "agent-earlier-callback"})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 || pendingResp.GetHooks()[0].GetIntent().GetIntentId() != "hook-earlier-callback" {
		t.Fatalf("expected only earlier callback hook to remain pending, got %#v", pendingResp.GetHooks())
	}
}

// TestRuntimeAgentRunLifeTrackSweepDelaysCadenceTickUntilSuppressionExpires
// previously exercised HookCadenceInteraction_SUPPRESS_BASE_TICK_UNTIL_EXPIRED.
// Per K-AGCORE-041 the admitted trigger/effect matrix does not include any
// cadence-interaction tag; runtime host owns cadence truth as a separate
// concern reconciled via `reconcileCadenceHooks`. This behaviour is therefore
// not a public surface anymore and this test is retired as part of the
// Exec Pack 2 hard cut. Internal reconciliation semantics are covered by
// the min-spacing and earlier-callback tests below.
func TestRuntimeAgentRunLifeTrackSweepDelaysCadenceTickUntilSuppressionExpires(t *testing.T) {
	t.Skip("retired: HookCadenceInteraction SUPPRESS_BASE_TICK_UNTIL_EXPIRED is not admitted in K-AGCORE-041 v1 matrix")
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

	admitBase := time.Now().UTC()
	entry, err := svc.agentByID("agent-min-spacing")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	entry.Hooks["hook-last-turn"] = newTestTimePendingHookWithStatus(t, "hook-last-turn", "agent-min-spacing", runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED, admitBase, admitBase)
	if err := svc.updateAgent(entry); err != nil {
		t.Fatalf("updateAgent: %v", err)
	}

	// Admit a hook with 10min delay; min-spacing policy requires 60min from
	// the most recent completed hook. Execute at admitBase+30min — the hook
	// is due (>=10min) but below the 60min min-spacing floor → runtime
	// reschedules to admitBase+60min.
	tooEarly := admitBase.Add(10 * time.Minute)
	if err := svc.admitPendingHook("agent-min-spacing", newTestTimePendingHookWithReason(t, "hook-too-early", "agent-min-spacing", "early callback", tooEarly, admitBase)); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	executeAt := admitBase.Add(30 * time.Minute)
	outcomes, err := svc.executeDueHooks(ctx, executeAt, func(context.Context, *lifeTurnRequest) (*lifeTurnResult, error) {
		t.Fatal("executor should not run before min spacing")
		return nil, nil
	})
	if err != nil {
		t.Fatalf("executeDueHooks: %v", err)
	}
	if len(outcomes) != 1 || outcomes[0].GetIntent().GetAdmissionState() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED {
		t.Fatalf("expected early callback to be rescheduled, got %#v", outcomes)
	}
	// The reschedule rebuilds a TIME-family follow-up hook targeting the
	// earliest instant allowed by min-spacing (anchor + 60min).
	expected := admitBase.Add(60 * time.Minute).UTC()
	pendingAfter, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{AgentId: "agent-min-spacing"})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	var followup *runtimev1.PendingHook
	for _, h := range pendingAfter.GetHooks() {
		if h.GetIntent().GetIntentId() != "hook-too-early" {
			followup = h
			break
		}
	}
	if followup == nil {
		t.Fatalf("expected min-spacing reschedule to admit fresh follow-up hook, got %#v", pendingAfter.GetHooks())
	}
	if got := followup.GetScheduledFor().AsTime().UTC(); !got.Equal(expected) {
		t.Fatalf("expected min spacing reschedule at %s, got %s", expected, got)
	}
}

// TestValidateNextHookIntentRejectsSuppressUntilExpiredWithoutExpiresAt is
// retired because NextHookIntent and HookCadenceInteraction are not admitted
// in the K-AGCORE-041 narrow-admission matrix. Replacement coverage below
// proves validateHookIntent rejects non-admitted trigger/effect combinations.
func TestValidateNextHookIntentRejectsSuppressUntilExpiredWithoutExpiresAt(t *testing.T) {
	t.Skip("retired: NextHookIntent + HookCadenceInteraction removed; see TestValidateHookIntentRejectsNonAdmittedMatrix")
}

// TestValidateHookIntentRejectsNonAdmittedMatrix proves validateHookIntent
// fails-closed for inputs outside K-AGCORE-041 (missing effect, missing
// trigger_detail branch, TIME family with both time and event details set).
func TestValidateHookIntentRejectsNonAdmittedMatrix(t *testing.T) {
	t.Parallel()

	// Missing effect.
	if err := validateHookIntent(&runtimev1.HookIntent{
		IntentId:       "h1",
		TriggerFamily:  runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME,
		TriggerDetail:  &runtimev1.HookTriggerDetail{Detail: &runtimev1.HookTriggerDetail_Time{Time: &runtimev1.HookTriggerTimeDetail{Delay: durationpb.New(time.Second)}}},
		AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
	}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for missing effect, got %v", err)
	}

	// Missing trigger_detail branch for TIME family.
	if err := validateHookIntent(&runtimev1.HookIntent{
		IntentId:       "h2",
		TriggerFamily:  runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME,
		TriggerDetail:  &runtimev1.HookTriggerDetail{},
		Effect:         runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
		AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
	}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for missing TIME detail, got %v", err)
	}

	// EVENT family with both user_idle and chat_ended (mutually exclusive).
	if err := validateHookIntent(&runtimev1.HookIntent{
		IntentId:      "h3",
		TriggerFamily: runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_EVENT,
		TriggerDetail: &runtimev1.HookTriggerDetail{
			Detail: &runtimev1.HookTriggerDetail_EventUserIdle{
				EventUserIdle: &runtimev1.HookTriggerEventUserIdleDetail{IdleFor: durationpb.New(time.Minute)},
			},
		},
		Effect:         runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
		AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
	}); err != nil {
		t.Fatalf("expected EVENT user_idle to be admitted, got %v", err)
	}
	if err := validateHookIntent(&runtimev1.HookIntent{
		IntentId:      "h4",
		TriggerFamily: runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME,
		TriggerDetail: &runtimev1.HookTriggerDetail{
			Detail: &runtimev1.HookTriggerDetail_EventUserIdle{
				EventUserIdle: &runtimev1.HookTriggerEventUserIdleDetail{IdleFor: durationpb.New(time.Minute)},
			},
		},
		Effect:         runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
		AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
	}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for TIME family with event detail, got %v", err)
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

	admitBase := time.Now().UTC().Add(-time.Minute)
	dueAt := admitBase.Add(-time.Second)
	if err := svc.admitPendingHook("agent-off-mode-gate", newTestTimePendingHook(t, "hook-off-mode", "agent-off-mode-gate", dueAt, admitBase)); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	outcomes, err := svc.executeDueHooks(ctx, time.Now().UTC().Add(time.Hour), func(context.Context, *lifeTurnRequest) (*lifeTurnResult, error) {
		t.Fatal("executor should not run when autonomy mode is off")
		return nil, nil
	})
	if err != nil {
		t.Fatalf("executeDueHooks: %v", err)
	}
	if len(outcomes) != 1 || outcomes[0].GetIntent().GetAdmissionState() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED {
		t.Fatalf("expected rejected outcome for OFF-mode agent, got %#v", outcomes)
	}
	if !strings.Contains(strings.ToLower(outcomes[0].GetMessage()), "mode is off") {
		t.Fatalf("expected OFF-mode rejection message, got %#v", outcomes[0])
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
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)

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
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)

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

// TestRuntimeAgentImportsLegacyJSONIntoSQLiteAndRename is retired as part of
// the Exec Pack 2 hard cut. The legacy-import fixture used the pre-cut
// `PendingHook{HookId, Status, Trigger, NextIntent}` shape plus
// `NextHookIntent_*` oneof sub-messages, which are no longer part of the
// Go proto surface and cannot be constructed in the new vocabulary.
// Re-introducing those Go types just to run this import path would
// preserve legacy canonical truth "just for tests", which packet doctrine
// explicitly forbids.
//
// The JSON-on-disk import path is still covered by runtime startup
// (loadState + importLegacyStateIfPresent) exercised by
// `TestRuntimeAgentStateReloadPreservesHookAdmissionAndEventSequence`
// after the hard cut, but using the new HookIntent-shaped fixture.
func TestRuntimeAgentImportsLegacyJSONIntoSQLiteAndRename(t *testing.T) {
	t.Skip("retired: pre-cut PendingHook + NextHookIntent shape is no longer part of the Go proto surface")
	_ = filepath.Join // keep filepath import reachable for later replacement test
}

func testRuntimeAgentImportsLegacyJSONIntoSQLiteAndRenameRetired(t *testing.T) {
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
	hook := newTestTimePendingHook(t, "hook-legacy", "agent-legacy", scheduledFor, now)
	event := &runtimev1.AgentEvent{
		EventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK,
		Sequence:  3,
		AgentId:   agent.GetAgentId(),
		Timestamp: timestamppb.New(now),
		Detail: &runtimev1.AgentEvent_Hook{
			Hook: &runtimev1.AgentHookEventDetail{
				Family:     runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
				Intent:     cloneHookIntent(hook.GetIntent()),
				ObservedAt: timestamppb.New(now),
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
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(import): %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)

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
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(restart): %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)
	entry, err = svc.agentByID(agent.GetAgentId())
	if err != nil {
		t.Fatalf("agentByID(restart): %v", err)
	}
	if len(entry.Hooks) != 1 {
		t.Fatalf("expected one imported hook after restart, got %#v", entry.Hooks)
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
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
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
	closeRuntimeAgentServiceForTest(t, svc)
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
		if hook != nil && hook.GetIntent() != nil && hook.GetIntent().GetReason() == autonomyCadenceHookReason {
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
	ctx        context.Context
	cancel     context.CancelFunc
	events     []*runtimev1.AgentEvent
	max        int
	headerSent chan struct{}
}

func newAgentEventCaptureStream(parent context.Context) *agentEventCaptureStream {
	return newAgentEventCaptureStreamLimit(parent, 1)
}

func newAgentEventCaptureStreamLimit(parent context.Context, max int) *agentEventCaptureStream {
	ctx, cancel := context.WithCancel(parent)
	return &agentEventCaptureStream{ctx: ctx, cancel: cancel, max: max}
}

func (s *agentEventCaptureStream) SetHeader(metadata.MD) error { return nil }
func (s *agentEventCaptureStream) SendHeader(metadata.MD) error {
	if s.headerSent != nil {
		select {
		case s.headerSent <- struct{}{}:
		default:
		}
	}
	return nil
}
func (s *agentEventCaptureStream) SetTrailer(metadata.MD)   {}
func (s *agentEventCaptureStream) Context() context.Context { return s.ctx }
func (s *agentEventCaptureStream) SendMsg(any) error        { return nil }
func (s *agentEventCaptureStream) RecvMsg(any) error        { return nil }

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
