package ai

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func localAppVoiceAssetsContext() context.Context {
	return localAppScenarioDecisionContext(accountservice.LocalAppOperationVoiceAssetsList, localappop.AppOperationIDVoiceAssetsList)
}

func TestListLocalAppVoiceAssetsRequiresExactDecision(t *testing.T) {
	svc := &Service{}
	_, err := svc.ListLocalAppVoiceAssets(context.Background(), &runtimev1.ListLocalAppVoiceAssetsRequest{})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
}

func TestListLocalAppVoiceAssetsRejectsInvalidPageControls(t *testing.T) {
	svc := &Service{}
	_, err := svc.ListLocalAppVoiceAssets(localAppVoiceAssetsContext(), &runtimev1.ListLocalAppVoiceAssetsRequest{PageToken: "not-a-number"})
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	_, err = svc.ListLocalAppVoiceAssets(localAppVoiceAssetsContext(), &runtimev1.ListLocalAppVoiceAssetsRequest{PageSize: -1})
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
}

func TestListLocalAppVoiceAssetsProjectsTrimmedCatalog(t *testing.T) {
	svc := newTestService(nil)
	now := timestamppb.New(time.Now().UTC())
	svc.voiceAssets.mu.Lock()
	svc.voiceAssets.assets["va-owned"] = &runtimev1.VoiceAsset{
		VoiceAssetId:     "va-owned",
		AppId:            "nimi.realm-persona-studio",
		SubjectUserId:    "account-1",
		WorkflowType:     runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_VOICE_CLONE,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
		Provider:         "provider-private",
		ModelId:          "model-private",
		ProviderVoiceRef: "provider-ref-private",
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	svc.voiceAssets.assets["va-cross-owner"] = &runtimev1.VoiceAsset{
		VoiceAssetId:  "va-cross-owner",
		AppId:         "other-app",
		SubjectUserId: "account-1",
		WorkflowType:  runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_VOICE_DESIGN,
		Status:        runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
	}
	svc.voiceAssets.mu.Unlock()

	response, err := svc.ListLocalAppVoiceAssets(localAppVoiceAssetsContext(), &runtimev1.ListLocalAppVoiceAssetsRequest{})
	if err != nil {
		t.Fatalf("ListLocalAppVoiceAssets: %v", err)
	}
	if len(response.GetAssets()) != 1 {
		t.Fatalf("catalog = %+v", response.GetAssets())
	}
	asset := response.GetAssets()[0]
	if asset.GetVoiceAssetId() != "va-owned" ||
		asset.GetWorkflowType() != runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_VOICE_CLONE ||
		asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE ||
		asset.GetCreatedAt() == nil {
		t.Fatalf("catalog projection = %+v", asset)
	}
}
