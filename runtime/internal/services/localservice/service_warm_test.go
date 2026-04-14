package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestWarmLocalModelLoadsOnceAndCachesReadyState(t *testing.T) {
	chatCompletions := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"qwen"}]}`)
		case "/v1/chat/completions":
			chatCompletions++
			_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"ready"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestServiceWithProbe(t, nil)
	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/qwen",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	first, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    60_000,
	})
	if err != nil {
		t.Fatalf("warm local model first call: %v", err)
	}
	if first.GetAlreadyWarm() {
		t.Fatalf("first warm call should not report already warm")
	}
	if first.GetModelResolved() != "qwen" {
		t.Fatalf("unexpected resolved model id: %q", first.GetModelResolved())
	}

	model := svc.modelByID(installed.GetLocalAssetId())
	if model == nil || model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("warm should promote model to ACTIVE, got %#v", model)
	}

	second, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    60_000,
	})
	if err != nil {
		t.Fatalf("warm local model second call: %v", err)
	}
	if !second.GetAlreadyWarm() {
		t.Fatalf("second warm call should reuse cached warm state")
	}
	if chatCompletions != 1 {
		t.Fatalf("expected a single backend warm call, got %d", chatCompletions)
	}
}

func TestWarmLocalModelRejectsUnsupportedCapability(t *testing.T) {
	svc := newTestService(t)
	installed := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/image-only",
		capabilities: []string{"image"},
		engine:       "llama",
	})

	_, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
	})
	if err == nil {
		t.Fatalf("expected warm to reject non-chat model")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("unexpected grpc code: got=%s want=%s", st.Code(), codes.FailedPrecondition)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED {
		t.Fatalf("unexpected reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
	}
}

func TestWarmLocalModelInstalledProbeFailureReturnsUnavailableWithoutInvalidTransition(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"other-model"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestServiceWithProbe(t, nil)
	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/qwen",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	_, err = svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    60_000,
	})
	if err == nil {
		t.Fatalf("expected warm failure when probe model does not match registration")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("unexpected reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	model := svc.modelByID(installed.GetLocalAssetId())
	if model == nil {
		t.Fatalf("expected model record to remain available")
	}
	if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("installed model should stay INSTALLED after warm probe failure, got %v", model.GetStatus())
	}
	if model.GetHealthDetail() == "" {
		t.Fatalf("expected warm probe failure to populate health detail")
	}
}

func TestWarmLocalModelUnhealthyProbeFailureReturnsUnavailableWithoutInvalidTransition(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe request failed: dial tcp 127.0.0.1:1234: connect: connection refused",
			probeURL: endpoint,
		}
	})
	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/qwen",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     "http://127.0.0.1:1234/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	if _, err := svc.updateModelStatus(installed.GetLocalAssetId(), runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, "model active"); err != nil {
		t.Fatalf("promote model active: %v", err)
	}
	if _, err := svc.updateModelStatus(installed.GetLocalAssetId(), runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, "probe failed"); err != nil {
		t.Fatalf("mark model unhealthy: %v", err)
	}

	_, err = svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    200,
	})
	if err == nil {
		t.Fatalf("expected warm failure when unhealthy model probe still fails")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("unexpected reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	model := svc.modelByID(installed.GetLocalAssetId())
	if model == nil {
		t.Fatalf("expected model record to remain available")
	}
	if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("unhealthy model should stay UNHEALTHY after repeated warm probe failure, got %v", model.GetStatus())
	}
	if model.GetHealthDetail() == "" {
		t.Fatalf("expected repeated warm probe failure to keep health detail populated")
	}
}

func TestWarmLocalModelRetriesManagedProbeUntilReady(t *testing.T) {
	chatCompletions := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/chat/completions":
			chatCompletions++
			_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"ready"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeCalls++
		if probeCalls < 3 {
			return endpointProbeResult{
				healthy:  false,
				detail:   `probe request failed: Get "http://127.0.0.1:1234/v1/models": dial tcp 127.0.0.1:1234: connect: connection refused`,
				probeURL: endpoint,
			}
		}
		return endpointProbeResult{
			healthy:  true,
			detail:   "probe succeeded",
			probeURL: endpoint,
			models:   []string{"qwen"},
		}
	})
	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/qwen",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	startedAt := time.Now()
	resp, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    5_000,
	})
	if err != nil {
		t.Fatalf("warm local model should wait for managed probe readiness: %v", err)
	}
	if resp.GetAlreadyWarm() {
		t.Fatalf("first warm call should not report already warm")
	}
	if probeCalls != 3 {
		t.Fatalf("expected warm probe retries until ready, got %d probe calls", probeCalls)
	}
	if chatCompletions != 1 {
		t.Fatalf("expected a single backend warm call after probe readiness, got %d", chatCompletions)
	}
	if time.Since(startedAt) < 2*warmManagedProbeRetryInterval {
		t.Fatalf("expected warm call to wait across probe retries")
	}
}

func TestRecordWarmKeyCapsCacheSize(t *testing.T) {
	svc := newTestService(t)
	for i := 0; i < 512; i++ {
		svc.recordWarmKey(fmt.Sprintf("key-%d", i))
	}
	svc.recordWarmKey("key-0")
	svc.recordWarmKey("key-512")
	if got := len(svc.warmedModelKeys); got > 512 {
		t.Fatalf("warm key cache should stay bounded, got %d", got)
	}
	if _, ok := svc.warmedModelKeys["key-1"]; ok {
		t.Fatal("expected oldest untouched key to be evicted first")
	}
	if _, ok := svc.warmedModelKeys["key-0"]; !ok {
		t.Fatal("expected recently touched key to remain cached")
	}
}

func TestWarmLocalSpeechSynthesizeLoadsOnceAndCachesReadyState(t *testing.T) {
	speechCalls := 0
	requestVoices := make([]string, 0, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/audio/speech":
			speechCalls++
			var req struct {
				Voice string `json:"voice"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode synth request: %v", err)
			}
			requestVoices = append(requestVoices, strings.TrimSpace(req.Voice))
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

	first, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    60_000,
	})
	if err != nil {
		t.Fatalf("warm local speech synth first call: %v", err)
	}
	if first.GetAlreadyWarm() {
		t.Fatal("first speech warm call should not report already warm")
	}
	model := svc.modelByID(installed.GetLocalAssetId())
	if model == nil || model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("speech warm should promote model to ACTIVE, got %#v", model)
	}
	if model.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY {
		t.Fatalf("speech warm_state = %s", model.GetWarmState())
	}

	second, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    60_000,
	})
	if err != nil {
		t.Fatalf("warm local speech synth second call: %v", err)
	}
	if !second.GetAlreadyWarm() {
		t.Fatal("second speech warm call should reuse cached warm state")
	}
	if speechCalls != 1 {
		t.Fatalf("expected a single speech warm request, got %d", speechCalls)
	}
	if len(requestVoices) != 1 || requestVoices[0] != "af" {
		t.Fatalf("expected warm synth request to carry preset voice af, got %#v", requestVoices)
	}
}

func TestWarmLocalSpeechTranscribeExecutesCapabilityRoute(t *testing.T) {
	transcribeCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/audio/transcriptions":
			transcribeCalls++
			mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || mediaType != "multipart/form-data" {
				t.Fatalf("unexpected transcription content-type: %q err=%v", r.Header.Get("Content-Type"), err)
			}
			reader := multipart.NewReader(r.Body, params["boundary"])
			var sawModel, sawFile, sawLanguage, sawResponseFormat, sawTimestamps, sawDiarization, sawSpeakerCount bool
			for {
				part, err := reader.NextPart()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Fatalf("read multipart: %v", err)
				}
				body, readErr := io.ReadAll(part)
				if readErr != nil {
					t.Fatalf("read part %q: %v", part.FormName(), readErr)
				}
				switch part.FormName() {
				case "model":
					sawModel = string(body) == "speech/whisper-large-v3"
				case "language":
					sawLanguage = string(body) == "en"
				case "response_format":
					sawResponseFormat = string(body) == "json"
				case "timestamps":
					sawTimestamps = string(body) == "true"
				case "diarization":
					sawDiarization = string(body) == "true"
				case "speaker_count":
					sawSpeakerCount = string(body) == "2"
				case "file":
					sawFile = len(body) > 0
				}
			}
			if !sawModel || !sawFile || !sawLanguage || !sawResponseFormat || !sawTimestamps || !sawDiarization || !sawSpeakerCount {
				t.Fatalf(
					"transcription warm request missing expected fields: model=%t file=%t language=%t response_format=%t timestamps=%t diarization=%t speaker_count=%t",
					sawModel,
					sawFile,
					sawLanguage,
					sawResponseFormat,
					sawTimestamps,
					sawDiarization,
					sawSpeakerCount,
				)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"text":"ready"}`))
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
			models:    []string{"speech/whisper-large-v3"},
			modelCaps: map[string][]string{
				"speech/whisper-large-v3": {"audio.transcribe"},
			},
		}
	})
	svc.SetManagedSpeechEndpoint(server.URL + "/v1")

	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/whisper-large-v3",
		capabilities: []string{"audio.transcribe"},
		engine:       "speech",
		entry:        "./dist/index.js",
		files:        []string{"./dist/index.js", "model.bin"},
	})
	writeManagedBundleFilesForTest(t, svc, installed, []string{"./dist/index.js", "model.bin"}, map[string][]byte{
		"./dist/index.js": []byte("console.log('ready')\n"),
		"model.bin":       []byte("fake-whisper-model"),
	})

	resp, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    60_000,
	})
	if err != nil {
		t.Fatalf("warm local speech transcribe: %v", err)
	}
	if resp.GetAlreadyWarm() {
		t.Fatal("first transcription warm call should not report already warm")
	}
	if transcribeCalls != 1 {
		t.Fatalf("expected one transcription warm request, got %d", transcribeCalls)
	}
	model := svc.modelByID(installed.GetLocalAssetId())
	if model == nil || model.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY {
		t.Fatalf("speech transcription warm_state = %#v", model)
	}
}

func TestWarmLocalSpeechSynthesizeFailureMarksModelWarmFailed(t *testing.T) {
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

	_, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    60_000,
	})
	if err == nil {
		t.Fatal("expected speech synth warm failure")
	}
	model := svc.modelByID(installed.GetLocalAssetId())
	if model == nil {
		t.Fatal("expected speech model to remain present")
	}
	if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("failed speech warm should transition model unhealthy after execution failure, got %s", model.GetStatus())
	}
	if model.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED {
		t.Fatalf("failed speech warm_state = %s", model.GetWarmState())
	}
	if got := model.GetHealthDetail(); got == "" || got == "model installed" {
		t.Fatalf("expected failed speech warm health detail, got %q", got)
	}
}

func TestWarmLocalSpeechSynthesizeRejectsEmptyVoicesFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/audio/speech":
			t.Fatal("warm synth request should not execute when voices.json is invalid")
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
		"voices.json": []byte(`{"voices":[]}`),
	})

	_, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    60_000,
	})
	if err == nil {
		t.Fatal("expected warm local speech synth to fail on empty voices.json")
	}
	model := svc.modelByID(installed.GetLocalAssetId())
	if model == nil {
		t.Fatal("expected speech model to remain present")
	}
	if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("invalid voices warm should transition model unhealthy, got %s", model.GetStatus())
	}
	if model.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED {
		t.Fatalf("invalid voices warm_state = %s", model.GetWarmState())
	}
	if !strings.Contains(model.GetHealthDetail(), "managed speech voices invalid") {
		t.Fatalf("unexpected invalid voices detail: %q", model.GetHealthDetail())
	}
}
