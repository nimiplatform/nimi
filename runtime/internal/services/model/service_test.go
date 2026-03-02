package model

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
)

func TestModelLifecycle(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))

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
	if pullResp.TaskId == "" {
		t.Fatalf("pull must return task id")
	}

	listResp, err := svc.ListModels(context.Background(), &runtimev1.ListModelsRequest{})
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if got := len(listResp.Models); got != 1 {
		t.Fatalf("expected 1 model, got %d", got)
	}
	if listResp.Models[0].ModelId != "qwen2.5" {
		t.Fatalf("unexpected model id: %s", listResp.Models[0].ModelId)
	}
	if listResp.Models[0].Status != runtimev1.ModelStatus_MODEL_STATUS_INSTALLED {
		t.Fatalf("model must be installed")
	}

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

func TestModelRegistryPersistence(t *testing.T) {
	registry := modelregistry.New()
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), registry)

	path := filepath.Join(t.TempDir(), "models.json")
	svc.SetPersistencePath(path)

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
