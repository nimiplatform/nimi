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

	"golang.org/x/net/websocket"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
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
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: server.URL}},
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
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: server.URL}},
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

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"volcengine":            {BaseURL: server.URL},
			"volcengine_openspeech": {BaseURL: server.URL},
		},
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

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"volcengine":            {BaseURL: server.URL},
			"volcengine_openspeech": {BaseURL: server.URL},
		},
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
			switch strings.ToLower(strings.TrimSpace(nimillm.ValueAsString(payload["event"]))) {
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

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"volcengine":            {BaseURL: server.URL},
			"volcengine_openspeech": {BaseURL: server.URL},
		},
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
			if strings.EqualFold(strings.TrimSpace(nimillm.ValueAsString(payload["event"])), "finish") {
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

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"volcengine":            {BaseURL: server.URL},
			"volcengine_openspeech": {BaseURL: server.URL},
		},
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
			if strings.EqualFold(strings.TrimSpace(nimillm.ValueAsString(payload["event"])), "finish") {
				time.Sleep(200 * time.Millisecond)
				return
			}
		}
	}))
	server := httptest.NewServer(mux)
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"volcengine":            {BaseURL: server.URL},
			"volcengine_openspeech": {BaseURL: server.URL},
		},
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

func TestSubmitMediaJobBytedanceARKVideoTask(t *testing.T) {
	videoPayload := []byte("bytedance-video-bytes")
	videoB64 := base64.StdEncoding.EncodeToString(videoPayload)
	var pollCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v3/contents/generations/tasks":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"ark-task-1"}`))
			return
		case r.Method == http.MethodGet && r.URL.Path == "/api/v3/contents/generations/tasks/ark-task-1":
			w.Header().Set("Content-Type", "application/json")
			if pollCount.Add(1) < 2 {
				_, _ = w.Write([]byte(`{"status":"running"}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":"succeeded","output":{"b64_mp4":"` + videoB64 + `","mime_type":"video/mp4"}}`))
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"volcengine": {BaseURL: server.URL}},
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
	if job.GetProviderJobId() != "ark-task-1" {
		t.Fatalf("provider job id mismatch: %s", job.GetProviderJobId())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(videoPayload) {
		t.Fatalf("video bytes mismatch: got=%q want=%q", got, string(videoPayload))
	}
}

func TestSubmitMediaJobBytedanceARKImage(t *testing.T) {
	imagePayload := []byte("bytedance-image-bytes")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/v3/images/generations" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"b64_json":"` + imageB64 + `","mime_type":"image/png"}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"volcengine": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "bytedance/image-1",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "bytedance image prompt",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit bytedance image job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(imagePayload) {
		t.Fatalf("image bytes mismatch: got=%q want=%q", got, string(imagePayload))
	}
}

func TestSubmitMediaJobAlibabaNativeModalities(t *testing.T) {
	imagePayload := []byte("alibaba-image-bytes")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	videoPayload := []byte("alibaba-video-bytes")
	videoB64 := base64.StdEncoding.EncodeToString(videoPayload)
	audioPayload := []byte("alibaba-tts-audio")
	var videoPollCount atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/services/aigc/image2image/image-synthesis":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"ali-image-task-1"}`))
			return
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/tasks/ali-image-task-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"succeeded","output":{"b64_json":"` + imageB64 + `","mime_type":"image/png"}}`))
			return
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/services/aigc/video-generation/video-synthesis":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"ali-video-task-1"}`))
			return
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/tasks/ali-video-task-1":
			w.Header().Set("Content-Type", "application/json")
			if videoPollCount.Add(1) < 2 {
				_, _ = w.Write([]byte(`{"status":"running"}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":"succeeded","output":{"b64_mp4":"` + videoB64 + `","mime_type":"video/mp4"}}`))
			return
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/services/aigc/multimodal-generation/generation":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(audioPayload)
			return
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/services/audio/asr/transcription":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"text":"alibaba stt text"}`))
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"dashscope": {BaseURL: server.URL}},
	})

	imageResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "aliyun/image-1",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "alibaba image prompt",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit alibaba image job: %v", err)
	}
	imageJob := waitMediaJobTerminal(t, svc, imageResp.GetJob().GetJobId(), 3*time.Second)
	if imageJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("image job status mismatch: %v", imageJob.GetStatus())
	}
	if imageJob.GetProviderJobId() != "ali-image-task-1" {
		t.Fatalf("image provider job id mismatch: %s", imageJob.GetProviderJobId())
	}
	if got := string(imageJob.GetArtifacts()[0].GetBytes()); got != string(imagePayload) {
		t.Fatalf("image payload mismatch: got=%q want=%q", got, string(imagePayload))
	}

	videoResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "aliyun/video-1",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: "alibaba video prompt",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit alibaba video job: %v", err)
	}
	videoJob := waitMediaJobTerminal(t, svc, videoResp.GetJob().GetJobId(), 3*time.Second)
	if videoJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("video job status mismatch: %v", videoJob.GetStatus())
	}
	if videoJob.GetProviderJobId() != "ali-video-task-1" {
		t.Fatalf("video provider job id mismatch: %s", videoJob.GetProviderJobId())
	}
	if got := string(videoJob.GetArtifacts()[0].GetBytes()); got != string(videoPayload) {
		t.Fatalf("video payload mismatch: got=%q want=%q", got, string(videoPayload))
	}

	ttsResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "aliyun/tts-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: "alibaba tts",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit alibaba tts job: %v", err)
	}
	ttsJob := waitMediaJobTerminal(t, svc, ttsResp.GetJob().GetJobId(), 3*time.Second)
	if ttsJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("tts job status mismatch: %v", ttsJob.GetStatus())
	}
	if got := string(ttsJob.GetArtifacts()[0].GetBytes()); got != string(audioPayload) {
		t.Fatalf("tts payload mismatch: got=%q want=%q", got, string(audioPayload))
	}

	sttResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "aliyun/stt-1",
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
		t.Fatalf("submit alibaba stt job: %v", err)
	}
	sttJob := waitMediaJobTerminal(t, svc, sttResp.GetJob().GetJobId(), 3*time.Second)
	if sttJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("stt job status mismatch: %v", sttJob.GetStatus())
	}
	if got := string(sttJob.GetArtifacts()[0].GetBytes()); got != "alibaba stt text" {
		t.Fatalf("stt text mismatch: got=%q", got)
	}
}

func TestSubmitMediaJobBytedanceARKVideoTaskCustomPaths(t *testing.T) {
	videoPayload := []byte("bytedance-custom-video-bytes")
	videoB64 := base64.StdEncoding.EncodeToString(videoPayload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/custom/tasks":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"ark-custom-task-1"}`))
			return
		case r.Method == http.MethodGet && r.URL.Path == "/custom/tasks/ark-custom-task-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"succeeded","output":{"b64_mp4":"` + videoB64 + `","mime_type":"video/mp4"}}`))
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"volcengine": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "bytedance/video-custom-1",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: "custom path video",
				ProviderOptions: structToMapPB(t, map[string]any{
					"video_submit_path":         "/custom/tasks",
					"video_query_path_template": "/custom/tasks/{task_id}",
				}),
			},
		},
	})
	if err != nil {
		t.Fatalf("submit bytedance custom path video job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetProviderJobId() != "ark-custom-task-1" {
		t.Fatalf("provider job id mismatch: %s", job.GetProviderJobId())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(videoPayload) {
		t.Fatalf("video bytes mismatch: got=%q want=%q", got, string(videoPayload))
	}
}

func TestSubmitMediaJobBytedanceARKVideoTaskFailedMapsUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v3/contents/generations/tasks":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"ark-failed-task-1"}`))
			return
		case r.Method == http.MethodGet && r.URL.Path == "/api/v3/contents/generations/tasks/ark-failed-task-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"failed"}`))
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"volcengine": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "bytedance/video-failed-1",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: "failed video",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit bytedance failed video job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
}

func TestSubmitMediaJobAlibabaNativeImageTaskCustomPaths(t *testing.T) {
	imagePayload := []byte("alibaba-custom-image-bytes")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/custom/alibaba/image":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"ali-custom-image-task-1"}`))
			return
		case r.Method == http.MethodGet && r.URL.Path == "/custom/alibaba/tasks/ali-custom-image-task-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"succeeded","output":{"b64_json":"` + imageB64 + `","mime_type":"image/png"}}`))
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"dashscope": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "aliyun/image-custom-1",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "custom alibaba image",
				ProviderOptions: structToMapPB(t, map[string]any{
					"image_submit_path":        "/custom/alibaba/image",
					"task_query_path_template": "/custom/alibaba/tasks/{task_id}",
				}),
			},
		},
	})
	if err != nil {
		t.Fatalf("submit alibaba custom path image job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetProviderJobId() != "ali-custom-image-task-1" {
		t.Fatalf("provider job id mismatch: %s", job.GetProviderJobId())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(imagePayload) {
		t.Fatalf("image payload mismatch: got=%q want=%q", got, string(imagePayload))
	}
}

func TestSubmitMediaJobAlibabaNativeVideoTaskFailedMapsUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/services/aigc/video-generation/video-synthesis":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"ali-failed-video-task-1"}`))
			return
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/tasks/ali-failed-video-task-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"failed"}`))
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"dashscope": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "alibaba/video-failed-1",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: "failed alibaba video",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit alibaba failed video job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
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

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"gemini": {BaseURL: server.URL}},
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

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"gemini": {BaseURL: server.URL}},
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

func TestSubmitMediaJobGeminiTTSOperation(t *testing.T) {
	audioPayload := []byte("gemini-tts-audio")
	audioB64 := base64.StdEncoding.EncodeToString(audioPayload)
	var capturedSubmitPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/operations":
			_ = json.NewDecoder(r.Body).Decode(&capturedSubmitPayload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"name": "op-tts-1",
			})
			return
		case r.Method == http.MethodGet && r.URL.Path == "/operations/op-tts-1":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"done":   true,
				"status": "succeeded",
				"artifact": map[string]any{
					"audio_base64": audioB64,
					"mime_type":    "audio/wav",
				},
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"gemini": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "gemini/tts-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text:        "hello gemini",
				Voice:       "voice-a",
				AudioFormat: "wav",
				ProviderOptions: structToMapPB(t, map[string]any{
					"style": "calm",
				}),
			},
		},
	})
	if err != nil {
		t.Fatalf("submit gemini tts operation job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetProviderJobId() != "op-tts-1" {
		t.Fatalf("provider job id mismatch: %s", job.GetProviderJobId())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(audioPayload) {
		t.Fatalf("audio payload mismatch: got=%q want=%q", got, string(audioPayload))
	}
	if got := job.GetArtifacts()[0].GetMimeType(); got != "audio/wav" {
		t.Fatalf("artifact mime mismatch: got=%s", got)
	}
	if nimillm.ValueAsString(capturedSubmitPayload["input"]) != "hello gemini" {
		t.Fatalf("gemini tts input mismatch: %#v", capturedSubmitPayload)
	}
	if _, ok := capturedSubmitPayload["provider_options"]; !ok {
		t.Fatalf("gemini tts provider options missing: %#v", capturedSubmitPayload)
	}
}

func TestSubmitMediaJobGeminiSTTOperation(t *testing.T) {
	var capturedSubmitPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/operations":
			_ = json.NewDecoder(r.Body).Decode(&capturedSubmitPayload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"name": "op-stt-1",
			})
			return
		case r.Method == http.MethodGet && r.URL.Path == "/operations/op-stt-1":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"done":   true,
				"status": "succeeded",
				"text":   "gemini stt text",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"gemini": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "gemini/asr-1",
		Modal:         runtimev1.Modal_MODAL_STT,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioBytes: []byte("audio-bytes"),
				MimeType:   "audio/wav",
				Language:   "en",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit gemini stt operation job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetProviderJobId() != "op-stt-1" {
		t.Fatalf("provider job id mismatch: %s", job.GetProviderJobId())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != "gemini stt text" {
		t.Fatalf("stt text mismatch: got=%q", got)
	}
	audioBase64 := strings.TrimSpace(nimillm.ValueAsString(capturedSubmitPayload["audio_base64"]))
	if audioBase64 == "" {
		t.Fatalf("gemini stt audio_base64 missing: %#v", capturedSubmitPayload)
	}
	if nimillm.ValueAsString(capturedSubmitPayload["mime_type"]) != "audio/wav" {
		t.Fatalf("gemini stt mime_type mismatch: %#v", capturedSubmitPayload)
	}
}

func TestSubmitMediaJobGeminiTTSOperationFailedMapsUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/operations":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"name": "op-tts-fail",
			})
			return
		case r.Method == http.MethodGet && r.URL.Path == "/operations/op-tts-fail":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"done":   true,
				"status": "failed",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"gemini": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "gemini/tts-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: "hello gemini",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit gemini tts failed job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("job reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
}

func TestSubmitMediaJobGeminiOperationTimeoutMapsProviderTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/operations":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"name": "op-timeout-1",
			})
			return
		case r.Method == http.MethodGet && r.URL.Path == "/operations/op-timeout-1":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"done":   false,
				"status": "running",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"gemini": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "gemini/veo-3",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     80,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: "timeout test",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit gemini timeout job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_TIMEOUT {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("job reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	}
}

func TestSubmitMediaJobGeminiSTTOperationFailedMapsUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/operations":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"name": "op-stt-fail",
			})
			return
		case r.Method == http.MethodGet && r.URL.Path == "/operations/op-stt-fail":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"done":   true,
				"status": "failed",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"gemini": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "gemini/asr-1",
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
		t.Fatalf("submit gemini stt failed job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("job reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
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

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"minimax": {BaseURL: server.URL}},
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

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"minimax": {BaseURL: server.URL}},
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

func TestSubmitMediaJobMiniMaxTTSTask(t *testing.T) {
	audioPayload := []byte("minimax-tts-audio")
	audioB64 := base64.StdEncoding.EncodeToString(audioPayload)
	var ttsPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/t2a_v2":
			_ = json.NewDecoder(r.Body).Decode(&ttsPayload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"audio_base64": audioB64,
				"mime_type":    "audio/mpeg",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"minimax": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "minimax/speech-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text:        "hello minimax",
				Voice:       "voice-a",
				AudioFormat: "mp3",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit minimax tts task job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(audioPayload) {
		t.Fatalf("audio payload mismatch: got=%q want=%q", got, string(audioPayload))
	}
	voiceSetting, ok := ttsPayload["voice_setting"].(map[string]any)
	if !ok {
		t.Fatalf("minimax tts voice_setting missing: %#v", ttsPayload)
	}
	if nimillm.ValueAsString(voiceSetting["voice"]) != "voice-a" {
		t.Fatalf("minimax tts voice mismatch: %#v", voiceSetting)
	}
}

func TestSubmitMediaJobMiniMaxTTSTaskFallbackToOpenAISpeech(t *testing.T) {
	audioPayload := []byte("minimax-tts-fallback-audio")
	var fallbackPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/t2a_v2":
			http.NotFound(w, r)
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech":
			fallbackPath = r.URL.Path
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(audioPayload)
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"minimax": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "minimax/speech-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: "hello minimax fallback",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit minimax tts fallback job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(audioPayload) {
		t.Fatalf("audio payload mismatch: got=%q want=%q", got, string(audioPayload))
	}
	if fallbackPath != "/v1/audio/speech" {
		t.Fatalf("minimax tts fallback path mismatch: got=%s", fallbackPath)
	}
}

func TestSubmitMediaJobMiniMaxSTTTask(t *testing.T) {
	var submitPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/transcriptions":
			submitPath = r.URL.Path
			_ = json.NewEncoder(w).Encode(map[string]any{
				"text": "minimax stt text",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"minimax": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "minimax/asr-1",
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
		t.Fatalf("submit minimax stt task job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != "minimax stt text" {
		t.Fatalf("stt text mismatch: got=%q", got)
	}
	if submitPath != "/v1/audio/transcriptions" {
		t.Fatalf("minimax stt submit path mismatch: got=%s", submitPath)
	}
}

func TestSubmitMediaJobMiniMaxSTTTaskUnsupportedMapsRouteUnsupported(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"minimax": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "minimax/asr-1",
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
		t.Fatalf("submit minimax stt unsupported job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("job reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func TestSubmitMediaJobMiniMaxImageTaskFailedMapsUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/image_generation":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"task_id": "task-failed-1",
			})
			return
		case r.Method == http.MethodGet && r.URL.Path == "/v1/query/image_generation":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "failed",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"minimax": {BaseURL: server.URL}},
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
				Prompt: "should fail",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit minimax failed job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("job reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
}

func TestSubmitMediaJobMiniMaxTTSTaskUnavailableMapsProviderUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/t2a_v2" {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"message": "tts unavailable",
				},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"minimax": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "minimax/speech-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: "minimax tts unavailable",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit minimax tts unavailable job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
}

func TestSubmitMediaJobMiniMaxSTTTaskTimeoutMapsProviderTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/audio/transcriptions" {
			time.Sleep(300 * time.Millisecond)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"text": "late text",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"minimax": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "minimax/asr-1",
		Modal:         runtimev1.Modal_MODAL_STT,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     80,
		Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioBytes: []byte("audio-bytes"),
				MimeType:   "audio/wav",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit minimax stt timeout job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_TIMEOUT {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	}
}

func TestSubmitMediaJobGLMVideoTask(t *testing.T) {
	videoPayload := []byte("glm-video-bytes")
	videoB64 := base64.StdEncoding.EncodeToString(videoPayload)
	pollCount := int32(0)
	var submitPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/paas/v4/videos/generations":
			submitPath = r.URL.Path
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": "glm-task-001",
			})
			return
		case r.Method == http.MethodGet && r.URL.Path == "/api/paas/v4/async-result/glm-task-001":
			current := atomic.AddInt32(&pollCount, 1)
			if current < 2 {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status": "running",
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
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

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"glm": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "glm/cogvideox-3",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt:      "city flyover",
				DurationSec: 6,
			},
		},
	})
	if err != nil {
		t.Fatalf("submit glm task job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 5*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetProviderJobId() != "glm-task-001" {
		t.Fatalf("provider job id mismatch: %s", job.GetProviderJobId())
	}
	if job.GetRetryCount() == 0 {
		t.Fatalf("glm job retry count must be tracked")
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(videoPayload) {
		t.Fatalf("video payload mismatch: got=%q want=%q", got, string(videoPayload))
	}
	if submitPath != "/api/paas/v4/videos/generations" {
		t.Fatalf("glm submit path mismatch: got=%s", submitPath)
	}
}

func TestSubmitMediaJobGLMImageNative(t *testing.T) {
	imagePayload := []byte("glm-image-bytes")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	var submitPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/paas/v4/images/generations":
			submitPath = r.URL.Path
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{
						"b64_json":  imageB64,
						"mime_type": "image/png",
					},
				},
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"glm": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "glm/cogview-3",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "mountain at dusk",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit glm image job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(imagePayload) {
		t.Fatalf("image payload mismatch: got=%q want=%q", got, string(imagePayload))
	}
	if submitPath != "/api/paas/v4/images/generations" {
		t.Fatalf("glm image submit path mismatch: got=%s", submitPath)
	}
}

func TestSubmitMediaJobGLMTTSNative(t *testing.T) {
	audioPayload := []byte("glm-tts-audio")
	audioB64 := base64.StdEncoding.EncodeToString(audioPayload)
	var submitPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/paas/v4/audio/speech":
			submitPath = r.URL.Path
			_ = json.NewEncoder(w).Encode(map[string]any{
				"audio_base64": audioB64,
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"glm": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "glm/tts-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: "hello glm",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit glm tts job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(audioPayload) {
		t.Fatalf("tts payload mismatch: got=%q want=%q", got, string(audioPayload))
	}
	if submitPath != "/api/paas/v4/audio/speech" {
		t.Fatalf("glm tts submit path mismatch: got=%s", submitPath)
	}
}

func TestSubmitMediaJobGLMSTTNative(t *testing.T) {
	var submitPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/paas/v4/audio/transcriptions":
			submitPath = r.URL.Path
			_ = json.NewEncoder(w).Encode(map[string]any{
				"text": "glm stt text",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"glm": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "glm/asr-1",
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
		t.Fatalf("submit glm stt job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != "glm stt text" {
		t.Fatalf("stt text mismatch: got=%q", got)
	}
	if submitPath != "/api/paas/v4/audio/transcriptions" {
		t.Fatalf("glm stt submit path mismatch: got=%s", submitPath)
	}
}

func TestSubmitMediaJobKimiImageChatMultimodal(t *testing.T) {
	imagePayload := []byte("kimi-image-bytes")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	var capturedPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/chat/completions":
			_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{
						"message": map[string]any{
							"content": []map[string]any{
								{
									"type":      "output_image",
									"b64_json":  imageB64,
									"mime_type": "image/png",
								},
							},
						},
					},
				},
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"kimi": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "moonshot/moonshot-v1-vision",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt:          "render a floating city",
				ResponseFormat:  "png",
				ReferenceImages: []string{"https://assets.example/ref.png"},
				ProviderOptions: structToMapPB(t, map[string]any{
					"style_preset": "anime",
				}),
			},
		},
	})
	if err != nil {
		t.Fatalf("submit kimi image job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(imagePayload) {
		t.Fatalf("image payload mismatch: got=%q want=%q", got, string(imagePayload))
	}
	if nimillm.ValueAsString(capturedPayload["model"]) != "moonshot-v1-vision" {
		t.Fatalf("kimi resolved model mismatch: %#v", capturedPayload)
	}
	responseField, ok := capturedPayload["response"].(map[string]any)
	if !ok {
		t.Fatalf("kimi response mapping missing: %#v", capturedPayload)
	}
	modalities, ok := responseField["modalities"].([]any)
	if !ok || len(modalities) == 0 || nimillm.ValueAsString(modalities[0]) != "image" {
		t.Fatalf("kimi response modalities mismatch: %#v", responseField)
	}
	if nimillm.ValueAsString(responseField["output_image_format"]) != "png" {
		t.Fatalf("kimi output image format mismatch: %#v", responseField)
	}
	if _, ok := capturedPayload["provider_options"]; !ok {
		t.Fatalf("kimi provider options mapping missing: %#v", capturedPayload)
	}
}

func TestSubmitMediaJobKimiImageChatMultimodalInvalidOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/chat/completions" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{
						"message": map[string]any{
							"content": []map[string]any{
								{
									"type": "text",
									"text": "no image generated",
								},
							},
						},
					},
				},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"kimi": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "kimi/kimi-image",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "missing image output",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit kimi invalid output job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
}

func TestSubmitMediaJobKimiTTSOpenAICompat(t *testing.T) {
	audioPayload := []byte("kimi-tts-audio")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech" {
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(audioPayload)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"kimi": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "kimi/voice-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: "hello kimi",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit kimi tts job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(audioPayload) {
		t.Fatalf("tts payload mismatch: got=%q want=%q", got, string(audioPayload))
	}
}

func TestSubmitMediaJobKimiTTSUnavailableMapsProviderUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech" {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"message": "tts unavailable",
				},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"kimi": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "kimi/voice-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: "hello kimi",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit kimi tts unavailable job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
}

func TestSubmitMediaJobKimiSTTOpenAICompat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/audio/transcriptions" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"text": "kimi stt text",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"kimi": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "kimi/asr-1",
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
		t.Fatalf("submit kimi stt job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != "kimi stt text" {
		t.Fatalf("stt text mismatch: got=%q", got)
	}
}

func TestSubmitMediaJobKimiSTTUnavailableMapsProviderUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/audio/transcriptions" {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"message": "service unavailable",
				},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"kimi": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "kimi/asr-1",
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
		t.Fatalf("submit kimi stt unavailable job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
}

func TestSubmitMediaJobLocalAIModalities(t *testing.T) {
	videoPayload := []byte("localai-video-bytes")
	videoB64 := base64.StdEncoding.EncodeToString(videoPayload)
	audioPayload := []byte("localai-tts-audio")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/video/generations":
			http.NotFound(w, r)
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/videos/generations":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"b64_mp4": videoB64, "mime_type": "video/mp4"},
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(audioPayload)
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/transcriptions":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"text": "localai stt text",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: server.URL}},
	})

	videoResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/video-1",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: "local video",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit localai video job: %v", err)
	}
	videoJob := waitMediaJobTerminal(t, svc, videoResp.GetJob().GetJobId(), 3*time.Second)
	if videoJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("video job status mismatch: %v", videoJob.GetStatus())
	}
	if got := string(videoJob.GetArtifacts()[0].GetBytes()); got != string(videoPayload) {
		t.Fatalf("video payload mismatch: got=%q want=%q", got, string(videoPayload))
	}

	ttsResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/tts-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: "local tts",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit localai tts job: %v", err)
	}
	ttsJob := waitMediaJobTerminal(t, svc, ttsResp.GetJob().GetJobId(), 3*time.Second)
	if ttsJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("tts job status mismatch: %v", ttsJob.GetStatus())
	}
	if got := string(ttsJob.GetArtifacts()[0].GetBytes()); got != string(audioPayload) {
		t.Fatalf("tts payload mismatch: got=%q want=%q", got, string(audioPayload))
	}

	sttResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/stt-1",
		Modal:         runtimev1.Modal_MODAL_STT,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioBytes: []byte("audio-bytes"),
				MimeType:   "audio/wav",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit localai stt job: %v", err)
	}
	sttJob := waitMediaJobTerminal(t, svc, sttResp.GetJob().GetJobId(), 3*time.Second)
	if sttJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("stt job status mismatch: %v", sttJob.GetStatus())
	}
	if got := string(sttJob.GetArtifacts()[0].GetBytes()); got != "localai stt text" {
		t.Fatalf("stt text mismatch: got=%q", got)
	}
}

func TestSubmitMediaJobNimiLLMModalities(t *testing.T) {
	imagePayload := []byte("nimillm-image-bytes")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	videoPayload := []byte("nimillm-video-bytes")
	videoB64 := base64.StdEncoding.EncodeToString(videoPayload)
	audioPayload := []byte("nimillm-tts-audio")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"b64_json": imageB64, "mime_type": "image/png"},
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/video/generations":
			http.NotFound(w, r)
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/videos/generations":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"b64_mp4": videoB64, "mime_type": "video/mp4"},
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(audioPayload)
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/transcriptions":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"text": "nimillm stt text",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"nimillm": {BaseURL: server.URL}},
	})

	imageResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "nimillm/image-1",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "nimillm image",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit nimillm image job: %v", err)
	}
	imageJob := waitMediaJobTerminal(t, svc, imageResp.GetJob().GetJobId(), 3*time.Second)
	if imageJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("image job status mismatch: %v", imageJob.GetStatus())
	}
	if got := string(imageJob.GetArtifacts()[0].GetBytes()); got != string(imagePayload) {
		t.Fatalf("image payload mismatch: got=%q want=%q", got, string(imagePayload))
	}

	videoResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "nimillm/video-1",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: "nimillm video",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit nimillm video job: %v", err)
	}
	videoJob := waitMediaJobTerminal(t, svc, videoResp.GetJob().GetJobId(), 3*time.Second)
	if videoJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("video job status mismatch: %v", videoJob.GetStatus())
	}
	if got := string(videoJob.GetArtifacts()[0].GetBytes()); got != string(videoPayload) {
		t.Fatalf("video payload mismatch: got=%q want=%q", got, string(videoPayload))
	}

	ttsResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "nimillm/tts-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: "nimillm tts",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit nimillm tts job: %v", err)
	}
	ttsJob := waitMediaJobTerminal(t, svc, ttsResp.GetJob().GetJobId(), 3*time.Second)
	if ttsJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("tts job status mismatch: %v", ttsJob.GetStatus())
	}
	if got := string(ttsJob.GetArtifacts()[0].GetBytes()); got != string(audioPayload) {
		t.Fatalf("tts payload mismatch: got=%q want=%q", got, string(audioPayload))
	}

	sttResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "nimillm/stt-1",
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
		t.Fatalf("submit nimillm stt job: %v", err)
	}
	sttJob := waitMediaJobTerminal(t, svc, sttResp.GetJob().GetJobId(), 3*time.Second)
	if sttJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("stt job status mismatch: %v", sttJob.GetStatus())
	}
	if got := string(sttJob.GetArtifacts()[0].GetBytes()); got != "nimillm stt text" {
		t.Fatalf("stt text mismatch: got=%q", got)
	}
}

func TestSubmitMediaJobNimiLLMImageUnavailableMapsProviderUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations" {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"message": "upstream unavailable",
				},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"nimillm": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "nimillm/image-1",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "fail image",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit nimillm unavailable job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
}

func TestSubmitMediaJobNimiLLMSTTTimeoutMapsProviderTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/audio/transcriptions" {
			time.Sleep(300 * time.Millisecond)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"text": "late transcribe",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"nimillm": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "nimillm/stt-1",
		Modal:         runtimev1.Modal_MODAL_STT,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     80,
		Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioBytes: []byte("audio-bytes"),
				MimeType:   "audio/wav",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit nimillm stt timeout job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_TIMEOUT {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	}
}

func TestSubmitMediaJobNexaModalitiesAndVideoFailClose(t *testing.T) {
	imagePayload := []byte("nexa-image-bytes")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	audioPayload := []byte("nexa-tts-audio")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"b64_json": imageB64, "mime_type": "image/png"},
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(audioPayload)
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/transcriptions":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"text": "nexa stt text",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"nexa": {BaseURL: server.URL}},
	})

	imageResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "nexa/image-1",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "nexa image",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit nexa image job: %v", err)
	}
	imageJob := waitMediaJobTerminal(t, svc, imageResp.GetJob().GetJobId(), 3*time.Second)
	if imageJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("image job status mismatch: %v", imageJob.GetStatus())
	}
	if got := string(imageJob.GetArtifacts()[0].GetBytes()); got != string(imagePayload) {
		t.Fatalf("image payload mismatch: got=%q want=%q", got, string(imagePayload))
	}

	ttsResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "nexa/tts-1",
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: "nexa tts",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit nexa tts job: %v", err)
	}
	ttsJob := waitMediaJobTerminal(t, svc, ttsResp.GetJob().GetJobId(), 3*time.Second)
	if ttsJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("tts job status mismatch: %v", ttsJob.GetStatus())
	}
	if got := string(ttsJob.GetArtifacts()[0].GetBytes()); got != string(audioPayload) {
		t.Fatalf("tts payload mismatch: got=%q want=%q", got, string(audioPayload))
	}

	sttResp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "nexa/stt-1",
		Modal:         runtimev1.Modal_MODAL_STT,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioBytes: []byte("audio-bytes"),
				MimeType:   "audio/wav",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit nexa stt job: %v", err)
	}
	sttJob := waitMediaJobTerminal(t, svc, sttResp.GetJob().GetJobId(), 3*time.Second)
	if sttJob.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("stt job status mismatch: %v", sttJob.GetStatus())
	}
	if got := string(sttJob.GetArtifacts()[0].GetBytes()); got != "nexa stt text" {
		t.Fatalf("stt text mismatch: got=%q", got)
	}

	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "nexa/video-1",
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: "nexa video unsupported",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit nexa video job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("reason code mismatch: got=%v want=%v", job.GetReasonCode(), runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func TestResolveMediaAdapterNameKimiImage(t *testing.T) {
	adapter := resolveMediaAdapterName("moonshot/moonshot-v1-vision", "moonshot-v1-vision", runtimev1.Modal_MODAL_IMAGE)
	if adapter != adapterKimiChatMultimodal {
		t.Fatalf("adapter mismatch: got=%s want=%s", adapter, adapterKimiChatMultimodal)
	}
}

func TestResolveMediaAdapterNameGLMNative(t *testing.T) {
	if adapter := resolveMediaAdapterName("glm/cogview-3", "cogview-3", runtimev1.Modal_MODAL_IMAGE); adapter != adapterGLMNative {
		t.Fatalf("glm image adapter mismatch: got=%s want=%s", adapter, adapterGLMNative)
	}
	if adapter := resolveMediaAdapterName("bigmodel/asr-1", "asr-1", runtimev1.Modal_MODAL_STT); adapter != adapterGLMNative {
		t.Fatalf("glm stt adapter mismatch: got=%s want=%s", adapter, adapterGLMNative)
	}
	if adapter := resolveMediaAdapterName("zhipu/video-1", "video-1", runtimev1.Modal_MODAL_VIDEO); adapter != adapterGLMTask {
		t.Fatalf("glm video adapter mismatch: got=%s want=%s", adapter, adapterGLMTask)
	}
}

func TestResolveMediaAdapterNameAlibabaAndBytedance(t *testing.T) {
	if adapter := resolveMediaAdapterName("aliyun/wanx-v2", "wanx-v2", runtimev1.Modal_MODAL_IMAGE); adapter != adapterAlibabaNative {
		t.Fatalf("alibaba image adapter mismatch: got=%s want=%s", adapter, adapterAlibabaNative)
	}
	if adapter := resolveMediaAdapterName("alibaba/wan2.2", "wan2.2", runtimev1.Modal_MODAL_VIDEO); adapter != adapterAlibabaNative {
		t.Fatalf("alibaba video adapter mismatch: got=%s want=%s", adapter, adapterAlibabaNative)
	}
	if adapter := resolveMediaAdapterName("bytedance/video-1", "video-1", runtimev1.Modal_MODAL_VIDEO); adapter != adapterBytedanceARKTask {
		t.Fatalf("bytedance video adapter mismatch: got=%s want=%s", adapter, adapterBytedanceARKTask)
	}
	if adapter := resolveMediaAdapterName("byte/stt-1", "stt-1", runtimev1.Modal_MODAL_STT); adapter != adapterBytedanceOpenSpeech {
		t.Fatalf("bytedance stt adapter mismatch: got=%s want=%s", adapter, adapterBytedanceOpenSpeech)
	}
}

func TestMediaJobMethodsValidateAndNotFound(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
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
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
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
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
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
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
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
			err:  grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE),
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

func TestMediaJobReasonCodeClassification(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	t.Run("GetMediaJob_NotFound_ReasonCode", func(t *testing.T) {
		_, err := svc.GetMediaJob(ctx, &runtimev1.GetMediaJobRequest{JobId: "nonexistent"})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("CancelMediaJob_NotFound_ReasonCode", func(t *testing.T) {
		_, err := svc.CancelMediaJob(ctx, &runtimev1.CancelMediaJobRequest{JobId: "nonexistent"})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("GetMediaArtifacts_NotFound_ReasonCode", func(t *testing.T) {
		_, err := svc.GetMediaArtifacts(ctx, &runtimev1.GetMediaArtifactsRequest{JobId: "nonexistent"})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubscribeMediaJobEvents_NotFound_ReasonCode", func(t *testing.T) {
		stream := &mediaJobEventCollector{ctx: ctx}
		err := svc.SubscribeMediaJobEvents(&runtimev1.SubscribeMediaJobEventsRequest{JobId: "nonexistent"}, stream)
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("CancelMediaJob_NotCancellable_ReasonCode", func(t *testing.T) {
		jobID := "job-completed-for-cancel"
		created := svc.mediaJobs.create(&runtimev1.MediaJob{
			JobId:         jobID,
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/sd3",
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			ModelResolved: "local/sd3",
			TraceId:       "trace-completed",
			Status:        runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED,
		}, func() {})
		if created == nil {
			t.Fatal("create media job record")
		}
		svc.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_COMPLETED, nil)

		_, err := svc.CancelMediaJob(ctx, &runtimev1.CancelMediaJobRequest{JobId: jobID})
		if err == nil {
			t.Fatal("expected error canceling completed job")
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_CANCELLABLE, got %v (ok=%v)", reason, ok)
		}
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FailedPrecondition, got %v", status.Code(err))
		}
	})

	t.Run("SubmitMediaJob_SpecInvalid_MissingSpec", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/sd3",
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID {
			t.Fatalf("expected AI_MEDIA_SPEC_INVALID, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubmitMediaJob_SpecInvalid_ModalUnspecified", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/sd3",
			Modal:         runtimev1.Modal_MODAL_UNSPECIFIED,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID {
			t.Fatalf("expected AI_MEDIA_SPEC_INVALID, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubmitMediaJob_OptionUnsupported_ImageN", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/sd3",
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
				ImageSpec: &runtimev1.ImageGenerationSpec{Prompt: "test", N: 17},
			},
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubmitMediaJob_OptionUnsupported_VideoFps", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/video",
			Modal:         runtimev1.Modal_MODAL_VIDEO,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
				VideoSpec: &runtimev1.VideoGenerationSpec{Prompt: "test", Fps: 121},
			},
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubmitMediaJob_OptionUnsupported_TtsSampleRate", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/tts",
			Modal:         runtimev1.Modal_MODAL_TTS,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{Text: "hello", SampleRateHz: 500000},
			},
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubmitMediaJob_OptionUnsupported_SttSpeakerCount", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/stt",
			Modal:         runtimev1.Modal_MODAL_STT,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
				TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{AudioBytes: []byte("audio"), SpeakerCount: 33},
			},
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got %v (ok=%v)", reason, ok)
		}
	})
}
