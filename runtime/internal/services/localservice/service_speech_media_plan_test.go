package localservice

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
)

func TestResolveModelInstallPlanSpeechSupervisedRequiresExplicitDownloadConfirmation(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	setLocalRuntimePlatformForTest(t, "linux", "arm64")

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ModelId:      "local/qwen3-asr",
		Engine:       "speech",
		Capabilities: []string{"audio.transcribe"},
	})
	if err != nil {
		t.Fatalf("resolve speech supervised plan: %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetInstallAvailable() {
		t.Fatalf("speech supervised plan must require explicit download confirmation")
	}
	if got := plan.GetEngineRuntimeMode(); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("expected supervised runtime mode, got %s", got)
	}
	if plan.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED.String() {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
}

func TestResolveModelInstallPlanSpeechAttachedEndpointDoesNotRequireExplicitDownloadConfirmation(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "linux", "arm64")

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ModelId:      "local/qwen3-asr-attached",
		Engine:       "speech",
		Capabilities: []string{"audio.transcribe"},
		Endpoint:     "http://127.0.0.1:19191/v1",
	})
	if err != nil {
		t.Fatalf("resolve speech attached plan: %v", err)
	}
	plan := resp.GetPlan()
	if !plan.GetInstallAvailable() {
		t.Fatalf("speech attached-endpoint plan should remain installable")
	}
	if got := plan.GetEngineRuntimeMode(); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT {
		t.Fatalf("expected attached runtime mode, got %s", got)
	}
	if plan.GetReasonCode() != "ACTION_EXECUTED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
}

func TestStartLocalModelSpeechMissingCapabilityProjectsBundleReasonCode(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe succeeded",
			probeURL:  endpoint,
			models:    []string{"speech/whisper-large-v3"},
			modelCaps: map[string][]string{
				"speech/whisper-large-v3": {"audio.synthesize"},
			},
		}
	})

	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "speech/whisper-large-v3",
		capabilities: []string{"audio.transcribe"},
		engine:       "speech",
		endpoint:     "http://127.0.0.1:18181/v1",
	})
	if err != nil {
		t.Fatalf("install speech model: %v", err)
	}

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{LocalAssetId: installed.GetLocalAssetId()})
	if err != nil {
		t.Fatalf("start speech model: %v", err)
	}
	if started.GetAsset().GetReasonCode() != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		t.Fatalf("unexpected asset reason code: %s", started.GetAsset().GetReasonCode())
	}
}

func TestResolveModelInstallPlanMediaVideoSupervisedUnsupportedHost(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setUnsupportedGPUProbeForTest(t)

	svc.mu.Lock()
	svc.catalog = append(svc.catalog, &runtimev1.LocalCatalogModelDescriptor{
		ItemId:            "catalog.media.supervised.unsupported",
		Source:            "verified",
		Title:             "Unsupported Media",
		ModelId:           "local/flux-1-schnell",
		Engine:            "media",
		EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		InstallKind:       "download",
		Capabilities:      []string{"video"},
	})
	svc.mu.Unlock()

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ItemId: "catalog.media.supervised.unsupported",
	})
	if err != nil {
		t.Fatalf("resolve supervised media plan: %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetInstallAvailable() {
		t.Fatalf("unsupported supervised media video plan must be unavailable")
	}
	if plan.GetReasonCode() != "LOCAL_ENGINE_ATTACHED_ENDPOINT_ONLY" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
	if !containsWarning(plan.GetWarnings(), warnMediaAttachedOnly) {
		t.Fatalf("expected attached-only warning, got %#v", plan.GetWarnings())
	}
}

func TestResolveModelInstallPlanImageSupervisedSupportedOnAppleSilicon(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ModelId:      "local/z-image-turbo",
		Engine:       "media",
		Capabilities: []string{"image"},
		Entry:        "z_image_turbo-Q4_K.gguf",
		Files:        []string{"z_image_turbo-Q4_K.gguf"},
	})
	if err != nil {
		t.Fatalf("resolve model install plan: %v", err)
	}
	plan := resp.GetPlan()
	if got := plan.GetEngineRuntimeMode(); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("expected supervised runtime mode, got %s", got)
	}
	if plan.GetReasonCode() == runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("image supervised Apple Silicon plan must not fail host-compatibility gate, got reason=%s warnings=%#v", plan.GetReasonCode(), plan.GetWarnings())
	}
	if warnings := strings.Join(plan.GetWarnings(), " "); strings.Contains(strings.ToLower(warnings), "unsupported") {
		t.Fatalf("unexpected unsupported warning: %#v", plan.GetWarnings())
	}
}

func TestResolveModelInstallPlanMediaAttachedEndpointAllowedOnUnsupportedHost(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setUnsupportedGPUProbeForTest(t)

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ModelId:      "local/wan-video",
		Engine:       "media",
		Capabilities: []string{"video"},
		Endpoint:     "http://127.0.0.1:9321/v1",
	})
	if err != nil {
		t.Fatalf("resolve attached media plan: %v", err)
	}
	plan := resp.GetPlan()
	if !plan.GetInstallAvailable() {
		t.Fatalf("explicit attached media endpoint should remain installable")
	}
	if plan.GetReasonCode() != "ACTION_EXECUTED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
}

func TestInstallLocalModelMediaVideoRequiresExplicitEndpointOnUnsupportedHost(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setUnsupportedGPUProbeForTest(t)

	_, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/flux-test",
		engine:       "media",
		capabilities: []string{"video"},
	})
	if err == nil {
		t.Fatal("expected explicit endpoint requirement for unsupported media video host")
	}
	assertGRPCCode(t, err, "InstallLocalModel(media video unsupported host)", codes.InvalidArgument)
	assertGRPCReasonCode(t, err, "InstallLocalModel(media video unsupported host)", runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
}

func TestStartLocalModelSpeechSupervisedLeavesExecutionToExactCapabilityHost(t *testing.T) {
	probedEndpoints := make([]string, 0, 1)
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probedEndpoints = append(probedEndpoints, endpoint)
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe succeeded",
			probeURL:  endpoint,
			models:    []string{"speech/kokoro-tts-model"},
			modelCaps: map[string][]string{
				"speech/kokoro-tts-model": {"audio.synthesize"},
			},
		}
	})
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)
	svc.SetManagedSpeechEndpoint("http://127.0.0.1:18330/v1")

	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-tts-model",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
		files:        []string{"model.onnx", "voices.json"},
	})
	writeManagedBundleFilesForTest(t, svc, installed, []string{"model.onnx", "voices.json"}, map[string][]byte{
		"model.onnx":  []byte("fake-onnx"),
		"voices.json": []byte(`{"voices":["af"]}`),
	})

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start supervised speech model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("speech supervised model status = %s", started.GetAsset().GetStatus())
	}
	if mgr.startCalls != 0 {
		t.Fatalf("speech managed bootstrap must not use generic StartEngine, got %d calls", mgr.startCalls)
	}
	if mgr.startConfigCalls != 0 {
		t.Fatalf("asset lifecycle started aggregate speech Host %d times", mgr.startConfigCalls)
	}
	if len(probedEndpoints) != 0 {
		t.Fatalf("asset lifecycle probed private speech Host endpoints: %#v", probedEndpoints)
	}
	if detail := started.GetAsset().GetHealthDetail(); !strings.Contains(detail, "execution health is private to exact local capability jobs") {
		t.Fatalf("speech asset availability detail = %q", detail)
	}
}

func TestManagedSpeechServiceLifecycleDoesNotStartAggregateHost(t *testing.T) {
	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeCalls++
		return endpointProbeResult{healthy: true, responded: true, probeURL: endpoint}
	})
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)
	svc.SetManagedSpeechEndpoint("http://127.0.0.1:18330/v1")

	model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/private-service-model",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.safetensors",
		files:        []string{"model.safetensors"},
	})
	service, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-private-speech",
		Engine:       "speech",
		Capabilities: []string{"audio.synthesize"},
		LocalModelId: model.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("install managed speech service: %v", err)
	}
	if _, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{ServiceId: service.GetService().GetServiceId()}); err == nil {
		t.Fatal("managed speech service exposed aggregate lifecycle")
	} else {
		assertGRPCReasonCode(t, err, "StartLocalService(private speech)", runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if _, err := svc.updateServiceStatus(service.GetService().GetServiceId(), runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE, "legacy active fixture"); err != nil {
		t.Fatalf("seed legacy active managed speech service: %v", err)
	}
	health, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{ServiceId: service.GetService().GetServiceId()})
	if err != nil {
		t.Fatalf("check managed speech service projection: %v", err)
	}
	if len(health.GetServices()) != 1 || !strings.Contains(health.GetServices()[0].GetDetail(), "exact local capability jobs") {
		t.Fatalf("managed speech service health = %+v", health.GetServices())
	}
	if mgr.startCalls != 0 || mgr.startConfigCalls != 0 || probeCalls != 0 {
		t.Fatalf("managed speech service lifecycle touched aggregate Host: start=%d configured=%d probes=%d", mgr.startCalls, mgr.startConfigCalls, probeCalls)
	}
}

func TestStartLocalModelSpeechSupervisedFailsClosedWhenManagedBundleFileMissing(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe succeeded",
			probeURL:  endpoint,
			models:    []string{"models/kokoro-tts-model"},
			modelCaps: map[string][]string{
				"models/kokoro-tts-model": {"audio.synthesize"},
			},
		}
	})
	svc.SetManagedSpeechEndpoint("http://127.0.0.1:18330/v1")

	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-tts-model",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
		files:        []string{"model.onnx", "voices.json"},
	})
	writeManagedBundleFilesForTest(t, svc, installed, []string{"model.onnx", "voices.json"}, map[string][]byte{
		"model.onnx": []byte("fake-onnx"),
	})

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start supervised speech model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("speech supervised model should fail closed when bundle file is missing, got %s", started.GetAsset().GetStatus())
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), `managed bundle file "voices.json" missing`) {
		t.Fatalf("unexpected health detail: %q", started.GetAsset().GetHealthDetail())
	}
}
