package localruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	return newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  true,
			detail:   "probe mocked healthy",
			probeURL: endpoint,
		}
	})
}

func newTestServiceWithProbe(t *testing.T, probe endpointProbeFunc) *Service {
	t.Helper()
	statePath := filepath.Join(t.TempDir(), "local-runtime-state.json")
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 0)
	if probe != nil {
		svc.endpointProbe = probe
	}
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return []*runtimev1.LocalCatalogModelDescriptor{}, nil
	}
	t.Cleanup(func() {
		svc.Close()
	})
	return svc
}

func TestLocalRuntimeModelLifecycle(t *testing.T) {
	svc := newTestService(t)

	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/test-chat",
		Capabilities: []string{"chat", "chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	model := installed.GetModel()
	if model.GetLocalModelId() == "" {
		t.Fatalf("local model id must not be empty")
	}
	if model.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("install status mismatch: got=%s", model.GetStatus())
	}
	if len(model.GetCapabilities()) != 1 || model.GetCapabilities()[0] != "chat" {
		t.Fatalf("capabilities must be normalized: %#v", model.GetCapabilities())
	}

	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{
		LocalModelId: model.GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("start status mismatch: got=%s", started.GetModel().GetStatus())
	}

	healthResp, err := svc.CheckLocalModelHealth(context.Background(), &runtimev1.CheckLocalModelHealthRequest{
		LocalModelId: model.GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("check local model health: %v", err)
	}
	if len(healthResp.GetModels()) != 1 {
		t.Fatalf("health rows mismatch: got=%d want=1", len(healthResp.GetModels()))
	}
	if healthResp.GetModels()[0].GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("health status mismatch: got=%s", healthResp.GetModels()[0].GetStatus())
	}
	if healthResp.GetModels()[0].GetDetail() != "model active" {
		t.Fatalf("health detail mismatch: got=%q", healthResp.GetModels()[0].GetDetail())
	}

	stopped, err := svc.StopLocalModel(context.Background(), &runtimev1.StopLocalModelRequest{
		LocalModelId: model.GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("stop local model: %v", err)
	}
	if stopped.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("stop status mismatch: got=%s", stopped.GetModel().GetStatus())
	}

	removed, err := svc.RemoveLocalModel(context.Background(), &runtimev1.RemoveLocalModelRequest{
		LocalModelId: model.GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("remove local model: %v", err)
	}
	if removed.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
		t.Fatalf("remove status mismatch: got=%s", removed.GetModel().GetStatus())
	}
}

func TestLocalRuntimeStartLocalModelProbeFailureTransitionsUnhealthy(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, _ string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  false,
			detail:   "connection refused",
			probeURL: "http://127.0.0.1:1234/v1/models",
		}
	})
	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/probe-fail-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{
		LocalModelId: installed.GetModel().GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy status, got %s", started.GetModel().GetStatus())
	}
	if !strings.Contains(started.GetModel().GetHealthDetail(), "connection refused") {
		t.Fatalf("expected probe failure detail, got %q", started.GetModel().GetHealthDetail())
	}
}

func TestLocalRuntimeCheckLocalModelHealthRecoversAfterThreeProbes(t *testing.T) {
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
	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/recover-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	localModelID := installed.GetModel().GetLocalModelId()

	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{
		LocalModelId: localModelID,
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy after startup probe failure, got %s", started.GetModel().GetStatus())
	}

	for i := 1; i <= 2; i++ {
		resp, err := svc.CheckLocalModelHealth(context.Background(), &runtimev1.CheckLocalModelHealthRequest{
			LocalModelId: localModelID,
		})
		if err != nil {
			t.Fatalf("check local model health #%d: %v", i, err)
		}
		if len(resp.GetModels()) != 1 {
			t.Fatalf("expected one model row at probe #%d, got %d", i, len(resp.GetModels()))
		}
		if resp.GetModels()[0].GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
			t.Fatalf("probe #%d should keep model unhealthy until threshold, got %s", i, resp.GetModels()[0].GetStatus())
		}
	}

	recovered, err := svc.CheckLocalModelHealth(context.Background(), &runtimev1.CheckLocalModelHealthRequest{
		LocalModelId: localModelID,
	})
	if err != nil {
		t.Fatalf("check local model health #3: %v", err)
	}
	if len(recovered.GetModels()) != 1 {
		t.Fatalf("expected one model row after recovery probe, got %d", len(recovered.GetModels()))
	}
	if recovered.GetModels()[0].GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("third successful probe should recover model to ACTIVE, got %s", recovered.GetModels()[0].GetStatus())
	}
}

func TestLocalRuntimeStartLocalServiceProbeFailureTransitionsUnhealthy(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, _ string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  false,
			detail:   "service connection refused",
			probeURL: "http://127.0.0.1:8080/v1/models",
		}
	})
	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/service-probe-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-probe-fail",
		Engine:       "localai",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetModel().GetLocalModelId(),
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

func TestLocalRuntimeCheckLocalServiceHealthRecoversAfterThreeProbes(t *testing.T) {
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
	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/service-recover-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-recover",
		Engine:       "localai",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetModel().GetLocalModelId(),
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

func TestLocalRuntimeCheckLocalModelHealthNotFoundWhenTargetMissing(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.CheckLocalModelHealth(context.Background(), &runtimev1.CheckLocalModelHealthRequest{
		LocalModelId: "model_missing",
	})
	assertGRPCCode(t, err, "CheckLocalModelHealth(not_found)", codes.NotFound)
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		t.Fatalf("CheckLocalModelHealth(not_found): expected no reason code, got %s", reason)
	}
}

func TestLocalRuntimeCheckLocalServiceHealthNotFoundWhenTargetMissing(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{
		ServiceId: "svc_missing",
	})
	assertGRPCCode(t, err, "CheckLocalServiceHealth(not_found)", codes.NotFound)
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		t.Fatalf("CheckLocalServiceHealth(not_found): expected no reason code, got %s", reason)
	}
}

func TestLocalRuntimeDefaultProbeBuildsSingleV1ModelsPath(t *testing.T) {
	receivedPath := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		_, _ = w.Write([]byte(`{"data":[{"id":"default-probe-model"}]}`))
	}))
	defer server.Close()

	svc := newTestServiceWithProbe(t, nil)
	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/default-probe-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
		Endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{
		LocalModelId: installed.GetModel().GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("expected active after successful real probe, got %s", started.GetModel().GetStatus())
	}
	if receivedPath != "/v1/models" {
		t.Fatalf("probe path mismatch: got %s want /v1/models", receivedPath)
	}
}

func TestLocalRuntimeStartLocalModelBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/bootstrap-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{
		LocalModelId: installed.GetModel().GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("expected ACTIVE, got %s", started.GetModel().GetStatus())
	}
	if mgr.startCalls != 1 {
		t.Fatalf("expected one engine bootstrap start call, got %d", mgr.startCalls)
	}
	if mgr.lastStartEngine != "localai" {
		t.Fatalf("expected engine localai, got %q", mgr.lastStartEngine)
	}
	if mgr.lastStartPort != 1234 {
		t.Fatalf("expected bootstrap port 1234, got %d", mgr.lastStartPort)
	}
}

func TestLocalRuntimeStartLocalServiceBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/bootstrap-service-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-bootstrap",
		Engine:       "localai",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetModel().GetLocalModelId(),
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
	if mgr.lastStartEngine != "localai" {
		t.Fatalf("expected engine localai, got %q", mgr.lastStartEngine)
	}
	if mgr.lastStartPort != 8080 {
		t.Fatalf("expected bootstrap port 8080, got %d", mgr.lastStartPort)
	}
}

func TestLocalRuntimeBootstrapSkipsNonLoopbackEndpoint(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/non-loopback-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
		Endpoint:     "https://example.com/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{
		LocalModelId: installed.GetModel().GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("expected ACTIVE, got %s", started.GetModel().GetStatus())
	}
	if mgr.startCalls != 0 {
		t.Fatalf("expected no managed engine bootstrap for non-loopback endpoint, got %d calls", mgr.startCalls)
	}
}

func TestLocalRuntimeCheckLocalModelHealthBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/health-bootstrap-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	localModelID := installed.GetModel().GetLocalModelId()
	if _, err := svc.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE, "model active"); err != nil {
		t.Fatalf("promote model to active: %v", err)
	}

	resp, err := svc.CheckLocalModelHealth(context.Background(), &runtimev1.CheckLocalModelHealthRequest{
		LocalModelId: localModelID,
	})
	if err != nil {
		t.Fatalf("check local model health: %v", err)
	}
	if len(resp.GetModels()) != 1 {
		t.Fatalf("expected one model row, got %d", len(resp.GetModels()))
	}
	if resp.GetModels()[0].GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("expected ACTIVE, got %s", resp.GetModels()[0].GetStatus())
	}
	if mgr.startCalls != 1 {
		t.Fatalf("expected one bootstrap start call, got %d", mgr.startCalls)
	}
	if mgr.lastStartEngine != "localai" {
		t.Fatalf("expected engine localai, got %q", mgr.lastStartEngine)
	}
	if mgr.lastStartPort != 1234 {
		t.Fatalf("expected bootstrap port 1234, got %d", mgr.lastStartPort)
	}
}

func TestLocalRuntimeCheckLocalServiceHealthBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/health-bootstrap-service-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-health-bootstrap",
		Engine:       "localai",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetModel().GetLocalModelId(),
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
	if mgr.lastStartEngine != "localai" {
		t.Fatalf("expected engine localai, got %q", mgr.lastStartEngine)
	}
	if mgr.lastStartPort != 8080 {
		t.Fatalf("expected bootstrap port 8080, got %d", mgr.lastStartPort)
	}
}

func TestLocalRuntimeCheckLocalModelHealthUnhealthyPathBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/health-unhealthy-bootstrap-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	localModelID := installed.GetModel().GetLocalModelId()
	if _, err := svc.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE, "model active"); err != nil {
		t.Fatalf("promote model to active: %v", err)
	}
	if _, err := svc.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, "model unhealthy"); err != nil {
		t.Fatalf("promote model to unhealthy: %v", err)
	}

	resp, err := svc.CheckLocalModelHealth(context.Background(), &runtimev1.CheckLocalModelHealthRequest{
		LocalModelId: localModelID,
	})
	if err != nil {
		t.Fatalf("check local model health: %v", err)
	}
	if len(resp.GetModels()) != 1 {
		t.Fatalf("expected one model row, got %d", len(resp.GetModels()))
	}
	if resp.GetModels()[0].GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
		t.Fatalf("expected UNHEALTHY before recovery threshold, got %s", resp.GetModels()[0].GetStatus())
	}
	if mgr.startCalls != 1 {
		t.Fatalf("expected one bootstrap start call, got %d", mgr.startCalls)
	}
}

func TestLocalRuntimeCheckLocalServiceHealthUnhealthyPathBootstrapsManagedEngine(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/health-unhealthy-bootstrap-service-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-health-unhealthy-bootstrap",
		Engine:       "localai",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetModel().GetLocalModelId(),
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

func TestSearchCatalogModelsMergesVerifiedAndHuggingFaceSorted(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return []*runtimev1.LocalCatalogModelDescriptor{
			{
				ItemId:       "hf_zeta_model",
				Source:       "huggingface",
				Title:        "Zeta Model",
				ModelId:      "org/zeta-model",
				Repo:         "org/zeta-model",
				Capabilities: []string{"chat"},
				Engine:       "localai",
				Verified:     false,
			},
			{
				ItemId:       "hf_alpha_model",
				Source:       "huggingface",
				Title:        "Alpha Community",
				ModelId:      "org/alpha-community",
				Repo:         "org/alpha-community",
				Capabilities: []string{"chat"},
				Engine:       "localai",
				Verified:     false,
			},
		}, nil
	}

	resp, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query: "",
	})
	if err != nil {
		t.Fatalf("search catalog models: %v", err)
	}
	if len(resp.GetItems()) < 4 {
		t.Fatalf("expected merged verified+hf items, got %d", len(resp.GetItems()))
	}
	if !resp.GetItems()[0].GetVerified() || !resp.GetItems()[1].GetVerified() {
		t.Fatalf("verified items must come first")
	}
	if resp.GetItems()[2].GetVerified() || resp.GetItems()[3].GetVerified() {
		t.Fatalf("hf items must follow verified items")
	}
	if resp.GetItems()[2].GetTitle() != "Alpha Community" || resp.GetItems()[3].GetTitle() != "Zeta Model" {
		t.Fatalf("hf items should sort by title asc, got [%s, %s]", resp.GetItems()[2].GetTitle(), resp.GetItems()[3].GetTitle())
	}
}

func TestSearchCatalogModelsDedupesByModelAndEngine(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return []*runtimev1.LocalCatalogModelDescriptor{
			{
				ItemId:       "hf_dup_llama",
				Source:       "huggingface",
				Title:        "Community Llama Dup",
				ModelId:      "local/llama3.1",
				Repo:         "nimiplatform/llama3.1-8b-instruct",
				Capabilities: []string{"chat"},
				Engine:       "localai",
				Verified:     false,
			},
		}, nil
	}

	resp, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{})
	if err != nil {
		t.Fatalf("search catalog models: %v", err)
	}
	count := 0
	for _, item := range resp.GetItems() {
		if item.GetModelId() == "local/llama3.1" && strings.EqualFold(item.GetEngine(), "localai") {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected deduped model count=1 for local/llama3.1 localai, got %d", count)
	}
}

func TestSearchCatalogModelsHFFailureReturnsReasonCode(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return nil, fmt.Errorf("hf timeout")
	}

	_, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query: "llama",
	})
	if err == nil {
		t.Fatalf("expected hf search failure")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.Unavailable {
		t.Fatalf("expected Unavailable, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED.String() {
		t.Fatalf("unexpected reason code: %s", st.Message())
	}
}

func TestSearchCatalogModelsInvalidHFRepoQueryReturnsReasonCode(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = defaultHFCatalogSearch

	_, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query: "hf://invalid_repo_format",
	})
	if err == nil {
		t.Fatalf("expected invalid hf repo error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_HF_REPO_INVALID.String() {
		t.Fatalf("unexpected reason code: %s", st.Message())
	}
}

func TestSearchCatalogModelsPassesHFRequestShape(t *testing.T) {
	svc := newTestService(t)
	captured := hfCatalogSearchRequest{}
	svc.hfCatalogSearch = func(_ context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		captured = req
		return []*runtimev1.LocalCatalogModelDescriptor{}, nil
	}

	if _, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query:        "Llama",
		Capability:   "image",
		EngineFilter: "nexa",
		Limit:        7,
	}); err != nil {
		t.Fatalf("search catalog models: %v", err)
	}

	if captured.Query != "llama" {
		t.Fatalf("query should be normalized to lowercase, got %q", captured.Query)
	}
	if captured.Capability != "image" {
		t.Fatalf("capability mismatch: %q", captured.Capability)
	}
	if captured.EngineFilter != "nexa" {
		t.Fatalf("engine filter mismatch: %q", captured.EngineFilter)
	}
	if captured.Limit != 7 {
		t.Fatalf("hf limit mismatch: got=%d want=7", captured.Limit)
	}
}

func TestLocalRuntimeRecoverySweepPromotesUnhealthyModel(t *testing.T) {
	healthy := false
	svc := newTestServiceWithProbe(t, func(_ context.Context, _ string) endpointProbeResult {
		if healthy {
			return endpointProbeResult{healthy: true, detail: "ok"}
		}
		return endpointProbeResult{healthy: false, detail: "startup failed"}
	})
	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/recovery-sweep-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	localModelID := installed.GetModel().GetLocalModelId()
	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{
		LocalModelId: localModelID,
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy after startup failure, got %s", started.GetModel().GetStatus())
	}

	healthy = true
	for i := 1; i <= 2; i++ {
		svc.mu.Lock()
		state := svc.modelProbeState[localModelID]
		if state == nil {
			t.Fatalf("expected model probe state to exist")
		}
		state.lastProbeAt = time.Now().UTC().Add(-localRecoveryDefaultProbeInterval)
		svc.mu.Unlock()
		svc.runRecoverySweep(context.Background())

		current := svc.modelByID(localModelID)
		if current == nil {
			t.Fatalf("model should still exist")
		}
		if current.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
			t.Fatalf("recovery sweep #%d should keep UNHEALTHY before threshold, got %s", i, current.GetStatus())
		}
	}

	svc.mu.Lock()
	state := svc.modelProbeState[localModelID]
	if state == nil {
		svc.mu.Unlock()
		t.Fatalf("expected model probe state to exist before final sweep")
	}
	state.lastProbeAt = time.Now().UTC().Add(-localRecoveryDefaultProbeInterval)
	svc.mu.Unlock()
	svc.runRecoverySweep(context.Background())

	current := svc.modelByID(localModelID)
	if current == nil {
		t.Fatalf("model should still exist")
	}
	if current.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("expected ACTIVE after third successful recovery sweep, got %s", current.GetStatus())
	}
}

func TestLocalRuntimeRecoveryProbeIntervalBackoff(t *testing.T) {
	now := time.Now().UTC()
	if got := recoveryProbeInterval(now, &probeRecoveryState{
		consecutiveFailure: localRecoverySlowFailureThreshold,
		firstFailureAt:     now.Add(-2 * time.Hour),
		lastProbeAt:        now,
	}); got != localRecoverySlowProbeInterval {
		t.Fatalf("expected slow probe interval, got %s", got)
	}

	if got := recoveryProbeInterval(now, &probeRecoveryState{
		consecutiveFailure: localRecoverySlowFailureThreshold + 1000,
		firstFailureAt:     now.Add(-25 * time.Hour),
		lastProbeAt:        now,
	}); got != localRecoveryLongFailProbeInterval {
		t.Fatalf("expected long-fail probe interval, got %s", got)
	}
}

func TestLocalRuntimeResolveAndApplyDependencies(t *testing.T) {
	svc := newTestService(t)

	planResp, err := svc.ResolveDependencies(context.Background(), &runtimev1.ResolveDependenciesRequest{
		ModId:      "world.nimi.user-math-quiz",
		Capability: "chat",
		Dependencies: &runtimev1.LocalDependenciesDeclarationDescriptor{
			Required: []*runtimev1.LocalDependencyOptionDescriptor{
				{
					DependencyId: "dep.chat.model",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_MODEL,
					Capability:   "chat",
					ModelId:      "local/chat-default",
					Engine:       "localai",
				},
				{
					DependencyId: "dep.chat.service",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_SERVICE,
					Capability:   "chat",
					ModelId:      "local/chat-default",
					ServiceId:    "svc-chat",
					Engine:       "localai",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve dependencies: %v", err)
	}
	plan := planResp.GetPlan()
	if plan.GetPlanId() == "" {
		t.Fatalf("plan id must not be empty")
	}
	if len(plan.GetDependencies()) != 2 {
		t.Fatalf("resolved dependency count mismatch: got=%d want=2", len(plan.GetDependencies()))
	}

	applyResp, err := svc.ApplyDependencies(context.Background(), &runtimev1.ApplyDependenciesRequest{
		Plan: plan,
	})
	if err != nil {
		t.Fatalf("apply dependencies: %v", err)
	}
	result := applyResp.GetResult()
	if result.GetPlanId() != plan.GetPlanId() {
		t.Fatalf("applied plan mismatch: got=%q want=%q", result.GetPlanId(), plan.GetPlanId())
	}
	if len(result.GetInstalledModels()) != 1 {
		t.Fatalf("installed model count mismatch: got=%d want=1", len(result.GetInstalledModels()))
	}
	if len(result.GetServices()) != 1 {
		t.Fatalf("installed service count mismatch: got=%d want=1", len(result.GetServices()))
	}
	if len(result.GetCapabilities()) != 1 || result.GetCapabilities()[0] != "chat" {
		t.Fatalf("applied capabilities mismatch: %#v", result.GetCapabilities())
	}
	gotStages := make([]string, 0, len(result.GetStageResults()))
	for _, stage := range result.GetStageResults() {
		gotStages = append(gotStages, stage.GetStage())
		if !stage.GetOk() {
			t.Fatalf("unexpected failed stage in happy path: %s (%s)", stage.GetStage(), stage.GetReasonCode())
		}
	}
	wantStages := []string{applyStagePreflight, applyStageInstall, applyStageBootstrap, applyStageHealth}
	if strings.Join(gotStages, ",") != strings.Join(wantStages, ",") {
		t.Fatalf("unexpected stage order: got=%v want=%v", gotStages, wantStages)
	}
	if result.GetRollbackApplied() {
		t.Fatalf("happy path apply must not set rollback_applied")
	}
}

func TestLocalRuntimeAuditFilterByModID(t *testing.T) {
	svc := newTestService(t)

	if _, err := svc.AppendInferenceAudit(context.Background(), &runtimev1.AppendInferenceAuditRequest{
		EventType: "inference_invoked",
		ModId:     "world.nimi.user-math-quiz",
		Source:    "local-runtime",
		Provider:  "localai",
		Modality:  "chat",
		Adapter:   "openai_compat_adapter",
		Model:     "local/chat-default",
	}); err != nil {
		t.Fatalf("append inference audit: %v", err)
	}

	if _, err := svc.AppendRuntimeAudit(context.Background(), &runtimev1.AppendRuntimeAuditRequest{
		EventType: "runtime_model_ready_after_install",
		ModelId:   "local/chat-default",
	}); err != nil {
		t.Fatalf("append runtime audit: %v", err)
	}

	filtered, err := svc.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{
		ModId: "world.nimi.user-math-quiz",
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("list local audits by mod id: %v", err)
	}
	if len(filtered.GetEvents()) != 1 {
		t.Fatalf("filtered events mismatch: got=%d want=1", len(filtered.GetEvents()))
	}
	if filtered.GetEvents()[0].GetEventType() != "inference_invoked" {
		t.Fatalf("unexpected filtered event type: %s", filtered.GetEvents()[0].GetEventType())
	}
}

func TestLocalRuntimeAuditContextEnvelopeAndFilters(t *testing.T) {
	svc := newTestService(t)

	ctx := authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "subject-ctx"})
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-nimi-trace-id", "trace-local-audit-ctx",
		"x-nimi-app-id", "app.ctx",
		"x-nimi-domain", "runtime.local_runtime",
	))

	if _, err := svc.AppendInferenceAudit(ctx, &runtimev1.AppendInferenceAuditRequest{
		EventType: "ctx_audit",
		Source:    "local-runtime",
		Model:     "local/ctx-model",
	}); err != nil {
		t.Fatalf("append inference audit: %v", err)
	}

	filtered, err := svc.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{
		EventType:     "ctx_audit",
		AppId:         "app.ctx",
		SubjectUserId: "subject-ctx",
		PageSize:      10,
	})
	if err != nil {
		t.Fatalf("list local audits with app/subject filter: %v", err)
	}
	if len(filtered.GetEvents()) != 1 {
		t.Fatalf("expected exactly one filtered event, got %d", len(filtered.GetEvents()))
	}
	event := filtered.GetEvents()[0]
	if event.GetTraceId() != "trace-local-audit-ctx" {
		t.Fatalf("unexpected trace_id: %s", event.GetTraceId())
	}
	if event.GetAppId() != "app.ctx" {
		t.Fatalf("unexpected app_id: %s", event.GetAppId())
	}
	if event.GetDomain() != "runtime.local_runtime" {
		t.Fatalf("unexpected domain: %s", event.GetDomain())
	}
	if event.GetOperation() != "append_inference_audit" {
		t.Fatalf("unexpected operation: %s", event.GetOperation())
	}
	if event.GetSubjectUserId() != "subject-ctx" {
		t.Fatalf("unexpected subject_user_id: %s", event.GetSubjectUserId())
	}
}

func TestLocalRuntimeNodeCatalogFiltersByCapabilityAndProvider(t *testing.T) {
	svc := newTestService(t)

	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/vision-chat-model",
		Capabilities: []string{"image", "chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	installed, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-vision",
		Title:        "Vision Service",
		Engine:       "localai",
		Capabilities: []string{"image", "chat"},
		LocalModelId: modelResp.GetModel().GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if installed.GetService().GetServiceId() != "svc-vision" {
		t.Fatalf("service id mismatch: %s", installed.GetService().GetServiceId())
	}
	if _, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-vision",
	}); err != nil {
		t.Fatalf("start local service: %v", err)
	}

	nodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		Capability: "image",
		Provider:   "localai",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(nodesResp.GetNodes()) != 1 {
		t.Fatalf("node count mismatch: got=%d want=1", len(nodesResp.GetNodes()))
	}
	node := nodesResp.GetNodes()[0]
	if node.GetServiceId() != "svc-vision" {
		t.Fatalf("node service id mismatch: %s", node.GetServiceId())
	}
	if !strings.HasPrefix(node.GetNodeId(), "svc-vision:") {
		t.Fatalf("node id should use <service_id>:<capability>, got: %s", node.GetNodeId())
	}
	if node.GetAdapter() != "localai_native_adapter" {
		t.Fatalf("localai image adapter mismatch: %s", node.GetAdapter())
	}
	if !node.GetAvailable() {
		t.Fatalf("node must be available before removal")
	}
	if node.GetProviderHints() == nil || node.GetProviderHints().GetLocalai() == nil {
		t.Fatalf("localai image node must include provider hints")
	}
	if node.GetProviderHints().GetLocalai().GetPreferredAdapter() != "localai_native_adapter" {
		t.Fatalf("localai image preferred adapter mismatch: %s", node.GetProviderHints().GetLocalai().GetPreferredAdapter())
	}
	if node.GetProviderHints().GetLocalai().GetStablediffusionPipeline() == "" {
		t.Fatalf("localai image provider hints should include stablediffusion pipeline")
	}
	if node.GetProviderHints().GetExtra()["service_id"] != "svc-vision" {
		t.Fatalf("provider hints extra.service_id mismatch: %s", node.GetProviderHints().GetExtra()["service_id"])
	}

	chatNodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		Capability: "chat",
		Provider:   "localai",
	})
	if err != nil {
		t.Fatalf("list chat node catalog: %v", err)
	}
	if len(chatNodesResp.GetNodes()) != 1 {
		t.Fatalf("chat node count mismatch: got=%d want=1", len(chatNodesResp.GetNodes()))
	}
	chatNode := chatNodesResp.GetNodes()[0]
	if chatNode.GetAdapter() != "openai_compat_adapter" {
		t.Fatalf("localai chat adapter mismatch: %s", chatNode.GetAdapter())
	}
	if chatNode.GetProviderHints() == nil || chatNode.GetProviderHints().GetLocalai() == nil {
		t.Fatalf("localai chat node must include provider hints")
	}
	if chatNode.GetProviderHints().GetLocalai().GetPreferredAdapter() != "openai_compat_adapter" {
		t.Fatalf("localai chat preferred adapter mismatch: %s", chatNode.GetProviderHints().GetLocalai().GetPreferredAdapter())
	}

	if _, err := svc.RemoveLocalService(context.Background(), &runtimev1.RemoveLocalServiceRequest{
		ServiceId: "svc-vision",
	}); err != nil {
		t.Fatalf("remove local service: %v", err)
	}

	nodesAfterRemove, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		ServiceId: "svc-vision",
	})
	if err != nil {
		t.Fatalf("list node catalog after remove: %v", err)
	}
	if len(nodesAfterRemove.GetNodes()) != 0 {
		t.Fatalf("removed/inactive services must not appear in node catalog")
	}
}

func TestLocalRuntimeNodeCatalogSortsByTypeThenNodeID(t *testing.T) {
	svc := newTestService(t)

	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/sort-catalog-model",
		Capabilities: []string{"chat", "image"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-sort",
		Title:        "Sort Service",
		Engine:       "localai",
		Capabilities: []string{"chat", "image"},
		LocalModelId: modelResp.GetModel().GetLocalModelId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if _, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-sort",
	}); err != nil {
		t.Fatalf("start local service: %v", err)
	}

	resp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		ServiceId: "svc-sort",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(resp.GetNodes()) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(resp.GetNodes()))
	}

	first := resp.GetNodes()[0]
	second := resp.GetNodes()[1]
	if first.GetAdapter() != "localai_native_adapter" || second.GetAdapter() != "openai_compat_adapter" {
		t.Fatalf("node catalog must sort by node type(adapter) before node id, got adapters: %s, %s", first.GetAdapter(), second.GetAdapter())
	}
	if len(first.GetCapabilities()) == 0 || first.GetCapabilities()[0] != "image" {
		t.Fatalf("expected image node first, got capabilities: %#v", first.GetCapabilities())
	}
	if len(second.GetCapabilities()) == 0 || second.GetCapabilities()[0] != "chat" {
		t.Fatalf("expected chat node second, got capabilities: %#v", second.GetCapabilities())
	}
}

func TestLocalRuntimeNodeCatalogNexaVideoFailClose(t *testing.T) {
	svc := newTestService(t)

	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/nexa-video-chat-model",
		Capabilities: []string{"video", "chat"},
		Engine:       "nexa",
		Endpoint:     "http://127.0.0.1:17881/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-nexa",
		Title:        "Nexa Service",
		Engine:       "nexa",
		Capabilities: []string{"video", "chat"},
		LocalModelId: modelResp.GetModel().GetLocalModelId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if _, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-nexa",
	}); err != nil {
		t.Fatalf("start local service: %v", err)
	}

	nodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		Provider: "nexa",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(nodesResp.GetNodes()) != 2 {
		t.Fatalf("node count mismatch: got=%d want=2", len(nodesResp.GetNodes()))
	}

	var videoNode *runtimev1.LocalNodeDescriptor
	var chatNode *runtimev1.LocalNodeDescriptor
	for _, item := range nodesResp.GetNodes() {
		if len(item.GetCapabilities()) == 0 {
			continue
		}
		switch item.GetCapabilities()[0] {
		case "video":
			videoNode = item
		case "chat":
			chatNode = item
		}
	}
	if videoNode == nil || chatNode == nil {
		t.Fatalf("expected both video/chat nodes in catalog")
	}
	if videoNode.GetAdapter() != "nexa_native_adapter" {
		t.Fatalf("video adapter mismatch: %s", videoNode.GetAdapter())
	}
	if videoNode.GetAvailable() {
		t.Fatalf("nexa video node must be fail-close unavailable")
	}
	if videoNode.GetReasonCode() != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String() {
		t.Fatalf("nexa video reason code mismatch: %s", videoNode.GetReasonCode())
	}
	if videoNode.GetPolicyGate() == "" {
		t.Fatalf("nexa video policy gate should be set")
	}
	if videoNode.GetProviderHints() == nil || videoNode.GetProviderHints().GetNexa() == nil {
		t.Fatalf("nexa video node should include provider hints")
	}
	videoHints := videoNode.GetProviderHints().GetNexa()
	if videoHints.GetPreferredAdapter() != "nexa_native_adapter" {
		t.Fatalf("nexa video preferred adapter mismatch: %s", videoHints.GetPreferredAdapter())
	}
	if videoHints.GetPolicyGate() != videoNode.GetPolicyGate() {
		t.Fatalf("nexa video policy gate mismatch: node=%s hints=%s", videoNode.GetPolicyGate(), videoHints.GetPolicyGate())
	}
	if videoHints.GetNpuMode() == "" {
		t.Fatalf("nexa video npu mode must not be empty")
	}
	if videoHints.GetPolicyGate() != "" && videoHints.GetPolicyGateAllowsNpu() {
		t.Fatalf("nexa video policy gate should disable policyGateAllowsNpu")
	}
	if videoHints.GetPolicyGate() != "" && videoHints.GetNpuUsable() {
		t.Fatalf("nexa video policy gate should disable npuUsable")
	}
	if !chatNode.GetAvailable() {
		t.Fatalf("nexa chat node should remain available")
	}
	if chatNode.GetProviderHints() == nil || chatNode.GetProviderHints().GetNexa() == nil {
		t.Fatalf("nexa chat node should include provider hints")
	}
	chatHints := chatNode.GetProviderHints().GetNexa()
	if chatHints.GetPreferredAdapter() != "nexa_native_adapter" {
		t.Fatalf("nexa chat preferred adapter mismatch: %s", chatHints.GetPreferredAdapter())
	}
	if !chatHints.GetHostNpuReady() && chatHints.GetNpuUsable() {
		t.Fatalf("nexa chat npuUsable cannot be true when host_npu_ready=false")
	}
}

func TestLocalRuntimeNodeCatalogCustomMissingProfileIsUnavailable(t *testing.T) {
	svc := newTestService(t)

	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "custom-node-model",
		Engine:       "localai",
		Capabilities: []string{"custom"},
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-custom",
		Title:        "Custom Service",
		Engine:       "localai",
		Capabilities: []string{"custom"},
		LocalModelId: modelResp.GetModel().GetLocalModelId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if _, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-custom",
	}); err != nil {
		t.Fatalf("start local service: %v", err)
	}

	nodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		ServiceId: "svc-custom",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(nodesResp.GetNodes()) != 1 {
		t.Fatalf("node count mismatch: got=%d want=1", len(nodesResp.GetNodes()))
	}
	node := nodesResp.GetNodes()[0]
	if node.GetAvailable() {
		t.Fatalf("custom node without local_invoke_profile_id must be unavailable")
	}
	if node.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING.String() {
		t.Fatalf("unexpected reason code: %s", node.GetReasonCode())
	}
	if node.GetPolicyGate() != "custom.invoke_profile.missing" {
		t.Fatalf("unexpected policy gate: %s", node.GetPolicyGate())
	}
}

func TestLocalRuntimeCollectDeviceProfileUsesRealProbe(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.CollectDeviceProfile(context.Background(), &runtimev1.CollectDeviceProfileRequest{})
	if err != nil {
		t.Fatalf("collect device profile: %v", err)
	}
	profile := resp.GetProfile()
	if profile.GetOs() == "" || profile.GetArch() == "" {
		t.Fatalf("device profile must include os/arch: %#v", profile)
	}
	if len(profile.GetPorts()) == 0 {
		t.Fatalf("device profile must include port probe results")
	}
}

func TestLocalRuntimeResolveDependenciesFailsOnInvalidRequired(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.ResolveDependencies(context.Background(), &runtimev1.ResolveDependenciesRequest{
		ModId:      "world.nimi.invalid-required",
		Capability: "chat",
		Dependencies: &runtimev1.LocalDependenciesDeclarationDescriptor{
			Required: []*runtimev1.LocalDependencyOptionDescriptor{
				{
					DependencyId: "dep.invalid.service",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_SERVICE,
					Capability:   "chat",
					Engine:       "localai",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve dependencies: %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetReasonCode() != "LOCAL_DEPENDENCY_REQUIRED_UNSATISFIED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
	if len(plan.GetDependencies()) != 1 || plan.GetDependencies()[0].GetSelected() {
		t.Fatalf("required dependency should be rejected: %#v", plan.GetDependencies())
	}
}

func TestLocalRuntimeResolveDependenciesRejectsWorkflowKind(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.ResolveDependencies(context.Background(), &runtimev1.ResolveDependenciesRequest{
		ModId:      "world.nimi.invalid-workflow-kind",
		Capability: "chat",
		Dependencies: &runtimev1.LocalDependenciesDeclarationDescriptor{
			Required: []*runtimev1.LocalDependencyOptionDescriptor{
				{
					DependencyId: "dep.invalid.workflow",
					Kind:         runtimev1.LocalDependencyKind(4),
					Capability:   "chat",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve dependencies: %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetReasonCode() != "LOCAL_DEPENDENCY_REQUIRED_UNSATISFIED" {
		t.Fatalf("unexpected plan reason code: %s", plan.GetReasonCode())
	}
	if len(plan.GetDependencies()) != 1 {
		t.Fatalf("resolved dependency count mismatch: got=%d want=1", len(plan.GetDependencies()))
	}
	dependency := plan.GetDependencies()[0]
	if dependency.GetSelected() {
		t.Fatalf("unsupported workflow kind must not be selected")
	}
	if dependency.GetReasonCode() != "LOCAL_DEPENDENCY_KIND_UNSUPPORTED" {
		t.Fatalf("unexpected dependency reason code: %s", dependency.GetReasonCode())
	}
}

func TestLocalRuntimeApplyDependenciesShortCircuitsOnPreflight(t *testing.T) {
	svc := newTestService(t)
	result, err := svc.ApplyDependencies(context.Background(), &runtimev1.ApplyDependenciesRequest{
		Plan: &runtimev1.LocalDependencyResolutionPlan{
			PlanId: "dep-plan-preflight",
			ModId:  "world.nimi.preflight-fail",
			Dependencies: []*runtimev1.LocalDependencyDescriptor{
				{
					DependencyId: "dep.python-required",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_MODEL,
					Selected:     true,
					Required:     true,
					ModelId:      "local/python-model",
					Capability:   "chat",
					Engine:       "python-runtime",
				},
			},
			DeviceProfile: &runtimev1.LocalDeviceProfile{
				Os:   "darwin",
				Arch: "arm64",
				Python: &runtimev1.LocalPythonProfile{
					Available: false,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("apply dependencies: %v", err)
	}
	if result.GetResult().GetReasonCode() != "LOCAL_DEPENDENCY_PYTHON_REQUIRED" {
		t.Fatalf("unexpected reason code: %s", result.GetResult().GetReasonCode())
	}
	if len(result.GetResult().GetInstalledModels()) != 0 || len(result.GetResult().GetServices()) != 0 {
		t.Fatalf("preflight failure should block install stage")
	}
}

func TestLocalRuntimeApplyDependenciesFailsWhenNodeUnresolved(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.ApplyDependencies(context.Background(), &runtimev1.ApplyDependenciesRequest{
		Plan: &runtimev1.LocalDependencyResolutionPlan{
			PlanId: "dep-plan-node-missing",
			ModId:  "world.nimi.node-missing",
			Dependencies: []*runtimev1.LocalDependencyDescriptor{
				{
					DependencyId: "dep.node.chat",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_NODE,
					Selected:     true,
					Required:     true,
					Capability:   "chat",
					NodeId:       "node_missing_chat",
				},
			},
			DeviceProfile: &runtimev1.LocalDeviceProfile{
				Os:   "darwin",
				Arch: "arm64",
				Python: &runtimev1.LocalPythonProfile{
					Available: true,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("apply dependencies: %v", err)
	}
	result := resp.GetResult()
	if result.GetReasonCode() != "LOCAL_DEPENDENCY_NODE_UNRESOLVED" {
		t.Fatalf("unexpected reason code: %s", result.GetReasonCode())
	}
	if len(result.GetStageResults()) == 0 || result.GetStageResults()[0].GetReasonCode() != "LOCAL_DEPENDENCY_NODE_UNRESOLVED" {
		t.Fatalf("preflight stage must expose node unresolved reason code")
	}
}

func TestLocalRuntimeApplyDependenciesPassesWhenNodeResolved(t *testing.T) {
	svc := newTestService(t)

	modelResp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/node-chat-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-node-chat",
		Title:        "Node Chat Service",
		Engine:       "localai",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetModel().GetLocalModelId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if _, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-node-chat",
	}); err != nil {
		t.Fatalf("start local service: %v", err)
	}

	nodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		ServiceId: "svc-node-chat",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(nodesResp.GetNodes()) == 0 {
		t.Fatalf("expected node catalog entry for active service")
	}
	nodeID := nodesResp.GetNodes()[0].GetNodeId()

	resp, err := svc.ApplyDependencies(context.Background(), &runtimev1.ApplyDependenciesRequest{
		Plan: &runtimev1.LocalDependencyResolutionPlan{
			PlanId: "dep-plan-node-ready",
			ModId:  "world.nimi.node-ready",
			Dependencies: []*runtimev1.LocalDependencyDescriptor{
				{
					DependencyId: "dep.node.chat",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_NODE,
					Selected:     true,
					Required:     true,
					Capability:   "chat",
					ServiceId:    "svc-node-chat",
					NodeId:       nodeID,
				},
			},
			DeviceProfile: &runtimev1.LocalDeviceProfile{
				Os:   "darwin",
				Arch: "arm64",
				Python: &runtimev1.LocalPythonProfile{
					Available: true,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("apply dependencies: %v", err)
	}
	result := resp.GetResult()
	if result.GetReasonCode() != "ACTION_EXECUTED" {
		t.Fatalf("unexpected reason code: %s", result.GetReasonCode())
	}
	if len(result.GetInstalledModels()) != 0 || len(result.GetServices()) != 0 {
		t.Fatalf("node-only apply must not install model/service artifacts")
	}
}

func TestLocalRuntimeInstallLocalModelRejectsDuplicateAndUsesULID(t *testing.T) {
	svc := newTestService(t)
	first, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId: "local/dup-model",
		Engine:  "localai",
	})
	if err != nil {
		t.Fatalf("install first local model: %v", err)
	}
	if _, parseErr := ulid.Parse(first.GetModel().GetLocalModelId()); parseErr != nil {
		t.Fatalf("local_model_id must be pure ULID: %v", parseErr)
	}

	_, err = svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId: "local/dup-model",
		Engine:  "localai",
	})
	if err == nil {
		t.Fatalf("expected duplicate install to fail")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_MODEL_ALREADY_INSTALLED.String() {
		t.Fatalf("expected AI_LOCAL_MODEL_ALREADY_INSTALLED, got %s", st.Message())
	}
}

func TestLocalRuntimeInstallLocalModelRequiresEndpointForNexa(t *testing.T) {
	svc := newTestService(t)
	_, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId: "local/nexa-model",
		Engine:  "nexa",
	})
	if err == nil {
		t.Fatalf("expected nexa endpoint required error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String() {
		t.Fatalf("expected AI_LOCAL_ENDPOINT_REQUIRED, got %s", st.Message())
	}
}

func TestLocalRuntimeInstallLocalServiceRequiresExistingLocalModel(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId: "svc-missing-model",
		Engine:    "localai",
	})
	if err == nil {
		t.Fatalf("expected missing local_model_id to fail")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE, got %s", st.Message())
	}

	_, err = svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-model-not-found",
		Engine:       "localai",
		LocalModelId: "01J00000000000000000000000",
	})
	if err == nil {
		t.Fatalf("expected unknown local_model_id to fail")
	}
	st, _ = status.FromError(err)
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE, got %s", st.Message())
	}
}

func TestLocalRuntimeInstallLocalServiceEnforcesModelServiceOneToOne(t *testing.T) {
	svc := newTestService(t)

	model1, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/service-bind-1",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install model1: %v", err)
	}
	model2, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/service-bind-2",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install model2: %v", err)
	}

	first, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-bind-1",
		Engine:       "localai",
		LocalModelId: model1.GetModel().GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("install first service: %v", err)
	}
	if first.GetService().GetLocalModelId() != model1.GetModel().GetLocalModelId() {
		t.Fatalf("service local_model_id mismatch")
	}

	secondTry, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-bind-2",
		Engine:       "localai",
		LocalModelId: model1.GetModel().GetLocalModelId(),
	})
	if err == nil {
		t.Fatalf("expected second service for same model to fail")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_MODEL_ALREADY_INSTALLED.String() {
		t.Fatalf("expected AI_LOCAL_MODEL_ALREADY_INSTALLED, got %s", st.Message())
	}
	if secondTry != nil {
		t.Fatalf("second install response must be nil on conflict")
	}

	_, err = svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-bind-1",
		Engine:       "localai",
		LocalModelId: model2.GetModel().GetLocalModelId(),
	})
	if err == nil {
		t.Fatalf("expected rebinding existing service to another model to fail")
	}
	st, _ = status.FromError(err)
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists for rebinding, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_MODEL_ALREADY_INSTALLED.String() {
		t.Fatalf("expected AI_LOCAL_MODEL_ALREADY_INSTALLED for rebinding, got %s", st.Message())
	}
}

func TestLocalRuntimeListLocalModelsSortByCategoryThenModelID(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "z-chat",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install chat model: %v", err)
	}
	_, err = svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "a-custom",
		Capabilities: []string{"custom"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install custom model: %v", err)
	}
	_, err = svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "a-chat",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install second chat model: %v", err)
	}

	resp, err := svc.ListLocalModels(context.Background(), &runtimev1.ListLocalModelsRequest{})
	if err != nil {
		t.Fatalf("list local models: %v", err)
	}
	if len(resp.GetModels()) != 3 {
		t.Fatalf("expected 3 models, got %d", len(resp.GetModels()))
	}
	if resp.GetModels()[0].GetModelId() != "a-custom" {
		t.Fatalf("expected custom category first, got %s", resp.GetModels()[0].GetModelId())
	}
	if resp.GetModels()[1].GetModelId() != "a-chat" || resp.GetModels()[2].GetModelId() != "z-chat" {
		t.Fatalf("expected llm models ordered by model_id asc, got [%s, %s]", resp.GetModels()[1].GetModelId(), resp.GetModels()[2].GetModelId())
	}
}

func TestLocalRuntimeListLocalServicesSortByServiceID(t *testing.T) {
	svc := newTestService(t)

	modelA, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/service-sort-a",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install modelA: %v", err)
	}
	modelB, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/service-sort-b",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install modelB: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-z",
		Engine:       "localai",
		LocalModelId: modelA.GetModel().GetLocalModelId(),
	}); err != nil {
		t.Fatalf("install svc-z: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-a",
		Engine:       "localai",
		LocalModelId: modelB.GetModel().GetLocalModelId(),
	}); err != nil {
		t.Fatalf("install svc-a: %v", err)
	}

	resp, err := svc.ListLocalServices(context.Background(), &runtimev1.ListLocalServicesRequest{})
	if err != nil {
		t.Fatalf("list local services: %v", err)
	}
	if len(resp.GetServices()) != 2 {
		t.Fatalf("expected 2 services, got %d", len(resp.GetServices()))
	}
	if resp.GetServices()[0].GetServiceId() != "svc-a" || resp.GetServices()[1].GetServiceId() != "svc-z" {
		t.Fatalf("services should be sorted by service_id asc, got [%s, %s]", resp.GetServices()[0].GetServiceId(), resp.GetServices()[1].GetServiceId())
	}
}

func TestLocalRuntimeRemoveModelRejectedWhenServiceBound(t *testing.T) {
	svc := newTestService(t)

	model, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/remove-guard",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install model: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-remove-guard",
		Engine:       "localai",
		LocalModelId: model.GetModel().GetLocalModelId(),
	}); err != nil {
		t.Fatalf("install service: %v", err)
	}

	_, err = svc.RemoveLocalModel(context.Background(), &runtimev1.RemoveLocalModelRequest{
		LocalModelId: model.GetModel().GetLocalModelId(),
	})
	if err == nil {
		t.Fatalf("expected remove model to fail while service is bound")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION.String() {
		t.Fatalf("expected AI_LOCAL_MODEL_INVALID_TRANSITION, got %s", st.Message())
	}
}

func TestLocalRuntimeResolveDependenciesRejectsServiceWithoutModelID(t *testing.T) {
	svc := newTestService(t)

	resp, err := svc.ResolveDependencies(context.Background(), &runtimev1.ResolveDependenciesRequest{
		ModId:      "world.nimi.service-without-model",
		Capability: "chat",
		Dependencies: &runtimev1.LocalDependenciesDeclarationDescriptor{
			Required: []*runtimev1.LocalDependencyOptionDescriptor{
				{
					DependencyId: "dep.chat.service",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_SERVICE,
					ServiceId:    "svc-chat",
					Capability:   "chat",
					Engine:       "localai",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve dependencies: %v", err)
	}
	if resp.GetPlan().GetReasonCode() != "LOCAL_DEPENDENCY_REQUIRED_UNSATISFIED" {
		t.Fatalf("unexpected reason code: %s", resp.GetPlan().GetReasonCode())
	}
	if len(resp.GetPlan().GetDependencies()) != 1 {
		t.Fatalf("expected one dependency in plan")
	}
	dep := resp.GetPlan().GetDependencies()[0]
	if dep.GetSelected() {
		t.Fatalf("service dependency without modelId must not be selected")
	}
	if dep.GetReasonCode() != "LOCAL_DEPENDENCY_MODEL_ID_REQUIRED" {
		t.Fatalf("unexpected dependency reason code: %s", dep.GetReasonCode())
	}
}

func TestLocalRuntimeInstallVerifiedModelTemplateNotFound(t *testing.T) {
	svc := newTestService(t)
	_, err := svc.InstallVerifiedModel(context.Background(), &runtimev1.InstallVerifiedModelRequest{
		TemplateId: "verified.missing-template",
	})
	if err == nil {
		t.Fatalf("expected missing template error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND.String() {
		t.Fatalf("expected AI_LOCAL_TEMPLATE_NOT_FOUND, got %s", st.Message())
	}
}

func TestLocalRuntimeImportManifestValidation(t *testing.T) {
	svc := newTestService(t)
	tmpDir := t.TempDir()

	invalidPath := filepath.Join(tmpDir, "invalid.json")
	if err := os.WriteFile(invalidPath, []byte("{not-json"), 0o600); err != nil {
		t.Fatalf("write invalid manifest: %v", err)
	}
	_, err := svc.ImportLocalModel(context.Background(), &runtimev1.ImportLocalModelRequest{ManifestPath: invalidPath})
	if err == nil {
		t.Fatalf("expected invalid manifest parse error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID.String() {
		t.Fatalf("unexpected invalid manifest error: %v", err)
	}

	schemaInvalidPath := filepath.Join(tmpDir, "schema-invalid.json")
	if err := os.WriteFile(schemaInvalidPath, []byte(`{"model_id":"local/test","engine":"localai","capabilities":"chat"}`), 0o600); err != nil {
		t.Fatalf("write schema invalid manifest: %v", err)
	}
	_, err = svc.ImportLocalModel(context.Background(), &runtimev1.ImportLocalModelRequest{ManifestPath: schemaInvalidPath})
	if err == nil {
		t.Fatalf("expected schema invalid manifest error")
	}
	st, _ = status.FromError(err)
	if st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID.String() {
		t.Fatalf("unexpected schema invalid manifest error: %v", err)
	}

	validPath := filepath.Join(tmpDir, "valid.json")
	validManifest := map[string]any{
		"model_id":                "local/import-manifest-ok",
		"engine":                  "localai",
		"capabilities":            []string{"chat"},
		"entry":                   "./dist/index.js",
		"local_invoke_profile_id": "profile-chat-default",
		"source": map[string]any{
			"repo":     "nimiplatform/import-model",
			"revision": "main",
		},
	}
	validRaw, _ := json.Marshal(validManifest)
	if err := os.WriteFile(validPath, validRaw, 0o600); err != nil {
		t.Fatalf("write valid manifest: %v", err)
	}
	resp, err := svc.ImportLocalModel(context.Background(), &runtimev1.ImportLocalModelRequest{ManifestPath: validPath})
	if err != nil {
		t.Fatalf("import valid manifest: %v", err)
	}
	if resp.GetModel().GetLocalInvokeProfileId() != "profile-chat-default" {
		t.Fatalf("local_invoke_profile_id should be imported from manifest")
	}
}

func TestLocalRuntimeCollectDeviceProfileIncludesExtraPorts(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.CollectDeviceProfile(context.Background(), &runtimev1.CollectDeviceProfileRequest{
		ExtraPorts: []int32{9999, 1234, -1, 70000},
	})
	if err != nil {
		t.Fatalf("collect profile with extra ports: %v", err)
	}
	found9999 := false
	for _, item := range resp.GetProfile().GetPorts() {
		if item.GetPort() == 9999 {
			found9999 = true
			break
		}
	}
	if !found9999 {
		t.Fatalf("extra port 9999 should be included in probe result")
	}
}

func TestResolveModelInstallPlanManualAddsDeviceWarnings(t *testing.T) {
	svc := newTestService(t)
	t.Setenv("NIMI_RUNTIME_NPU_AVAILABLE", "0")
	t.Setenv("NIMI_RUNTIME_NPU_READY", "0")

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ModelId:  "local/npu-model",
		Engine:   "npu-accelerated-engine",
		Endpoint: "http://127.0.0.1:1234/v1",
	})
	if err != nil {
		t.Fatalf("resolve model install plan: %v", err)
	}
	plan := resp.GetPlan()
	if !plan.GetInstallAvailable() {
		t.Fatalf("manual localai-like plan should remain installable with warnings")
	}
	if plan.GetReasonCode() != "ACTION_EXECUTED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
	found := false
	for _, warning := range plan.GetWarnings() {
		if warning == "WARN_NPU_REQUIRED" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected WARN_NPU_REQUIRED warning, got %#v", plan.GetWarnings())
	}
}

func TestResolveModelInstallPlanNexaEndpointRequired(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ModelId: "local/nexa-model",
		Engine:  "nexa",
	})
	if err != nil {
		t.Fatalf("resolve model install plan: %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetInstallAvailable() {
		t.Fatalf("nexa attached-endpoint plan without endpoint must be unavailable")
	}
	if plan.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String() {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
	if strings.TrimSpace(plan.GetEndpoint()) != "" {
		t.Fatalf("nexa endpoint should remain empty when not provided, got %q", plan.GetEndpoint())
	}
}

func TestResolveModelInstallPlanCatalogSupervisedRequiresEngineManager(t *testing.T) {
	svc := newTestService(t)
	svc.mu.Lock()
	svc.catalog = append(svc.catalog, &runtimev1.LocalCatalogModelDescriptor{
		ItemId:            "catalog.supervised.model",
		Source:            "verified",
		Title:             "Supervised Model",
		ModelId:           "local/supervised-model",
		Engine:            "localai",
		EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		InstallKind:       "download",
		Capabilities:      []string{"chat"},
	})
	svc.mu.Unlock()

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ItemId: "catalog.supervised.model",
	})
	if err != nil {
		t.Fatalf("resolve supervised plan: %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetInstallAvailable() {
		t.Fatalf("supervised plan without engine manager must be unavailable")
	}
	if plan.GetReasonCode() != "LOCAL_ENGINE_MANAGER_UNAVAILABLE" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
}

func TestResolveModelInstallPlanCatalogSupervisedWithManagerAvailable(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	svc.mu.Lock()
	svc.catalog = append(svc.catalog, &runtimev1.LocalCatalogModelDescriptor{
		ItemId:            "catalog.supervised.model.available",
		Source:            "verified",
		Title:             "Supervised Model Available",
		ModelId:           "local/supervised-model-available",
		Engine:            "localai",
		EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		InstallKind:       "download",
		Capabilities:      []string{"chat"},
	})
	svc.mu.Unlock()

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ItemId: "catalog.supervised.model.available",
	})
	if err != nil {
		t.Fatalf("resolve supervised plan with manager: %v", err)
	}
	plan := resp.GetPlan()
	if !plan.GetInstallAvailable() {
		t.Fatalf("supervised plan should be available when engine manager can resolve status")
	}
	if plan.GetReasonCode() != "ACTION_EXECUTED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
}

func TestLocalRuntimeApplyDependenciesRejectsUnsupportedKindInPreflight(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.ApplyDependencies(context.Background(), &runtimev1.ApplyDependenciesRequest{
		Plan: &runtimev1.LocalDependencyResolutionPlan{
			PlanId: "dep-plan-unsupported-kind",
			ModId:  "world.nimi.unsupported-kind",
			Dependencies: []*runtimev1.LocalDependencyDescriptor{
				{
					DependencyId: "dep.unsupported.kind",
					Kind:         runtimev1.LocalDependencyKind(99),
					Selected:     true,
					Required:     true,
				},
			},
			DeviceProfile: &runtimev1.LocalDeviceProfile{
				Os:   "darwin",
				Arch: "arm64",
				Python: &runtimev1.LocalPythonProfile{
					Available: true,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("apply dependencies: %v", err)
	}
	result := resp.GetResult()
	if result.GetReasonCode() != "LOCAL_DEPENDENCY_KIND_UNSUPPORTED" {
		t.Fatalf("unexpected reason code: %s", result.GetReasonCode())
	}
	if result.GetRollbackApplied() {
		t.Fatalf("preflight rejection must not apply rollback")
	}
}

func TestLocalRuntimeRollbackApplyCombinesReasonCodesOnRollbackFailure(t *testing.T) {
	svc := newTestService(t)
	result := &runtimev1.LocalDependencyApplyResult{
		ReasonCode: "LOCAL_DEPENDENCY_MODEL_HEALTH_FAILED",
	}

	svc.rollbackApply(context.Background(), []string{"local-model-missing"}, []string{"local-service-missing"}, result)

	if !result.GetRollbackApplied() {
		t.Fatalf("rollback_applied must be true when rollback is attempted")
	}
	if !strings.Contains(result.GetReasonCode(), "LOCAL_DEPENDENCY_MODEL_HEALTH_FAILED") {
		t.Fatalf("result reason code must retain original failure, got %s", result.GetReasonCode())
	}
	if !strings.Contains(result.GetReasonCode(), runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String()) {
		t.Fatalf("result reason code must include rollback failure reason, got %s", result.GetReasonCode())
	}
	if len(result.GetStageResults()) != 1 {
		t.Fatalf("expected exactly one rollback stage result, got %d", len(result.GetStageResults()))
	}
	stage := result.GetStageResults()[0]
	if stage.GetStage() != applyStageRollback {
		t.Fatalf("expected rollback stage name, got %s", stage.GetStage())
	}
	if stage.GetOk() {
		t.Fatalf("rollback stage must fail when rollback remove operations fail")
	}
	if stage.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("unexpected rollback reason code: %s", stage.GetReasonCode())
	}
	if len(result.GetWarnings()) < 2 {
		t.Fatalf("expected rollback warnings for failed remove operations")
	}
}

func TestLocalRuntimeStateRestoresAfterRestart(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-runtime-state.json")
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	svc := New(logger, nil, statePath, 0)
	installedModel, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/persisted-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install model: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-persisted",
		Title:        "svc-persisted",
		Capabilities: []string{"chat"},
		LocalModelId: installedModel.GetModel().GetLocalModelId(),
	}); err != nil {
		t.Fatalf("install service: %v", err)
	}

	manifestPath := filepath.Join(t.TempDir(), "persist-import.json")
	manifestRaw, _ := json.Marshal(map[string]any{
		"model_id":                "local/persisted-import",
		"engine":                  "localai",
		"capabilities":            []string{"chat"},
		"local_invoke_profile_id": "profile-persisted",
	})
	if err := os.WriteFile(manifestPath, manifestRaw, 0o600); err != nil {
		t.Fatalf("write import manifest: %v", err)
	}
	if _, err := svc.ImportLocalModel(context.Background(), &runtimev1.ImportLocalModelRequest{
		ManifestPath: manifestPath,
	}); err != nil {
		t.Fatalf("import model: %v", err)
	}

	ctx := authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "user-persist"})
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-nimi-trace-id", "trace-persist",
		"x-nimi-app-id", "app.persist",
		"x-nimi-domain", "runtime.local_runtime",
	))
	if _, err := svc.AppendInferenceAudit(ctx, &runtimev1.AppendInferenceAuditRequest{
		EventType: "persist_audit",
		Source:    "local-runtime",
		Model:     "local/persisted-model",
	}); err != nil {
		t.Fatalf("append persisted audit: %v", err)
	}

	restarted := New(logger, nil, statePath, 0)
	modelsResp, err := restarted.ListLocalModels(context.Background(), &runtimev1.ListLocalModelsRequest{})
	if err != nil {
		t.Fatalf("list models after restart: %v", err)
	}
	if len(modelsResp.GetModels()) == 0 {
		t.Fatalf("expected restored models from persisted state")
	}
	foundProfile := false
	for _, model := range modelsResp.GetModels() {
		if model.GetModelId() == "local/persisted-import" && model.GetLocalInvokeProfileId() == "profile-persisted" {
			foundProfile = true
			break
		}
	}
	if !foundProfile {
		t.Fatalf("expected restored model with local_invoke_profile_id=profile-persisted")
	}
	servicesResp, err := restarted.ListLocalServices(context.Background(), &runtimev1.ListLocalServicesRequest{})
	if err != nil {
		t.Fatalf("list services after restart: %v", err)
	}
	if len(servicesResp.GetServices()) == 0 {
		t.Fatalf("expected restored services from persisted state")
	}

	auditsResp, err := restarted.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{
		EventType:     "persist_audit",
		AppId:         "app.persist",
		SubjectUserId: "user-persist",
		PageSize:      10,
	})
	if err != nil {
		t.Fatalf("list audits after restart: %v", err)
	}
	if len(auditsResp.GetEvents()) != 1 {
		t.Fatalf("expected one restored persisted audit event, got %d", len(auditsResp.GetEvents()))
	}
	event := auditsResp.GetEvents()[0]
	if event.GetTraceId() != "trace-persist" {
		t.Fatalf("unexpected restored trace_id: %s", event.GetTraceId())
	}
	if event.GetOperation() != "append_inference_audit" {
		t.Fatalf("unexpected restored operation: %s", event.GetOperation())
	}
}

func TestLocalRuntimeAuditCapacityRespectedAcrossPersistAndRestore(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-runtime-state.json")
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	svc := New(logger, nil, statePath, 2)
	defer svc.Close()

	for i := 0; i < 5; i++ {
		if _, err := svc.AppendRuntimeAudit(context.Background(), &runtimev1.AppendRuntimeAuditRequest{
			EventType: fmt.Sprintf("evt-%d", i),
			ModelId:   fmt.Sprintf("local/model-%d", i),
		}); err != nil {
			t.Fatalf("append runtime audit #%d: %v", i, err)
		}
	}

	current, err := svc.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{PageSize: 10})
	if err != nil {
		t.Fatalf("list local audits before restart: %v", err)
	}
	if len(current.GetEvents()) != 2 {
		t.Fatalf("expected in-memory audit cap=2, got %d", len(current.GetEvents()))
	}
	if current.GetEvents()[0].GetEventType() != "evt-4" || current.GetEvents()[1].GetEventType() != "evt-3" {
		t.Fatalf("unexpected retained audit order before restart: %s, %s", current.GetEvents()[0].GetEventType(), current.GetEvents()[1].GetEventType())
	}

	restarted := New(logger, nil, statePath, 2)
	defer restarted.Close()

	restored, err := restarted.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{PageSize: 10})
	if err != nil {
		t.Fatalf("list local audits after restart: %v", err)
	}
	if len(restored.GetEvents()) != 2 {
		t.Fatalf("expected restored audit cap=2, got %d", len(restored.GetEvents()))
	}
	if restored.GetEvents()[0].GetEventType() != "evt-4" || restored.GetEvents()[1].GetEventType() != "evt-3" {
		t.Fatalf("unexpected retained audit order after restart: %s, %s", restored.GetEvents()[0].GetEventType(), restored.GetEvents()[1].GetEventType())
	}
}

// --- Engine RPC tests ---

func TestEngineRPCsReturnFailedPreconditionWithoutManager(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	// ListEngines
	_, err := svc.ListEngines(ctx, &runtimev1.ListEnginesRequest{})
	assertGRPCCode(t, err, "ListEngines", codes.FailedPrecondition)

	// EnsureEngine
	_, err = svc.EnsureEngine(ctx, &runtimev1.EnsureEngineRequest{Engine: "localai"})
	assertGRPCCode(t, err, "EnsureEngine", codes.FailedPrecondition)

	// StartEngine
	_, err = svc.StartEngine(ctx, &runtimev1.StartEngineRequest{Engine: "localai"})
	assertGRPCCode(t, err, "StartEngine", codes.FailedPrecondition)

	// StopEngine
	_, err = svc.StopEngine(ctx, &runtimev1.StopEngineRequest{Engine: "localai"})
	assertGRPCCode(t, err, "StopEngine", codes.FailedPrecondition)

	// GetEngineStatus
	_, err = svc.GetEngineStatus(ctx, &runtimev1.GetEngineStatusRequest{Engine: "localai"})
	assertGRPCCode(t, err, "GetEngineStatus", codes.FailedPrecondition)
}

func TestEngineRPCsWithMockManager(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	ctx := context.Background()

	// ListEngines should return the mock engines.
	resp, err := svc.ListEngines(ctx, &runtimev1.ListEnginesRequest{})
	if err != nil {
		t.Fatalf("ListEngines: %v", err)
	}
	if len(resp.GetEngines()) != 1 {
		t.Fatalf("expected 1 engine, got %d", len(resp.GetEngines()))
	}
	if resp.GetEngines()[0].GetEngine() != "localai" {
		t.Errorf("expected engine localai, got %s", resp.GetEngines()[0].GetEngine())
	}

	// GetEngineStatus should return the mock engine status.
	statusResp, err := svc.GetEngineStatus(ctx, &runtimev1.GetEngineStatusRequest{Engine: "localai"})
	if err != nil {
		t.Fatalf("GetEngineStatus: %v", err)
	}
	if statusResp.GetEngine().GetStatus() != runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_HEALTHY {
		t.Errorf("expected healthy status, got %s", statusResp.GetEngine().GetStatus())
	}
}

func TestEngineRPCsRequireEngineName(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	ctx := context.Background()

	// Empty engine name should return INVALID_ARGUMENT.
	_, err := svc.EnsureEngine(ctx, &runtimev1.EnsureEngineRequest{Engine: ""})
	assertGRPCCode(t, err, "EnsureEngine(empty)", codes.InvalidArgument)

	_, err = svc.StartEngine(ctx, &runtimev1.StartEngineRequest{Engine: ""})
	assertGRPCCode(t, err, "StartEngine(empty)", codes.InvalidArgument)

	_, err = svc.StopEngine(ctx, &runtimev1.StopEngineRequest{Engine: ""})
	assertGRPCCode(t, err, "StopEngine(empty)", codes.InvalidArgument)

	_, err = svc.GetEngineStatus(ctx, &runtimev1.GetEngineStatusRequest{Engine: ""})
	assertGRPCCode(t, err, "GetEngineStatus(empty)", codes.InvalidArgument)
}

// mockEngineManager implements EngineManager for testing with configurable errors.
type mockEngineManager struct {
	ensureErr error
	startErr  error
	stopErr   error
	statusErr error

	startCalls       int
	lastStartEngine  string
	lastStartPort    int
	lastStartVersion string
}

func (m *mockEngineManager) ListEngines() []EngineInfo {
	return []EngineInfo{
		{Engine: "localai", Version: "3.12.1", Status: "healthy", Port: 1234, Endpoint: "http://127.0.0.1:1234"},
	}
}

func (m *mockEngineManager) EnsureEngine(_ context.Context, _ string, _ string) error {
	return m.ensureErr
}

func (m *mockEngineManager) StartEngine(_ context.Context, engine string, port int, version string) error {
	m.startCalls++
	m.lastStartEngine = engine
	m.lastStartPort = port
	m.lastStartVersion = version
	return m.startErr
}

func (m *mockEngineManager) StopEngine(_ string) error {
	return m.stopErr
}

func (m *mockEngineManager) EngineStatus(engine string) (EngineInfo, error) {
	if m.statusErr != nil {
		return EngineInfo{}, m.statusErr
	}
	return EngineInfo{
		Engine:   engine,
		Version:  "3.12.1",
		Status:   "healthy",
		Port:     1234,
		Endpoint: "http://127.0.0.1:1234",
	}, nil
}

func assertGRPCCode(t *testing.T, err error, rpc string, wantCode codes.Code) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected error, got nil", rpc)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("%s: expected gRPC status error, got %T: %v", rpc, err, err)
	}
	if st.Code() != wantCode {
		t.Errorf("%s: expected code %s, got %s (msg: %s)", rpc, wantCode, st.Code(), st.Message())
	}
}

func assertGRPCReasonCode(t *testing.T, err error, rpc string, want runtimev1.ReasonCode) {
	t.Helper()
	got, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		t.Fatalf("%s: expected reason code %s, got none", rpc, want)
	}
	if got != want {
		t.Fatalf("%s: expected reason code %s, got %s", rpc, want, got)
	}
}

func assertNoGRPCReasonCode(t *testing.T, err error, rpc string) {
	t.Helper()
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		t.Fatalf("%s: expected no reason code, got %s", rpc, reason)
	}
}

// --- Engine RPC success/error tests ---

func TestEngineRPCEnsureEngineSuccess(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.EnsureEngine(context.Background(), &runtimev1.EnsureEngineRequest{Engine: "localai"})
	if err != nil {
		t.Fatalf("EnsureEngine: %v", err)
	}
	desc := resp.GetEngine()
	if desc.GetEngine() != "localai" {
		t.Errorf("expected engine localai, got %s", desc.GetEngine())
	}
	if desc.GetVersion() != "3.12.1" {
		t.Errorf("expected version 3.12.1, got %s", desc.GetVersion())
	}
}

func TestEngineRPCStartEngineSuccess(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.StartEngine(context.Background(), &runtimev1.StartEngineRequest{
		Engine: "localai",
		Port:   5000,
	})
	if err != nil {
		t.Fatalf("StartEngine: %v", err)
	}
	desc := resp.GetEngine()
	if desc.GetEngine() != "localai" {
		t.Errorf("expected engine localai, got %s", desc.GetEngine())
	}
}

func TestEngineRPCStopEngineSuccess(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.StopEngine(context.Background(), &runtimev1.StopEngineRequest{Engine: "localai"})
	if err != nil {
		t.Fatalf("StopEngine: %v", err)
	}
	desc := resp.GetEngine()
	if desc.GetStatus() != runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_STOPPED {
		t.Errorf("expected STOPPED status, got %s", desc.GetStatus())
	}
}

func TestEngineRPCGetEngineStatusNotFound(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		statusErr: fmt.Errorf("engine missing not started"),
	})

	_, err := svc.GetEngineStatus(context.Background(), &runtimev1.GetEngineStatusRequest{Engine: "missing"})
	assertGRPCCode(t, err, "GetEngineStatus(not_found)", codes.NotFound)
}

func TestEngineRPCEnsureEngineError(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		ensureErr: fmt.Errorf("download failed"),
	})

	_, err := svc.EnsureEngine(context.Background(), &runtimev1.EnsureEngineRequest{Engine: "localai"})
	assertGRPCCode(t, err, "EnsureEngine(error)", codes.Internal)
	assertGRPCReasonCode(t, err, "EnsureEngine(error)", runtimev1.ReasonCode_AI_LOCAL_DOWNLOAD_FAILED)
}

func TestEngineRPCEnsureEngineHashMismatch(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		ensureErr: fmt.Errorf("engine binary hash mismatch"),
	})

	_, err := svc.EnsureEngine(context.Background(), &runtimev1.EnsureEngineRequest{Engine: "localai"})
	assertGRPCCode(t, err, "EnsureEngine(hash_mismatch)", codes.DataLoss)
	assertGRPCReasonCode(t, err, "EnsureEngine(hash_mismatch)", runtimev1.ReasonCode_AI_LOCAL_DOWNLOAD_HASH_MISMATCH)
}

func TestLocalRuntimeManagementRPCsUsePlainInvalidArgumentAndNotFoundForModelIDs(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	_, err := svc.StartLocalModel(ctx, &runtimev1.StartLocalModelRequest{LocalModelId: ""})
	assertGRPCCode(t, err, "StartLocalModel(empty_id)", codes.InvalidArgument)
	assertNoGRPCReasonCode(t, err, "StartLocalModel(empty_id)")

	_, err = svc.StopLocalModel(ctx, &runtimev1.StopLocalModelRequest{LocalModelId: ""})
	assertGRPCCode(t, err, "StopLocalModel(empty_id)", codes.InvalidArgument)
	assertNoGRPCReasonCode(t, err, "StopLocalModel(empty_id)")

	_, err = svc.RemoveLocalModel(ctx, &runtimev1.RemoveLocalModelRequest{LocalModelId: ""})
	assertGRPCCode(t, err, "RemoveLocalModel(empty_id)", codes.InvalidArgument)
	assertNoGRPCReasonCode(t, err, "RemoveLocalModel(empty_id)")

	_, err = svc.StartLocalModel(ctx, &runtimev1.StartLocalModelRequest{LocalModelId: "model_missing"})
	assertGRPCCode(t, err, "StartLocalModel(not_found)", codes.NotFound)
	assertNoGRPCReasonCode(t, err, "StartLocalModel(not_found)")

	_, err = svc.StopLocalModel(ctx, &runtimev1.StopLocalModelRequest{LocalModelId: "model_missing"})
	assertGRPCCode(t, err, "StopLocalModel(not_found)", codes.NotFound)
	assertNoGRPCReasonCode(t, err, "StopLocalModel(not_found)")

	_, err = svc.RemoveLocalModel(ctx, &runtimev1.RemoveLocalModelRequest{LocalModelId: "model_missing"})
	assertGRPCCode(t, err, "RemoveLocalModel(not_found)", codes.NotFound)
	assertNoGRPCReasonCode(t, err, "RemoveLocalModel(not_found)")
}

func TestLocalRuntimeManagementRPCsUsePlainInvalidArgumentAndNotFoundForServiceIDs(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	_, err := svc.StartLocalService(ctx, &runtimev1.StartLocalServiceRequest{ServiceId: ""})
	assertGRPCCode(t, err, "StartLocalService(empty_id)", codes.InvalidArgument)
	assertNoGRPCReasonCode(t, err, "StartLocalService(empty_id)")

	_, err = svc.StopLocalService(ctx, &runtimev1.StopLocalServiceRequest{ServiceId: ""})
	assertGRPCCode(t, err, "StopLocalService(empty_id)", codes.InvalidArgument)
	assertNoGRPCReasonCode(t, err, "StopLocalService(empty_id)")

	_, err = svc.RemoveLocalService(ctx, &runtimev1.RemoveLocalServiceRequest{ServiceId: ""})
	assertGRPCCode(t, err, "RemoveLocalService(empty_id)", codes.InvalidArgument)
	assertNoGRPCReasonCode(t, err, "RemoveLocalService(empty_id)")

	_, err = svc.StartLocalService(ctx, &runtimev1.StartLocalServiceRequest{ServiceId: "svc_missing"})
	assertGRPCCode(t, err, "StartLocalService(not_found)", codes.NotFound)
	assertNoGRPCReasonCode(t, err, "StartLocalService(not_found)")

	_, err = svc.StopLocalService(ctx, &runtimev1.StopLocalServiceRequest{ServiceId: "svc_missing"})
	assertGRPCCode(t, err, "StopLocalService(not_found)", codes.NotFound)
	assertNoGRPCReasonCode(t, err, "StopLocalService(not_found)")

	_, err = svc.RemoveLocalService(ctx, &runtimev1.RemoveLocalServiceRequest{ServiceId: "svc_missing"})
	assertGRPCCode(t, err, "RemoveLocalService(not_found)", codes.NotFound)
	assertNoGRPCReasonCode(t, err, "RemoveLocalService(not_found)")
}

func TestEngineRPCStartEngineAlreadyRunning(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		startErr: fmt.Errorf("engine localai already running"),
	})

	_, err := svc.StartEngine(context.Background(), &runtimev1.StartEngineRequest{Engine: "localai"})
	assertGRPCCode(t, err, "StartEngine(already_running)", codes.AlreadyExists)
	assertGRPCReasonCode(t, err, "StartEngine(already_running)", runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
}

func TestEngineRPCStopEngineNotStarted(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		stopErr: fmt.Errorf("engine localai not started"),
	})

	_, err := svc.StopEngine(context.Background(), &runtimev1.StopEngineRequest{Engine: "localai"})
	assertGRPCCode(t, err, "StopEngine(not_started)", codes.NotFound)
	assertGRPCReasonCode(t, err, "StopEngine(not_started)", runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
}

func TestEngineRPCGetEngineStatusUnknownEngine(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		statusErr: fmt.Errorf("unknown engine kind: \"mystery\""),
	})

	_, err := svc.GetEngineStatus(context.Background(), &runtimev1.GetEngineStatusRequest{Engine: "mystery"})
	assertGRPCCode(t, err, "GetEngineStatus(unknown_engine)", codes.InvalidArgument)
	assertGRPCReasonCode(t, err, "GetEngineStatus(unknown_engine)", runtimev1.ReasonCode_AI_INPUT_INVALID)
}

// --- Enum mapping test ---

func TestEngineStatusToProtoMapping(t *testing.T) {
	tests := []struct {
		input string
		want  runtimev1.LocalEngineStatus
	}{
		{"stopped", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_STOPPED},
		{"starting", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_STARTING},
		{"healthy", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_HEALTHY},
		{"unhealthy", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_UNHEALTHY},
		{"unknown", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_UNSPECIFIED},
		{"", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_UNSPECIFIED},
	}
	for _, tt := range tests {
		got := engineStatusToProto(tt.input)
		if got != tt.want {
			t.Errorf("engineStatusToProto(%q) = %s, want %s", tt.input, got, tt.want)
		}
	}
}
