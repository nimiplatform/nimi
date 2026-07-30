package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestShouldRetryUnhealthyManagedSpeechStartForSpeechModals(t *testing.T) {
	asr := &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset-asr",
		AssetId:      "local.stt.qwen3-asr-0.6b.safetensors",
		Engine:       "speech",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		Capabilities: []string{"audio.transcribe"},
	}
	if !shouldRetryUnhealthyLocalModelStart(asr, runtimev1.Modal_MODAL_STT) {
		t.Fatalf("unhealthy speech ASR asset should be retried for STT execution")
	}
	if shouldRetryUnhealthyLocalModelStart(asr, runtimev1.Modal_MODAL_TTS) {
		t.Fatalf("ASR asset must not be retried for TTS execution")
	}

	tts := &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset-tts",
		AssetId:      "local.tts.qwen3-tts-customvoice-0.6b.safetensors",
		Engine:       "speech",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		Capabilities: []string{"audio.synthesize"},
	}
	if !shouldRetryUnhealthyLocalModelStart(tts, runtimev1.Modal_MODAL_TTS) {
		t.Fatalf("unhealthy speech TTS asset should be retried for TTS execution")
	}
	if shouldRetryUnhealthyLocalModelStart(tts, runtimev1.Modal_MODAL_STT) {
		t.Fatalf("TTS asset must not be retried for STT execution")
	}
}

func TestPrepareLocalModelExecutionPlanRetriesUnhealthySpeechAsset(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	unhealthy := &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset-asr",
		AssetId:      "local.stt.qwen3-asr-0.6b.safetensors",
		Engine:       "speech",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		Endpoint:     "http://127.0.0.1:8330/v1",
		Capabilities: []string{"audio.transcribe"},
	}
	active := &runtimev1.LocalAssetRecord{
		LocalAssetId: unhealthy.GetLocalAssetId(),
		AssetId:      unhealthy.GetAssetId(),
		Engine:       unhealthy.GetEngine(),
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Endpoint:     unhealthy.GetEndpoint(),
		Capabilities: unhealthy.GetCapabilities(),
	}
	lister := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{unhealthy},
		}},
		startResp: &runtimev1.StartLocalAssetResponse{Asset: active},
	}
	svc.localModel = lister

	plan, err := svc.prepareLocalModelExecutionPlan(
		context.Background(),
		"local/local.stt.qwen3-asr-0.6b.safetensors",
		nil,
		runtimev1.Modal_MODAL_STT,
		nil,
	)
	if err != nil {
		t.Fatalf("prepare speech execution plan: %v", err)
	}
	if lister.startCalls != 1 {
		t.Fatalf("expected unhealthy speech asset to be restarted once, got %d", lister.startCalls)
	}
	if plan == nil || plan.selected == nil || plan.selected.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected active selected speech asset, got %#v", plan)
	}
	localBackend, ok := svc.selector.local.(*localProvider)
	if !ok {
		t.Fatalf("expected local provider, got %T", svc.selector.local)
	}
	_, _, speechBackend, _, _ := localBackend.backends()
	if speechBackend == nil {
		t.Fatalf("expected speech backend to be hydrated from recovered asset endpoint")
	}
}
