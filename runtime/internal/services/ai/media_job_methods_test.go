package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"golang.org/x/net/websocket"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestSubmitMediaJobImageCompletes(t *testing.T) {
	imagePayload := []byte("image-payload")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"b64_json":"` + imageB64 + `","mime_type":"image/png"}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: server.URL,
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt:         "blue car on mars",
				Size:           "1024x1024",
				ResponseFormat: "png",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit media job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if len(job.GetArtifacts()) == 0 {
		t.Fatalf("expected at least one artifact")
	}
	artifact := job.GetArtifacts()[0]
	if artifact.GetMimeType() == "" || artifact.GetSha256() == "" || artifact.GetSizeBytes() == 0 {
		t.Fatalf("artifact metadata must be populated: %#v", artifact)
	}
	if artifact.GetWidth() != 1024 || artifact.GetHeight() != 1024 {
		t.Fatalf("artifact image dimensions mismatch: %dx%d", artifact.GetWidth(), artifact.GetHeight())
	}
	artifactsResp, err := svc.GetMediaArtifacts(context.Background(), &runtimev1.GetMediaArtifactsRequest{
		JobId: job.GetJobId(),
	})
	if err != nil {
		t.Fatalf("get media artifacts: %v", err)
	}
	if len(artifactsResp.GetArtifacts()) == 0 {
		t.Fatalf("expected artifacts in response")
	}
}

func TestSubmitMediaJobIdempotencyReturnsSameJob(t *testing.T) {
	imagePayload := []byte("idempotent-image")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"b64_json":"` + imageB64 + `","mime_type":"image/png"}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: server.URL,
	})
	req := &runtimev1.SubmitMediaJobRequest{
		AppId:          "nimi.desktop",
		SubjectUserId:  "user-001",
		ModelId:        "local/sd3",
		Modal:          runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:       runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		IdempotencyKey: "idempotent-key-1",
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "idempotent prompt",
			},
		},
	}
	firstResp, err := svc.SubmitMediaJob(context.Background(), req)
	if err != nil {
		t.Fatalf("first submit media job: %v", err)
	}
	secondResp, err := svc.SubmitMediaJob(context.Background(), req)
	if err != nil {
		t.Fatalf("second submit media job: %v", err)
	}
	if firstResp.GetJob().GetJobId() == "" || secondResp.GetJob().GetJobId() == "" {
		t.Fatalf("job id must not be empty")
	}
	if firstResp.GetJob().GetJobId() != secondResp.GetJob().GetJobId() {
		t.Fatalf("idempotency must return same job id: first=%s second=%s", firstResp.GetJob().GetJobId(), secondResp.GetJob().GetJobId())
	}
}

func TestSubmitMediaJobBytedanceOpenSpeechTTS(t *testing.T) {
	audioPayload := []byte("byte-tts-audio")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/tts" {
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(audioPayload)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/v1/") {
			http.NotFound(w, r)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudBytedanceBaseURL:       server.URL,
		CloudBytedanceSpeechBaseURL: server.URL,
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "bytedance/voice-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text:  "hello world",
				Voice: "zh_female",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit bytedance tts job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(audioPayload) {
		t.Fatalf("audio bytes mismatch: got=%q want=%q", got, string(audioPayload))
	}
}

func TestSubmitMediaJobBytedanceOpenSpeechSTT(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v3/auc/bigmodel/recognize/flash" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"text":"bytedance stt text"}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudBytedanceBaseURL:       server.URL,
		CloudBytedanceSpeechBaseURL: server.URL,
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "bytedance/stt-1",
		Modal:         runtimev1.Modal_MODAL_STT,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioBytes: []byte("audio-bytes"),
				MimeType:   "audio/wav",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit bytedance stt job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != "bytedance stt text" {
		t.Fatalf("stt text mismatch: got=%q", got)
	}
}

func TestSubmitMediaJobBytedanceOpenSpeechSTTWS(t *testing.T) {
	var startSeen atomic.Bool
	var finishSeen atomic.Bool
	var chunkCount atomic.Int32

	mux := http.NewServeMux()
	mux.Handle("/api/v3/auc/bigmodel/recognize/stream", websocket.Handler(func(connection *websocket.Conn) {
		defer connection.Close()
		for {
			var payload map[string]any
			if err := websocket.JSON.Receive(connection, &payload); err != nil {
				return
			}
			switch strings.ToLower(strings.TrimSpace(valueAsString(payload["event"]))) {
			case "start":
				startSeen.Store(true)
			case "audio":
				chunkCount.Add(1)
			case "finish":
				finishSeen.Store(true)
				_ = websocket.JSON.Send(connection, map[string]any{
					"status": "completed",
					"text":   "bytedance ws stt text",
					"done":   true,
				})
				return
			}
		}
	}))
	server := httptest.NewServer(mux)
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudBytedanceBaseURL:       server.URL,
		CloudBytedanceSpeechBaseURL: server.URL,
	})
	response, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "bytedance/stt-ws-1",
		Modal:         runtimev1.Modal_MODAL_STT,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
					Source: &runtimev1.SpeechTranscriptionAudioSource_AudioChunks{
						AudioChunks: &runtimev1.AudioChunks{
							Chunks: [][]byte{
								[]byte("audio-chunk-1"),
								[]byte("audio-chunk-2"),
							},
						},
					},
				},
				MimeType: "audio/wav",
				ProviderOptions: structToMapPB(t, map[string]any{
					"transport": "ws",
				}),
			},
		},
	})
	if err != nil {
		t.Fatalf("submit bytedance ws stt job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, response.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != "bytedance ws stt text" {
		t.Fatalf("stt ws text mismatch: got=%q", got)
	}
	if !startSeen.Load() || !finishSeen.Load() {
		t.Fatalf("ws lifecycle frames not observed: start=%v finish=%v", startSeen.Load(), finishSeen.Load())
	}
	if chunkCount.Load() != 2 {
		t.Fatalf("ws chunk frame count mismatch: got=%d want=2", chunkCount.Load())
	}
}

func TestSubmitMediaJobBytedanceOpenSpeechSTTWSFailedMapsUnavailable(t *testing.T) {
	mux := http.NewServeMux()
	mux.Handle("/api/v3/auc/bigmodel/recognize/stream", websocket.Handler(func(connection *websocket.Conn) {
		defer connection.Close()
		for {
			var payload map[string]any
			if err := websocket.JSON.Receive(connection, &payload); err != nil {
				return
			}
			if strings.EqualFold(strings.TrimSpace(valueAsString(payload["event"])), "finish") {
				_ = websocket.JSON.Send(connection, map[string]any{
					"status": "failed",
					"error":  "provider failure",
					"done":   true,
				})
				return
			}
		}
	}))
	server := httptest.NewServer(mux)
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudBytedanceBaseURL:       server.URL,
		CloudBytedanceSpeechBaseURL: server.URL,
	})
	response, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "bytedance/stt-ws-failed",
		Modal:         runtimev1.Modal_MODAL_STT,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
					Source: &runtimev1.SpeechTranscriptionAudioSource_AudioChunks{
						AudioChunks: &runtimev1.AudioChunks{
							Chunks: [][]byte{
								[]byte("audio-chunk-1"),
							},
						},
					},
				},
				MimeType: "audio/wav",
				ProviderOptions: structToMapPB(t, map[string]any{
					"transport": "ws",
				}),
			},
		},
	})
	if err != nil {
		t.Fatalf("submit bytedance ws failed stt job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, response.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: got=%v want=%v", job.GetStatus(), runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED)
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("job reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
}

func TestSubmitMediaJobBytedanceOpenSpeechSTTWSReadTimeoutMapsProviderTimeout(t *testing.T) {
	mux := http.NewServeMux()
	mux.Handle("/api/v3/auc/bigmodel/recognize/stream", websocket.Handler(func(connection *websocket.Conn) {
		defer connection.Close()
		for {
			var payload map[string]any
			if err := websocket.JSON.Receive(connection, &payload); err != nil {
				return
			}
			if strings.EqualFold(strings.TrimSpace(valueAsString(payload["event"])), "finish") {
				time.Sleep(200 * time.Millisecond)
				return
			}
		}
	}))
	server := httptest.NewServer(mux)
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudBytedanceBaseURL:       server.URL,
		CloudBytedanceSpeechBaseURL: server.URL,
	})
	response, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "bytedance/stt-ws-slow",
		Modal:         runtimev1.Modal_MODAL_STT,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     2000,
		Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
					Source: &runtimev1.SpeechTranscriptionAudioSource_AudioChunks{
						AudioChunks: &runtimev1.AudioChunks{
							Chunks: [][]byte{
								[]byte("audio-chunk-1"),
								[]byte("audio-chunk-2"),
							},
						},
					},
				},
				MimeType: "audio/wav",
				ProviderOptions: structToMapPB(t, map[string]any{
					"transport":          "ws",
					"ws_read_timeout_ms": 30,
				}),
			},
		},
	})
	if err != nil {
		t.Fatalf("submit bytedance ws timeout stt job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, response.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_TIMEOUT {
		t.Fatalf("job status mismatch: got=%v want=%v", job.GetStatus(), runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_TIMEOUT)
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("job reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	}
}

func TestSubmitMediaJobBytedanceVideoViaOpenAICompat(t *testing.T) {
	videoPayload := []byte("bytedance-video-bytes")
	videoB64 := base64.StdEncoding.EncodeToString(videoPayload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/video/generations":
			http.NotFound(w, r)
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/videos/generations":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"b64_mp4":"` + videoB64 + `"}]}`))
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudBytedanceBaseURL: server.URL,
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "bytedance/video-1",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: "bytedance video prompt",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit bytedance video job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(videoPayload) {
		t.Fatalf("video bytes mismatch: got=%q want=%q", got, string(videoPayload))
	}
}

func TestSubmitMediaJobGeminiOperation(t *testing.T) {
	videoPayload := []byte("gemini-video-bytes")
	videoB64 := base64.StdEncoding.EncodeToString(videoPayload)
	pollCount := int32(0)
	var capturedSubmitPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/operations":
			_ = json.NewDecoder(r.Body).Decode(&capturedSubmitPayload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"name": "op-123",
			})
			return
		case r.Method == http.MethodGet && r.URL.Path == "/operations/op-123":
			current := atomic.AddInt32(&pollCount, 1)
			if current < 2 {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"done":   false,
					"status": "running",
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"done":   true,
				"status": "succeeded",
				"artifact": map[string]any{
					"b64_mp4":   videoB64,
					"mime_type": "video/mp4",
				},
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudGeminiBaseURL: server.URL,
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "gemini/veo-3",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt:         "city at dawn",
				NegativePrompt: "rain",
				DurationSec:    8,
				Fps:            24,
				ProviderOptions: structToMapPB(t, map[string]any{
					"stabilization": true,
				}),
			},
		},
	})
	if err != nil {
		t.Fatalf("submit gemini operation job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 5*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetProviderJobId() != "op-123" {
		t.Fatalf("provider job id mismatch: %s", job.GetProviderJobId())
	}
	if job.GetRetryCount() == 0 {
		t.Fatalf("gemini job retry count must be tracked")
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(videoPayload) {
		t.Fatalf("video payload mismatch: got=%q want=%q", got, string(videoPayload))
	}
	if capturedSubmitPayload["negative_prompt"] != "rain" {
		t.Fatalf("gemini canonical negative_prompt not forwarded: %#v", capturedSubmitPayload)
	}
	if intValue, ok := capturedSubmitPayload["duration_sec"].(float64); !ok || int(intValue) != 8 {
		t.Fatalf("gemini canonical duration_sec not forwarded: %#v", capturedSubmitPayload)
	}
	if _, ok := capturedSubmitPayload["provider_options"]; !ok {
		t.Fatalf("gemini provider_options not forwarded: %#v", capturedSubmitPayload)
	}
}

func TestSubmitMediaJobGeminiImageOperation(t *testing.T) {
	imagePayload := []byte("gemini-image-bytes")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/operations":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"name": "op-image-1",
			})
			return
		case r.Method == http.MethodGet && r.URL.Path == "/operations/op-image-1":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"done":   true,
				"status": "succeeded",
				"artifact": map[string]any{
					"b64_json":  imageB64,
					"mime_type": "image/png",
				},
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudGeminiBaseURL: server.URL,
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "gemini/imagen-3",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "mountain",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit gemini image operation job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetProviderJobId() != "op-image-1" {
		t.Fatalf("provider job id mismatch: %s", job.GetProviderJobId())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(imagePayload) {
		t.Fatalf("image payload mismatch: got=%q want=%q", got, string(imagePayload))
	}
}

func TestSubmitMediaJobMiniMaxTask(t *testing.T) {
	imagePayload := []byte("minimax-image-bytes")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	pollCount := int32(0)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/image_generation":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"task_id": "task-001",
			})
			return
		case r.Method == http.MethodGet && r.URL.Path == "/v1/query/image_generation":
			current := atomic.AddInt32(&pollCount, 1)
			if current < 2 {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status": "running",
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "success",
				"artifact": map[string]any{
					"b64_json":  imageB64,
					"mime_type": "image/png",
				},
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudMiniMaxBaseURL: server.URL,
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "minimax/image-1",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "forest at dusk",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit minimax task job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 5*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetProviderJobId() != "task-001" {
		t.Fatalf("provider job id mismatch: %s", job.GetProviderJobId())
	}
	if job.GetRetryCount() == 0 {
		t.Fatalf("minimax job retry count must be tracked")
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(imagePayload) {
		t.Fatalf("image payload mismatch: got=%q want=%q", got, string(imagePayload))
	}
}

func TestSubmitMediaJobMiniMaxVideoTask(t *testing.T) {
	videoPayload := []byte("minimax-video-bytes")
	videoB64 := base64.StdEncoding.EncodeToString(videoPayload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/video_generation":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"task_id": "task-video-001",
			})
			return
		case r.Method == http.MethodGet && r.URL.Path == "/v1/query/video_generation":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "success",
				"artifact": map[string]any{
					"b64_mp4":   videoB64,
					"mime_type": "video/mp4",
				},
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudMiniMaxBaseURL: server.URL,
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "minimax/video-1",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: "sea sunset",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit minimax video task job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetProviderJobId() != "task-video-001" {
		t.Fatalf("provider job id mismatch: %s", job.GetProviderJobId())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(videoPayload) {
		t.Fatalf("video payload mismatch: got=%q want=%q", got, string(videoPayload))
	}
}

func TestMediaJobMethodsValidateAndNotFound(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	if _, err := svc.SubmitMediaJob(ctx, nil); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("submit nil request code mismatch: %v", status.Code(err))
	}
	if _, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("submit invalid image spec code mismatch: %v", status.Code(err))
	}
	if _, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Modal:         runtimev1.Modal(99),
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("submit unsupported modal code mismatch: %v", status.Code(err))
	}

	if _, err := svc.GetMediaJob(ctx, &runtimev1.GetMediaJobRequest{}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("get media job invalid code mismatch: %v", status.Code(err))
	}
	if _, err := svc.GetMediaJob(ctx, &runtimev1.GetMediaJobRequest{JobId: "missing"}); status.Code(err) != codes.NotFound {
		t.Fatalf("get media job missing code mismatch: %v", status.Code(err))
	}

	if _, err := svc.CancelMediaJob(ctx, &runtimev1.CancelMediaJobRequest{}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("cancel media job invalid code mismatch: %v", status.Code(err))
	}
	if _, err := svc.CancelMediaJob(ctx, &runtimev1.CancelMediaJobRequest{JobId: "missing"}); status.Code(err) != codes.NotFound {
		t.Fatalf("cancel media job missing code mismatch: %v", status.Code(err))
	}

	if _, err := svc.GetMediaArtifacts(ctx, &runtimev1.GetMediaArtifactsRequest{}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("get artifacts invalid code mismatch: %v", status.Code(err))
	}
	if _, err := svc.GetMediaArtifacts(ctx, &runtimev1.GetMediaArtifactsRequest{JobId: "missing"}); status.Code(err) != codes.NotFound {
		t.Fatalf("get artifacts missing code mismatch: %v", status.Code(err))
	}

	stream := &mediaJobEventCollector{ctx: ctx}
	if err := svc.SubscribeMediaJobEvents(&runtimev1.SubscribeMediaJobEventsRequest{}, stream); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("subscribe invalid code mismatch: %v", status.Code(err))
	}
	if err := svc.SubscribeMediaJobEvents(&runtimev1.SubscribeMediaJobEventsRequest{JobId: "missing"}, stream); status.Code(err) != codes.NotFound {
		t.Fatalf("subscribe missing code mismatch: %v", status.Code(err))
	}
}

func TestSubmitMediaJobRangeValidation(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	cases := []struct {
		name string
		req  *runtimev1.SubmitMediaJobRequest
	}{
		{
			name: "image negative n",
			req: &runtimev1.SubmitMediaJobRequest{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-001",
				ModelId:       "local/sd3",
				Modal:         runtimev1.Modal_MODAL_IMAGE,
				RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
				Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
					ImageSpec: &runtimev1.ImageGenerationSpec{
						Prompt: "test",
						N:      -1,
					},
				},
			},
		},
		{
			name: "video fps overflow",
			req: &runtimev1.SubmitMediaJobRequest{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-001",
				ModelId:       "local/video",
				Modal:         runtimev1.Modal_MODAL_VIDEO,
				RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
				Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
					VideoSpec: &runtimev1.VideoGenerationSpec{
						Prompt: "test",
						Fps:    121,
					},
				},
			},
		},
		{
			name: "tts invalid sample rate",
			req: &runtimev1.SubmitMediaJobRequest{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-001",
				ModelId:       "local/tts",
				Modal:         runtimev1.Modal_MODAL_TTS,
				RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
				Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
					SpeechSpec: &runtimev1.SpeechSynthesisSpec{
						Text:         "hello",
						SampleRateHz: 500000,
					},
				},
			},
		},
		{
			name: "stt speaker count overflow",
			req: &runtimev1.SubmitMediaJobRequest{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-001",
				ModelId:       "local/stt",
				Modal:         runtimev1.Modal_MODAL_STT,
				RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
				Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
					TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
						AudioBytes:   []byte("audio"),
						SpeakerCount: 33,
					},
				},
			},
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.SubmitMediaJob(ctx, tc.req)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("invalid request must return invalid argument, got=%v", status.Code(err))
			}
		})
	}
}

func TestCancelMediaJobAndSubscribeLive(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	cancelCalled := atomic.Bool{}

	jobID := "job-live"
	created := svc.mediaJobs.create(&runtimev1.MediaJob{
		JobId:         jobID,
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		ModelResolved: "local/sd3",
		TraceId:       "trace-live",
		Status:        runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED,
	}, func() {
		cancelCalled.Store(true)
	})
	if created == nil {
		t.Fatalf("create media job record")
	}

	stream := &mediaJobEventCollector{ctx: ctx}
	subscribeDone := make(chan error, 1)
	go func() {
		subscribeDone <- svc.SubscribeMediaJobEvents(&runtimev1.SubscribeMediaJobEventsRequest{JobId: jobID}, stream)
	}()
	time.Sleep(20 * time.Millisecond)

	_, _ = svc.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_RUNNING, nil)
	cancelResp, err := svc.CancelMediaJob(ctx, &runtimev1.CancelMediaJobRequest{
		JobId:  jobID,
		Reason: "user canceled",
	})
	if err != nil {
		t.Fatalf("cancel media job: %v", err)
	}
	if cancelResp.GetJob().GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_CANCELED {
		t.Fatalf("cancel status mismatch: %v", cancelResp.GetJob().GetStatus())
	}
	if cancelResp.GetJob().GetReasonDetail() != "user canceled" {
		t.Fatalf("cancel reason mismatch: %s", cancelResp.GetJob().GetReasonDetail())
	}

	select {
	case err := <-subscribeDone:
		if err != nil {
			t.Fatalf("subscribe media job events: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("subscribe media job events timeout")
	}
	if !cancelCalled.Load() {
		t.Fatalf("expected cancel function to be invoked")
	}
	if len(stream.snapshot()) < 3 {
		t.Fatalf("expected at least submitted/running/canceled events, got %d", len(stream.snapshot()))
	}
}

func TestSubscribeMediaJobEventsTerminalBacklog(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	jobID := "job-terminal"
	if svc.mediaJobs.create(&runtimev1.MediaJob{
		JobId:         jobID,
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		ModelResolved: "local/sd3",
		TraceId:       "trace-terminal",
		Status:        runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED,
	}, nil) == nil {
		t.Fatalf("create media job record")
	}
	_, _ = svc.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_RUNNING, nil)
	_, _ = svc.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_COMPLETED, nil)

	stream := &mediaJobEventCollector{ctx: context.Background()}
	if err := svc.SubscribeMediaJobEvents(&runtimev1.SubscribeMediaJobEventsRequest{JobId: jobID}, stream); err != nil {
		t.Fatalf("subscribe terminal backlog: %v", err)
	}
	events := stream.snapshot()
	if len(events) < 3 {
		t.Fatalf("expected backlog events, got %d", len(events))
	}
	if events[len(events)-1].GetEventType() != runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_COMPLETED {
		t.Fatalf("expected terminal completed event, got %v", events[len(events)-1].GetEventType())
	}
}

func TestReasonCodeFromMediaErrorMapping(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want runtimev1.ReasonCode
	}{
		{
			name: "nil",
			err:  nil,
			want: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		{
			name: "deadline",
			err:  status.Error(codes.DeadlineExceeded, "deadline"),
			want: runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
		},
		{
			name: "not found",
			err:  status.Error(codes.NotFound, "missing"),
			want: runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
		},
		{
			name: "failed precondition",
			err:  status.Error(codes.FailedPrecondition, "unsupported"),
			want: runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
		},
		{
			name: "invalid argument",
			err:  status.Error(codes.InvalidArgument, "bad request"),
			want: runtimev1.ReasonCode_AI_INPUT_INVALID,
		},
		{
			name: "message enum",
			err:  status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String()),
			want: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		},
		{
			name: "non status",
			err:  io.EOF,
			want: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if got := reasonCodeFromMediaError(tc.err); got != tc.want {
				t.Fatalf("reason code mismatch: got=%v want=%v", got, tc.want)
			}
		})
	}
}

func waitMediaJobTerminal(t *testing.T, svc *Service, jobID string, timeout time.Duration) *runtimev1.MediaJob {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := svc.GetMediaJob(context.Background(), &runtimev1.GetMediaJobRequest{JobId: jobID})
		if err != nil {
			t.Fatalf("get media job: %v", err)
		}
		switch resp.GetJob().GetStatus() {
		case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_CANCELED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_TIMEOUT:
			return resp.GetJob()
		}
		time.Sleep(20 * time.Millisecond)
	}
	resp, err := svc.GetMediaJob(context.Background(), &runtimev1.GetMediaJobRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("get media job: %v", err)
	}
	t.Fatalf("media job timeout: id=%s status=%s", jobID, resp.GetJob().GetStatus().String())
	return nil
}

func structToMapPB(t *testing.T, input map[string]any) *structpb.Struct {
	t.Helper()
	value, err := structpb.NewStruct(input)
	if err != nil {
		t.Fatalf("create structpb: %v", err)
	}
	return value
}

type mediaJobEventCollector struct {
	mu     sync.Mutex
	ctx    context.Context
	events []*runtimev1.MediaJobEvent
}

func (s *mediaJobEventCollector) Send(event *runtimev1.MediaJobEvent) error {
	cloned := proto.Clone(event)
	copyEvent, ok := cloned.(*runtimev1.MediaJobEvent)
	if !ok {
		copyEvent = &runtimev1.MediaJobEvent{}
	}
	s.mu.Lock()
	s.events = append(s.events, copyEvent)
	s.mu.Unlock()
	return nil
}

func (s *mediaJobEventCollector) snapshot() []*runtimev1.MediaJobEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*runtimev1.MediaJobEvent, 0, len(s.events))
	out = append(out, s.events...)
	return out
}

func (s *mediaJobEventCollector) SetHeader(metadata.MD) error  { return nil }
func (s *mediaJobEventCollector) SendHeader(metadata.MD) error { return nil }
func (s *mediaJobEventCollector) SetTrailer(metadata.MD)       {}
func (s *mediaJobEventCollector) Context() context.Context     { return s.ctx }
func (s *mediaJobEventCollector) SendMsg(any) error            { return nil }
func (s *mediaJobEventCollector) RecvMsg(any) error            { return nil }
