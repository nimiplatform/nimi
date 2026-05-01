package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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
	if started.GetAsset().GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_SPEECH_BUNDLE_DEGRADED {
		t.Fatalf("unexpected asset reason code: %s", started.GetAsset().GetReasonCode())
	}
}

func TestCheckLocalAssetHealthSpeechMissingModelProjectsCapabilityDownloadReasonCode(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe succeeded",
			probeURL:  endpoint,
			models:    []string{"speech/other-tts-model"},
			modelCaps: map[string][]string{
				"speech/other-tts-model": {"audio.synthesize"},
			},
		}
	})

	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "speech/kokoro-tts-model",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		endpoint:     "http://127.0.0.1:18181/v1",
	})
	if err != nil {
		t.Fatalf("install speech model: %v", err)
	}
	if _, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{LocalAssetId: installed.GetLocalAssetId()}); err != nil {
		t.Fatalf("start speech model: %v", err)
	}

	health, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{LocalAssetId: installed.GetLocalAssetId()})
	if err != nil {
		t.Fatalf("check supervised speech health: %v", err)
	}
	if len(health.GetAssets()) != 1 {
		t.Fatalf("expected one health row, got %d", len(health.GetAssets()))
	}
	if health.GetAssets()[0].GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED {
		t.Fatalf("unexpected health reason code: %s", health.GetAssets()[0].GetReasonCode())
	}
}

func TestResolveModelInstallPlanMediaVideoSupervisedUnsupportedHost(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "intel")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "false")

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
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "intel")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "false")

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
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "intel")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "false")

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

func TestStartLocalModelSpeechProbeFailsClosedWhenCatalogMissingExpectedModel(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe succeeded",
			probeURL:  endpoint,
			models:    []string{"speech/other-tts-model"},
		}
	})

	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/kokoro-tts-model",
		capabilities: []string{"tts"},
		engine:       "speech",
		endpoint:     "http://127.0.0.1:18181/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("speech model should fail closed when catalog is missing expected model, got %s", started.GetAsset().GetStatus())
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), `speech probe missing expected model "local/kokoro-tts-model"`) {
		t.Fatalf("expected speech missing-model detail, got %q", started.GetAsset().GetHealthDetail())
	}
}

func TestStartLocalModelSpeechTTSProbeSuccess(t *testing.T) {
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

	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/kokoro-tts-model",
		capabilities: []string{"tts"},
		engine:       "speech",
		endpoint:     "http://127.0.0.1:18181/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("speech tts model should become active when capability probe matches, got %s", started.GetAsset().GetStatus())
	}
}

func TestStartLocalModelSpeechProbeFailsClosedWhenCatalogMissingRequiredCapability(t *testing.T) {
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
		t.Fatalf("install local model: %v", err)
	}

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("speech model should fail closed when catalog row misses required capability, got %s", started.GetAsset().GetStatus())
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), `speech probe missing required capability "audio.transcribe"`) {
		t.Fatalf("expected speech missing-capability detail, got %q", started.GetAsset().GetHealthDetail())
	}
}

func TestStartLocalModelSpeechSupervisedUsesManagedSpeechEndpoint(t *testing.T) {
	speechWarmCalls := 0
	requestVoices := make([]string, 0, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/audio/speech":
			speechWarmCalls++
			var req struct {
				Voice string `json:"voice"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode speech synth request: %v", err)
			}
			requestVoices = append(requestVoices, strings.TrimSpace(req.Voice))
			w.Header().Set("Content-Type", "audio/wav")
			_, _ = w.Write([]byte("RIFFdemo"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	probedEndpoints := make([]string, 0, 1)
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probedEndpoints = append(probedEndpoints, endpoint)
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
	svc.SetManagedSpeechEndpoint(server.URL + "/v1")

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
		t.Fatalf("speech supervised model should become active when managed endpoint probe succeeds, got %s", started.GetAsset().GetStatus())
	}
	if started.GetAsset().GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("speech supervised model should stay cold after start, got %s", started.GetAsset().GetWarmState())
	}
	if len(probedEndpoints) != 1 {
		t.Fatalf("expected exactly one speech probe, got %d", len(probedEndpoints))
	}
	if got := probedEndpoints[0]; got != server.URL+"/v1" {
		t.Fatalf("expected managed speech endpoint to be probed, got %q", got)
	}
	if speechWarmCalls != 0 {
		t.Fatalf("expected no speech warm request during start, got %d", speechWarmCalls)
	}
	if len(requestVoices) != 0 {
		t.Fatalf("expected no start-path warm request voice payload, got %#v", requestVoices)
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

func TestStartLocalModelSpeechSupervisedSkipsWarmExecutionOnStart(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/audio/speech":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":{"message":"speech synth unavailable"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

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
	svc.SetManagedSpeechEndpoint(server.URL + "/v1")

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
		t.Fatalf("speech supervised model should become active without warm execution, got %s", started.GetAsset().GetStatus())
	}
	if started.GetAsset().GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("speech supervised model warm_state = %s", started.GetAsset().GetWarmState())
	}
	if started.GetAsset().GetHealthDetail() != "model active" {
		t.Fatalf("unexpected health detail: %q", started.GetAsset().GetHealthDetail())
	}
}

func TestStartLocalModelSpeechSupervisedFailsClosedWhenVoicesFileInvalid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/audio/speech":
			t.Fatal("speech synth request should not execute when voices.json is invalid")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

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
	svc.SetManagedSpeechEndpoint(server.URL + "/v1")

	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-tts-model",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
		files:        []string{"model.onnx", "voices.json"},
	})
	writeManagedBundleFilesForTest(t, svc, installed, []string{"model.onnx", "voices.json"}, map[string][]byte{
		"model.onnx":  []byte("fake-onnx"),
		"voices.json": []byte(`{"voices":[]}`),
	})

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start supervised speech model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("speech supervised model should become active without validating voices.json on start, got %s", started.GetAsset().GetStatus())
	}
	if started.GetAsset().GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("speech supervised invalid voices warm_state = %s", started.GetAsset().GetWarmState())
	}
	if started.GetAsset().GetHealthDetail() != "model active" {
		t.Fatalf("unexpected invalid voices detail: %q", started.GetAsset().GetHealthDetail())
	}
}

func TestCheckLocalAssetHealthSpeechSupervisedRetainsReadyAfterSuccessfulStart(t *testing.T) {
	speechWarmCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/audio/speech":
			speechWarmCalls++
			w.Header().Set("Content-Type", "audio/wav")
			_, _ = w.Write([]byte("RIFFdemo"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
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
	svc.SetManagedSpeechEndpoint(server.URL + "/v1")

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
	if started.GetAsset().GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("speech supervised model warm_state = %s", started.GetAsset().GetWarmState())
	}

	resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("check local asset health: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one speech health row, got %d", len(resp.GetAssets()))
	}
	health := resp.GetAssets()[0]
	if health.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("speech supervised health status = %s", health.GetStatus())
	}
	if health.GetDetail() != managedLocalModelColdDetail() {
		t.Fatalf("speech supervised health detail = %q", health.GetDetail())
	}
	stored := svc.modelByID(installed.GetLocalAssetId())
	if stored == nil {
		t.Fatal("expected stored speech asset")
	}
	if stored.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("stored speech supervised warm_state = %s", stored.GetWarmState())
	}
	if speechWarmCalls != 0 {
		t.Fatalf("expected no warm request during start, got %d", speechWarmCalls)
	}
}

func TestCheckLocalAssetHealthSpeechSupervisedRecoveryProjectsColdAfterThreshold(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
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
	if _, err := svc.updateModelAvailabilityAndWarmState(
		installed.GetLocalAssetId(),
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED,
		"seed unhealthy",
		true,
	); err != nil {
		t.Fatalf("seed supervised speech unhealthy state: %v", err)
	}

	for attempt := 1; attempt < localRecoverySuccessThreshold; attempt++ {
		resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
			LocalAssetId: installed.GetLocalAssetId(),
		})
		if err != nil {
			t.Fatalf("recovery check #%d: %v", attempt, err)
		}
		health := resp.GetAssets()[0]
		if health.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
			t.Fatalf("recovery check #%d status = %s, want UNHEALTHY", attempt, health.GetStatus())
		}
		if !strings.Contains(health.GetDetail(), fmt.Sprintf("recovery probe succeeded (%d/%d)", attempt, localRecoverySuccessThreshold)) {
			t.Fatalf("recovery check #%d detail = %q", attempt, health.GetDetail())
		}
	}

	resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("recovery check threshold: %v", err)
	}
	health := resp.GetAssets()[0]
	if health.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("recovered speech supervised status = %s", health.GetStatus())
	}
	if health.GetDetail() != managedLocalModelColdDetail() {
		t.Fatalf("recovered speech supervised detail = %q", health.GetDetail())
	}
	stored := svc.modelByID(installed.GetLocalAssetId())
	if stored == nil {
		t.Fatal("expected stored recovered speech asset")
	}
	if stored.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("stored recovered speech warm_state = %s", stored.GetWarmState())
	}
}

func TestCheckLocalAssetHealthSpeechSupervisedProbeFailureTransitionsFailed(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  false,
			detail:   fmt.Sprintf("probe request failed: Get %q: connection refused", endpoint),
			probeURL: endpoint,
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
		"model.onnx":  []byte("fake-onnx"),
		"voices.json": []byte(`{"voices":["af"]}`),
	})
	if _, err := svc.updateModelAvailabilityAndWarmState(
		installed.GetLocalAssetId(),
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
		managedLocalModelReadyDetail(),
		true,
	); err != nil {
		t.Fatalf("seed supervised speech ready state: %v", err)
	}

	resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("check local asset health: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one speech health row, got %d", len(resp.GetAssets()))
	}
	health := resp.GetAssets()[0]
	if health.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("speech supervised failed health status = %s", health.GetStatus())
	}
	if !strings.Contains(health.GetDetail(), "connection refused") {
		t.Fatalf("unexpected failed health detail: %q", health.GetDetail())
	}
	if !strings.Contains(health.GetDetail(), "plane=local-supervised") {
		t.Fatalf("expected supervised plane marker, got %q", health.GetDetail())
	}
	stored := svc.modelByID(installed.GetLocalAssetId())
	if stored == nil {
		t.Fatal("expected stored failed speech asset")
	}
	if stored.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("stored speech supervised failed warm_state = %s", stored.GetWarmState())
	}
}
