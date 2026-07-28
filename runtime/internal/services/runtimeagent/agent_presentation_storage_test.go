package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestAgentPresentationProfileRevisionIsMonotonicAcrossSetPatchAndClear(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	agentID := "presentation-monotonic"
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext(agentID),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}

	setResp, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext(agentID),
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{Profile: &runtimev1.AgentPresentationProfile{
			BackendKind:    runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
			AvatarAssetRef: "avatar-one",
		}},
	})
	if err != nil {
		t.Fatalf("set: %v", err)
	}
	if setResp.GetCommittedRevision() != 1 || setResp.GetProfile().GetRevision() != 1 {
		t.Fatalf("set revisions = response:%d profile:%d, want 1/1", setResp.GetCommittedRevision(), setResp.GetProfile().GetRevision())
	}

	_, staleErr := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext(agentID),
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Patch{Patch: &runtimev1.AgentPresentationProfilePatch{
			BackgroundAssetRef: proto.String("stale-background"),
		}},
	})
	if status.Code(staleErr) != codes.Aborted {
		t.Fatalf("stale mutation code = %s, want Aborted", status.Code(staleErr))
	}
	if reason, ok := grpcerr.ExtractReasonCode(staleErr); !ok || reason != runtimev1.ReasonCode_AGENT_PRESENTATION_REVISION_CONFLICT {
		t.Fatalf("stale mutation reason = %s, %v; want AGENT_PRESENTATION_REVISION_CONFLICT", reason, ok)
	}

	patchResp, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext(agentID),
		ExpectedRevision: proto.Uint64(1),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Patch{Patch: &runtimev1.AgentPresentationProfilePatch{
			BackgroundAssetRef: proto.String("background-one"),
		}},
	})
	if err != nil {
		t.Fatalf("patch: %v", err)
	}
	if patchResp.GetCommittedRevision() != 2 || patchResp.GetProfile().GetRevision() != 2 {
		t.Fatalf("patch revisions = response:%d profile:%d, want 2/2", patchResp.GetCommittedRevision(), patchResp.GetProfile().GetRevision())
	}
	if got := patchResp.GetProfile().GetAvatarAssetRef(); got != "avatar-one" {
		t.Fatalf("patch lost committed avatar ref: %q", got)
	}

	clearResp, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext(agentID),
		ExpectedRevision: proto.Uint64(2),
		Mutation:         &runtimev1.SetAgentPresentationProfileRequest_Clear{Clear: &runtimev1.ClearAgentPresentationProfile{}},
	})
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if clearResp.GetProfile() != nil || clearResp.GetCommittedRevision() != 3 {
		t.Fatalf("clear response = profile:%v revision:%d, want nil/3", clearResp.GetProfile(), clearResp.GetCommittedRevision())
	}

	agentResp, err := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{
		Context: testRuntimeAgentIdentityContext(agentID),
	})
	if err != nil {
		t.Fatalf("GetAgent after clear: %v", err)
	}
	if agentResp.GetAgent().GetPresentationProfile() != nil || agentResp.GetAgent().GetPresentationProfileRevision() != 3 {
		t.Fatalf("typed record after clear = profile:%v revision:%d, want nil/3", agentResp.GetAgent().GetPresentationProfile(), agentResp.GetAgent().GetPresentationProfileRevision())
	}
	for _, key := range []string{"presentationProfile", "presentationProfileRevision"} {
		if _, exists := agentResp.GetAgent().GetMetadata().GetFields()[key]; exists {
			t.Fatalf("generic metadata retained reserved key %q", key)
		}
	}
}

func TestAgentPresentationProfileConcurrentPatchesUseSingleCASBoundary(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	agentID := "presentation-concurrent-cas"
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext(agentID),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	if _, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext(agentID),
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{Profile: &runtimev1.AgentPresentationProfile{
			BackendKind:    runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
			AvatarAssetRef: "avatar-committed",
		}},
	}); err != nil {
		t.Fatalf("initial set: %v", err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	patches := []*runtimev1.AgentPresentationProfilePatch{
		{ExpressionProfileRef: proto.String("expression-one")},
		{IdlePreset: proto.String("idle-one")},
	}
	for _, patch := range patches {
		patch := patch
		go func() {
			<-start
			_, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
				Context:          testRuntimeAgentIdentityContext(agentID),
				ExpectedRevision: proto.Uint64(1),
				Mutation:         &runtimev1.SetAgentPresentationProfileRequest_Patch{Patch: patch},
			})
			results <- err
		}()
	}
	close(start)

	successes := 0
	conflicts := 0
	for range 2 {
		err := <-results
		switch status.Code(err) {
		case codes.OK:
			successes++
		case codes.Aborted:
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_PRESENTATION_REVISION_CONFLICT {
				t.Fatalf("conflict reason = %s, %v", reason, ok)
			}
			conflicts++
		default:
			t.Fatalf("concurrent patch returned %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent results = %d success, %d conflict; want 1/1", successes, conflicts)
	}

	agentResp, err := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(agentID)})
	if err != nil {
		t.Fatalf("GetAgent: %v", err)
	}
	profile := agentResp.GetAgent().GetPresentationProfile()
	if agentResp.GetAgent().GetPresentationProfileRevision() != 2 || profile.GetRevision() != 2 {
		t.Fatalf("committed concurrent revision = record:%d profile:%d, want 2/2", agentResp.GetAgent().GetPresentationProfileRevision(), profile.GetRevision())
	}
	if got := profile.GetAvatarAssetRef(); got != "avatar-committed" {
		t.Fatalf("concurrent patch lost committed avatar ref: %q", got)
	}
	if (profile.GetExpressionProfileRef() == "expression-one") == (profile.GetIdlePreset() == "idle-one") {
		t.Fatalf("committed profile must contain exactly one winning patch: %#v", profile)
	}
}

func TestSetAgentPresentationProfileRequiresExpectedRevision(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	agentID := "presentation-cas-required"
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext(agentID),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}

	_, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context: testRuntimeAgentIdentityContext(agentID),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:    runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
				AvatarAssetRef: "avatar-one",
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("omitted expected_revision code = %s, want InvalidArgument", status.Code(err))
	}

	resp, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          testRuntimeAgentIdentityContext(agentID),
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:    runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
				AvatarAssetRef: "avatar-one",
			},
		},
	})
	if err != nil {
		t.Fatalf("initial expected_revision=0: %v", err)
	}
	if got := resp.GetCommittedRevision(); got != 1 {
		t.Fatalf("committed_revision = %d, want 1", got)
	}
}

func TestAgentPresentationOpaqueRefGrammarRejectsInvalidRefsAtEveryRuntimeBoundary(t *testing.T) {
	invalidRefs := map[string]string{
		"posix absolute path":         "/tmp/avatar.vrm",
		"windows drive path":          `C:\avatars\avatar.vrm`,
		"windows drive relative":      `c:relative-avatar.vrm`,
		"windows UNC path":            `\\server\share\avatar.vrm`,
		"file URL":                    "file:///tmp/avatar.vrm",
		"data URL":                    "data:model/gltf-binary;base64,AAAA",
		"direct HTTP URL":             "http://cdn.example.com/avatar.vrm",
		"direct HTTPS URL":            "https://cdn.example.com/avatar.vrm",
		"whitespace":                  "asset:bad value",
		"control NUL":                 "asset:bad\x00value",
		"backslash":                   `asset:bad\value`,
		"raw parent traversal":        "asset:../avatar.vrm",
		"raw current traversal":       "asset:one/./avatar.vrm",
		"encoded traversal":           "asset:%2e%2e/avatar.vrm",
		"invalid percent short":       "asset:bad%2",
		"invalid percent non-hex":     "asset:bad%zz",
		"base64 marker":               "asset:application/octet-stream;base64,AAAA",
		"uppercase namespace":         "Avatar:managed-ref",
		"non-ASCII bare ref":          "avatar-你好",
		"oversized bare ref":          strings.Repeat("a", 257),
		"oversized qualified ref":     "asset:" + strings.Repeat("a", 2043),
		"escaped host":                "profile_media_url:https://%65xample.com/avatar.png",
		"encoded userinfo":            "profile_media_url:https://user%40example.com/avatar.png",
		"encoded host slash":          "profile_media_url:https://example.com%2fevil/avatar.png",
		"invalid port":                "profile_media_url:https://example.com:bad/avatar.png",
		"IPv6 close missing":          "profile_media_url:https://[::1/avatar.png",
		"IPv6 invalid suffix":         "profile_media_url:https://[::1]bad/avatar.png",
		"IPv6 invalid port":           "profile_media_url:https://[::1]:bad/avatar.png",
		"bracketed hostname":          "profile_media_url:https://[hello]/avatar.png",
		"IPvFuture host":              "profile_media_url:https://[v1.fe]/avatar.png",
		"IPv6 triple colon":           "profile_media_url:https://[2001:db8:::1]/avatar.png",
		"IPv6 invalid hex":            "profile_media_url:https://[2001:db8::gg]/avatar.png",
		"IPv6 too few groups":         "profile_media_url:https://[2001:db8:1]/avatar.png",
		"IPv6 embedded v4":            "profile_media_url:https://[::ffff:192.0.2.999]/avatar.png",
		"IPv6 v4 leading zero":        "profile_media_url:https://[::ffff:192.0.002.1]/avatar.png",
		"IPv6 zone escaped slash":     "profile_media_url:https://[fe80::1%25en%2F0]/avatar.png",
		"IPv6 zone escaped query":     "profile_media_url:https://[fe80::1%25en%3F0]/avatar.png",
		"IPv6 zone escaped hash":      "profile_media_url:https://[fe80::1%25en%230]/avatar.png",
		"IPv6 zone escaped at":        "profile_media_url:https://[fe80::1%25en%400]/avatar.png",
		"IPv6 zone escaped space":     "profile_media_url:https://[fe80::1%25en%200]/avatar.png",
		"IPv6 zone escaped backslash": "profile_media_url:https://[fe80::1%25en%5C0]/avatar.png",
	}
	svc := newRuntimeAgentTestService(t)

	for name, invalidRef := range invalidRefs {
		name := name
		invalidRef := invalidRef
		t.Run(name, func(t *testing.T) {
			assertInvalid := func(t *testing.T, err error, boundary string) {
				t.Helper()
				if status.Code(err) != codes.InvalidArgument {
					t.Errorf("%s accepted %q: %v", boundary, invalidRef, err)
				}
			}

			t.Run("full profile", func(t *testing.T) {
				ctx := testRuntimeAgentIdentityContext("invalid-full-" + strings.ReplaceAll(name, " ", "-"))
				if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: ctx}); err != nil {
					t.Fatalf("RealmSourceMaterialization: %v", err)
				}
				_, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
					Context:          ctx,
					ExpectedRevision: proto.Uint64(0),
					Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{Profile: &runtimev1.AgentPresentationProfile{
						BackendKind:    runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
						AvatarAssetRef: invalidRef,
					}},
				})
				assertInvalid(t, err, "full profile")
			})

			t.Run("merged patch", func(t *testing.T) {
				ctx := testRuntimeAgentIdentityContext("invalid-patch-" + strings.ReplaceAll(name, " ", "-"))
				if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: ctx}); err != nil {
					t.Fatalf("RealmSourceMaterialization: %v", err)
				}
				_, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
					Context:          ctx,
					ExpectedRevision: proto.Uint64(0),
					Mutation: &runtimev1.SetAgentPresentationProfileRequest_Patch{Patch: &runtimev1.AgentPresentationProfilePatch{
						BackgroundAssetRef: proto.String(invalidRef),
					}},
				})
				assertInvalid(t, err, "merged patch")
			})

			t.Run("typed persisted read", func(t *testing.T) {
				ctx := testRuntimeAgentIdentityContext("invalid-read-" + strings.ReplaceAll(name, " ", "-"))
				if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: ctx}); err != nil {
					t.Fatalf("RealmSourceMaterialization: %v", err)
				}
				svc.mu.Lock()
				entry := svc.agents[ctx.GetLocalAgentRef()]
				entry.Agent.PresentationProfile = &runtimev1.AgentPresentationProfile{
					BackendKind:    runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
					AvatarAssetRef: invalidRef,
					Revision:       1,
				}
				entry.Agent.PresentationProfileRevision = 1
				svc.mu.Unlock()

				_, err := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: ctx})
				assertInvalid(t, err, "typed persisted read")
				_, err = svc.ListAgents(context.Background(), &runtimev1.ListAgentsRequest{})
				assertInvalid(t, err, "typed persisted list")
			})
		})
	}
}

func TestAgentPresentationOpaqueRefGrammarAcceptsKitAndProfileMediaRefs(t *testing.T) {
	t.Parallel()

	validRefs := []string{
		"agent-center-avatar",
		"avatar.asset_v1@prod+active~1",
		"runtime-presentation-avatar:test-vrm",
		"profile_media_url:https://cdn.example.com/avatar.vrm?version=1#ready",
		"profile_media_url:https://example.com:99999/avatar.png",
		"profile_media_url:https://[2001:db8::1]/avatar.png",
		"profile_media_url:https://[::ffff:192.0.2.128]/avatar.png",
		"profile_media_url:https://[fe80::1%25en0]:443/avatar.png",
		"profile_media_url:https://[fe80::1%25en%410]/avatar.png",
		"profile_media_url:https://[fe80::1%25en%220]/avatar.png",
		"profile_media_url:https://[fe80::1%25en%250]/avatar.png",
	}
	for _, validRef := range validRefs {
		validRef := validRef
		t.Run(validRef, func(t *testing.T) {
			t.Parallel()
			svc := newRuntimeAgentTestService(t)
			ctx := testRuntimeAgentIdentityContext("valid-ref")
			if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: ctx}); err != nil {
				t.Fatalf("RealmSourceMaterialization: %v", err)
			}
			resp, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
				Context:          ctx,
				ExpectedRevision: proto.Uint64(0),
				Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{Profile: &runtimev1.AgentPresentationProfile{
					BackendKind:        runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
					AvatarAssetRef:     validRef,
					BackgroundAssetRef: "profile_media_url:https://cdn.example.com/background.webp",
				}},
			})
			if err != nil {
				t.Fatalf("SetAgentPresentationProfile(%q): %v", validRef, err)
			}
			if resp.GetProfile().GetAvatarAssetRef() != validRef {
				t.Fatalf("avatar_asset_ref = %q, want %q", resp.GetProfile().GetAvatarAssetRef(), validRef)
			}
			if _, err := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: ctx}); err != nil {
				t.Fatalf("GetAgent persisted valid ref %q: %v", validRef, err)
			}
		})
	}
}

func TestClearedAgentPresentationProfileDoesNotFallbackToAnchorMetadataPolicy(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	agentID := "presentation-no-anchor-fallback"
	ctx := testRuntimeAgentIdentityContext(agentID)
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: ctx}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, agentID, "desktop.app", "user-1", publicChatVoicePolicyMetadata(t, true))
	if _, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          ctx,
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{Profile: &runtimev1.AgentPresentationProfile{
			BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
			AvatarAssetRef:        "agent-center-avatar",
			DefaultVoiceReference: "preset_voice_id:nimi-default",
			AvatarAutoplay:        true,
		}},
	}); err != nil {
		t.Fatalf("set profile: %v", err)
	}
	if _, err := svc.SetAgentPresentationProfile(context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          ctx,
		ExpectedRevision: proto.Uint64(1),
		Mutation:         &runtimev1.SetAgentPresentationProfileRequest_Clear{Clear: &runtimev1.ClearAgentPresentationProfile{}},
	}); err != nil {
		t.Fatalf("clear profile: %v", err)
	}

	profile := svc.publicChatRuntime().agentPresentationProfileForSession(publicChatAnchorState{
		ConversationAnchorID: anchorID,
		AgentID:              ctx.GetLocalAgentRef(),
	})
	if profile != nil {
		t.Fatalf("cleared typed profile fell back to stale anchor metadata policy: %#v", profile)
	}

	svc.mu.Lock()
	entry := svc.agents[ctx.GetLocalAgentRef()]
	entry.Agent.PresentationProfile = &runtimev1.AgentPresentationProfile{
		DefaultVoiceReference: "preset_voice_id:stale",
		AvatarAutoplay:        true,
		Revision:              1,
	}
	svc.mu.Unlock()
	if profile := svc.publicChatRuntime().agentPresentationProfileForSession(publicChatAnchorState{
		ConversationAnchorID: anchorID,
		AgentID:              ctx.GetLocalAgentRef(),
	}); profile != nil {
		t.Fatalf("invalid typed profile drove policy or fell back to anchor metadata: %#v", profile)
	}
}

func TestPersistedAgentPresentationReadAndLoadRejectReservedMetadataStorage(t *testing.T) {
	t.Parallel()

	for _, key := range []string{"presentationProfile", "presentationProfileRevision"} {
		key := key
		t.Run(key, func(t *testing.T) {
			t.Parallel()

			t.Run("read", func(t *testing.T) {
				svc := newRuntimeAgentTestService(t)
				ctx := testRuntimeAgentIdentityContext("persisted-reserved-read-" + key)
				if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: ctx}); err != nil {
					t.Fatalf("RealmSourceMaterialization: %v", err)
				}
				metadata, err := structpb.NewStruct(map[string]any{key: "legacy-bypass"})
				if err != nil {
					t.Fatalf("structpb.NewStruct: %v", err)
				}
				svc.mu.Lock()
				svc.agents[ctx.GetLocalAgentRef()].Agent.Metadata = metadata
				svc.mu.Unlock()

				_, err = svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: ctx})
				if status.Code(err) != codes.InvalidArgument {
					t.Fatalf("GetAgent with persisted %s code = %s, want InvalidArgument", key, status.Code(err))
				}
				_, err = svc.ListAgents(context.Background(), &runtimev1.ListAgentsRequest{})
				if status.Code(err) != codes.InvalidArgument {
					t.Fatalf("ListAgents with persisted %s code = %s, want InvalidArgument", key, status.Code(err))
				}
			})

			t.Run("load", func(t *testing.T) {
				svc := newRuntimeAgentTestService(t)
				ctx := testRuntimeAgentIdentityContext("persisted-reserved-load-" + key)
				if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: ctx}); err != nil {
					t.Fatalf("RealmSourceMaterialization: %v", err)
				}
				metadata, err := structpb.NewStruct(map[string]any{key: "legacy-bypass"})
				if err != nil {
					t.Fatalf("structpb.NewStruct: %v", err)
				}
				svc.mu.Lock()
				svc.agents[ctx.GetLocalAgentRef()].Agent.Metadata = metadata
				err = svc.saveStateLocked()
				svc.mu.Unlock()
				if err != nil {
					t.Fatalf("save corrupt persisted fixture: %v", err)
				}
				if err := svc.loadState(); err == nil {
					t.Fatalf("loadState accepted persisted reserved metadata key %s", key)
				}
			})
		})
	}
}

func TestPersistedAgentPresentationLoadRejectsInvalidTypedRef(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	requestContext := testRuntimeAgentIdentityContext("persisted-invalid-typed-ref")
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: requestContext}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	svc.mu.Lock()
	entry := svc.agents[requestContext.GetLocalAgentRef()]
	entry.Agent.PresentationProfile = &runtimev1.AgentPresentationProfile{
		BackendKind:    runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
		AvatarAssetRef: "file:///tmp/persisted-invalid.vrm",
		Revision:       1,
	}
	entry.Agent.PresentationProfileRevision = 1
	err := svc.saveStateLocked()
	svc.mu.Unlock()
	if err != nil {
		t.Fatalf("save invalid typed fixture: %v", err)
	}
	if err := svc.loadState(); err == nil {
		t.Fatal("loadState accepted persisted invalid typed avatar ref")
	}
}
