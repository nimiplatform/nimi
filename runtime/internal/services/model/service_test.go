package model

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type fakeLocalModelLister struct {
	responses []*runtimev1.ListLocalModelsResponse
	err       error
}

func (f *fakeLocalModelLister) ListLocalModels(_ context.Context, req *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	if len(f.responses) == 0 {
		return &runtimev1.ListLocalModelsResponse{}, nil
	}
	response := f.responses[0]
	f.responses = f.responses[1:]
	if response == nil {
		return &runtimev1.ListLocalModelsResponse{}, nil
	}
	if req.GetStatusFilter() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNSPECIFIED {
		filtered := make([]*runtimev1.LocalModelRecord, 0, len(response.GetModels()))
		for _, model := range response.GetModels() {
			if model != nil && model.GetStatus() == req.GetStatusFilter() {
				filtered = append(filtered, model)
			}
		}
		return &runtimev1.ListLocalModelsResponse{Models: filtered, NextPageToken: response.GetNextPageToken()}, nil
	}
	return response, nil
}

func TestPullModelTransitionsThroughPullingState(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	release := make(chan struct{})
	done := make(chan struct{})
	svc.SetPullExecutor(func(modelID string, complete func(runtimev1.ModelStatus)) {
		go func() {
			<-release
			complete(runtimev1.ModelStatus_MODEL_STATUS_INSTALLED)
			close(done)
		}()
	})

	pullResp, err := svc.PullModel(context.Background(), &runtimev1.PullModelRequest{
		AppId:    "nimi.desktop",
		ModelRef: "qwen2.5:latest",
	})
	if err != nil {
		t.Fatalf("pull model: %v", err)
	}
	if !pullResp.Accepted || pullResp.TaskId == "" {
		t.Fatalf("pull response invalid: %+v", pullResp)
	}

	listResp, err := svc.ListModels(context.Background(), &runtimev1.ListModelsRequest{})
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if got := len(listResp.Models); got != 1 {
		t.Fatalf("expected 1 model, got %d", got)
	}
	if listResp.Models[0].Status != runtimev1.ModelStatus_MODEL_STATUS_PULLING {
		t.Fatalf("expected pulling status, got %v", listResp.Models[0].Status)
	}
	if listResp.Models[0].GetPreferredEngine() != "llama" {
		t.Fatalf("expected llama preferred engine, got %q", listResp.Models[0].GetPreferredEngine())
	}
	if listResp.Models[0].GetBundleState() != runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_RESOLVING {
		t.Fatalf("expected resolving bundle state, got %v", listResp.Models[0].GetBundleState())
	}

	close(release)
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("model pull did not complete in time")
	}

	installedResp, err := svc.ListModels(context.Background(), &runtimev1.ListModelsRequest{})
	if err != nil {
		t.Fatalf("list models after completion: %v", err)
	}
	if len(installedResp.GetModels()) != 1 || installedResp.GetModels()[0].GetStatus() != runtimev1.ModelStatus_MODEL_STATUS_INSTALLED {
		t.Fatalf("expected installed model after pull completion, got %#v", installedResp.GetModels())
	}
}

func TestModelLifecycle(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	done := make(chan struct{})
	svc.SetPullExecutor(func(modelID string, complete func(runtimev1.ModelStatus)) {
		go func() {
			complete(runtimev1.ModelStatus_MODEL_STATUS_INSTALLED)
			close(done)
		}()
	})

	pullResp, err := svc.PullModel(context.Background(), &runtimev1.PullModelRequest{
		AppId:    "nimi.desktop",
		ModelRef: "qwen2.5:latest",
	})
	if err != nil {
		t.Fatalf("pull model: %v", err)
	}
	if !pullResp.Accepted {
		t.Fatalf("pull must be accepted")
	}
	<-done

	healthResp, err := svc.CheckModelHealth(context.Background(), &runtimev1.CheckModelHealthRequest{
		AppId:   "nimi.desktop",
		ModelId: "qwen2.5",
	})
	if err != nil {
		t.Fatalf("check model health: %v", err)
	}
	if !healthResp.Healthy {
		t.Fatalf("model must be healthy")
	}

	listResp, err := svc.ListModels(context.Background(), &runtimev1.ListModelsRequest{})
	if err != nil {
		t.Fatalf("list models after install: %v", err)
	}
	if got := listResp.GetModels()[0].GetLogicalModelId(); got != "qwen2.5" {
		t.Fatalf("logical model id mismatch: %q", got)
	}
	if got := listResp.GetModels()[0].GetFamily(); got != "qwen" {
		t.Fatalf("family mismatch: %q", got)
	}

	removeResp, err := svc.RemoveModel(context.Background(), &runtimev1.RemoveModelRequest{
		AppId:   "nimi.desktop",
		ModelId: "qwen2.5",
	})
	if err != nil {
		t.Fatalf("remove model: %v", err)
	}
	if !removeResp.Ok {
		t.Fatalf("remove must succeed")
	}

	healthAfterRemove, err := svc.CheckModelHealth(context.Background(), &runtimev1.CheckModelHealthRequest{
		AppId:   "nimi.desktop",
		ModelId: "qwen2.5",
	})
	if err != nil {
		t.Fatalf("check model health after remove: %v", err)
	}
	if healthAfterRemove.Healthy {
		t.Fatalf("removed model must not be healthy")
	}
	if healthAfterRemove.ReasonCode != runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
		t.Fatalf("unexpected reason code: %v", healthAfterRemove.ReasonCode)
	}
}

func TestCheckModelHealthLocalLlamaRequiresWarmProof(t *testing.T) {
	registry := modelregistry.New()
	registry.Upsert(modelregistry.Entry{
		ModelID:      "local/qwen2.5",
		Version:      "latest",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"text.generate"},
		Source:       "local",
	})
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), registry)

	resp, err := svc.CheckModelHealth(context.Background(), &runtimev1.CheckModelHealthRequest{
		AppId:   "nimi.desktop",
		ModelId: "local/qwen2.5",
	})
	if err != nil {
		t.Fatalf("check model health: %v", err)
	}
	if resp.GetHealthy() {
		t.Fatalf("local llama model without warm proof must fail closed")
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_AI_MODEL_NOT_READY {
		t.Fatalf("unexpected reason code: %v", resp.GetReasonCode())
	}
	if got := resp.GetActionHint(); got != "warm local model" {
		t.Fatalf("unexpected action hint: %q", got)
	}
}

func TestCheckModelHealthLocalModelUsesLocalServiceActiveState(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalModelLister(&fakeLocalModelLister{
		responses: []*runtimev1.ListLocalModelsResponse{{
			Models: []*runtimev1.LocalModelRecord{{
				LocalModelId: "local-1",
				ModelId:      "local/qwen3-4b-q4_k_m",
				Engine:       "llama",
				Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			}},
		}},
	})

	resp, err := svc.CheckModelHealth(context.Background(), &runtimev1.CheckModelHealthRequest{
		AppId:   "nimi.desktop",
		ModelId: "local/qwen3-4b-q4_k_m",
	})
	if err != nil {
		t.Fatalf("check model health: %v", err)
	}
	if !resp.GetHealthy() {
		t.Fatalf("active local model from local service must be healthy: %+v", resp)
	}
}

func TestCheckModelHealthLocalModelUsesLocalServiceInstalledState(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalModelLister(&fakeLocalModelLister{
		responses: []*runtimev1.ListLocalModelsResponse{{
			Models: []*runtimev1.LocalModelRecord{{
				LocalModelId: "local-1",
				ModelId:      "local/qwen3-4b-q4_k_m",
				Engine:       "llama",
				Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
			}},
		}},
	})

	resp, err := svc.CheckModelHealth(context.Background(), &runtimev1.CheckModelHealthRequest{
		AppId:   "nimi.desktop",
		ModelId: "local/qwen3-4b-q4_k_m",
	})
	if err != nil {
		t.Fatalf("check model health: %v", err)
	}
	if resp.GetHealthy() {
		t.Fatalf("installed local model must not be healthy")
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_AI_MODEL_NOT_READY {
		t.Fatalf("unexpected reason code: %v", resp.GetReasonCode())
	}
	if got := resp.GetActionHint(); got != "warm local model" {
		t.Fatalf("unexpected action hint: %q", got)
	}
}

func TestCheckModelHealthLocalModelFallsBackToRegistryOnLocalServiceError(t *testing.T) {
	registry := modelregistry.New()
	registry.Upsert(modelregistry.Entry{
		ModelID:      "local/qwen3-4b-q4_k_m",
		Version:      "latest",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"text.generate"},
		Source:       "local",
	})
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), registry)
	svc.SetLocalModelLister(&fakeLocalModelLister{err: errors.New("boom")})

	resp, err := svc.CheckModelHealth(context.Background(), &runtimev1.CheckModelHealthRequest{
		AppId:   "nimi.desktop",
		ModelId: "local/qwen3-4b-q4_k_m",
	})
	if err != nil {
		t.Fatalf("check model health: %v", err)
	}
	if resp.GetHealthy() {
		t.Fatalf("local llama without local service result must still fail closed")
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_AI_MODEL_NOT_READY {
		t.Fatalf("unexpected reason code: %v", resp.GetReasonCode())
	}
}

func TestCheckModelHealthLocalMediaRequiresTargetReadyCatalogEntry(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok","ready":true}`))
		case "/v1/catalog":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"models":[{"id":"media/demo-image","ready":true}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	t.Setenv("NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL", server.URL)

	registry := modelregistry.New()
	registry.Upsert(modelregistry.Entry{
		ModelID:      "media/demo-image",
		Version:      "latest",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"image.generate"},
		Source:       "local",
	})
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), registry)

	resp, err := svc.CheckModelHealth(context.Background(), &runtimev1.CheckModelHealthRequest{
		AppId:   "nimi.desktop",
		ModelId: "media/demo-image",
	})
	if err != nil {
		t.Fatalf("check model health: %v", err)
	}
	if !resp.GetHealthy() {
		t.Fatalf("local media model with matching ready catalog entry must be healthy: %+v", resp)
	}
}

func TestCheckModelHealthLocalMediaFailsClosedWhenCatalogMissesTarget(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok","ready":true}`))
		case "/v1/catalog":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"models":[{"id":"media/other-model","ready":true}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	t.Setenv("NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL", server.URL)

	registry := modelregistry.New()
	registry.Upsert(modelregistry.Entry{
		ModelID:      "media/demo-image",
		Version:      "latest",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"image.generate"},
		Source:       "local",
	})
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), registry)

	resp, err := svc.CheckModelHealth(context.Background(), &runtimev1.CheckModelHealthRequest{
		AppId:   "nimi.desktop",
		ModelId: "media/demo-image",
	})
	if err != nil {
		t.Fatalf("check model health: %v", err)
	}
	if resp.GetHealthy() {
		t.Fatalf("local media model must fail closed when target catalog entry is missing")
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_AI_MODEL_NOT_READY {
		t.Fatalf("unexpected reason code: %v", resp.GetReasonCode())
	}
	if got := resp.GetActionHint(); got != "start local media engine" {
		t.Fatalf("unexpected action hint: %q", got)
	}
}

func TestDefaultPullExecutorKeepsPullingStateObservable(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))

	pullResp, err := svc.PullModel(context.Background(), &runtimev1.PullModelRequest{
		AppId:    "nimi.desktop",
		ModelRef: "qwen2.5:latest",
	})
	if err != nil {
		t.Fatalf("pull model: %v", err)
	}
	if !pullResp.GetAccepted() {
		t.Fatalf("pull model must be accepted")
	}

	listResp, err := svc.ListModels(context.Background(), &runtimev1.ListModelsRequest{})
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(listResp.GetModels()) != 1 {
		t.Fatalf("expected 1 model, got %d", len(listResp.GetModels()))
	}
	if got := listResp.GetModels()[0].GetStatus(); got != runtimev1.ModelStatus_MODEL_STATUS_PULLING {
		t.Fatalf("expected default executor to leave pulling observable, got %v", got)
	}

	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		listResp, err = svc.ListModels(context.Background(), &runtimev1.ListModelsRequest{})
		if err != nil {
			t.Fatalf("list models after pull: %v", err)
		}
		if len(listResp.GetModels()) == 1 && listResp.GetModels()[0].GetStatus() == runtimev1.ModelStatus_MODEL_STATUS_INSTALLED {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("default executor did not complete install in time: %#v", listResp.GetModels())
}

func TestPullModelInvalidInput(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))

	resp, err := svc.PullModel(context.Background(), &runtimev1.PullModelRequest{
		AppId:    "nimi.desktop",
		ModelRef: " ",
	})
	if err != nil {
		t.Fatalf("pull model with invalid input: %v", err)
	}
	if resp.Accepted {
		t.Fatalf("invalid input must be rejected")
	}
	if resp.ReasonCode != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("unexpected reason code: %v", resp.ReasonCode)
	}
}

func TestRemoveModelRejectsIllegalSourceState(t *testing.T) {
	registry := modelregistry.New()
	registry.Upsert(modelregistry.Entry{
		ModelID: "qwen2.5",
		Version: "latest",
		Status:  runtimev1.ModelStatus_MODEL_STATUS_PULLING,
	})
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), registry)

	_, err := svc.RemoveModel(context.Background(), &runtimev1.RemoveModelRequest{
		AppId:   "nimi.desktop",
		ModelId: "qwen2.5",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected failed precondition, got %v", err)
	}
}

func TestRemoveModelRequiresAppID(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, err := svc.RemoveModel(context.Background(), &runtimev1.RemoveModelRequest{ModelId: "qwen2.5"})
	if err != nil {
		t.Fatalf("remove model without app id: %v", err)
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("unexpected reason code: %v", resp.GetReasonCode())
	}
}

func TestCheckModelHealthRequiresAppID(t *testing.T) {
	registry := modelregistry.New()
	registry.Upsert(modelregistry.Entry{
		ModelID: "qwen2.5",
		Version: "latest",
		Status:  runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
	})
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), registry)

	resp, err := svc.CheckModelHealth(context.Background(), &runtimev1.CheckModelHealthRequest{
		ModelId: "qwen2.5",
	})
	if err != nil {
		t.Fatalf("check model health without app id: %v", err)
	}
	if resp.GetHealthy() {
		t.Fatalf("health check without app id must fail closed")
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("unexpected reason code: %v", resp.GetReasonCode())
	}
	if resp.GetActionHint() != "set app_id" {
		t.Fatalf("unexpected action hint: %q", resp.GetActionHint())
	}
}

func TestModelStatusTransitionsMatchSpec(t *testing.T) {
	installed := runtimev1.ModelStatus_MODEL_STATUS_INSTALLED
	pulling := runtimev1.ModelStatus_MODEL_STATUS_PULLING
	failed := runtimev1.ModelStatus_MODEL_STATUS_FAILED
	removed := runtimev1.ModelStatus_MODEL_STATUS_REMOVED

	tests := []struct {
		name string
		from runtimev1.ModelStatus
		to   runtimev1.ModelStatus
		want bool
	}{
		{"INSTALLED->PULLING", installed, pulling, true},
		{"PULLING->INSTALLED", pulling, installed, true},
		{"PULLING->FAILED", pulling, failed, true},
		{"INSTALLED->REMOVED", installed, removed, true},
		{"FAILED->PULLING", failed, pulling, true},
		{"FAILED->REMOVED", failed, removed, true},
		{"PULLING->REMOVED", pulling, removed, false},
		{"REMOVED->PULLING", removed, pulling, false},
		{"INSTALLED->INSTALLED", installed, installed, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canTransitionModel(tt.from, tt.to); got != tt.want {
				t.Fatalf("canTransitionModel(%v, %v) = %v, want %v", tt.from, tt.to, got, tt.want)
			}
		})
	}
}

func TestModelRegistryPersistence(t *testing.T) {
	registry := modelregistry.New()
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), registry)

	path := filepath.Join(t.TempDir(), "models.json")
	svc.SetPersistencePath(path)
	done := make(chan struct{})
	svc.SetPullExecutor(func(modelID string, complete func(runtimev1.ModelStatus)) {
		go func() {
			complete(runtimev1.ModelStatus_MODEL_STATUS_INSTALLED)
			close(done)
		}()
	})

	resp, err := svc.PullModel(context.Background(), &runtimev1.PullModelRequest{
		AppId:    "nimi.desktop",
		ModelRef: "dashscope/qwen-max@v1",
		Source:   "dashscope",
	})
	if err != nil {
		t.Fatalf("pull model: %v", err)
	}
	if !resp.Accepted {
		t.Fatalf("pull model must be accepted")
	}
	<-done

	loaded, err := modelregistry.NewFromFile(path)
	if err != nil {
		t.Fatalf("load persisted registry: %v", err)
	}
	item, exists := loaded.Get("dashscope/qwen-max")
	if !exists {
		t.Fatalf("persisted model must exist")
	}
	if item.ProviderHint != modelregistry.ProviderHintDashScope {
		t.Fatalf("provider hint mismatch: got=%s", item.ProviderHint)
	}
}
