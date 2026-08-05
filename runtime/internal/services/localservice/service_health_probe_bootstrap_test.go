package localservice

import (
	"context"
	"fmt"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
)

func TestLocalCheckLocalServiceHealthNotFoundWhenTargetMissing(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{
		ServiceId: "svc_missing",
	})
	assertGRPCCode(t, err, "CheckLocalServiceHealth(not_found)", codes.NotFound)
	assertGRPCReasonCode(t, err, "CheckLocalServiceHealth(not_found)", runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
}

func TestLegacyAttachedLlamaStartFailsWithoutBootstrappingOrProbing(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	installed := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/non-loopback-model",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     "https://example.com/v1",
	})

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if started != nil {
		t.Fatalf("legacy llama start response = %+v", started)
	}
	assertGRPCReasonCode(t, err, "StartLocalAsset(legacy llama)", runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	if mgr.startCalls != 0 {
		t.Fatalf("expected no managed engine bootstrap for non-loopback endpoint, got %d calls", mgr.startCalls)
	}
}

func TestLocalCheckLegacyLlamaServiceHealthDoesNotProbeAttachedEndpoint(t *testing.T) {
	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeCalls++
		return endpointProbeResult{
			healthy:  false,
			detail:   fmt.Sprintf("probe request failed: Get %q: connection refused", endpoint),
			probeURL: endpoint,
		}
	})

	modelResp := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/attached-service-sanitize-model",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     "https://speech.example.com/v1",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-attached-sanitize",
		Engine:       "llama",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	started, startErr := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{ServiceId: "svc-attached-sanitize"})
	if started != nil {
		t.Fatalf("legacy llama service start response=%+v", started)
	}
	assertGRPCReasonCode(t, startErr, "StartLocalService(legacy llama)", runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	if _, err := svc.updateServiceStatus("svc-attached-sanitize", runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE, "service active"); err != nil {
		t.Fatalf("promote service to active: %v", err)
	}

	resp, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{
		ServiceId: "svc-attached-sanitize",
	})
	if err != nil {
		t.Fatalf("check local service health: %v", err)
	}
	if len(resp.GetServices()) != 1 {
		t.Fatalf("expected one service row, got %d", len(resp.GetServices()))
	}
	detail := resp.GetServices()[0].GetDetail()
	if detail != "execution health is evaluated by exact local capability jobs" || probeCalls != 0 {
		t.Fatalf("legacy llama service health detail=%q probe_calls=%d", detail, probeCalls)
	}
}

func TestLocalCheckLocalSpeechServiceHealthProjectsSpeechReasonCode(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  false,
			detail:   fmt.Sprintf("speech probe request failed: Get %q: connection refused", endpoint),
			probeURL: endpoint,
		}
	})

	modelResp := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/qwen3tts",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		endpoint:     "http://127.0.0.1:18181/v1",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-speech-health-reason",
		Engine:       "speech",
		Capabilities: []string{"audio.synthesize"},
		LocalModelId: modelResp.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install local speech service: %v", err)
	}
	if _, err := svc.updateServiceStatus("svc-speech-health-reason", runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE, "service active"); err != nil {
		t.Fatalf("promote service to active: %v", err)
	}

	resp, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{
		ServiceId: "svc-speech-health-reason",
	})
	if err != nil {
		t.Fatalf("check local speech service health: %v", err)
	}
	if len(resp.GetServices()) != 1 {
		t.Fatalf("expected one service row, got %d", len(resp.GetServices()))
	}
	service := resp.GetServices()[0]
	if service.GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY {
		t.Fatalf("expected UNHEALTHY, got %s", service.GetStatus())
	}
	if service.GetReasonCode() != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		t.Fatalf("unexpected service reason code: %s", service.GetReasonCode())
	}
}
