package ai

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/status"
)

func TestExecuteFirstRunLocalBaselinePreservesSchedulerCauseWithoutPublishingIt(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := svc.ExecuteFirstRunLocalBaseline(ctx, FirstRunLocalExecutionRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ModelID:      "local/test-model",
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled scheduler cause, got %v", err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("unexpected reason: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if wireMessage := status.Convert(err).Message(); strings.Contains(wireMessage, context.Canceled.Error()) {
		t.Fatalf("wire message leaked scheduler cause: %q", wireMessage)
	}
}

func TestShouldRetryUnhealthyManagedSpeechStartForBaselineSpeechModals(t *testing.T) {
	asr := &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset-asr",
		AssetId:      "local.stt.qwen3-asr-0.6b.safetensors",
		Engine:       "speech",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		Capabilities: []string{"audio.transcribe"},
	}
	if !shouldRetryUnhealthyLocalModelStart(asr, runtimev1.Modal_MODAL_STT) {
		t.Fatalf("unhealthy speech ASR asset should be retried for STT execution")
	}
	if shouldRetryUnhealthyLocalModelStart(asr, runtimev1.Modal_MODAL_TTS) {
		t.Fatalf("ASR asset must not be retried for TTS execution")
	}

	tts := &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset-tts",
		AssetId:      "local.tts.qwen3-tts-customvoice-0.6b.safetensors",
		Engine:       "speech",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		Capabilities: []string{"audio.synthesize"},
	}
	if !shouldRetryUnhealthyLocalModelStart(tts, runtimev1.Modal_MODAL_TTS) {
		t.Fatalf("unhealthy speech TTS asset should be retried for TTS execution")
	}
	if shouldRetryUnhealthyLocalModelStart(tts, runtimev1.Modal_MODAL_STT) {
		t.Fatalf("TTS asset must not be retried for STT execution")
	}
}

func TestPrepareLocalModelExecutionPlanRetriesUnhealthySpeechAsset(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	unhealthy := &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset-asr",
		AssetId:      "local.stt.qwen3-asr-0.6b.safetensors",
		Engine:       "speech",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		Endpoint:     "http://127.0.0.1:8330/v1",
		Capabilities: []string{"audio.transcribe"},
	}
	active := &runtimev1.LocalAssetRecord{
		LocalAssetId: unhealthy.GetLocalAssetId(),
		AssetId:      unhealthy.GetAssetId(),
		Engine:       unhealthy.GetEngine(),
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Endpoint:     unhealthy.GetEndpoint(),
		Capabilities: unhealthy.GetCapabilities(),
	}
	lister := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{unhealthy},
		}},
		startResp: &runtimev1.StartLocalAssetResponse{Asset: active},
	}
	svc.localModel = lister

	plan, err := svc.prepareLocalModelExecutionPlan(
		context.Background(),
		"local/local.stt.qwen3-asr-0.6b.safetensors",
		nil,
		runtimev1.Modal_MODAL_STT,
		nil,
	)
	if err != nil {
		t.Fatalf("prepare speech execution plan: %v", err)
	}
	if lister.startCalls != 1 {
		t.Fatalf("expected unhealthy speech asset to be restarted once, got %d", lister.startCalls)
	}
	if plan == nil || plan.selected == nil || plan.selected.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected active selected speech asset, got %#v", plan)
	}
	localBackend, ok := svc.selector.local.(*localProvider)
	if !ok {
		t.Fatalf("expected local provider, got %T", svc.selector.local)
	}
	_, _, speechBackend, _, _ := localBackend.backends()
	if speechBackend == nil {
		t.Fatalf("expected speech backend to be hydrated from recovered asset endpoint")
	}
}

func TestExecuteFirstRunLocalBaselinePreparesRecoveredSpeechAsset(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/audio/transcriptions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"hello"}`))
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{AllowLoopbackEndpoint: true})
	unhealthy := &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset-asr",
		AssetId:      "local.stt.qwen3-asr-0.6b.safetensors",
		Engine:       "speech",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		Endpoint:     server.URL,
		Capabilities: []string{"audio.transcribe"},
	}
	active := &runtimev1.LocalAssetRecord{
		LocalAssetId: unhealthy.GetLocalAssetId(),
		AssetId:      unhealthy.GetAssetId(),
		Engine:       unhealthy.GetEngine(),
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Endpoint:     unhealthy.GetEndpoint(),
		Capabilities: unhealthy.GetCapabilities(),
	}
	lister := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{unhealthy},
		}},
		startResp: &runtimev1.StartLocalAssetResponse{Asset: active},
	}
	svc.localModel = lister

	result, err := svc.ExecuteFirstRunLocalBaseline(context.Background(), FirstRunLocalExecutionRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		ModelID:      unhealthy.GetAssetId(),
	})
	if err != nil {
		t.Fatalf("execute first-run STT baseline: %v", err)
	}
	if lister.startCalls != 1 {
		t.Fatalf("expected first-run STT execution to restart stale unhealthy speech asset once, got %d", lister.startCalls)
	}
	if result.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		t.Fatalf("route policy = %s, want local", result.RoutePolicy)
	}
	if result.ModelResolved != unhealthy.GetAssetId() {
		t.Fatalf("model resolved = %q, want %q", result.ModelResolved, unhealthy.GetAssetId())
	}
}

func TestExecuteFirstRunLocalBaselineAcquiresLeaseBeforeTextExecution(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"ready"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{AllowLoopbackEndpoint: true})
	active := &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset-chat",
		AssetId:      "local.chat.gemma-4-e2b-it.q8-0",
		Engine:       "llama",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		WarmState:    runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD,
		Endpoint:     server.URL + "/v1",
		Capabilities: []string{"text.generate"},
	}
	lister := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{active},
		}},
	}
	svc.localModel = lister

	result, err := svc.ExecuteFirstRunLocalBaseline(context.Background(), FirstRunLocalExecutionRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ModelID:      active.GetAssetId(),
	})
	if err != nil {
		t.Fatalf("execute first-run text baseline: %v", err)
	}
	if result.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		t.Fatalf("route policy = %s, want local", result.RoutePolicy)
	}
	expected := []string{
		"acquire:asset-chat:first_run_local_baseline",
		"release:asset-chat:first_run_local_baseline_cleanup",
	}
	if len(lister.leaseCalls) != len(expected) {
		t.Fatalf("lease calls = %#v, want %#v", lister.leaseCalls, expected)
	}
	for i, want := range expected {
		if lister.leaseCalls[i] != want {
			t.Fatalf("lease call[%d] = %q, want %q (all calls %#v)", i, lister.leaseCalls[i], want, lister.leaseCalls)
		}
	}
}

func TestExecuteFirstRunLocalBaselineUsesSpeechExecutionTimeout(t *testing.T) {
	var capturedExtensions map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/audio/transcriptions" {
			http.NotFound(w, r)
			return
		}
		reader, err := r.MultipartReader()
		if err != nil {
			t.Fatalf("MultipartReader: %v", err)
		}
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("NextPart: %v", err)
			}
			if part.FormName() != "extensions" {
				continue
			}
			payload, err := io.ReadAll(part)
			if err != nil {
				t.Fatalf("ReadAll(extensions): %v", err)
			}
			if err := json.Unmarshal(payload, &capturedExtensions); err != nil {
				t.Fatalf("json.Unmarshal(extensions): %v", err)
			}
		}
		time.Sleep(25 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":""}`))
	}))
	defer server.Close()

	svc := newTestService(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		Config{AIHTTPTimeout: time.Millisecond, AllowLoopbackEndpoint: true},
	)
	active := &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset-asr",
		AssetId:      "local.stt.qwen3-asr-0.6b.safetensors",
		Engine:       "speech",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Endpoint:     server.URL,
		Capabilities: []string{"audio.transcribe"},
	}
	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{active},
		}},
	}

	if _, err := svc.ExecuteFirstRunLocalBaseline(context.Background(), FirstRunLocalExecutionRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		ModelID:      active.GetAssetId(),
	}); err != nil {
		t.Fatalf("first-run STT baseline should use scenario speech timeout and allow terminal no-speech execution: %v", err)
	}
	if allow, ok := capturedExtensions["nimi_allow_empty_transcript"].(bool); !ok || !allow {
		t.Fatalf("first-run STT baseline did not forward allow-empty extension: %#v", capturedExtensions)
	}
}

func TestExecuteFirstRunLocalBaselineTTSMarksPrivateBaselineProbe(t *testing.T) {
	var capturedPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		defer func() { _ = r.Body.Close() }()
		if err := json.NewDecoder(r.Body).Decode(&capturedPayload); err != nil {
			t.Fatalf("decode speech payload: %v", err)
		}
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write([]byte("first-run-tts-audio"))
	}))
	defer server.Close()

	svc := newTestService(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		Config{AllowLoopbackEndpoint: true},
	)
	active := &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset-tts",
		AssetId:      "local.tts.qwen3-tts-customvoice-0.6b.safetensors",
		Engine:       "speech",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Endpoint:     server.URL + "/v1",
		Capabilities: []string{"audio.synthesize"},
	}
	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{active},
		}},
	}

	if _, err := svc.ExecuteFirstRunLocalBaseline(context.Background(), FirstRunLocalExecutionRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ModelID:      active.GetAssetId(),
	}); err != nil {
		t.Fatalf("execute first-run TTS baseline: %v", err)
	}
	extensions, ok := capturedPayload["extensions"].(map[string]any)
	if !ok {
		t.Fatalf("speech payload missing extensions: %#v", capturedPayload)
	}
	if got, ok := extensions["nimi_first_run_baseline_probe"].(bool); !ok || !got {
		t.Fatalf("baseline probe extension = %#v, want true", extensions["nimi_first_run_baseline_probe"])
	}
	if rawVoice, ok := capturedPayload["voice"]; ok {
		if voice := strings.TrimSpace(rawVoice.(string)); voice != "" {
			t.Fatalf("first-run baseline must not fabricate a public voice_ref, got %q", voice)
		}
	}
}

func TestFirstRunBaselineSTTAudioProbeIsValidNonEmptyPCM(t *testing.T) {
	payload := firstRunBaselineSTTAudioProbe()
	if len(payload) <= 44 {
		t.Fatalf("expected non-empty WAV data payload, got %d bytes", len(payload))
	}
	if got := string(payload[0:4]); got != "RIFF" {
		t.Fatalf("unexpected RIFF header: %q", got)
	}
	if got := string(payload[8:12]); got != "WAVE" {
		t.Fatalf("unexpected WAVE header: %q", got)
	}
	if got := binary.LittleEndian.Uint16(payload[20:22]); got != 1 {
		t.Fatalf("audio format = %d, want PCM", got)
	}
	if got := binary.LittleEndian.Uint16(payload[22:24]); got != firstRunBaselineSTTChannels {
		t.Fatalf("channels = %d, want %d", got, firstRunBaselineSTTChannels)
	}
	if got := binary.LittleEndian.Uint32(payload[24:28]); got != firstRunBaselineSTTSampleRateHz {
		t.Fatalf("sample rate = %d, want %d", got, firstRunBaselineSTTSampleRateHz)
	}
	dataSize := binary.LittleEndian.Uint32(payload[40:44])
	if dataSize == 0 {
		t.Fatal("WAV data chunk must contain audio frames")
	}
	if int(dataSize) != len(payload)-44 {
		t.Fatalf("data size = %d, payload data bytes = %d", dataSize, len(payload)-44)
	}
}
