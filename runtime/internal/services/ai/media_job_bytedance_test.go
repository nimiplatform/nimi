package ai

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/net/websocket"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

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
		ModelId:       "volcengine/voice-1",
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
		ModelId:       "volcengine/stt-1",
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
		ModelId:       "volcengine/stt-ws-1",
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
		ModelId:       "volcengine/stt-ws-failed",
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
		ModelId:       "volcengine/stt-ws-slow",
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
		ModelId:       "volcengine/video-1",
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
		ModelId:       "volcengine/image-1",
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
		ModelId:       "volcengine/video-custom-1",
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
		ModelId:       "volcengine/video-failed-1",
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
