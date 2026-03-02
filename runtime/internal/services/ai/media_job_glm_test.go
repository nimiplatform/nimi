package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

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
