package localservice

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
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

func TestStartLocalModelSpeechSupervisedStartsConfiguredSpeechEngine(t *testing.T) {
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

	ttsRoot := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-tts")
	asrRoot := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-asr")
	upsertVerifiedSpeechPackageSetForTest(t, svc, "speech.qwen3-tts.python", "local-speech-qwen3-tts.package-set", ttsRoot, "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD", engine.SpeechQwen3TTSDriverPath)
	upsertVerifiedSpeechPackageSetForTest(t, svc, "speech.qwen3-asr.python", "local-speech-qwen3-asr.package-set", asrRoot, "NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD", engine.SpeechQwen3ASRDriverPath)

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
	if mgr.startConfigCalls != 1 {
		t.Fatalf("expected one configured speech engine start, got %d", mgr.startConfigCalls)
	}
	if got := mgr.lastStartConfig.Kind; got != engine.EngineSpeech {
		t.Fatalf("configured engine kind = %s, want speech", got)
	}
	if got := mgr.lastStartConfig.Port; got != 18330 {
		t.Fatalf("configured speech port = %d, want 18330", got)
	}
	if got := mgr.lastStartConfig.ModelsPath; got != svc.resolvedLocalModelsPath() {
		t.Fatalf("configured speech models path = %q, want %q", got, svc.resolvedLocalModelsPath())
	}
	if got := mgr.lastStartConfig.SpeechQwen3TTSPackageSetRoot; got != ttsRoot {
		t.Fatalf("configured tts package-set root = %q, want %q", got, ttsRoot)
	}
	if got := mgr.lastStartConfig.SpeechQwen3ASRPackageSetRoot; got != asrRoot {
		t.Fatalf("configured asr package-set root = %q, want %q", got, asrRoot)
	}
	if len(probedEndpoints) != 1 || probedEndpoints[0] != "http://127.0.0.1:18330/v1" {
		t.Fatalf("unexpected speech probe endpoints: %#v", probedEndpoints)
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
