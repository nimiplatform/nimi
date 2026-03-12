package model

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPullModelTransitionsThroughPullingState(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	release := make(chan struct{})
	svc.SetPullExecutor(func(modelID string, complete func(runtimev1.ModelStatus)) {
		go func() {
			<-release
			complete(runtimev1.ModelStatus_MODEL_STATUS_INSTALLED)
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

	close(release)
	waitForModelStatus(t, svc, "qwen2.5", runtimev1.ModelStatus_MODEL_STATUS_INSTALLED)
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

	healthResp, err := svc.CheckModelHealth(context.Background(), &runtimev1.CheckModelHealthRequest{ModelId: "qwen2.5"})
	if err != nil {
		t.Fatalf("check model health: %v", err)
	}
	if !healthResp.Healthy {
		t.Fatalf("model must be healthy")
	}

	removeResp, err := svc.RemoveModel(context.Background(), &runtimev1.RemoveModelRequest{ModelId: "qwen2.5"})
	if err != nil {
		t.Fatalf("remove model: %v", err)
	}
	if !removeResp.Ok {
		t.Fatalf("remove must succeed")
	}

	healthAfterRemove, err := svc.CheckModelHealth(context.Background(), &runtimev1.CheckModelHealthRequest{ModelId: "qwen2.5"})
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

	_, err := svc.RemoveModel(context.Background(), &runtimev1.RemoveModelRequest{ModelId: "qwen2.5"})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected failed precondition, got %v", err)
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

func waitForModelStatus(t *testing.T, svc *Service, modelID string, want runtimev1.ModelStatus) {
	t.Helper()
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		resp, err := svc.ListModels(context.Background(), &runtimev1.ListModelsRequest{})
		if err != nil {
			t.Fatalf("list models: %v", err)
		}
		for _, model := range resp.GetModels() {
			if model.GetModelId() == modelID && model.GetStatus() == want {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("model %s did not reach status %v", modelID, want)
}
