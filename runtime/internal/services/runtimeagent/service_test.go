package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
)

func authenticatedRuntimeAgentTestContext(parent context.Context, subjectUserID string) context.Context {
	return authn.WithIdentity(parent, &authn.Identity{SubjectUserID: subjectUserID})
}

func closeRuntimeAgentServiceForTest(t *testing.T, svc *Service) {
	t.Helper()
	t.Cleanup(func() {
		if svc != nil {
			svc.Close()
		}
	})
}

func TestRuntimeAgentEventBroadcastSkipsClosedSubscriber(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, closeFn := openRuntimeAgentTestComposition(t, localStatePath)
	t.Cleanup(closeFn)

	sub := &subscriber{
		id:      1,
		agentID: "agent-closed",
		ch:      make(chan *runtimev1.AgentEvent, 1),
	}
	svc.mu.Lock()
	svc.subscribers[sub.id] = sub
	svc.mu.Unlock()
	svc.eventStreamRuntime().removeSubscriber(sub.id)

	event := svc.presentationActivityRequestedEvent(
		"agent-closed",
		"anchor-1",
		"turn-1",
		"stream-1",
		"wave",
		"interaction",
		"moderate",
		"test",
		time.Now().UTC(),
	)
	svc.eventStreamRuntime().broadcast([]*runtimev1.AgentEvent{event}, [][]*subscriber{{sub}})
}

func TestRuntimeAgentInitializeStateAndHooks(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, closeFn := openRuntimeAgentTestComposition(t, localStatePath)
	t.Cleanup(closeFn)

	ctx := authenticatedRuntimeAgentTestContext(context.Background(), "user-1")
	initResp, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-alpha"),
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget:          100,
			MaxBackgroundOutputTokens: 20,
		},
	})
	if err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
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

	entry, err := svc.agentByID(testRuntimeAgentLocalRef("agent-alpha"))
	if err != nil || entry.Life == nil || entry.Life.Revision != 1 || entry.Life.Current != nil {
		t.Fatalf("new Agent life: %+v %v", entry, err)
	}

}

func TestRuntimeAgentAutonomyDefaultsOffWithoutImplicitEnable(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	initResp, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-default-off"),
		AutonomyConfig: &runtimev1.AgentAutonomyConfig{
			DailyTokenBudget: 20,
		},
	})
	if err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	if initResp.GetAgent().GetAutonomy().GetEnabled() {
		t.Fatalf("expected default-off autonomy, got %#v", initResp.GetAgent().GetAutonomy())
	}
	if initResp.GetAgent().GetAutonomy().GetConfig().GetMode() != runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		t.Fatalf("expected OFF mode normalization, got %s", initResp.GetAgent().GetAutonomy().GetConfig().GetMode())
	}
}

func TestRuntimeAgentSetAutonomyConfigRejectsOmittedCASRevision(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-cas-required"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	_, err := svc.SetAutonomyConfig(ctx, &runtimev1.SetAutonomyConfigRequest{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-cas-required"),
		AgentId: "agent-autonomy-cas-required",
		Config:  &runtimev1.AgentAutonomyConfig{Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("omitted autonomy revision code = %s, err=%v", status.Code(err), err)
	}
}

func TestRuntimeAgentSetAutonomyConfigDoesNotImplicitlyEnable(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-config"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}

	resp, err := svc.SetAutonomyConfig(ctx, &runtimev1.SetAutonomyConfigRequest{
		Context:                  testRuntimeAgentIdentityContext("agent-autonomy-config"),
		AgentId:                  "agent-autonomy-config",
		ExpectedAutonomyRevision: proto.Uint64(1),
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

func TestRuntimeAgentSetPresentationProfilePersistsAndClearsTypedFields(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}

	resp, err := setTestAgentPresentationProfile(svc, ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext("agent-presentation-profile"),
		AgentId:          "agent-presentation-profile",
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_LIVE2D,
				AvatarAssetRef:        "agent-center-avatar",
				ExpressionProfileRef:  "expression:airi/default",
				IdlePreset:            "idle.soft",
				InteractionPolicyRef:  "interaction:airi/v1",
				DefaultVoiceReference: "preset_voice_id:airi-default",
				AvatarAutoplay:        true,
				BackgroundAssetRef:    "agent-center-background",
			},
		},
	})
	if err != nil {
		t.Fatalf("SetAgentPresentationProfile(set): %v", err)
	}
	if got := resp.GetProfile().GetAvatarAssetRef(); got != "agent-center-avatar" {
		t.Fatalf("unexpected avatar_asset_ref: %q", got)
	}
	if resp.GetCommittedRevision() != 1 || resp.GetProfile().GetRevision() != 1 {
		t.Fatalf("unexpected committed revisions: response=%d profile=%d", resp.GetCommittedRevision(), resp.GetProfile().GetRevision())
	}

	agentResp, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile"), AgentId: "agent-presentation-profile"})
	if err != nil {
		t.Fatalf("GetAgent: %v", err)
	}
	presentation := agentResp.GetAgent().GetPresentationProfile()
	if presentation.GetBackendKind() != runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_LIVE2D {
		t.Fatalf("unexpected typed backend kind: %s", presentation.GetBackendKind())
	}
	if got := presentation.GetAvatarAssetRef(); got != "agent-center-avatar" {
		t.Fatalf("unexpected typed avatar asset ref: %q", got)
	}
	if got := presentation.GetDefaultVoiceReference(); got != "preset_voice_id:airi-default" {
		t.Fatalf("unexpected typed default voice reference: %q", got)
	}
	if got := presentation.GetBackgroundAssetRef(); got != "agent-center-background" {
		t.Fatalf("unexpected typed background asset ref: %q", got)
	}
	if !presentation.GetAvatarAutoplay() {
		t.Fatal("expected typed avatar autoplay")
	}
	if agentResp.GetAgent().GetPresentationProfileRevision() != 1 {
		t.Fatalf("unexpected typed record revision: %d", agentResp.GetAgent().GetPresentationProfileRevision())
	}

	clearResp, err := setTestAgentPresentationProfile(svc, ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext("agent-presentation-profile"),
		AgentId:          "agent-presentation-profile",
		ExpectedRevision: proto.Uint64(1),
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
	if clearResp.GetCommittedRevision() != 2 {
		t.Fatalf("clear committed revision = %d, want 2", clearResp.GetCommittedRevision())
	}

	clearedAgentResp, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile"), AgentId: "agent-presentation-profile"})
	if err != nil {
		t.Fatalf("GetAgent after clear: %v", err)
	}
	if clearedAgentResp.GetAgent().GetPresentationProfile() != nil || clearedAgentResp.GetAgent().GetPresentationProfileRevision() != 2 {
		t.Fatalf("unexpected typed clear state: %#v", clearedAgentResp.GetAgent())
	}
}

func TestRuntimeAgentPatchPresentationProfileAllowsNonAvatarFields(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile-patch"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}

	resp, err := setTestAgentPresentationProfile(svc, ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext("agent-presentation-profile-patch"),
		AgentId:          "agent-presentation-profile-patch",
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Patch{
			Patch: &runtimev1.AgentPresentationProfilePatch{
				DefaultVoiceReference: proto.String("preset_voice_id:airi-default"),
				AvatarAutoplay:        proto.Bool(true),
				BackgroundAssetRef:    proto.String("agent-center-background"),
			},
		},
	})
	if err != nil {
		t.Fatalf("SetAgentPresentationProfile(patch): %v", err)
	}
	if got := resp.GetProfile().GetAvatarAssetRef(); got != "" {
		t.Fatalf("patch without avatar must not invent avatar ref, got %q", got)
	}
	if got := resp.GetProfile().GetDefaultVoiceReference(); got != "preset_voice_id:airi-default" {
		t.Fatalf("unexpected default voice after patch: %q", got)
	}
	if got := resp.GetProfile().GetBackgroundAssetRef(); got != "agent-center-background" {
		t.Fatalf("unexpected background after patch: %q", got)
	}
	if !resp.GetProfile().GetAvatarAutoplay() {
		t.Fatal("expected avatar autoplay patch to persist true")
	}

	agentResp, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile-patch"),
		AgentId: "agent-presentation-profile-patch",
	})
	if err != nil {
		t.Fatalf("GetAgent: %v", err)
	}
	presentation := agentResp.GetAgent().GetPresentationProfile()
	if presentation.GetAvatarAssetRef() != "" {
		t.Fatalf("patch without avatar must not write typed avatar ref: %#v", presentation)
	}
	if got := presentation.GetDefaultVoiceReference(); got != "preset_voice_id:airi-default" {
		t.Fatalf("unexpected typed default voice reference: %q", got)
	}
	if got := presentation.GetBackgroundAssetRef(); got != "agent-center-background" {
		t.Fatalf("unexpected typed background asset ref: %q", got)
	}
	if !presentation.GetAvatarAutoplay() {
		t.Fatal("expected typed avatar autoplay")
	}

	clearResp, err := setTestAgentPresentationProfile(svc, ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext("agent-presentation-profile-patch"),
		AgentId:          "agent-presentation-profile-patch",
		ExpectedRevision: proto.Uint64(1),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Patch{
			Patch: &runtimev1.AgentPresentationProfilePatch{
				DefaultVoiceReference: proto.String(""),
				AvatarAutoplay:        proto.Bool(false),
				BackgroundAssetRef:    proto.String(""),
			},
		},
	})
	if err != nil {
		t.Fatalf("SetAgentPresentationProfile(clear patch): %v", err)
	}
	if clearResp.GetProfile() != nil {
		t.Fatalf("expected empty patch result to remove presentationProfile, got %#v", clearResp.GetProfile())
	}
}

func TestRuntimeAgentSetPresentationProfileRejectsInvalidProfiles(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}

	_, err := setTestAgentPresentationProfile(svc, ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
		AgentId:          "agent-presentation-profile-invalid",
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:    runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_UNSPECIFIED,
				AvatarAssetRef: "avatar-invalid",
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid backend to fail with InvalidArgument, got %v", err)
	}

	_, err = setTestAgentPresentationProfile(svc, ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
		AgentId:          "agent-presentation-profile-invalid",
		ExpectedRevision: proto.Uint64(0),
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

	_, err = setTestAgentPresentationProfile(svc, ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
		AgentId:          "agent-presentation-profile-invalid",
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
				AvatarAssetRef:        "avatar-valid",
				DefaultVoiceReference: "voice://airi/default",
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected non-VoiceReference default voice to fail with InvalidArgument, got %v", err)
	}

	_, err = setTestAgentPresentationProfile(svc, ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
		AgentId:          "agent-presentation-profile-invalid",
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
				AvatarAssetRef:        "avatar-valid",
				DefaultVoiceReference: "voice_asset_id:   ",
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected empty VoiceReference id to fail with InvalidArgument, got %v", err)
	}

	_, err = setTestAgentPresentationProfile(svc, ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext("agent-presentation-profile-invalid"),
		AgentId:          "agent-presentation-profile-invalid",
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
				AvatarAssetRef:        "avatar-valid",
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
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-noop"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
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
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-autonomy-enable"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	if _, err := svc.SetAutonomyConfig(ctx, &runtimev1.SetAutonomyConfigRequest{
		Context:                  testRuntimeAgentIdentityContext("agent-autonomy-enable"),
		AgentId:                  "agent-autonomy-enable",
		ExpectedAutonomyRevision: proto.Uint64(1),
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
