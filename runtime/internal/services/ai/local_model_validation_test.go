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
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type fakeLocalModelLister struct {
	responses  []*runtimev1.ListLocalAssetsResponse
	err        error
	calls      int
	warmErr    error
	warmCalls  int
	startErr   error
	startCalls int
	startResp  *runtimev1.StartLocalAssetResponse
}

func (f *fakeLocalModelLister) ListLocalAssets(_ context.Context, _ *runtimev1.ListLocalAssetsRequest) (*runtimev1.ListLocalAssetsResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	if f.calls >= len(f.responses) {
		return &runtimev1.ListLocalAssetsResponse{}, nil
	}
	resp := f.responses[f.calls]
	f.calls++
	return resp, nil
}

func (f *fakeLocalModelLister) WarmLocalAsset(_ context.Context, _ *runtimev1.WarmLocalAssetRequest) (*runtimev1.WarmLocalAssetResponse, error) {
	f.warmCalls++
	if f.warmErr != nil {
		return nil, f.warmErr
	}
	return &runtimev1.WarmLocalAssetResponse{}, nil
}

func (f *fakeLocalModelLister) StartLocalAsset(_ context.Context, _ *runtimev1.StartLocalAssetRequest) (*runtimev1.StartLocalAssetResponse, error) {
	f.startCalls++
	if f.startErr != nil {
		return nil, f.startErr
	}
	if f.startResp != nil {
		return f.startResp, nil
	}
	return &runtimev1.StartLocalAssetResponse{}, nil
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
	models := []*runtimev1.LocalAssetRecord{
		{LocalAssetId: "b", AssetId: "qwen", Engine: "media"},
		{LocalAssetId: "c", AssetId: "qwen", Engine: "sidecar"},
		{LocalAssetId: "a", AssetId: "qwen", Engine: "llama"},
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

	if modelRequiresInvokeProfile(&runtimev1.LocalAssetRecord{LocalInvokeProfileId: "profile-1"}) {
		t.Fatalf("profile id should satisfy requirement")
	}
	if !modelRequiresInvokeProfile(&runtimev1.LocalAssetRecord{Capabilities: []string{"custom.voice"}}) {
		t.Fatalf("custom capability should require invoke profile")
	}
	if modelRequiresInvokeProfile(&runtimev1.LocalAssetRecord{Capabilities: []string{"chat"}}) {
		t.Fatalf("non-custom capabilities should not require profile")
	}
}

func TestListAllActiveLocalModelsPagination(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{
			{Assets: []*runtimev1.LocalAssetRecord{{LocalAssetId: "1"}}, NextPageToken: "next"},
			{Assets: []*runtimev1.LocalAssetRecord{{LocalAssetId: "2"}}},
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
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{AssetId: "other", Engine: "llama"}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected local model unavailable, got=%v ok=%v", reason, ok)
	}

	// Missing invoke profile for custom capability should fail.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{AssetId: "qwen", Engine: "llama", Capabilities: []string{"custom"}}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING {
		t.Fatalf("expected profile missing, got=%v ok=%v", reason, ok)
	}

	// Explicit unsupported engine/capability combination should fail route unsupported.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{AssetId: "qwen", Engine: "llama"}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "media/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("expected route unsupported, got=%v ok=%v", reason, ok)
	}

	// Success path.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{AssetId: "qwen", Engine: "llama", LocalInvokeProfileId: "invoke"}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected local model validation success, got %v", err)
	}

	loopbackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer loopbackServer.Close()
	svc = newTestService(logger, Config{EnforceEndpointSecurity: true})
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			AssetId:  "qwen",
			Engine:   "llama",
			Status:   runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
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
	dualEnginePage := &runtimev1.ListLocalAssetsResponse{
		Assets: []*runtimev1.LocalAssetRecord{
			{AssetId: "qwen", Engine: "llama", LocalInvokeProfileId: "invoke"},
			{AssetId: "qwen", Engine: "sidecar", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{
		dualEnginePage,
		dualEnginePage,
	}}
	if err := svc.validateLocalModelRequest(context.Background(), "llama/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected llama selector to succeed, got %v", err)
	}
	if err := svc.validateLocalModelRequest(context.Background(), "sidecar/qwen", nil, runtimev1.Modal_MODAL_MUSIC); err != nil {
		t.Fatalf("expected sidecar selector to succeed, got %v", err)
	}
	dualEnginePageWithSidecar := &runtimev1.ListLocalAssetsResponse{
		Assets: []*runtimev1.LocalAssetRecord{
			{AssetId: "qwen", Engine: "llama", LocalInvokeProfileId: "invoke"},
			{AssetId: "qwen", Engine: "sidecar", LocalInvokeProfileId: "invoke"},
			{AssetId: "qwen", Engine: "media", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{
		dualEnginePageWithSidecar,
		dualEnginePageWithSidecar,
	}}
	if err := svc.validateLocalModelRequest(context.Background(), "sidecar/qwen", nil, runtimev1.Modal_MODAL_MUSIC); err != nil {
		t.Fatalf("expected sidecar selector to succeed, got %v", err)
	}

	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			AssetId:              "kokoro-tts",
			Engine:               "speech",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			LocalInvokeProfileId: "invoke",
		}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "speech/kokoro-tts", nil, runtimev1.Modal_MODAL_TTS); err != nil {
		t.Fatalf("expected speech selector to succeed, got %v", err)
	}

	// Case-insensitive modelId matching should succeed across desktop/go-runtime normalization.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{AssetId: "Qwen", Engine: "llama", LocalInvokeProfileId: "invoke"}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected case-insensitive local model validation success, got %v", err)
	}

	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			AssetId:              "local/qwen3-4b-q4_k_m",
			Engine:               "llama",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			LocalInvokeProfileId: "invoke",
		}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen3-4b-q4_k_m", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected qualified local model id validation success, got %v", err)
	}

	installedLister := &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId:         "local-installed",
			AssetId:              "qwen-installed",
			Engine:               "llama",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			LocalInvokeProfileId: "invoke",
			Capabilities:         []string{"chat"},
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
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "local-failed-warm",
				AssetId:      "qwen-failed-warm",
				Engine:       "llama",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
				Capabilities: []string{"chat"},
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
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{
			{AssetId: "wan2.2", Engine: "llama", LocalInvokeProfileId: "invoke"},
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
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			AssetId:      "unsloth/Z-Image-Turbo-GGUF",
			Engine:       "media",
			Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
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

	textPage := &runtimev1.ListLocalAssetsResponse{
		Assets: []*runtimev1.LocalAssetRecord{
			{AssetId: "qwen", Engine: "llama", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{textPage}}

	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_TEXT); err != nil {
		t.Fatalf("expected canonical text local model validation success via llama, got %v", err)
	}

	imagePage := &runtimev1.ListLocalAssetsResponse{
		Assets: []*runtimev1.LocalAssetRecord{
			{AssetId: "flux.1-schnell", Engine: "media", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{imagePage}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/flux.1-schnell", nil, runtimev1.Modal_MODAL_IMAGE); err != nil {
		t.Fatalf("expected canonical image local model validation success via media, got %v", err)
	}
}

func TestValidateLocalModelRequestInstalledImageDoesNotWarmTextOnlyAssets(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger, Config{EnforceEndpointSecurity: true})
	loopbackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer loopbackServer.Close()
	imageLister := &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId:         "local-image-installed",
			AssetId:              "flux.1-schnell",
			Engine:               "media",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			LocalInvokeProfileId: "invoke",
			Capabilities:         []string{"image.generate"},
			Endpoint:             loopbackServer.URL + "/v1",
		}},
	}},
		startResp: &runtimev1.StartLocalAssetResponse{
			Asset: &runtimev1.LocalAssetRecord{
				LocalAssetId:         "local-image-installed",
				AssetId:              "flux.1-schnell",
				Engine:               "media",
				Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				LocalInvokeProfileId: "invoke",
				Capabilities:         []string{"image.generate"},
				Endpoint:             loopbackServer.URL + "/v1",
			},
		},
	}
	svc.localModel = imageLister

	if err := svc.validateLocalModelRequest(context.Background(), "local/flux.1-schnell", nil, runtimev1.Modal_MODAL_IMAGE); err != nil {
		t.Fatalf("expected installed image local model validation to start and succeed, got %v", err)
	}
	if imageLister.warmCalls != 0 {
		t.Fatalf("installed image local model must not call warm, got %d", imageLister.warmCalls)
	}
	if imageLister.startCalls != 1 {
		t.Fatalf("installed image local model must call start exactly once, got %d", imageLister.startCalls)
	}
	local, ok := svc.selector.local.(*localProvider)
	if !ok || local == nil {
		t.Fatalf("expected local provider after image validation")
	}
	backend, resolved, providerType := local.resolveMediaBackendForModal("media/flux.1-schnell", runtimev1.Modal_MODAL_IMAGE)
	if backend == nil || providerType != "media" {
		t.Fatalf("expected installed image local model to hydrate media backend, backend=%v provider=%q", backend, providerType)
	}
	if resolved != "flux.1-schnell" {
		t.Fatalf("unexpected hydrated image backend resolution: %q", resolved)
	}
}

func TestValidateLocalModelRequestInstalledImagePrimesManagedProfileBeforeStart(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger, Config{EnforceEndpointSecurity: true})
	imageLister := &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId:         "local-image-installed",
			AssetId:              "flux.1-schnell",
			Engine:               "media",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			LocalInvokeProfileId: "invoke",
			Capabilities:         []string{"image.generate"},
			Endpoint:             "http://127.0.0.1:8321/v1",
		}},
	}},
		startResp: &runtimev1.StartLocalAssetResponse{
			Asset: &runtimev1.LocalAssetRecord{
				LocalAssetId:         "local-image-installed",
				AssetId:              "flux.1-schnell",
				Engine:               "media",
				Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				LocalInvokeProfileId: "invoke",
				Capabilities:         []string{"image.generate"},
				Endpoint:             "http://127.0.0.1:8321/v1",
			},
		},
	}
	resolver := &fakeLocalImageProfileResolver{
		alias: "nimi-img-probe",
		profile: map[string]any{
			"backend": "stablediffusion-ggml",
			"parameters": map[string]any{
				"model": "resolved/flux/model.gguf",
			},
		},
		selection: engine.ImageSupervisedMatrixSelection{
			Matched:        true,
			EntryID:        "macos-apple-silicon-gguf",
			ProductState:   engine.ImageProductStateSupported,
			BackendClass:   engine.ImageBackendClassNativeBinary,
			BackendFamily:  engine.ImageBackendFamilyStableDiffusionGGML,
			ControlPlane:   engine.ImageControlPlaneRuntime,
			ExecutionPlane: engine.EngineMedia,
			Entry: &engine.ImageSupervisedMatrixEntry{
				EntryID:        "macos-apple-silicon-gguf",
				ProductState:   engine.ImageProductStateSupported,
				BackendClass:   engine.ImageBackendClassNativeBinary,
				BackendFamily:  engine.ImageBackendFamilyStableDiffusionGGML,
				ControlPlane:   engine.ImageControlPlaneRuntime,
				ExecutionPlane: engine.EngineMedia,
			},
		},
	}
	svc.localModel = imageLister
	svc.localImageProfile = resolver

	err := svc.validateLocalModelRequestWithExtensions(
		context.Background(),
		"local/flux.1-schnell",
		nil,
		runtimev1.Modal_MODAL_IMAGE,
		map[string]any{
			"profile_entries": []any{
				map[string]any{"entryId": "main", "kind": "asset", "capability": "image", "assetId": "flux.1-schnell", "assetKind": "image"},
			},
		},
	)
	if err != nil {
		t.Fatalf("expected installed image local model validation success, got %v", err)
	}
	if resolver.resolveProfileCalls != 1 {
		t.Fatalf("expected managed image profile to be primed once, got %d", resolver.resolveProfileCalls)
	}
	if resolver.lastRequestedModel != "local/flux.1-schnell" {
		t.Fatalf("unexpected primed model id: %q", resolver.lastRequestedModel)
	}
	if imageLister.startCalls != 1 {
		t.Fatalf("expected installed image local model to start once, got %d", imageLister.startCalls)
	}
}

func TestValidateLocalModelRequestHardCutDoesNotFallbackAcrossEngines(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)

	page := &runtimev1.ListLocalAssetsResponse{
		Assets: []*runtimev1.LocalAssetRecord{
			{AssetId: "qwen", Engine: "llama", LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{page, page}}

	err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_IMAGE)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected image hard-cut to fail without media, got=%v ok=%v", reason, ok)
	}

	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{page, page}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_MUSIC)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected music hard-cut to fail without sidecar, got=%v ok=%v", reason, ok)
	}
}

func TestValidateLocalModelRequestInstalledImageFailsClosedWhenStartDoesNotActivate(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger, Config{EnforceEndpointSecurity: true})
	imageLister := &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId:         "local-image-installed",
			AssetId:              "flux.1-schnell",
			Engine:               "media",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			LocalInvokeProfileId: "invoke",
			Capabilities:         []string{"image.generate"},
			Endpoint:             "http://127.0.0.1:8321/v1",
		}},
	}},
		startResp: &runtimev1.StartLocalAssetResponse{
			Asset: &runtimev1.LocalAssetRecord{
				LocalAssetId:         "local-image-installed",
				AssetId:              "flux.1-schnell",
				Engine:               "media",
				Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
				LocalInvokeProfileId: "invoke",
				Capabilities:         []string{"image.generate"},
				Endpoint:             "http://127.0.0.1:8321/v1",
				HealthDetail:         "probe request failed: dial tcp 127.0.0.1:8321: connect: connection refused",
			},
		},
	}
	svc.localModel = imageLister

	err := svc.validateLocalModelRequest(context.Background(), "local/flux.1-schnell", nil, runtimev1.Modal_MODAL_IMAGE)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE, got err=%v reason=%v", err, reason)
	}
	if !strings.Contains(err.Error(), "connection refused") {
		t.Fatalf("expected start failure detail to be preserved, got %v", err)
	}
}

func TestValidateLocalModelRequestInstalledImageFailsClosedWhenStartLeavesInstalled(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger, Config{EnforceEndpointSecurity: true})
	imageLister := &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId:         "local-image-installed",
			AssetId:              "flux.1-schnell",
			Engine:               "media",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			LocalInvokeProfileId: "invoke",
			Capabilities:         []string{"image.generate"},
			Endpoint:             "http://127.0.0.1:8321/v1",
		}},
	}},
		startResp: &runtimev1.StartLocalAssetResponse{
			Asset: &runtimev1.LocalAssetRecord{
				LocalAssetId:         "local-image-installed",
				AssetId:              "flux.1-schnell",
				Engine:               "media",
				Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
				LocalInvokeProfileId: "invoke",
				Capabilities:         []string{"image.generate"},
				Endpoint:             "http://127.0.0.1:8321/v1",
				HealthDetail:         "managed local model ready (not started)",
			},
		},
	}
	svc.localModel = imageLister

	err := svc.validateLocalModelRequest(context.Background(), "local/flux.1-schnell", nil, runtimev1.Modal_MODAL_IMAGE)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE, got err=%v reason=%v", err, reason)
	}
	if !strings.Contains(err.Error(), "not started") {
		t.Fatalf("expected installed start detail to be preserved, got %v", err)
	}
}

func TestLocalPreferredEnginesPrefersCanonicalEngines(t *testing.T) {
	models := []*runtimev1.LocalAssetRecord{
		{LocalAssetId: "a", AssetId: "qwen", Engine: "llama"},
		{LocalAssetId: "b", AssetId: "qwen", Engine: "media"},
		{LocalAssetId: "c", AssetId: "qwen", Engine: "sidecar"},
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
		status runtimev1.LocalAssetStatus
		want   int
	}{
		{runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, 0},
		{runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED, 1},
		{runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, 2},
		{runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED, 3},
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
		status runtimev1.LocalAssetStatus
		want   string
	}{
		{runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, "active"},
		{runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED, "installed"},
		{runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, "unhealthy"},
		{runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED, "removed"},
	}
	for _, tc := range cases {
		got := localModelStatusLabel(tc.status)
		if got != tc.want {
			t.Errorf("localModelStatusLabel(%v) = %q, want %q", tc.status, got, tc.want)
		}
	}
}
