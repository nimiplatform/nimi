package localservice

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/grpc/codes"
)

func TestLocalCheckLocalModelHealthNotFoundWhenTargetMissing(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: "model_missing",
	})
	assertGRPCCode(t, err, "CheckLocalModelHealth(not_found)", codes.NotFound)
	assertGRPCReasonCode(t, err, "CheckLocalModelHealth(not_found)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func TestLocalCheckLocalServiceHealthNotFoundWhenTargetMissing(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{
		ServiceId: "svc_missing",
	})
	assertGRPCCode(t, err, "CheckLocalServiceHealth(not_found)", codes.NotFound)
	assertGRPCReasonCode(t, err, "CheckLocalServiceHealth(not_found)", runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
}

func TestLocalDefaultProbeBuildsSingleV1ModelsPath(t *testing.T) {
	receivedPath := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		_, _ = w.Write([]byte(`{"data":[{"id":"default-probe-model"}]}`))
	}))
	defer func() { server.Close() }()

	svc := newTestServiceWithProbe(t, nil)
	installed := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/default-probe-model",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     server.URL + "/v1",
	})
	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected active after successful real probe, got %s", started.GetAsset().GetStatus())
	}
	if receivedPath != "/v1/models" {
		t.Fatalf("probe path mismatch: got %s want /v1/models", receivedPath)
	}
}

func TestLocalStartLocalModelBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{sharedAcceleratorDependencyStatus: &engine.SharedAcceleratorDependencyStatus{
		DependencyID: engine.NVIDIACUDAUserSpaceRuntimeDependencyID,
		State:        engine.SharedAcceleratorDependencyReadySystem,
		Source:       "compatible_system",
		Detail:       "nvidia_cuda_user_space_runtime state=ready_system source=compatible_system",
	}}
	svc.SetEngineManager(mgr)

	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/bootstrap-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected ACTIVE, got %s", started.GetAsset().GetStatus())
	}
	if mgr.startCalls != 1 {
		t.Fatalf("expected one engine bootstrap start call, got %d", mgr.startCalls)
	}
	if mgr.lastStartEngine != "llama" {
		t.Fatalf("expected engine llama, got %q", mgr.lastStartEngine)
	}
	if mgr.lastStartPort != 1234 {
		t.Fatalf("expected bootstrap port 1234, got %d", mgr.lastStartPort)
	}
}

func TestLocalStartLocalServiceBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/bootstrap-service-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-bootstrap",
		Engine:       "llama",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}

	started, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-bootstrap",
	})
	if err != nil {
		t.Fatalf("start local service: %v", err)
	}
	if started.GetService().GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE {
		t.Fatalf("expected ACTIVE, got %s", started.GetService().GetStatus())
	}
	if mgr.startCalls != 1 {
		t.Fatalf("expected one engine bootstrap start call, got %d", mgr.startCalls)
	}
	if mgr.lastStartEngine != "llama" {
		t.Fatalf("expected engine llama, got %q", mgr.lastStartEngine)
	}
	if mgr.lastStartPort != 1234 {
		t.Fatalf("expected bootstrap port 1234, got %d", mgr.lastStartPort)
	}
}

func TestLocalStartLocalServiceSanitizesProbeMetadata(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  false,
			detail:   fmt.Sprintf("probe request failed: Get %q: connection refused", endpoint),
			probeURL: endpoint,
		}
	})
	svc.SetEngineManager(&mockEngineManager{
		startErr: fmt.Errorf("bootstrap failed for /tmp/private-service-model on 127.0.0.1:1234"),
	})

	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/bootstrap-service-sanitize-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-bootstrap-sanitize",
		Engine:       "llama",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}

	started, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-bootstrap-sanitize",
	})
	if err != nil {
		t.Fatalf("start local service: %v", err)
	}
	detail := started.GetService().GetDetail()
	if !strings.Contains(detail, "bootstrap_error=managed_engine_bootstrap_failed") {
		t.Fatalf("expected sanitized bootstrap marker, got %q", detail)
	}
	if !strings.Contains(detail, "plane=local-supervised") {
		t.Fatalf("expected supervised plane marker, got %q", detail)
	}
	if strings.Contains(detail, "/tmp/private-service-model") {
		t.Fatalf("bootstrap detail should not leak filesystem paths: %q", detail)
	}
	if strings.Contains(detail, "http://127.0.0.1:1234") {
		t.Fatalf("service detail should not leak raw probe urls: %q", detail)
	}
	if strings.Contains(detail, "probe_url=") {
		t.Fatalf("service detail should not emit raw probe_url markers: %q", detail)
	}
}

func TestLocalBootstrapSkipsNonLoopbackEndpoint(t *testing.T) {
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
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected ACTIVE, got %s", started.GetAsset().GetStatus())
	}
	if mgr.startCalls != 0 {
		t.Fatalf("expected no managed engine bootstrap for non-loopback endpoint, got %d calls", mgr.startCalls)
	}
}

func TestLocalCheckLocalModelHealthBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/health-bootstrap-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	localModelID := installed.GetLocalAssetId()
	if _, err := svc.updateModelStatus(localModelID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, "model active"); err != nil {
		t.Fatalf("promote model to active: %v", err)
	}

	resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: localModelID,
	})
	if err != nil {
		t.Fatalf("check local model health: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one model row, got %d", len(resp.GetAssets()))
	}
	if resp.GetAssets()[0].GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected ACTIVE, got %s", resp.GetAssets()[0].GetStatus())
	}
	if mgr.startCalls != 1 {
		t.Fatalf("expected one bootstrap start call, got %d", mgr.startCalls)
	}
	if mgr.lastStartEngine != "llama" {
		t.Fatalf("expected engine llama, got %q", mgr.lastStartEngine)
	}
	if mgr.lastStartPort != 1234 {
		t.Fatalf("expected bootstrap port 1234, got %d", mgr.lastStartPort)
	}
}

func TestLocalCheckLocalServiceHealthBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/health-bootstrap-service-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-health-bootstrap",
		Engine:       "llama",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if _, err := svc.updateServiceStatus("svc-health-bootstrap", runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE, "service active"); err != nil {
		t.Fatalf("promote service to active: %v", err)
	}

	resp, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{
		ServiceId: "svc-health-bootstrap",
	})
	if err != nil {
		t.Fatalf("check local service health: %v", err)
	}
	if len(resp.GetServices()) != 1 {
		t.Fatalf("expected one service row, got %d", len(resp.GetServices()))
	}
	if resp.GetServices()[0].GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE {
		t.Fatalf("expected ACTIVE, got %s", resp.GetServices()[0].GetStatus())
	}
	if mgr.startCalls != 1 {
		t.Fatalf("expected one bootstrap start call, got %d", mgr.startCalls)
	}
	if mgr.lastStartEngine != "llama" {
		t.Fatalf("expected engine llama, got %q", mgr.lastStartEngine)
	}
	if mgr.lastStartPort != 1234 {
		t.Fatalf("expected bootstrap port 1234, got %d", mgr.lastStartPort)
	}
}

func TestLocalCheckLocalModelHealthUnhealthyPathBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/health-unhealthy-bootstrap-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	localModelID := installed.GetLocalAssetId()
	if _, err := svc.updateModelStatus(localModelID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, "model active"); err != nil {
		t.Fatalf("promote model to active: %v", err)
	}
	if _, err := svc.updateModelStatus(localModelID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, "model unhealthy"); err != nil {
		t.Fatalf("promote model to unhealthy: %v", err)
	}

	resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: localModelID,
	})
	if err != nil {
		t.Fatalf("check local model health: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one model row, got %d", len(resp.GetAssets()))
	}
	if resp.GetAssets()[0].GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected UNHEALTHY before recovery threshold, got %s", resp.GetAssets()[0].GetStatus())
	}
	if mgr.startCalls != 1 {
		t.Fatalf("expected one bootstrap start call, got %d", mgr.startCalls)
	}
}

func TestLocalCheckLocalServiceHealthUnhealthyPathBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/health-unhealthy-bootstrap-service-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-health-unhealthy-bootstrap",
		Engine:       "llama",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if _, err := svc.updateServiceStatus("svc-health-unhealthy-bootstrap", runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE, "service active"); err != nil {
		t.Fatalf("promote service to active: %v", err)
	}
	if _, err := svc.updateServiceStatus("svc-health-unhealthy-bootstrap", runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY, "service unhealthy"); err != nil {
		t.Fatalf("promote service to unhealthy: %v", err)
	}

	resp, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{
		ServiceId: "svc-health-unhealthy-bootstrap",
	})
	if err != nil {
		t.Fatalf("check local service health: %v", err)
	}
	if len(resp.GetServices()) != 1 {
		t.Fatalf("expected one service row, got %d", len(resp.GetServices()))
	}
	if resp.GetServices()[0].GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY {
		t.Fatalf("expected UNHEALTHY before recovery threshold, got %s", resp.GetServices()[0].GetStatus())
	}
	if mgr.startCalls != 1 {
		t.Fatalf("expected one bootstrap start call, got %d", mgr.startCalls)
	}
}

func TestLocalCheckLocalServiceHealthSanitizesAttachedProbeMetadata(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
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
	if !strings.Contains(detail, "plane=attached-endpoint") {
		t.Fatalf("expected attached plane marker, got %q", detail)
	}
	if strings.Contains(detail, "speech.example.com") {
		t.Fatalf("service detail should not leak attached endpoint hosts: %q", detail)
	}
	if strings.Contains(detail, "probe_url=") {
		t.Fatalf("service detail should not emit raw probe_url markers: %q", detail)
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
