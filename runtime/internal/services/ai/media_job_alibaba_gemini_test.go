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
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

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
		ModelId:       "dashscope/image-1",
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
		ModelId:       "dashscope/video-1",
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
		ModelId:       "dashscope/tts-1",
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
		ModelId:       "dashscope/stt-1",
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
		ModelId:       "dashscope/image-custom-1",
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
		ModelId:       "dashscope/video-failed-1",
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
