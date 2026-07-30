package runtimeagent

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type testVoiceAssetResolver func(context.Context, string) (*runtimev1.VoiceAsset, error)

func (resolve testVoiceAssetResolver) ResolveVoiceAsset(ctx context.Context, voiceAssetID string) (*runtimev1.VoiceAsset, error) {
	return resolve(ctx, voiceAssetID)
}

type testRuntimeAIVoiceAssetService struct {
	get func(context.Context, *runtimev1.GetVoiceAssetRequest) (*runtimev1.GetVoiceAssetResponse, error)
}

func (service testRuntimeAIVoiceAssetService) GetVoiceAsset(ctx context.Context, req *runtimev1.GetVoiceAssetRequest) (*runtimev1.GetVoiceAssetResponse, error) {
	return service.get(ctx, req)
}

func durableVoiceAssetTargetRef() *runtimev1.RuntimeDurableTargetRef {
	return &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
			Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
				Version:              "v2",
				ConnectorId:          "connector-1",
				RemoteModelCatalogId: "remote-catalog-1",
				ProviderModelId:      "provider-model-1",
				Provider:             "provider-1",
			},
		},
	}
}

func bindableVoiceAsset(voiceAssetID string) *runtimev1.VoiceAsset {
	targetRef := durableVoiceAssetTargetRef()
	return &runtimev1.VoiceAsset{
		VoiceAssetId:        voiceAssetID,
		AppId:               "runtime-agent-boundary-test",
		SubjectUserId:       "user-1",
		WorkflowType:        runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_VOICE_CLONE,
		Provider:            "provider-1",
		ProviderVoiceRef:    "provider-voice-1",
		Persistence:         runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:              runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
		TargetRef:           proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
		VoiceAssetTargetRef: targetRef,
	}
}

func setVoiceAssetTargetRefs(asset *runtimev1.VoiceAsset, targetRef *runtimev1.RuntimeDurableTargetRef) {
	asset.TargetRef = proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef)
	asset.VoiceAssetTargetRef = proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef)
}

func initializePresentationVoiceTestAgent(t *testing.T, svc *Service, runtimeSourceRef string) *runtimev1.AgentRequestContext {
	t.Helper()
	requestContext := testRuntimeAgentIdentityContext(runtimeSourceRef)
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: requestContext}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	return requestContext
}

func setPresentationVoiceReference(ctx context.Context, svc *Service, requestContext *runtimev1.AgentRequestContext, expectedRevision uint64, voiceReference string) (*runtimev1.SetAgentPresentationProfileResponse, error) {
	return setTestAgentPresentationProfile(svc, ctx, &runtimev1.SetAgentPresentationProfileRequest{
		Context:          requestContext,
		ExpectedRevision: proto.Uint64(expectedRevision),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Patch{Patch: &runtimev1.AgentPresentationProfilePatch{
			DefaultVoiceReference: proto.String(voiceReference),
		}},
	})
}

func assertPresentationVoiceNotCommitted(t *testing.T, svc *Service, requestContext *runtimev1.AgentRequestContext, wantRevision uint64) {
	t.Helper()
	response, err := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: requestContext})
	if err != nil {
		t.Fatalf("GetAgent: %v", err)
	}
	if got := response.GetAgent().GetPresentationProfileRevision(); got != wantRevision {
		t.Fatalf("presentation revision = %d, want %d", got, wantRevision)
	}
}

func TestSetAgentPresentationProfileVoiceAssetFailsClosedWithoutResolver(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	requestContext := testRuntimeAgentIdentityContext("voice-asset-resolver-required")
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: requestContext}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}

	_, err := setTestAgentPresentationProfile(svc, context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          requestContext,
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Patch{Patch: &runtimev1.AgentPresentationProfilePatch{
			DefaultVoiceReference: proto.String("voice_asset_id:asset-missing-resolver"),
		}},
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("code = %s, want FailedPrecondition: %v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED {
		t.Fatalf("reason = %s, %v; want AI_VOICE_ASSET_EXPIRED", reason, ok)
	}

	agent, getErr := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: requestContext})
	if getErr != nil {
		t.Fatalf("GetAgent: %v", getErr)
	}
	if agent.GetAgent().GetPresentationProfileRevision() != 0 || agent.GetAgent().GetPresentationProfile() != nil {
		t.Fatalf("failed resolution committed profile: %#v", agent.GetAgent())
	}
}

func TestSetAgentPresentationProfilePresetVoiceSkipsAssetResolver(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	requestContext := initializePresentationVoiceTestAgent(t, svc, "preset-skips-resolver")
	resolverCalls := 0
	svc.SetVoiceAssetResolver(testVoiceAssetResolver(func(context.Context, string) (*runtimev1.VoiceAsset, error) {
		resolverCalls++
		return nil, errors.New("preset must not resolve a VoiceAsset")
	}))

	response, err := setPresentationVoiceReference(context.Background(), svc, requestContext, 0, "preset_voice_id:nimi-stable-preset")
	if err != nil {
		t.Fatalf("SetAgentPresentationProfile: %v", err)
	}
	if resolverCalls != 0 {
		t.Fatalf("resolver calls = %d, want 0", resolverCalls)
	}
	if response.GetProfile().GetDefaultVoiceReference() != "preset_voice_id:nimi-stable-preset" || response.GetCommittedRevision() != 1 {
		t.Fatalf("unexpected preset profile response: %#v", response)
	}
}

func TestSetAgentPresentationProfileValidatesResolvedVoiceAsset(t *testing.T) {
	t.Parallel()

	notFoundErr := grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND)
	scopeErr := grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	tests := []struct {
		name       string
		resolve    testVoiceAssetResolver
		wantCode   codes.Code
		wantReason runtimev1.ReasonCode
	}{
		{
			name: "missing asset",
			resolve: func(context.Context, string) (*runtimev1.VoiceAsset, error) {
				return nil, notFoundErr
			},
			wantCode:   codes.NotFound,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND,
		},
		{
			name: "resolver scope forbidden",
			resolve: func(context.Context, string) (*runtimev1.VoiceAsset, error) {
				return nil, scopeErr
			},
			wantCode:   codes.PermissionDenied,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN,
		},
		{
			name: "nil resolver result",
			resolve: func(context.Context, string) (*runtimev1.VoiceAsset, error) {
				return nil, nil
			},
			wantCode:   codes.NotFound,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND,
		},
		{
			name: "wrong voice asset id",
			resolve: func(context.Context, string) (*runtimev1.VoiceAsset, error) {
				return bindableVoiceAsset("asset-other"), nil
			},
			wantCode:   codes.FailedPrecondition,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED,
		},
		{
			name: "cross app asset",
			resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				asset := bindableVoiceAsset(id)
				asset.AppId = "other.app"
				return asset, nil
			},
			wantCode:   codes.PermissionDenied,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN,
		},
		{
			name: "cross user asset",
			resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				asset := bindableVoiceAsset(id)
				asset.SubjectUserId = "other-user"
				return asset, nil
			},
			wantCode:   codes.PermissionDenied,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN,
		},
		{
			name: "missing workflow type",
			resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				asset := bindableVoiceAsset(id)
				asset.WorkflowType = runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_UNSPECIFIED
				return asset, nil
			},
			wantCode:   codes.FailedPrecondition,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED,
		},
		{
			name: "unknown workflow type",
			resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				asset := bindableVoiceAsset(id)
				asset.WorkflowType = runtimev1.VoiceWorkflowType(99)
				return asset, nil
			},
			wantCode:   codes.FailedPrecondition,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED,
		},
		{
			name: "missing provider",
			resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				asset := bindableVoiceAsset(id)
				asset.Provider = ""
				return asset, nil
			},
			wantCode:   codes.FailedPrecondition,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED,
		},
		{
			name: "missing provider voice ref",
			resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				asset := bindableVoiceAsset(id)
				asset.ProviderVoiceRef = ""
				return asset, nil
			},
			wantCode:   codes.FailedPrecondition,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED,
		},
		{
			name: "active status with elapsed expiry",
			resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				asset := bindableVoiceAsset(id)
				asset.ExpiresAt = timestamppb.New(time.Now().UTC().Add(-24 * time.Hour))
				return asset, nil
			},
			wantCode:   codes.FailedPrecondition,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED,
		},
	}

	for _, statusValue := range []runtimev1.VoiceAssetStatus{
		runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_UNSPECIFIED,
		runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_EXPIRED,
		runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED,
		runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_FAILED,
	} {
		statusValue := statusValue
		tests = append(tests, struct {
			name       string
			resolve    testVoiceAssetResolver
			wantCode   codes.Code
			wantReason runtimev1.ReasonCode
		}{
			name: "inactive status " + statusValue.String(),
			resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				asset := bindableVoiceAsset(id)
				asset.Status = statusValue
				return asset, nil
			},
			wantCode:   codes.FailedPrecondition,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED,
		})
	}

	for _, persistence := range []runtimev1.VoiceAssetPersistence{
		runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_UNSPECIFIED,
		runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL,
	} {
		persistence := persistence
		tests = append(tests, struct {
			name       string
			resolve    testVoiceAssetResolver
			wantCode   codes.Code
			wantReason runtimev1.ReasonCode
		}{
			name: "non durable persistence " + persistence.String(),
			resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				asset := bindableVoiceAsset(id)
				asset.Persistence = persistence
				return asset, nil
			},
			wantCode:   codes.FailedPrecondition,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED,
		})
	}

	invalidTargetMutations := []struct {
		name   string
		mutate func(*runtimev1.VoiceAsset)
	}{
		{name: "missing target ref", mutate: func(asset *runtimev1.VoiceAsset) { asset.TargetRef = nil }},
		{name: "missing voice asset target ref", mutate: func(asset *runtimev1.VoiceAsset) { asset.VoiceAssetTargetRef = nil }},
		{name: "empty target oneof", mutate: func(asset *runtimev1.VoiceAsset) { asset.TargetRef = &runtimev1.RuntimeDurableTargetRef{} }},
		{name: "empty voice asset target oneof", mutate: func(asset *runtimev1.VoiceAsset) { asset.VoiceAssetTargetRef = &runtimev1.RuntimeDurableTargetRef{} }},
		{name: "nil cloud target payload", mutate: func(asset *runtimev1.VoiceAsset) {
			asset.TargetRef = &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_Cloud{}}
		}},
		{name: "nil voice asset cloud target payload", mutate: func(asset *runtimev1.VoiceAsset) {
			asset.VoiceAssetTargetRef = &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_Cloud{}}
		}},
		{name: "wrong cloud target version", mutate: func(asset *runtimev1.VoiceAsset) { asset.TargetRef.GetCloud().Version = "v1" }},
		{name: "incomplete cloud target", mutate: func(asset *runtimev1.VoiceAsset) { asset.TargetRef.GetCloud().ConnectorId = "" }},
		{name: "empty local target id", mutate: func(asset *runtimev1.VoiceAsset) {
			asset.TargetRef = &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{},
			}}}
		}},
		{name: "padded cloud target field", mutate: func(asset *runtimev1.VoiceAsset) {
			asset.TargetRef.GetCloud().ConnectorId = " connector-1"
		}},
		{name: "padded voice asset cloud target field", mutate: func(asset *runtimev1.VoiceAsset) {
			asset.VoiceAssetTargetRef.GetCloud().ProviderModelId = "provider-model-1 "
		}},
		{name: "padded local target profile binding", mutate: func(asset *runtimev1.VoiceAsset) {
			asset.TargetRef = &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{ProfileBindingId: " profile-binding-1"},
			}}}
		}},
		{name: "padded local voice asset readiness ref", mutate: func(asset *runtimev1.VoiceAsset) {
			asset.VoiceAssetTargetRef = &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{ReadinessRef: "readiness-1 "},
			}}}
		}},
		{name: "contradictory durable targets", mutate: func(asset *runtimev1.VoiceAsset) {
			asset.VoiceAssetTargetRef.GetCloud().ConnectorId = "connector-other"
		}},
		{name: "voice asset provider mismatches cloud target", mutate: func(asset *runtimev1.VoiceAsset) {
			asset.Provider = "provider-other"
		}},
	}
	for _, invalid := range invalidTargetMutations {
		invalid := invalid
		tests = append(tests, struct {
			name       string
			resolve    testVoiceAssetResolver
			wantCode   codes.Code
			wantReason runtimev1.ReasonCode
		}{
			name: invalid.name,
			resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				asset := bindableVoiceAsset(id)
				invalid.mutate(asset)
				return asset, nil
			},
			wantCode:   codes.FailedPrecondition,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED,
		})
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc := newRuntimeAgentTestService(t)
			requestContext := initializePresentationVoiceTestAgent(t, svc, "invalid-voice-binding-"+tc.name)
			svc.SetVoiceAssetResolver(tc.resolve)

			_, err := setPresentationVoiceReference(context.Background(), svc, requestContext, 0, "voice_asset_id:asset-1")
			if status.Code(err) != tc.wantCode {
				t.Fatalf("code = %s, want %s: %v", status.Code(err), tc.wantCode, err)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != tc.wantReason {
				t.Fatalf("reason = %s, %v; want %s", reason, ok, tc.wantReason)
			}
			assertPresentationVoiceNotCommitted(t, svc, requestContext, 0)
		})
	}
}

func TestSetAgentPresentationProfileFailsClosedOnEffectiveVoiceAssetAppScope(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		requestApp string
		headerApp  string
		assetApp   string
		wantCode   codes.Code
		wantCalls  int
	}{
		{name: "missing request and header app", wantCode: codes.PermissionDenied},
		{name: "conflicting request and header app", requestApp: "runtime-agent-boundary-test", headerApp: "other.app", assetApp: "other.app", wantCode: codes.PermissionDenied},
		{name: "header-only app", headerApp: "runtime-agent-boundary-test", assetApp: "runtime-agent-boundary-test", wantCode: codes.OK, wantCalls: 1},
		{name: "matching request and header app", requestApp: "runtime-agent-boundary-test", headerApp: "runtime-agent-boundary-test", assetApp: "runtime-agent-boundary-test", wantCode: codes.OK, wantCalls: 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newRuntimeAgentTestService(t)
			requestContext := initializePresentationVoiceTestAgent(t, svc, "effective-app-"+tc.name)
			requestContext.AppId = tc.requestApp
			resolverCalls := 0
			svc.SetVoiceAssetResolver(testVoiceAssetResolver(func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				resolverCalls++
				asset := bindableVoiceAsset(id)
				asset.AppId = tc.assetApp
				return asset, nil
			}))
			ctx := context.Background()
			if tc.headerApp != "" {
				ctx = metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-app-id", tc.headerApp))
			}
			_, err := setPresentationVoiceReference(ctx, svc, requestContext, 0, "voice_asset_id:asset-app-scope")
			if status.Code(err) != tc.wantCode {
				t.Fatalf("code = %s, want %s: %v", status.Code(err), tc.wantCode, err)
			}
			if resolverCalls != tc.wantCalls {
				t.Fatalf("resolver calls = %d, want %d", resolverCalls, tc.wantCalls)
			}
			if tc.wantCode != codes.OK {
				if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN {
					t.Fatalf("reason = %s, %v; want AI_VOICE_ASSET_SCOPE_FORBIDDEN", reason, ok)
				}
				assertPresentationVoiceNotCommitted(t, svc, requestContext, 0)
			}
		})
	}
}

func TestSetAgentPresentationProfileAcceptsOwnerScopedDurableVoiceAssetAndPreservesContext(t *testing.T) {
	t.Parallel()

	type contextKey struct{}
	sentinel := &struct{}{}
	svc := newRuntimeAgentTestService(t)
	requestContext := initializePresentationVoiceTestAgent(t, svc, "valid-voice-binding")
	svc.SetVoiceAssetResolver(testVoiceAssetResolver(func(ctx context.Context, id string) (*runtimev1.VoiceAsset, error) {
		if ctx.Value(contextKey{}) != sentinel {
			t.Fatal("resolver did not receive incoming RPC context")
		}
		return bindableVoiceAsset(id), nil
	}))

	response, err := setPresentationVoiceReference(context.WithValue(context.Background(), contextKey{}, sentinel), svc, requestContext, 0, "voice_asset_id:asset-valid")
	if err != nil {
		t.Fatalf("SetAgentPresentationProfile: %v", err)
	}
	if response.GetCommittedRevision() != 1 || response.GetProfile().GetDefaultVoiceReference() != "voice_asset_id:asset-valid" {
		t.Fatalf("unexpected committed profile: %#v", response)
	}
}

func TestSetAgentPresentationProfileAcceptsCanonicalLocalDurableVoiceAssetTargets(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	requestContext := initializePresentationVoiceTestAgent(t, svc, "valid-local-voice-binding")
	svc.SetVoiceAssetResolver(testVoiceAssetResolver(func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
		asset := bindableVoiceAsset(id)
		localTarget := &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
			Version: "v2",
			Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{ReadinessRef: "readiness-1"},
		}}}
		setVoiceAssetTargetRefs(asset, localTarget)
		return asset, nil
	}))

	response, err := setPresentationVoiceReference(context.Background(), svc, requestContext, 0, "voice_asset_id:asset-local")
	if err != nil {
		t.Fatalf("SetAgentPresentationProfile: %v", err)
	}
	if response.GetCommittedRevision() != 1 {
		t.Fatalf("committed revision = %d, want 1", response.GetCommittedRevision())
	}
}

func TestSetAgentPresentationProfileRevalidatesMergedVoiceAndClearSkipsResolver(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	requestContext := initializePresentationVoiceTestAgent(t, svc, "partial-revalidates-voice")
	resolverCalls := 0
	svc.SetVoiceAssetResolver(testVoiceAssetResolver(func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
		resolverCalls++
		return bindableVoiceAsset(id), nil
	}))
	if _, err := setPresentationVoiceReference(context.Background(), svc, requestContext, 0, "voice_asset_id:asset-partial"); err != nil {
		t.Fatalf("initial voice set: %v", err)
	}

	svc.SetVoiceAssetResolver(testVoiceAssetResolver(func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
		resolverCalls++
		asset := bindableVoiceAsset(id)
		asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_EXPIRED
		return asset, nil
	}))
	_, err := setTestAgentPresentationProfile(svc, context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          requestContext,
		ExpectedRevision: proto.Uint64(1),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Patch{Patch: &runtimev1.AgentPresentationProfilePatch{
			BackgroundAssetRef: proto.String("background-after-voice"),
		}},
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("unchanged voice revalidation code = %s, want FailedPrecondition: %v", status.Code(err), err)
	}
	assertPresentationVoiceNotCommitted(t, svc, requestContext, 1)

	svc.SetVoiceAssetResolver(testVoiceAssetResolver(func(context.Context, string) (*runtimev1.VoiceAsset, error) {
		resolverCalls++
		return nil, errors.New("cleared voice must not resolve")
	}))
	response, err := setPresentationVoiceReference(context.Background(), svc, requestContext, 1, "")
	if err != nil {
		t.Fatalf("clear voice reference: %v", err)
	}
	if resolverCalls != 2 {
		t.Fatalf("resolver calls = %d, want 2 (set + failed revalidation only)", resolverCalls)
	}
	if response.GetCommittedRevision() != 2 || response.GetProfile() != nil {
		t.Fatalf("clear response = %#v, want absent profile at revision 2", response)
	}
}

func TestSetAgentPresentationProfileResolvesOutsideStateLockAndRechecksCAS(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	requestContext := initializePresentationVoiceTestAgent(t, svc, "resolve-outside-lock")
	if _, err := setPresentationVoiceReference(context.Background(), svc, requestContext, 0, "preset_voice_id:initial"); err != nil {
		t.Fatalf("initial preset: %v", err)
	}

	resolverEntered := make(chan struct{})
	resolverRelease := make(chan struct{})
	var enterOnce sync.Once
	svc.SetVoiceAssetResolver(testVoiceAssetResolver(func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
		enterOnce.Do(func() { close(resolverEntered) })
		<-resolverRelease
		return bindableVoiceAsset(id), nil
	}))

	firstDone := make(chan error, 1)
	go func() {
		_, err := setPresentationVoiceReference(context.Background(), svc, requestContext, 1, "voice_asset_id:asset-racing")
		firstDone <- err
	}()
	select {
	case <-resolverEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("voice resolver was not entered")
	}

	secondDone := make(chan error, 1)
	go func() {
		_, err := setTestAgentPresentationProfile(svc, context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
			Context:          requestContext,
			ExpectedRevision: proto.Uint64(1),
			Mutation: &runtimev1.SetAgentPresentationProfileRequest_Patch{Patch: &runtimev1.AgentPresentationProfilePatch{
				BackgroundAssetRef: proto.String("background-winner"),
			}},
		})
		secondDone <- err
	}()
	select {
	case err := <-secondDone:
		if err != nil {
			t.Fatalf("concurrent non-resolving mutation: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("concurrent mutation blocked on external voice resolution while state lock was held")
	}
	close(resolverRelease)
	if err := <-firstDone; status.Code(err) != codes.Aborted {
		t.Fatalf("racing voice mutation code = %s, want Aborted: %v", status.Code(err), err)
	}

	response, err := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: requestContext})
	if err != nil {
		t.Fatalf("GetAgent: %v", err)
	}
	profile := response.GetAgent().GetPresentationProfile()
	if response.GetAgent().GetPresentationProfileRevision() != 2 || profile.GetBackgroundAssetRef() != "background-winner" || profile.GetDefaultVoiceReference() != "preset_voice_id:initial" {
		t.Fatalf("unexpected winning profile: %#v", response.GetAgent())
	}
}

func TestAIBackedVoiceAssetResolverDelegatesContextAndPreservesOwnerBoundaryErrors(t *testing.T) {
	t.Parallel()

	type contextKey struct{}
	sentinel := &struct{}{}
	scopeErr := grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	serviceCalls := 0
	resolver := NewAIBackedVoiceAssetResolver(testRuntimeAIVoiceAssetService{get: func(ctx context.Context, req *runtimev1.GetVoiceAssetRequest) (*runtimev1.GetVoiceAssetResponse, error) {
		serviceCalls++
		if ctx.Value(contextKey{}) != sentinel {
			t.Fatal("GetVoiceAsset did not receive incoming context")
		}
		if req.GetVoiceAssetId() != "asset-owner-boundary" {
			t.Fatalf("voice_asset_id = %q", req.GetVoiceAssetId())
		}
		return nil, scopeErr
	}})

	_, err := resolver.ResolveVoiceAsset(context.WithValue(context.Background(), contextKey{}, sentinel), " asset-owner-boundary ")
	if serviceCalls != 1 {
		t.Fatalf("GetVoiceAsset calls = %d, want 1", serviceCalls)
	}
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("code = %s, want PermissionDenied: %v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN {
		t.Fatalf("reason = %s, %v; want AI_VOICE_ASSET_SCOPE_FORBIDDEN", reason, ok)
	}
}
