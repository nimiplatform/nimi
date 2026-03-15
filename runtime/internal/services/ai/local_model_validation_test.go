package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
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
		modal          runtimev1.Modal
	}{
		{modelID: "localai/qwen", explicitEngine: "localai", normalizedID: "qwen"},
		{modelID: "nexa/qwen", explicitEngine: "nexa", normalizedID: "qwen"},
		{modelID: "nimi_media/qwen", explicitEngine: "nimi_media", normalizedID: "qwen"},
		{modelID: "sidecar/qwen", explicitEngine: "sidecar", normalizedID: "qwen"},
		{modelID: "localsidecar/qwen", explicitEngine: "sidecar", normalizedID: "qwen"},
		{modelID: "local/qwen", preferLocalAI: true, normalizedID: "qwen", modal: runtimev1.Modal_MODAL_VIDEO},
		{modelID: "raw-model", normalizedID: "raw-model"},
		{modelID: "   ", normalizedID: ""},
	}

	for _, tt := range tests {
		sel := parseLocalModelSelector(tt.modelID, tt.modal)
		if sel.explicitEngine != tt.explicitEngine || sel.preferLocalAI != tt.preferLocalAI || sel.modelID != tt.normalizedID || sel.modal != tt.modal {
			t.Fatalf("selector mismatch for %q: %+v", tt.modelID, sel)
		}
	}
}

func TestSelectActiveLocalModel(t *testing.T) {
	models := []*runtimev1.LocalModelRecord{
		{LocalModelId: "b", ModelId: "qwen", Engine: "nexa"},
		{LocalModelId: "c", ModelId: "qwen", Engine: "sidecar"},
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

	selected, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", explicitEngine: "sidecar"})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "sidecar" {
		t.Fatalf("expected explicit sidecar, got selected=%v reason=%v", selected.GetEngine(), reason)
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
	if localEnginePriority("sidecar") <= localEnginePriority("nexa") {
		t.Fatalf("text routing should not prioritize sidecar over nexa")
	}
	if localEnginePriority("nimi_media") <= localEnginePriority("sidecar") {
		t.Fatalf("text routing should rank nimi_media after sidecar fallback")
	}
	if localEnginePriority("other") <= localEnginePriority("nimi_media") {
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
	if err := svc.validateLocalModelRequest(context.Background(), "openai/gpt-4", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("non-local model should bypass validation: %v", err)
	}

	// Remote target bypass path.
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", &nimillm.RemoteTarget{ProviderType: "openai"}, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("remote target should bypass validation: %v", err)
	}

	// Local lister error maps to local model unavailable.
	svc.localModel = &fakeLocalModelLister{err: errors.New("boom")}
	err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected local model unavailable, got=%v ok=%v", reason, ok)
	}

	// Missing model should fail unavailable.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "other", Engine: "localai"}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected local model unavailable, got=%v ok=%v", reason, ok)
	}

	// Missing invoke profile for custom capability should fail.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "qwen", Engine: "localai", Capabilities: []string{"custom"}}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING {
		t.Fatalf("expected profile missing, got=%v ok=%v", reason, ok)
	}

	// Explicit engine mismatch should fail provider mismatch.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "qwen", Engine: "localai"}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "nexa/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH {
		t.Fatalf("expected provider mismatch, got=%v ok=%v", reason, ok)
	}

	// Success path.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "qwen", Engine: "localai", LocalInvokeProfileId: "invoke"}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected local model validation success, got %v", err)
	}

	// Same modelId across engines should respect explicit engine selector.
	dualEnginePage := &runtimev1.ListLocalModelsResponse{
		Models: []*runtimev1.LocalModelRecord{
			{ModelId: "qwen", Engine: "localai", LocalInvokeProfileId: "invoke"},
			{ModelId: "qwen", Engine: "nexa", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{
		dualEnginePage,
		dualEnginePage,
	}}
	if err := svc.validateLocalModelRequest(context.Background(), "localai/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected localai selector to succeed, got %v", err)
	}
	if err := svc.validateLocalModelRequest(context.Background(), "nexa/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected nexa selector to succeed, got %v", err)
	}
	dualEnginePageWithSidecar := &runtimev1.ListLocalModelsResponse{
		Models: []*runtimev1.LocalModelRecord{
			{ModelId: "qwen", Engine: "localai", LocalInvokeProfileId: "invoke"},
			{ModelId: "qwen", Engine: "sidecar", LocalInvokeProfileId: "invoke"},
			{ModelId: "qwen", Engine: "nexa", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{
		dualEnginePageWithSidecar,
		dualEnginePageWithSidecar,
	}}
	if err := svc.validateLocalModelRequest(context.Background(), "sidecar/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected sidecar selector to succeed, got %v", err)
	}

	// Case-insensitive modelId matching should succeed across desktop/go-runtime normalization.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "Qwen", Engine: "localai", LocalInvokeProfileId: "invoke"}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected case-insensitive local model validation success, got %v", err)
	}
}

func TestValidateLocalModelRequestIncludesUnhealthyDetail(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{
			ModelId:      "unsloth/Z-Image-Turbo-GGUF",
			Engine:       "localai",
			Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
			HealthDetail: "managed/bundled LocalAI binary on darwin/arm64 does not ship stablediffusion backend",
		}},
	}}}

	err := svc.validateLocalModelRequest(context.Background(), "local/unsloth/Z-Image-Turbo-GGUF", nil, runtimev1.Modal_MODAL_IMAGE)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected local model unavailable, got=%v ok=%v", reason, ok)
	}
	if err == nil || !strings.Contains(err.Error(), "inspect_local_runtime_model_health") {
		t.Fatalf("expected action hint in structured error payload, got %v", err)
	}
	if err == nil || !strings.Contains(err.Error(), "stablediffusion backend") {
		t.Fatalf("expected unhealthy detail in structured error payload, got %v", err)
	}
}

func TestValidateLocalModelRequestPrefersWindowsModalEngines(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	origGOOS := localModelValidationGOOS
	localModelValidationGOOS = "windows"
	defer func() { localModelValidationGOOS = origGOOS }()

	page := &runtimev1.ListLocalModelsResponse{
		Models: []*runtimev1.LocalModelRecord{
			{ModelId: "qwen", Engine: "localai", LocalInvokeProfileId: "invoke"},
			{ModelId: "qwen", Engine: "nexa", LocalInvokeProfileId: "invoke"},
			{ModelId: "qwen", Engine: "nimi_media", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{page, page}}

	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_TTS); err != nil {
		t.Fatalf("expected windows tts local model validation success via nexa, got %v", err)
	}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_IMAGE); err != nil {
		t.Fatalf("expected windows image local model validation success via nimi_media, got %v", err)
	}
}

func TestLocalPreferredEnginesPrefersWindowsTextAndEmbeddingViaNexa(t *testing.T) {
	origGOOS := localModelValidationGOOS
	localModelValidationGOOS = "windows"
	defer func() { localModelValidationGOOS = origGOOS }()

	models := []*runtimev1.LocalModelRecord{
		{LocalModelId: "a", ModelId: "qwen", Engine: "localai"},
		{LocalModelId: "b", ModelId: "qwen", Engine: "nexa"},
		{LocalModelId: "c", ModelId: "qwen", Engine: "nimi_media"},
	}

	selected, reason := selectActiveLocalModel(models, localModelSelector{
		modelID:       "qwen",
		preferLocalAI: true,
		modal:         runtimev1.Modal_MODAL_TEXT,
	})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "nexa" {
		t.Fatalf("expected windows text route to prefer nexa, got engine=%v reason=%v", selected.GetEngine(), reason)
	}

	selected, reason = selectActiveLocalModel(models, localModelSelector{
		modelID:       "qwen",
		preferLocalAI: true,
		modal:         runtimev1.Modal_MODAL_EMBEDDING,
	})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "nexa" {
		t.Fatalf("expected windows embedding route to prefer nexa, got engine=%v reason=%v", selected.GetEngine(), reason)
	}
}
