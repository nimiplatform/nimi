package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/grpc/codes"
)

func TestDefaultEndpointProbeMediaRejectsEmptyReadyCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"detail": "warming complete",
			})
		case "/v1/catalog":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"detail": "catalog missing ready models",
				"models": []map[string]any{},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	probe := defaultEndpointProbe(context.Background(), "media", server.URL)
	if probe.healthy {
		t.Fatal("expected media probe to fail when catalog has no ready models")
	}
	if !probe.responded {
		t.Fatal("expected media probe to record HTTP response")
	}
	if !strings.Contains(probe.detail, "catalog") {
		t.Fatalf("expected catalog detail in probe failure, got %q", probe.detail)
	}
}

func TestDefaultEndpointProbeMediaCollectsReadyModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"detail": "ready",
			})
		case "/v1/catalog":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"models": []map[string]any{
					{"id": "flux.1-schnell", "ready": true},
					{"id": "wan2.1-video", "ready": true},
					{"id": "broken-model", "ready": false},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	probe := defaultEndpointProbe(context.Background(), "media", server.URL)
	if !probe.healthy {
		t.Fatalf("expected media probe to succeed, got detail=%q", probe.detail)
	}
	if !strings.Contains(probe.probeURL, "/v1/catalog") {
		t.Fatalf("expected canonical catalog probe url, got %q", probe.probeURL)
	}
	if got := strings.Join(probe.models, ","); got != "flux.1-schnell,wan2.1-video" {
		t.Fatalf("unexpected ready model list: %s", got)
	}
}

func TestDefaultEndpointProbeMediaProxyAllowsReadyEmptyCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"checks": map[string]any{
					"proxy_mode": true,
				},
			})
		case "/v1/catalog":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"detail": "proxy execution catalog is informational only",
				"models": []map[string]any{},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	probe := defaultEndpointProbe(context.Background(), "media", server.URL)
	if !probe.healthy {
		t.Fatalf("expected media proxy probe to succeed, got detail=%q", probe.detail)
	}
}

func TestDefaultEndpointProbeSpeechRejectsCatalogReadyFalse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"detail": "health endpoint reachable",
			})
		case "/v1/catalog":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "placeholder",
				"ready":  false,
				"detail": "speech placeholder catalog",
				"models": []map[string]any{
					{"id": "speech-default", "ready": true, "capabilities": []string{"audio.synthesize"}},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	probe := defaultEndpointProbe(context.Background(), "speech", server.URL)
	if probe.healthy {
		t.Fatal("expected speech probe to fail when catalog reports ready=false")
	}
	if !strings.Contains(probe.detail, "placeholder") && !strings.Contains(probe.detail, "ready=false") {
		t.Fatalf("expected placeholder-ready=false detail, got %q", probe.detail)
	}
}

func TestLocalModelLifecycle(t *testing.T) {
	svc := newTestService(t)

	installed := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/test-chat",
		capabilities: []string{"chat", "chat"},
		engine:       "llama",
	})
	model := installed
	if model.GetLocalAssetId() == "" {
		t.Fatalf("local model id must not be empty")
	}
	if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("install status mismatch: got=%s", model.GetStatus())
	}
	if len(model.GetCapabilities()) != 1 || model.GetCapabilities()[0] != "chat" {
		t.Fatalf("capabilities must be normalized: %#v", model.GetCapabilities())
	}

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("start status mismatch: got=%s", started.GetAsset().GetStatus())
	}

	healthResp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("check local model health: %v", err)
	}
	if len(healthResp.GetAssets()) != 1 {
		t.Fatalf("health rows mismatch: got=%d want=1", len(healthResp.GetAssets()))
	}
	if healthResp.GetAssets()[0].GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("health status mismatch: got=%s", healthResp.GetAssets()[0].GetStatus())
	}
	if healthResp.GetAssets()[0].GetDetail() != "model active" {
		t.Fatalf("health detail mismatch: got=%q", healthResp.GetAssets()[0].GetDetail())
	}

	stopped, err := svc.StopLocalAsset(context.Background(), &runtimev1.StopLocalAssetRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("stop local model: %v", err)
	}
	if stopped.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("stop status mismatch: got=%s", stopped.GetAsset().GetStatus())
	}

	removed, err := svc.RemoveLocalAsset(context.Background(), &runtimev1.RemoveLocalAssetRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("remove local model: %v", err)
	}
	if removed.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
		t.Fatalf("remove status mismatch: got=%s", removed.GetAsset().GetStatus())
	}
}

func TestLocalStartLocalModelProbeFailureTransitionsUnhealthy(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, _ string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  false,
			detail:   "connection refused",
			probeURL: "http://127.0.0.1:1234/v1/models",
		}
	})
	installed := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/probe-fail-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy status, got %s", started.GetAsset().GetStatus())
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), "connection refused") {
		t.Fatalf("expected probe failure detail, got %q", started.GetAsset().GetHealthDetail())
	}
}

func TestLocalStartManagedLocalModelWarmsBeforeReportingActive(t *testing.T) {
	chatCompletions := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"qwen"}]}`)
		case "/v1/chat/completions":
			chatCompletions++
			_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"ready"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestServiceWithProbe(t, nil)
	mgr := &mockEngineManager{sharedAcceleratorDependencyStatus: &engine.SharedAcceleratorDependencyStatus{
		DependencyID: engine.NVIDIACUDAUserSpaceRuntimeDependencyID,
		State:        engine.SharedAcceleratorDependencyReadySystem,
		Source:       "compatible_system",
		Detail:       "nvidia_cuda_user_space_runtime state=ready_system source=compatible_system",
	}}
	svc.SetEngineManager(mgr)
	svc.SetManagedLlamaEndpoint(server.URL + "/v1")
	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/qwen",
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
		t.Fatalf("expected active status after warm success, got %s", started.GetAsset().GetStatus())
	}
	if chatCompletions != 1 {
		t.Fatalf("expected one warm execution, got %d", chatCompletions)
	}
	if mgr.startCalls != 1 {
		t.Fatalf("expected a single managed engine bootstrap, got %d", mgr.startCalls)
	}

	restarted, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("restart local model after warm cache: %v", err)
	}
	if restarted.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected active status after cached warm start, got %s", restarted.GetAsset().GetStatus())
	}
	if chatCompletions != 1 {
		t.Fatalf("expected cached warm state to avoid a second execution, got %d calls", chatCompletions)
	}
}

func TestLocalStartManagedLocalModelWarmFailureTransitionsUnhealthy(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"qwen"}]}`)
		case "/v1/chat/completions":
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(w, `{"error":{"message":"grpc service not ready"}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestServiceWithProbe(t, nil)
	svc.SetEngineManager(&mockEngineManager{})
	svc.SetManagedLlamaEndpoint(server.URL + "/v1")
	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/qwen",
		capabilities: []string{"chat"},
		engine:       "llama",
	})

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy status after warm failure, got %s", started.GetAsset().GetStatus())
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), "warm execution failed") {
		t.Fatalf("expected warm failure detail, got %q", started.GetAsset().GetHealthDetail())
	}
}

func TestLocalCheckLocalModelHealthRecoversAfterThreeProbes(t *testing.T) {
	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, _ string) endpointProbeResult {
		probeCalls++
		if probeCalls == 1 {
			return endpointProbeResult{
				healthy:  false,
				detail:   "startup probe failed",
				probeURL: "http://127.0.0.1:1234/v1/models",
			}
		}
		return endpointProbeResult{
			healthy:  true,
			detail:   "probe recovered",
			probeURL: "http://127.0.0.1:1234/v1/models",
		}
	})
	installed := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/recover-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	localModelID := installed.GetLocalAssetId()

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: localModelID,
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy after startup probe failure, got %s", started.GetAsset().GetStatus())
	}

	for i := 1; i <= 2; i++ {
		resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
			LocalAssetId: localModelID,
		})
		if err != nil {
			t.Fatalf("check local model health #%d: %v", i, err)
		}
		if len(resp.GetAssets()) != 1 {
			t.Fatalf("expected one model row at probe #%d, got %d", i, len(resp.GetAssets()))
		}
		if resp.GetAssets()[0].GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
			t.Fatalf("probe #%d should keep model unhealthy until threshold, got %s", i, resp.GetAssets()[0].GetStatus())
		}
	}

	recovered, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: localModelID,
	})
	if err != nil {
		t.Fatalf("check local model health #3: %v", err)
	}
	if len(recovered.GetAssets()) != 1 {
		t.Fatalf("expected one model row after recovery probe, got %d", len(recovered.GetAssets()))
	}
	if recovered.GetAssets()[0].GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("third successful probe should recover model to ACTIVE, got %s", recovered.GetAssets()[0].GetStatus())
	}
}

func TestLocalStartLocalServiceProbeFailureTransitionsUnhealthy(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, _ string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  false,
			detail:   "service connection refused",
			probeURL: "http://127.0.0.1:8080/v1/models",
		}
	})
	modelResp := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/service-probe-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-probe-fail",
		Engine:       "llama",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}

	started, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-probe-fail",
	})
	if err != nil {
		t.Fatalf("start local service: %v", err)
	}
	if started.GetService().GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy service status, got %s", started.GetService().GetStatus())
	}
	if !strings.Contains(started.GetService().GetDetail(), "connection refused") {
		t.Fatalf("expected probe failure detail, got %q", started.GetService().GetDetail())
	}
}

func TestLocalCheckLocalServiceHealthRecoversAfterThreeProbes(t *testing.T) {
	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, _ string) endpointProbeResult {
		probeCalls++
		if probeCalls == 1 {
			return endpointProbeResult{
				healthy:  false,
				detail:   "service startup failed",
				probeURL: "http://127.0.0.1:8080/v1/models",
			}
		}
		return endpointProbeResult{
			healthy:  true,
			detail:   "service probe recovered",
			probeURL: "http://127.0.0.1:8080/v1/models",
		}
	})
	modelResp := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/service-recover-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-recover",
		Engine:       "llama",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}

	started, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-recover",
	})
	if err != nil {
		t.Fatalf("start local service: %v", err)
	}
	if started.GetService().GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy after startup probe failure, got %s", started.GetService().GetStatus())
	}

	for i := 1; i <= 2; i++ {
		resp, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{
			ServiceId: "svc-recover",
		})
		if err != nil {
			t.Fatalf("check local service health #%d: %v", i, err)
		}
		if len(resp.GetServices()) != 1 {
			t.Fatalf("expected one service row at probe #%d, got %d", i, len(resp.GetServices()))
		}
		if resp.GetServices()[0].GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY {
			t.Fatalf("probe #%d should keep service unhealthy until threshold, got %s", i, resp.GetServices()[0].GetStatus())
		}
	}

	recovered, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{
		ServiceId: "svc-recover",
	})
	if err != nil {
		t.Fatalf("check local service health #3: %v", err)
	}
	if len(recovered.GetServices()) != 1 {
		t.Fatalf("expected one service row after recovery probe, got %d", len(recovered.GetServices()))
	}
	if recovered.GetServices()[0].GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE {
		t.Fatalf("third successful probe should recover service to ACTIVE, got %s", recovered.GetServices()[0].GetStatus())
	}
}

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
	defer server.Close()

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
	if service.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_SPEECH_HOST_INIT_FAILED {
		t.Fatalf("unexpected service reason code: %s", service.GetReasonCode())
	}
}
