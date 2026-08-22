package runtimeagent

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type testVoiceAssetResolver func(context.Context, string) (*runtimev1.VoiceAsset, error)

var testVoiceAssetTargets sync.Map

func (resolve testVoiceAssetResolver) ResolveVoiceAsset(ctx context.Context, voiceAssetID string) (*resolvedVoiceAsset, error) {
	asset, err := resolve(ctx, voiceAssetID)
	if err != nil || asset == nil {
		return nil, err
	}
	target, _ := testVoiceAssetTargets.Load(asset)
	resolvedTarget, _ := target.(*runtimeidentity.Target)
	return &resolvedVoiceAsset{Asset: asset, Target: resolvedTarget.Clone()}, nil
}

func testVoiceAssetExecutionIntent(target *runtimeidentity.Target) executionintent.Intent {
	if target == nil || target.GetCloud() == nil {
		return executionintent.Intent{}
	}
	cloud := target.GetCloud()
	rawTarget, _ := structpb.NewStruct(map[string]any{
		"provider": cloud.Provider, "providerModelId": cloud.ProviderModelID, "remoteModelCatalogId": cloud.RemoteModelCatalogID,
	})
	return executionintent.Intent{
		CapabilityContract: "audio.synthesize", Route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ConnectorRef: cloud.ConnectorID,
		CloudImplementation: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: "cloud.audio.test", DriverId: "driver." + cloud.Provider, DriverDialect: "provider/audio/v1",
		},
		ProviderModelTarget: rawTarget,
	}
}

type testRuntimeAIVoiceAssetService struct {
	get     func(context.Context, *runtimev1.GetVoiceAssetRequest) (*runtimev1.GetVoiceAssetResponse, error)
	resolve func(context.Context, string, string) (*runtimev1.VoiceAsset, *runtimeidentity.Target, error)
}

func (service testRuntimeAIVoiceAssetService) GetVoiceAsset(ctx context.Context, req *runtimev1.GetVoiceAssetRequest) (*runtimev1.GetVoiceAssetResponse, error) {
	return service.get(ctx, req)
}

func (service testRuntimeAIVoiceAssetService) ResolveRuntimeAgentVoiceAsset(ctx context.Context, voiceAssetID string, ownerUserID string) (*runtimev1.VoiceAsset, *runtimeidentity.Target, error) {
	return service.resolve(ctx, voiceAssetID, ownerUserID)
}

func durableVoiceAssetTargetRef() *runtimeidentity.Target {
	return &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID:          "connector-1",
		RemoteModelCatalogID: "remote-catalog-1",
		ProviderModelID:      "provider-model-1",
		Provider:             "provider-1",
	}}
}

func bindableVoiceAsset(voiceAssetID string) *runtimev1.VoiceAsset {
	targetRef := durableVoiceAssetTargetRef()
	asset := &runtimev1.VoiceAsset{
		VoiceAssetId:     voiceAssetID,
		AppId:            "runtime-agent-boundary-test",
		SubjectUserId:    "user-1",
		CreationSource:   runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_REFERENCE_AUDIO,
		Provider:         "provider-1",
		ProviderVoiceRef: "provider-voice-1",
		Persistence:      runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
	}
	testVoiceAssetTargets.Store(asset, targetRef.Clone())
	return asset
}

func setVoiceAssetTargetRefs(asset *runtimev1.VoiceAsset, targetRef *runtimeidentity.Target) {
	testVoiceAssetTargets.Store(asset, targetRef.Clone())
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
				asset.CreationSource = runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_UNSPECIFIED
				return asset, nil
			},
			wantCode:   codes.FailedPrecondition,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED,
		},
		{
			name: "unknown workflow type",
			resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
				asset := bindableVoiceAsset(id)
				asset.CreationSource = runtimev1.VoiceCreationSource(99)
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

	tests = append(tests, struct {
		name       string
		resolve    testVoiceAssetResolver
		wantCode   codes.Code
		wantReason runtimev1.ReasonCode
	}{
		name: "voice asset provider mismatches private cloud target",
		resolve: func(_ context.Context, id string) (*runtimev1.VoiceAsset, error) {
			asset := bindableVoiceAsset(id)
			asset.Provider = "provider-other"
			return asset, nil
		},
		wantCode:   codes.FailedPrecondition,
		wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_EXPIRED,
	})

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
		localTarget := &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{ReadinessRef: "readiness-1"}}
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
	resolver := NewAIBackedVoiceAssetResolver(testRuntimeAIVoiceAssetService{
		get: func(context.Context, *runtimev1.GetVoiceAssetRequest) (*runtimev1.GetVoiceAssetResponse, error) {
			return nil, errors.New("public GetVoiceAsset must not be called")
		},
		resolve: func(ctx context.Context, voiceAssetID string, ownerUserID string) (*runtimev1.VoiceAsset, *runtimeidentity.Target, error) {
			serviceCalls++
			if ctx.Value(contextKey{}) != sentinel {
				t.Fatal("private resolver did not receive incoming context")
			}
			if voiceAssetID != "asset-owner-boundary" || ownerUserID != "owner-1" {
				t.Fatalf("private scope = %q/%q", voiceAssetID, ownerUserID)
			}
			return nil, nil, scopeErr
		},
	})

	ctx := withRuntimeAgentVoiceAssetOwner(context.WithValue(context.Background(), contextKey{}, sentinel), "owner-1")
	_, err := resolver.ResolveVoiceAsset(ctx, " asset-owner-boundary ")
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
