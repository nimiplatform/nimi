package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func runtimeAgentVoiceAssetTestTarget(connectorID string) *runtimev1.RuntimeDurableTargetRef {
	return &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
			Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
				Version:              "v2",
				ConnectorId:          connectorID,
				RemoteModelCatalogId: "dashscope/cosyvoice-v3-flash",
				ProviderModelId:      "cosyvoice-v3-flash",
				Provider:             "dashscope",
			},
		},
	}
}

func runtimeAgentVoiceAssetTestSpec(assetID string) *runtimev1.SpeechSynthesizeScenarioSpec {
	return &runtimev1.SpeechSynthesizeScenarioSpec{
		Text: "宋濂语音链路验收",
		VoiceRef: &runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
			Reference: &runtimev1.VoiceReference_VoiceAssetId{
				VoiceAssetId: assetID,
			},
		},
	}
}

func TestResolveSynthesizeSpeechVoiceAssetKeepsAppSubjectAndTargetScope(t *testing.T) {
	t.Parallel()
	const (
		assetID     = "voice-asset-song-lian"
		appID       = "nimi.voice-demo"
		ownerUserID = "user-1"
		connectorID = "connector-dashscope-owner"
	)
	targetRef := runtimeAgentVoiceAssetTestTarget(connectorID)
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{})
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:        assetID,
		AppId:               appID,
		SubjectUserId:       ownerUserID,
		WorkflowType:        runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_VOICE_CLONE,
		Provider:            "dashscope",
		TargetModelId:       "dashscope/cosyvoice-v3-flash",
		ProviderVoiceRef:    "cosyvoice-song-lian",
		Persistence:         runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:              runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
		TargetRef:           proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
		VoiceAssetTargetRef: proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
	}

	tests := []struct {
		name       string
		ctx        context.Context
		head       *runtimev1.ScenarioRequestHead
		wantCode   codes.Code
		wantReason runtimev1.ReasonCode
	}{
		{
			name: "matching owner and durable target",
			head: &runtimev1.ScenarioRequestHead{
				AppId:         appID,
				SubjectUserId: ownerUserID,
				ConnectorId:   connectorID,
				TargetRef:     proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
			},
			wantCode: codes.OK,
		},
		{
			name: "cross app",
			head: &runtimev1.ScenarioRequestHead{
				AppId:         "desktop.app",
				SubjectUserId: ownerUserID,
				ConnectorId:   connectorID,
				TargetRef:     proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
			},
			wantCode:   codes.PermissionDenied,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN,
		},
		{
			name: "cross subject",
			head: &runtimev1.ScenarioRequestHead{
				AppId:         appID,
				SubjectUserId: "user-other",
				ConnectorId:   connectorID,
				TargetRef:     proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
			},
			wantCode:   codes.PermissionDenied,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN,
		},
		{
			name: "authenticated subject cannot spoof matching head",
			ctx: authn.WithIdentity(
				context.Background(),
				&authn.Identity{SubjectUserID: "user-other"},
			),
			head: &runtimev1.ScenarioRequestHead{
				AppId:         appID,
				SubjectUserId: ownerUserID,
				ConnectorId:   connectorID,
				TargetRef:     proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
			},
			wantCode:   codes.PermissionDenied,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN,
		},
		{
			name: "caller app cannot spoof matching head",
			ctx: metadata.NewIncomingContext(
				authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: ownerUserID}),
				metadata.Pairs("x-nimi-app-id", "desktop.app"),
			),
			head: &runtimev1.ScenarioRequestHead{
				AppId:         appID,
				SubjectUserId: ownerUserID,
				ConnectorId:   connectorID,
				TargetRef:     proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
			},
			wantCode:   codes.PermissionDenied,
			wantReason: runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN,
		},
		{
			name: "target mismatch",
			head: &runtimev1.ScenarioRequestHead{
				AppId:         appID,
				SubjectUserId: ownerUserID,
				ConnectorId:   "connector-other",
				TargetRef:     runtimeAgentVoiceAssetTestTarget("connector-other"),
			},
			wantCode:   codes.InvalidArgument,
			wantReason: runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH,
		},
		{
			name: "connector mismatches bound target",
			head: &runtimev1.ScenarioRequestHead{
				AppId:         appID,
				SubjectUserId: ownerUserID,
				ConnectorId:   "connector-other",
				TargetRef:     proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
			},
			wantCode:   codes.InvalidArgument,
			wantReason: runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ctx := tc.ctx
			if ctx == nil {
				ctx = context.Background()
			}
			effective, err := svc.resolveSynthesizeSpeechSpecVoiceRef(
				ctx,
				tc.head,
				"dashscope/cosyvoice-v3-flash",
				runtimeAgentVoiceAssetTestSpec(assetID),
			)
			if status.Code(err) != tc.wantCode {
				t.Fatalf("code=%s want=%s err=%v", status.Code(err), tc.wantCode, err)
			}
			if tc.wantCode == codes.OK {
				if got := effective.GetVoiceRef().GetProviderVoiceRef(); got != "cosyvoice-song-lian" {
					t.Fatalf("resolved provider voice ref=%q", got)
				}
				return
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != tc.wantReason {
				t.Fatalf("reason=%s ok=%v want=%s err=%v", reason, ok, tc.wantReason, err)
			}
		})
	}
}

func TestResolveRuntimeAgentVoiceAssetIsSubjectBoundWithoutWideningPublicAppRead(t *testing.T) {
	t.Parallel()
	const assetID = "voice-asset-song-lian-private-resolution"
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{})
	svc.voiceAssets.assets[assetID] = &runtimev1.VoiceAsset{
		VoiceAssetId:  assetID,
		AppId:         "nimi.voice-demo",
		SubjectUserId: "user-1",
	}

	asset, err := svc.ResolveRuntimeAgentVoiceAsset(nil, assetID, "user-1")
	if err != nil || asset.GetAppId() != "nimi.voice-demo" {
		t.Fatalf("owner-aware private resolve asset=%v err=%v", asset, err)
	}
	if _, err := svc.ResolveRuntimeAgentVoiceAsset(nil, assetID, "user-other"); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("cross-subject private resolve code=%s err=%v", status.Code(err), err)
	}
	if _, err := svc.GetVoiceAsset(
		scenarioJobUserContext("desktop.app", "user-1"),
		&runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID},
	); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("public cross-app GetVoiceAsset code=%s err=%v", status.Code(err), err)
	}
}
