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

func TestDeleteLocalAppVoiceAssetRequiresExactOwnerAndConfirmation(t *testing.T) {
	svc := newTestService(nil)
	ctx := localAppScenarioDecisionContext(accountservice.LocalAppOperationVoiceAssetsDelete, localappop.AppOperationIDVoiceAssetsDelete)
	request := &runtimev1.DeleteLocalAppVoiceAssetRequest{VoiceAssetId: "owned"}
	for _, rejected := range []context.Context{context.Background(), localAppVoiceAssetsContext()} {
		_, err := svc.DeleteLocalAppVoiceAsset(rejected, request)
		assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	for _, row := range []struct{ id, app, account string }{
		{"owned", "nimi.realm-persona-studio", "account-1"},
		{"other-app", "other", "account-1"},
		{"other-account", "nimi.realm-persona-studio", "account-2"},
	} {
		svc.voiceAssets.assets[row.id] = &runtimev1.VoiceAsset{VoiceAssetId: row.id, AppId: row.app, SubjectUserId: row.account,
			Provider: "local", ProviderVoiceRef: "private-voice", Persistence: runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL, Status: runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE}
	}
	for _, id := range []string{"missing", "other-app", "other-account"} {
		_, err := svc.DeleteLocalAppVoiceAsset(ctx, &runtimev1.DeleteLocalAppVoiceAssetRequest{VoiceAssetId: id})
		assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_AI_VOICE_ASSET_SCOPE_FORBIDDEN)
	}
	for _, id := range []string{"", " owned", "owned\x01"} {
		_, err := svc.DeleteLocalAppVoiceAsset(ctx, &runtimev1.DeleteLocalAppVoiceAssetRequest{VoiceAssetId: id})
		assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	response, err := svc.DeleteLocalAppVoiceAsset(ctx, request)
	if err != nil || !response.GetDeleted() || svc.voiceAssets.assets["owned"].GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
		t.Fatalf("owner deletion not confirmed: %v %v", response, err)
	}
	// A broken captured cloud binding cannot become a local success.
	cloud := cloneVoiceAsset(svc.voiceAssets.assets["owned"])
	cloud.VoiceAssetId, cloud.Provider = "cloud-failure", "dashscope"
	cloud.Persistence, cloud.Status = runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT, runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE
	svc.voiceAssets.assets[cloud.VoiceAssetId] = cloud
	response, err = svc.DeleteLocalAppVoiceAsset(ctx, &runtimev1.DeleteLocalAppVoiceAssetRequest{VoiceAssetId: cloud.VoiceAssetId})
	if err == nil || response.GetDeleted() || svc.voiceAssets.assets[cloud.VoiceAssetId].GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE {
		t.Fatalf("failed cloud deletion was acknowledged: %v %v", response, err)
	}
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
		CreationSource:   runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_REFERENCE_AUDIO,
		Status:           runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
		Provider:         "provider-private",
		ModelId:          "model-private",
		ProviderVoiceRef: "provider-ref-private",
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	svc.voiceAssets.assets["va-cross-owner"] = &runtimev1.VoiceAsset{
		VoiceAssetId:   "va-cross-owner",
		AppId:          "other-app",
		SubjectUserId:  "account-1",
		CreationSource: runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_TEXT_DESCRIPTION,
		Status:         runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
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
		asset.GetCreationSource() != runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_REFERENCE_AUDIO ||
		asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE ||
		asset.GetCreatedAt() == nil {
		t.Fatalf("catalog projection = %+v", asset)
	}
}
