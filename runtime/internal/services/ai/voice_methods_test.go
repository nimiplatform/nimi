package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestListPresetVoicesReturnsCatalogVoices(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"dashscope": {BaseURL: "http://example.com", APIKey: "test-key"}},
	})

	resp, err := svc.ListPresetVoices(context.Background(), &runtimev1.ListPresetVoicesRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "dashscope/qwen3-tts-instruct-flash",
	})
	if err != nil {
		t.Fatalf("ListPresetVoices: %v", err)
	}
	if len(resp.GetVoices()) == 0 {
		t.Fatalf("expected non-empty preset voice list")
	}
	if resp.GetTraceId() == "" {
		t.Fatalf("trace id must be set")
	}
	if resp.GetModelResolved() == "" {
		t.Fatalf("model resolved must be set")
	}
}

func TestVoiceAssetMethodsLifecycle(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: "http://example.com", APIKey: "test-key"},
		},
	})

	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "dashscope/qwen3-tts-vc",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{
				VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
					TargetModelId: "dashscope/qwen3-tts-vc",
					Input: &runtimev1.VoiceV2VInput{
						ReferenceAudioUri: "file://sample.wav",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob(voice clone): %v", err)
	}
	if submitResp.GetAsset() == nil {
		t.Fatalf("voice clone submit must return asset")
	}
	assetID := submitResp.GetAsset().GetVoiceAssetId()
	if assetID == "" {
		t.Fatalf("voice asset id must be set")
	}

	getResp, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset: %v", err)
	}
	if getResp.GetAsset() == nil || getResp.GetAsset().GetVoiceAssetId() != assetID {
		t.Fatalf("get voice asset mismatch")
	}

	listResp, err := svc.ListVoiceAssets(context.Background(), &runtimev1.ListVoiceAssetsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		PageSize:      10,
	})
	if err != nil {
		t.Fatalf("ListVoiceAssets: %v", err)
	}
	if len(listResp.GetAssets()) == 0 {
		t.Fatalf("expected at least one voice asset")
	}

	deleteResp, err := svc.DeleteVoiceAsset(context.Background(), &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("DeleteVoiceAsset: %v", err)
	}
	if deleteResp.GetAck() == nil || !deleteResp.GetAck().GetOk() {
		t.Fatalf("delete voice asset ack must be ok")
	}

	getAfterDelete, err := svc.GetVoiceAsset(context.Background(), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: assetID})
	if err != nil {
		t.Fatalf("GetVoiceAsset(after delete): %v", err)
	}
	if getAfterDelete.GetAsset().GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED {
		t.Fatalf("asset status mismatch after delete: got=%v", getAfterDelete.GetAsset().GetStatus())
	}
}

func TestListVoiceAssetsValidation(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	_, err := svc.ListVoiceAssets(context.Background(), &runtimev1.ListVoiceAssetsRequest{
		AppId:         "",
		SubjectUserId: "user-001",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got=%v", status.Code(err))
	}
}
