package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
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
	warmErr   error
	warmCalls int
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

func (f *fakeLocalModelLister) WarmLocalModel(_ context.Context, _ *runtimev1.WarmLocalModelRequest) (*runtimev1.WarmLocalModelResponse, error) {
	f.warmCalls++
	if f.warmErr != nil {
		return nil, f.warmErr
	}
	return &runtimev1.WarmLocalModelResponse{}, nil
}

func TestParseLocalModelSelector(t *testing.T) {
	tests := []struct {
		modelID        string
		explicitEngine string
		preferLocal    bool
		normalizedID   string
		modal          runtimev1.Modal
	}{
		{modelID: "llama/qwen", explicitEngine: "llama", normalizedID: "qwen"},
		{modelID: "media/qwen", explicitEngine: "media", normalizedID: "qwen"},
		{modelID: "speech/qwen", explicitEngine: "speech", normalizedID: "qwen"},
		{modelID: "sidecar/qwen", explicitEngine: "sidecar", normalizedID: "qwen"},
		{modelID: "local/qwen", preferLocal: true, normalizedID: "qwen", modal: runtimev1.Modal_MODAL_VIDEO},
		{modelID: "raw-model", normalizedID: "raw-model"},
		{modelID: "   ", normalizedID: ""},
	}

	for _, tt := range tests {
		sel := parseLocalModelSelector(tt.modelID, tt.modal)
		if sel.explicitEngine != tt.explicitEngine || sel.preferLocal != tt.preferLocal || sel.modelID != tt.normalizedID || sel.modal != tt.modal {
			t.Fatalf("selector mismatch for %q: %+v", tt.modelID, sel)
		}
	}
}

func TestSelectActiveLocalModel(t *testing.T) {
	models := []*runtimev1.LocalModelRecord{
		{LocalModelId: "b", ModelId: "qwen", Engine: "media"},
		{LocalModelId: "c", ModelId: "qwen", Engine: "sidecar"},
		{LocalModelId: "a", ModelId: "qwen", Engine: "llama"},
	}

	selected, reason := selectActiveLocalModel(models, localModelSelector{modelID: "qwen"})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "llama" {
		t.Fatalf("expected llama prioritized, got selected=%v reason=%v", selected.GetEngine(), reason)
	}

	selected, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", explicitEngine: "media", modal: runtimev1.Modal_MODAL_IMAGE})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "media" {
		t.Fatalf("expected explicit media, got selected=%v reason=%v", selected.GetEngine(), reason)
	}

	selected, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", explicitEngine: "sidecar", modal: runtimev1.Modal_MODAL_MUSIC})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "sidecar" {
		t.Fatalf("expected explicit sidecar, got selected=%v reason=%v", selected.GetEngine(), reason)
	}

	_, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", explicitEngine: "unknown"})
	if reason != runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH {
		t.Fatalf("expected provider mismatch, got %v", reason)
	}

	selected, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", preferLocal: true})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "llama" {
		t.Fatalf("expected prefer local llama, got selected=%v reason=%v", selected.GetEngine(), reason)
	}

	_, reason = selectActiveLocalModel(models, localModelSelector{modelID: "absent"})
	if reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected unavailable, got %v", reason)
	}
}

func TestLocalEnginePriorityAndProfileRequirement(t *testing.T) {
	if localEnginePriority("llama") >= localEnginePriority("media") {
		t.Fatalf("unexpected local engine priority ordering")
	}
	if localEnginePriority("sidecar") != len(localPreferredEngines(runtimev1.Modal_MODAL_UNSPECIFIED)) {
		t.Fatalf("unsupported text engines should rank after supported providers")
	}
	if localEnginePriority("other") < localEnginePriority("sidecar") {
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
		Models: []*runtimev1.LocalModelRecord{{ModelId: "other", Engine: "llama"}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected local model unavailable, got=%v ok=%v", reason, ok)
	}

	// Missing invoke profile for custom capability should fail.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "qwen", Engine: "llama", Capabilities: []string{"custom"}}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING {
		t.Fatalf("expected profile missing, got=%v ok=%v", reason, ok)
	}

	// Explicit unsupported engine/capability combination should fail route unsupported.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "qwen", Engine: "llama"}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "media/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("expected route unsupported, got=%v ok=%v", reason, ok)
	}

	// Success path.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "qwen", Engine: "llama", LocalInvokeProfileId: "invoke"}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected local model validation success, got %v", err)
	}

	loopbackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer loopbackServer.Close()
	svc = newTestService(logger, Config{EnforceEndpointSecurity: true})
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{
			ModelId:  "qwen",
			Engine:   "llama",
			Status:   runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			Endpoint: loopbackServer.URL + "/v1",
		}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected local model validation to hydrate active endpoint, got %v", err)
	}
	local, ok := svc.selector.local.(*localProvider)
	if !ok || local == nil {
		t.Fatalf("expected local provider after validation")
	}
	backend, resolved, explicit, available := local.pickAvailabilityBackend("qwen")
	if backend == nil || !available {
		t.Fatalf("expected hydrated llama backend, backend=%v available=%v", backend, available)
	}
	if resolved != "qwen" || explicit {
		t.Fatalf("unexpected hydrated backend resolution: resolved=%q explicit=%v", resolved, explicit)
	}

	// Same modelId across engines should respect explicit engine selector.
	dualEnginePage := &runtimev1.ListLocalModelsResponse{
		Models: []*runtimev1.LocalModelRecord{
			{ModelId: "qwen", Engine: "llama", LocalInvokeProfileId: "invoke"},
			{ModelId: "qwen", Engine: "sidecar", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{
		dualEnginePage,
		dualEnginePage,
	}}
	if err := svc.validateLocalModelRequest(context.Background(), "llama/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected llama selector to succeed, got %v", err)
	}
	if err := svc.validateLocalModelRequest(context.Background(), "sidecar/qwen", nil, runtimev1.Modal_MODAL_MUSIC); err != nil {
		t.Fatalf("expected sidecar selector to succeed, got %v", err)
	}
	dualEnginePageWithSidecar := &runtimev1.ListLocalModelsResponse{
		Models: []*runtimev1.LocalModelRecord{
			{ModelId: "qwen", Engine: "llama", LocalInvokeProfileId: "invoke"},
			{ModelId: "qwen", Engine: "sidecar", LocalInvokeProfileId: "invoke"},
			{ModelId: "qwen", Engine: "media", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{
		dualEnginePageWithSidecar,
		dualEnginePageWithSidecar,
	}}
	if err := svc.validateLocalModelRequest(context.Background(), "sidecar/qwen", nil, runtimev1.Modal_MODAL_MUSIC); err != nil {
		t.Fatalf("expected sidecar selector to succeed, got %v", err)
	}

	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{
			ModelId:              "kokoro-tts",
			Engine:               "speech",
			Status:               runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			LocalInvokeProfileId: "invoke",
		}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "speech/kokoro-tts", nil, runtimev1.Modal_MODAL_TTS); err != nil {
		t.Fatalf("expected speech selector to succeed, got %v", err)
	}

	// Case-insensitive modelId matching should succeed across desktop/go-runtime normalization.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{ModelId: "Qwen", Engine: "llama", LocalInvokeProfileId: "invoke"}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected case-insensitive local model validation success, got %v", err)
	}

	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{
			ModelId:              "local/qwen3-4b-q4_k_m",
			Engine:               "llama",
			Status:               runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			LocalInvokeProfileId: "invoke",
		}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen3-4b-q4_k_m", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected qualified local model id validation success, got %v", err)
	}

	installedLister := &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{
			LocalModelId:         "local-installed",
			ModelId:              "qwen-installed",
			Engine:               "llama",
			Status:               runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
			LocalInvokeProfileId: "invoke",
		}},
	}}}
	svc.localModel = installedLister
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen-installed", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected installed local model validation success via warm, got %v", err)
	}
	if installedLister.warmCalls != 1 {
		t.Fatalf("expected installed model to trigger warm, got %d", installedLister.warmCalls)
	}

	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalModelsResponse{{
			Models: []*runtimev1.LocalModelRecord{{
				LocalModelId: "local-failed-warm",
				ModelId:      "qwen-failed-warm",
				Engine:       "llama",
				Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
			}},
		}},
		warmErr: errors.New("warm failed"),
	}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen-failed-warm", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected warm failure to map to local model unavailable, got=%v ok=%v", reason, ok)
	}
}

func TestValidateLocalModelRequestRejectsUnsupportedExplicitEngineModal(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{
			{ModelId: "wan2.2", Engine: "llama", LocalInvokeProfileId: "invoke"},
		},
	}}}

	err := svc.validateLocalModelRequest(context.Background(), "llama/wan2.2", nil, runtimev1.Modal_MODAL_VIDEO)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("expected route unsupported, got=%v ok=%v", reason, ok)
	}
}

func TestValidateLocalModelRequestIncludesUnhealthyDetail(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{{
		Models: []*runtimev1.LocalModelRecord{{
			ModelId:      "unsloth/Z-Image-Turbo-GGUF",
			Engine:       "media",
			Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
			HealthDetail: "media supervised mode requires a CUDA-ready NVIDIA runtime",
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
	if err == nil || !strings.Contains(err.Error(), "CUDA-ready NVIDIA runtime") {
		t.Fatalf("expected unhealthy detail in structured error payload, got %v", err)
	}
}

func TestValidateLocalModelRequestPrefersCanonicalModalEngines(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)

	textPage := &runtimev1.ListLocalModelsResponse{
		Models: []*runtimev1.LocalModelRecord{
			{ModelId: "qwen", Engine: "llama", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{textPage}}

	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_TEXT); err != nil {
		t.Fatalf("expected canonical text local model validation success via llama, got %v", err)
	}

	imagePage := &runtimev1.ListLocalModelsResponse{
		Models: []*runtimev1.LocalModelRecord{
			{ModelId: "flux.1-schnell", Engine: "media", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{imagePage}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/flux.1-schnell", nil, runtimev1.Modal_MODAL_IMAGE); err != nil {
		t.Fatalf("expected canonical image local model validation success via media, got %v", err)
	}
}

func TestValidateLocalModelRequestHardCutDoesNotFallbackAcrossEngines(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)

	page := &runtimev1.ListLocalModelsResponse{
		Models: []*runtimev1.LocalModelRecord{
			{ModelId: "qwen", Engine: "llama", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{page, page}}

	err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_IMAGE)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected image hard-cut to fail without media, got=%v ok=%v", reason, ok)
	}

	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalModelsResponse{page, page}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_MUSIC)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected music hard-cut to fail without sidecar, got=%v ok=%v", reason, ok)
	}
}

func TestLocalPreferredEnginesPrefersCanonicalEngines(t *testing.T) {
	models := []*runtimev1.LocalModelRecord{
		{LocalModelId: "a", ModelId: "qwen", Engine: "llama"},
		{LocalModelId: "b", ModelId: "qwen", Engine: "media"},
		{LocalModelId: "c", ModelId: "qwen", Engine: "sidecar"},
	}

	selected, reason := selectActiveLocalModel(models, localModelSelector{
		modelID:     "qwen",
		preferLocal: true,
		modal:       runtimev1.Modal_MODAL_TEXT,
	})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "llama" {
		t.Fatalf("expected text route to prefer llama, got engine=%v reason=%v", selected.GetEngine(), reason)
	}

	selected, reason = selectActiveLocalModel(models, localModelSelector{
		modelID:     "qwen",
		preferLocal: true,
		modal:       runtimev1.Modal_MODAL_EMBEDDING,
	})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "llama" {
		t.Fatalf("expected embedding route to prefer llama, got engine=%v reason=%v", selected.GetEngine(), reason)
	}

	selected, reason = selectActiveLocalModel(models, localModelSelector{
		modelID:     "qwen",
		preferLocal: true,
		modal:       runtimev1.Modal_MODAL_IMAGE,
	})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "media" {
		t.Fatalf("expected image route to prefer media, got engine=%v reason=%v", selected.GetEngine(), reason)
	}
}

func TestLocalUnavailableStatusPriority(t *testing.T) {
	cases := []struct {
		status runtimev1.LocalModelStatus
		want   int
	}{
		{runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, 0},
		{runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED, 1},
		{runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE, 2},
		{runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED, 3},
	}
	for _, tc := range cases {
		got := localUnavailableStatusPriority(tc.status)
		if got != tc.want {
			t.Errorf("localUnavailableStatusPriority(%v) = %d, want %d", tc.status, got, tc.want)
		}
	}
}

func TestLocalModelStatusLabel(t *testing.T) {
	cases := []struct {
		status runtimev1.LocalModelStatus
		want   string
	}{
		{runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE, "active"},
		{runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED, "installed"},
		{runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, "unhealthy"},
		{runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED, "removed"},
	}
	for _, tc := range cases {
		got := localModelStatusLabel(tc.status)
		if got != tc.want {
			t.Errorf("localModelStatusLabel(%v) = %q, want %q", tc.status, got, tc.want)
		}
	}
}
