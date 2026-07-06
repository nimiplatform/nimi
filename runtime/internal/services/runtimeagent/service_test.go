package runtimeagent

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/durationpb"
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

func setRuntimeAgentManagedEmbeddingProfileForTest(svc *memoryservice.Service, profile *runtimev1.MemoryEmbeddingProfile) {
	svc.SetManagedEmbeddingProfile(profile)
	svc.SetRuntimeEmbeddingVectorExecutor(func(_ context.Context, profile *runtimev1.MemoryEmbeddingProfile, raws []string) ([][]float64, error) {
		dimension := int(profile.GetDimension())
		out := make([][]float64, 0, len(raws))
		for _, raw := range raws {
			out = append(out, runtimeAgentTestEmbeddingVector(raw, dimension))
		}
		return out, nil
	})
}

func runtimeAgentTestEmbeddingVector(raw string, dimension int) []float64 {
	if dimension <= 0 {
		return nil
	}
	vector := make([]float64, dimension)
	tokens := strings.Fields(strings.ToLower(raw))
	for _, token := range tokens {
		hash := 0
		for i, r := range token {
			hash += (i + 1) * int(r)
		}
		vector[hash%dimension] += 1
	}
	if len(tokens) == 0 {
		vector[0] = 1
	}
	return vector
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
	setRuntimeAgentManagedEmbeddingProfileForTest(memorySvc, &runtimev1.MemoryEmbeddingProfile{
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
		Context:     testRuntimeAgentIdentityContext("agent-alpha"),
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
		Context: testRuntimeAgentIdentityContext("agent-alpha"),
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
		Context: testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId: "agent-alpha",
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-alpha")},
					},
				},
				SourceEventId: "evt-1",
				Extensions:    completePromotionEvidence(t, svc),
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
						AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: testRuntimeAgentLocalRef("agent-alpha"), UserId: "user-1"},
					},
				},
				SourceEventId: "evt-2",
				Extensions:    completePromotionEvidence(t, svc),
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
		Context: testRuntimeAgentIdentityContext("agent-alpha"),
		AgentId: "agent-alpha",
		Query:   "What do you know?",
		Limit:   10,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{
			runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
			runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
		},
	})
	if err != nil {
		t.Fatalf("QueryAgentMemory: %v", err)
	}
	if len(queryResp.GetMemories()) != 2 {
		t.Fatalf("expected 2 memories, got %d", len(queryResp.GetMemories()))
	}

	historyResp, err := svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context:          testRuntimeAgentIdentityContext("agent-alpha"),
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
	if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-alpha"), hook); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context: testRuntimeAgentIdentityContext("agent-alpha"), AgentId: "agent-alpha"})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 || pendingResp.GetHooks()[0].GetIntent().GetAdmissionState() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
		t.Fatalf("unexpected pending hooks response: %#v", pendingResp.GetHooks())
	}

	cancelResp, err := svc.CancelHook(ctx, &runtimev1.CancelHookRequest{
		Context:  testRuntimeAgentIdentityContext("agent-alpha"),
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
		Context:      testRuntimeAgentIdentityContext("agent-alpha"),
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

func TestRuntimeAgentSubscribeAgentEventsRejectsMissingLocalAgentIdentity(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	err := svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{}, newAgentEventCaptureStream(context.Background()))
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for missing local identity context, got %v", err)
	}
	if !strings.Contains(err.Error(), "agent request context is required") {
		t.Fatalf("expected explicit local identity context failure, got %v", err)
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
			Context:      testRuntimeAgentIdentityContext("agent-empty-stream"),
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

func TestRuntimeAgentSubscribeAgentEventsEmitsBindingRevokedWhileIdle(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	requestContext := testRuntimeAgentIdentityContext("agent-alpha")
	requestContext.AppId = "nimi.desktop"
	requestContext.ScopedBinding = &runtimev1.ScopedRuntimeBindingAttachment{
		BindingId:            "binding-idle-revoke",
		RuntimeAppId:         "nimi.desktop",
		AgentId:              requestContext.GetLocalAgentRef(),
		ConversationAnchorId: "anchor-idle-revoke",
	}
	var allowed atomic.Bool
	allowed.Store(true)
	svc.SetScopedBindingValidator(stubScopedBindingValidator{
		validate: func(bindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool) {
			if !allowed.Load() {
				return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND, false
			}
			if bindingID != "binding-idle-revoke" ||
				actual.GetRuntimeAppId() != "nimi.desktop" ||
				actual.GetAgentId() != requestContext.GetLocalAgentRef() ||
				actual.GetConversationAnchorId() != "anchor-idle-revoke" ||
				requiredScope != runtimeAgentEventReadScope {
				return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND, false
			}
			return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_UNSPECIFIED, true
		},
	})

	streamCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	stream := newAgentEventCaptureStreamLimit(streamCtx, 1)
	stream.headerSent = make(chan struct{}, 1)
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAgentEvents(&runtimev1.SubscribeAgentEventsRequest{
			Context:      requestContext,
			AgentId:      requestContext.GetLocalAgentRef(),
			EventFilters: []runtimev1.AgentEventType{runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY},
		}, stream)
	}()

	select {
	case <-stream.headerSent:
	case err := <-done:
		t.Fatalf("SubscribeAgentEvents returned before initial binding admission: %v", err)
	case <-time.After(time.Second):
		t.Fatal("expected subscribe agent events to admit the initial binding")
	}
	allowed.Store(false)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("SubscribeAgentEvents returned unexpected error after binding revocation event: %v", err)
		}
	case <-time.After(2500 * time.Millisecond):
		t.Fatal("SubscribeAgentEvents did not close after idle binding revocation")
	}
	if len(stream.events) != 1 {
		t.Fatalf("expected one binding.revoked event, got=%d", len(stream.events))
	}
	event := stream.events[0]
	if event.GetEventType() != runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE {
		t.Fatalf("binding revocation must be a state event, got=%s", event.GetEventType())
	}
	if got := event.GetState().GetCurrentStatusText(); got != "binding.revoked" {
		t.Fatalf("expected binding.revoked status, got=%q event=%+v", got, event)
	}
}

func TestRuntimeAgentAutonomyDefaultsOffWithoutImplicitEnable(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	initResp, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-default-off"),
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
		Context: testRuntimeAgentIdentityContext("agent-autonomy-config"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	resp, err := svc.SetAutonomyConfig(ctx, &runtimev1.SetAutonomyConfigRequest{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-config"),
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
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	resp, err := svc.SetAgentPresentationProfile(ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile"),
		AgentId: "agent-presentation-profile",
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_LIVE2D,
				AvatarAssetRef:        "  avatar://airi/live2d/main  ",
				ExpressionProfileRef:  " expressions://airi/default ",
				IdlePreset:            " idle.soft ",
				InteractionPolicyRef:  " interaction://airi/v1 ",
				DefaultVoiceReference: " preset_voice_id:airi-default ",
				AvatarAutoplay:        true,
				SpeechModelId:         " speech/qwen3-tts-realtime ",
				SpeechRoutePolicy:     runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			},
		},
	})
	if err != nil {
		t.Fatalf("SetAgentPresentationProfile(set): %v", err)
	}
	if got := resp.GetProfile().GetAvatarAssetRef(); got != "avatar://airi/live2d/main" {
		t.Fatalf("unexpected normalized avatar_asset_ref: %q", got)
	}
	if got := resp.GetProfile().GetSpeechModelId(); got != "speech/qwen3-tts-realtime" {
		t.Fatalf("unexpected normalized speech_model_id: %q", got)
	}
	if got := resp.GetProfile().GetSpeechRoutePolicy(); got != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		t.Fatalf("unexpected speech_route_policy: %s", got.String())
	}

	agentResp, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile"), AgentId: "agent-presentation-profile"})
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
	if got := presentation["defaultVoiceReference"].GetStringValue(); got != "preset_voice_id:airi-default" {
		t.Fatalf("unexpected defaultVoiceReference metadata: %q", got)
	}
	if got := presentation["avatarAutoplay"].GetBoolValue(); !got {
		t.Fatalf("unexpected avatarAutoplay metadata: %v", got)
	}
	if got := presentation["speechModelId"].GetStringValue(); got != "speech/qwen3-tts-realtime" {
		t.Fatalf("unexpected speechModelId metadata: %q", got)
	}
	if got := presentation["speechRoutePolicy"].GetStringValue(); got != "cloud" {
		t.Fatalf("unexpected speechRoutePolicy metadata: %q", got)
	}

	clearResp, err := svc.SetAgentPresentationProfile(ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile"),
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

	clearedAgentResp, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile"), AgentId: "agent-presentation-profile"})
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
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	_, err := svc.SetAgentPresentationProfile(ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
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
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
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

	_, err = svc.SetAgentPresentationProfile(ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
		AgentId: "agent-presentation-profile-invalid",
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
				AvatarAssetRef:        "avatar://valid",
				DefaultVoiceReference: "voice://airi/default",
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected non-VoiceReference default voice to fail with InvalidArgument, got %v", err)
	}

	_, err = svc.SetAgentPresentationProfile(ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
		AgentId: "agent-presentation-profile-invalid",
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
				AvatarAssetRef:        "avatar://valid",
				DefaultVoiceReference: "voice_asset_id:   ",
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected empty VoiceReference id to fail with InvalidArgument, got %v", err)
	}

	_, err = svc.SetAgentPresentationProfile(ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
		AgentId: "agent-presentation-profile-invalid",
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
				AvatarAssetRef:        "avatar://valid",
				DefaultVoiceReference: "provider_voice_ref:dashscope/raw-voice-handle",
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected provider voice reference profile binding to fail with InvalidArgument, got %v", err)
	}
}

func TestRuntimeAgentEnableAutonomyNoopWhenModeOff(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-noop"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}

	resp, err := svc.EnableAutonomy(ctx, &runtimev1.EnableAutonomyRequest{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-noop"),
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
		Context: testRuntimeAgentIdentityContext("agent-autonomy-enable"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	if _, err := svc.SetAutonomyConfig(ctx, &runtimev1.SetAutonomyConfigRequest{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-enable"),
		AgentId: "agent-autonomy-enable",
		Config: &runtimev1.AgentAutonomyConfig{
			Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM,
			DailyTokenBudget: 20,
		},
	}); err != nil {
		t.Fatalf("SetAutonomyConfig: %v", err)
	}

	resp, err := svc.EnableAutonomy(ctx, &runtimev1.EnableAutonomyRequest{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-enable"),
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
				Context: testRuntimeAgentIdentityContext(agentID),
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
		Context: testRuntimeAgentIdentityContext("agent-earlier-callback"),
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-earlier-callback")

	now := time.Now().UTC()
	callbackAt := now.Add(30 * time.Minute)
	if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-earlier-callback"), newTestTimePendingHookWithReason(t, "hook-earlier-callback", "agent-earlier-callback", "callback first", callbackAt, now)); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	if err := svc.runLifeTrackSweep(ctx, now); err != nil {
		t.Fatalf("runLifeTrackSweep: %v", err)
	}

	pendingResp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context: testRuntimeAgentIdentityContext("agent-earlier-callback"), AgentId: "agent-earlier-callback"})
	if err != nil {
		t.Fatalf("ListPendingHooks: %v", err)
	}
	if len(pendingResp.GetHooks()) != 1 || pendingResp.GetHooks()[0].GetIntent().GetIntentId() != "hook-earlier-callback" {
		t.Fatalf("expected only earlier callback hook to remain pending, got %#v", pendingResp.GetHooks())
	}
}

func TestRuntimeAgentExecuteDueHooksRespectsMinSpacingForEarlyCallback(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-min-spacing"),
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
		},
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	mustEnableAutonomy(t, svc, ctx, "agent-min-spacing")

	admitBase := time.Now().UTC()
	entry, err := svc.agentByID(testRuntimeAgentLocalRef("agent-min-spacing"))
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	entry.Hooks["hook-last-turn"] = newTestTimePendingHookWithStatus(t, "hook-last-turn", "agent-min-spacing", runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED, admitBase, admitBase)
	if err := svc.updateAgent(entry); err != nil {
		t.Fatalf("updateAgent: %v", err)
	}

	// Admit a hook with 10min delay; min-spacing policy requires 60min from
	// the most recent completed hook. Execute at admitBase+30min: the hook
	// is due (>=10min) but below the 60min min-spacing floor, so runtime
	// reschedules to admitBase+60min.
	tooEarly := admitBase.Add(10 * time.Minute)
	if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-min-spacing"), newTestTimePendingHookWithReason(t, "hook-too-early", "agent-min-spacing", "early callback", tooEarly, admitBase)); err != nil {
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
	pendingAfter, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{
		Context: testRuntimeAgentIdentityContext("agent-min-spacing"), AgentId: "agent-min-spacing"})
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
		Context: testRuntimeAgentIdentityContext("agent-off-mode-gate"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	entry, err := svc.agentByID(testRuntimeAgentLocalRef("agent-off-mode-gate"))
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	entry.Agent.Autonomy.Enabled = true
	if err := svc.updateAgent(entry); err != nil {
		t.Fatalf("updateAgent: %v", err)
	}

	admitBase := time.Now().UTC().Add(-time.Minute)
	dueAt := admitBase.Add(-time.Second)
	if err := svc.admitPendingHook(testRuntimeAgentLocalRef("agent-off-mode-gate"), newTestTimePendingHook(t, "hook-off-mode", "agent-off-mode-gate", dueAt, admitBase)); err != nil {
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
