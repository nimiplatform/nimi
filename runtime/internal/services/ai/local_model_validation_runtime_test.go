package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestValidateLocalModelRequestPrefersCanonicalTextEngineAndRejectsTargetlessImage(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)

	textPage := &runtimev1.ListLocalAssetsResponse{
		Assets: []*runtimev1.LocalAssetRecord{
			{AssetId: "qwen", Engine: "llama", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{textPage}}

	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_TEXT); err != nil {
		t.Fatalf("expected canonical text local model validation success via llama, got %v", err)
	}

	imagePage := &runtimev1.ListLocalAssetsResponse{
		Assets: []*runtimev1.LocalAssetRecord{
			{AssetId: "flux.1-schnell", Engine: "media", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{imagePage}}
	err := svc.validateLocalModelRequest(context.Background(), "local/flux.1-schnell", nil, runtimev1.Modal_MODAL_IMAGE)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("targetless image reason=%v ok=%v err=%v, want AI_LOCAL_MODEL_UNAVAILABLE", reason, ok, err)
	}
}

func TestValidateLocalModelRequestTargetlessInstalledImageDoesNotWarmOrStart(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger, Config{EnforceEndpointSecurity: true})
	loopbackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer func() { loopbackServer.Close() }()
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

	err := svc.validateLocalModelRequest(context.Background(), "local/flux.1-schnell", nil, runtimev1.Modal_MODAL_IMAGE)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("targetless installed image reason=%v ok=%v err=%v", reason, ok, err)
	}
	if imageLister.calls != 0 || imageLister.warmCalls != 0 || imageLister.startCalls != 0 {
		t.Fatalf("targetless image must not scan/warm/start: list=%d warm=%d start=%d", imageLister.calls, imageLister.warmCalls, imageLister.startCalls)
	}
}

func TestValidateLocalModelRequestTargetlessInstalledImageDoesNotPrimeManagedProfile(t *testing.T) {
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
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("targetless installed image reason=%v ok=%v err=%v", reason, ok, err)
	}
	if resolver.resolveProfileCalls != 0 {
		t.Fatalf("targetless image must not prime a managed profile, got %d calls", resolver.resolveProfileCalls)
	}
	if imageLister.calls != 0 || imageLister.startCalls != 0 {
		t.Fatalf("targetless image must not scan or start: list=%d start=%d", imageLister.calls, imageLister.startCalls)
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

func TestValidateLocalModelRequestTargetlessInstalledImageIgnoresStartResult(t *testing.T) {
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
	if imageLister.calls != 0 || imageLister.startCalls != 0 {
		t.Fatalf("targetless image must not scan or start: list=%d start=%d", imageLister.calls, imageLister.startCalls)
	}
}

func TestValidateLocalModelRequestTargetlessInstalledImageNeverUsesStartToActivate(t *testing.T) {
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
	if imageLister.calls != 0 || imageLister.startCalls != 0 {
		t.Fatalf("targetless image must not scan or start: list=%d start=%d", imageLister.calls, imageLister.startCalls)
	}
}

func TestValidateLocalModelRequestTargetlessUnhealthyImageDoesNotRetryStart(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger, Config{EnforceEndpointSecurity: true})
	loopbackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer func() { loopbackServer.Close() }()

	imageLister := &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId:         "local-image-unhealthy",
			AssetId:              "flux.1-schnell",
			Engine:               "media",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
			LocalInvokeProfileId: "invoke",
			Capabilities:         []string{"image.generate"},
			Endpoint:             loopbackServer.URL + "/v1",
			HealthDetail:         "managed local image backend validation failed: stale failure",
		}},
	}},
		startResp: &runtimev1.StartLocalAssetResponse{
			Asset: &runtimev1.LocalAssetRecord{
				LocalAssetId:         "local-image-unhealthy",
				AssetId:              "flux.1-schnell",
				Engine:               "media",
				Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				LocalInvokeProfileId: "invoke",
				Capabilities:         []string{"image.generate"},
				Endpoint:             loopbackServer.URL + "/v1",
				HealthDetail:         "managed local image active; backend load verified",
			},
		},
	}
	svc.localModel = imageLister

	err := svc.validateLocalModelRequest(context.Background(), "local/flux.1-schnell", nil, runtimev1.Modal_MODAL_IMAGE)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("targetless unhealthy image reason=%v ok=%v err=%v", reason, ok, err)
	}
	if imageLister.calls != 0 || imageLister.startCalls != 0 {
		t.Fatalf("targetless unhealthy image must not scan or retry start: list=%d start=%d", imageLister.calls, imageLister.startCalls)
	}
}

func TestValidateLocalModelRequestTargetlessUnhealthyImageRejectsDynamicProfileOverrides(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger, Config{EnforceEndpointSecurity: true})
	loopbackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer func() { loopbackServer.Close() }()

	imageLister := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId:         "local-image-unhealthy",
				AssetId:              "z_image_turbo-Q4_K",
				Engine:               "media",
				Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
				LocalInvokeProfileId: "invoke",
				Capabilities:         []string{"image.generate"},
				Endpoint:             loopbackServer.URL + "/v1",
				HealthDetail:         "managed local image backend validation failed: stale failure",
			}},
		}},
		startResp: &runtimev1.StartLocalAssetResponse{Asset: &runtimev1.LocalAssetRecord{
			LocalAssetId:         "local-image-unhealthy",
			AssetId:              "z_image_turbo-Q4_K",
			Engine:               "media",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			LocalInvokeProfileId: "invoke",
			Capabilities:         []string{"image.generate"},
			Endpoint:             loopbackServer.URL + "/v1",
			HealthDetail:         "managed local image active; backend load verified",
		}},
	}
	resolver := &fakeLocalImageProfileResolver{
		alias:          "dynamic-profile",
		profile:        map[string]any{"name": "dynamic-profile"},
		backendAddress: "127.0.0.1:50052",
		modelsRoot:     "/tmp/models",
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
		"local/z_image_turbo-Q4_K",
		nil,
		runtimev1.Modal_MODAL_IMAGE,
		map[string]any{
			"profile_entries": []any{
				map[string]any{"entryId": "main", "kind": "asset", "capability": "image", "assetId": "z_image_turbo-Q4_K", "assetKind": "image"},
			},
			"entry_overrides": []any{
				map[string]any{"entry_id": "main", "local_asset_id": "local-image-unhealthy"},
			},
		},
	)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("targetless unhealthy image reason=%v ok=%v err=%v", reason, ok, err)
	}
	if resolver.resolveProfileCalls != 0 {
		t.Fatalf("targetless image must not resolve dynamic profile overrides, got %d calls", resolver.resolveProfileCalls)
	}
	if imageLister.calls != 0 || imageLister.startCalls != 0 {
		t.Fatalf("targetless image must not scan or start: list=%d start=%d", imageLister.calls, imageLister.startCalls)
	}
}

func TestLocalPreferredEnginesPrefersCanonicalEngines(t *testing.T) {
	models := []*runtimev1.LocalAssetRecord{
		{LocalAssetId: "a", AssetId: "qwen", Engine: "llama", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE},
		{LocalAssetId: "b", AssetId: "qwen", Engine: "media", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE},
		{LocalAssetId: "c", AssetId: "qwen", Engine: "sidecar", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE},
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

func TestSelectRunnableLocalModelRejectsCompanionOnlyImageAssets(t *testing.T) {
	models := []*runtimev1.LocalAssetRecord{{
		LocalAssetId:   "local-ideogram4-uncond",
		AssetId:        "local-import/ideogram4_uncond-Q4_0",
		Engine:         "media",
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Capabilities:   []string{"image.generate"},
		ArtifactRoles:  []string{"uncond_diffusion_model"},
		LogicalModelId: "nimi/local-import-ideogram4-uncond-q4-0",
	}}

	selected, reason, detail := selectRunnableLocalModel(
		models,
		parseLocalModelSelector("local/local-import/ideogram4_uncond-Q4_0", runtimev1.Modal_MODAL_IMAGE),
	)

	if selected != nil {
		t.Fatalf("companion-only image asset must not be selected as a primary runnable model: %+v", selected)
	}
	if reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("reason = %s, want AI_LOCAL_MODEL_UNAVAILABLE", reason)
	}
	if detail != "" {
		t.Fatalf("detail = %q, want empty", detail)
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
