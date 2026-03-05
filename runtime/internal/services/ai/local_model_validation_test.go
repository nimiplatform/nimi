package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type fakeLocalModelLister struct {
	responses []*runtimev1.ListLocalModelsResponse
	err       error
	calls     int
}

func (f *fakeLocalModelLister) ListLocalModels(_ context.Context, _ *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	if f.calls >= len(f.responses) {
		return &runtimev1.ListLocalModelsResponse{}, nil
	}
	resp := f.responses[f.calls]
	f.calls++
	return resp, nil
}

func TestParseLocalModelSelector(t *testing.T) {
	tests := []struct {
		modelID        string
		explicitEngine string
		preferLocalAI  bool
		normalizedID   string
	}{
		{modelID: "localai/qwen", explicitEngine: "localai", normalizedID: "qwen"},
		{modelID: "nexa/qwen", explicitEngine: "nexa", normalizedID: "qwen"},
		{modelID: "local/qwen", preferLocalAI: true, normalizedID: "qwen"},
		{modelID: "raw-model", normalizedID: "raw-model"},
		{modelID: "   ", normalizedID: "local-model"},
	}

	for _, tt := range tests {
		sel := parseLocalModelSelector(tt.modelID)
		if sel.explicitEngine != tt.explicitEngine || sel.preferLocalAI != tt.preferLocalAI || sel.modelID != tt.normalizedID {
			t.Fatalf("selector mismatch for %q: %+v", tt.modelID, sel)
		}
	}
}

func TestSelectActiveLocalModel(t *testing.T) {
	models := []*runtimev1.LocalModelRecord{
		{LocalModelId: "b", ModelId: "qwen", Engine: "nexa"},
		{LocalModelId: "a", ModelId: "qwen", Engine: "localai"},
	}

	selected, reason := selectActiveLocalModel(models, localModelSelector{modelID: "qwen"})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "localai" {
		t.Fatalf("expected localai prioritized, got selected=%v reason=%v", selected.GetEngine(), reason)
	}

	selected, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", explicitEngine: "nexa"})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "nexa" {
		t.Fatalf("expected explicit nexa, got selected=%v reason=%v", selected.GetEngine(), reason)
	}

	_, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", explicitEngine: "unknown"})
	if reason != runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH {
		t.Fatalf("expected provider mismatch, got %v", reason)
	}

	selected, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", preferLocalAI: true})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "localai" {
		t.Fatalf("expected prefer localai, got selected=%v reason=%v", selected.GetEngine(), reason)
	}

	_, reason = selectActiveLocalModel(models, localModelSelector{modelID: "absent"})
	if reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected unavailable, got %v", reason)
	}
}

func TestLocalEnginePriorityAndProfileRequirement(t *testing.T) {
	if localEnginePriority("localai") >= localEnginePriority("nexa") {
		t.Fatalf("unexpected local engine priority ordering")
	}
	if localEnginePriority("other") != 2 {
		t.Fatalf("unexpected default engine priority")
	}

	if modelRequiresInvokeProfile(&runtimev1.LocalModelRecord{LocalInvokeProfileId: "profile-1"}) {
		t.Fatalf("profile id should satisfy requirement")
	}
	if !modelRequiresInvokeProfile(&runtimev1.LocalModelRecord{Capabilities: []string{"custom.voice"}}) {
		t.Fatalf("custom capability should require invoke profile")
	}
	if modelRequiresInvokeProfile(&runtimev1.LocalModelRecord{Capabilities: []string{"chat"}}) {
		t.Fatalf("non-custom capabilities should not require profile")
	}
}

func TestListAllActiveLocalModelsPagination(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalModelsResponse{
			{Models: []*runtimev1.LocalModelRecord{{LocalModelId: "1"}}, NextPageToken: "next"},
			{Models: []*runtimev1.LocalModelRecord{{LocalModelId: "2"}}},
		},
	}
	models, err := svc.listAllActiveLocalModels(context.Background())
	if err != nil {
		t.Fatalf("listAllActiveLocalModels: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
}

func TestValidateLocalModelRequest(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)

	// Non-local route should bypass local model validation.
	if err := svc.validateLocalModelRequest(context.Background(), "openai/gpt-4", nil); err != nil {
		t.Fatalf("non-local model should bypass validation: %v", err)
	}

	// Remote target bypass path.
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", &nimillm.RemoteTarget{ProviderType: "openai"}); err != nil {
		t.Fatalf("remote target should bypass validation: %v", err)
	}

	// Local lister error maps to local model unavailable.
	svc.localModel = &fakeLocalModelLister{err: errors.New("boom")}
	err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected local model unavailable, got=%v ok=%v", reason, ok)
	}

	// Missing model should fail unavailable.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "other", Engine: "localai"}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected local model unavailable, got=%v ok=%v", reason, ok)
	}

	// Missing invoke profile for custom capability should fail.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "qwen", Engine: "localai", Capabilities: []string{"custom"}}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING {
		t.Fatalf("expected profile missing, got=%v ok=%v", reason, ok)
	}

	// Explicit engine mismatch should fail provider mismatch.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "qwen", Engine: "localai"}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "nexa/qwen", nil)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH {
		t.Fatalf("expected provider mismatch, got=%v ok=%v", reason, ok)
	}

	// Success path.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "qwen", Engine: "localai", LocalInvokeProfileId: "invoke"}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil); err != nil {
		t.Fatalf("expected local model validation success, got %v", err)
	}
}
