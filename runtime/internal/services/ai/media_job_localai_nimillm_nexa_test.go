package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

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

func TestSubmitMediaJobLocalAIImageMinimalWorkflowMapping(t *testing.T) {
	imagePayload := []byte("localai-image-bytes")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	referenceImages := []string{
		"https://example.com/source.png",
		"https://example.com/ref-2.png",
		"https://example.com/ref-3.png",
	}
	var capturedSubmitPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations" {
			_ = json.NewDecoder(r.Body).Decode(&capturedSubmitPayload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"b64_json": imageB64, "mime_type": "image/png"},
				},
			})
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
		ModelId:       "local/sdxl-image-1",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt:          "sunrise over city",
				NegativePrompt:  "rain",
				ReferenceImages: referenceImages,
				ProviderOptions: structToMapPB(t, map[string]any{
					"steps":          30,
					"method":         "i2i",
					"guidance_scale": 7,
					"eta":            1,
					"strength":       0.5,
				}),
			},
		},
	})
	if err != nil {
		t.Fatalf("submit localai image job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(imagePayload) {
		t.Fatalf("image payload mismatch: got=%q want=%q", got, string(imagePayload))
	}

	if capturedSubmitPayload["prompt"] != "sunrise over city|rain" {
		t.Fatalf("localai prompt mismatch: %#v", capturedSubmitPayload["prompt"])
	}
	if capturedSubmitPayload["negative_prompt"] != "rain" {
		t.Fatalf("negative prompt mismatch: %#v", capturedSubmitPayload["negative_prompt"])
	}
	if capturedSubmitPayload["file"] != referenceImages[0] {
		t.Fatalf("file mapping mismatch: %#v", capturedSubmitPayload["file"])
	}
	if files := stringSliceFromAny(capturedSubmitPayload["files"]); len(files) != 3 || files[0] != referenceImages[0] || files[1] != referenceImages[1] || files[2] != referenceImages[2] {
		t.Fatalf("files mapping mismatch: %#v", capturedSubmitPayload["files"])
	}
	if refs := stringSliceFromAny(capturedSubmitPayload["ref_images"]); len(refs) != 2 || refs[0] != referenceImages[1] || refs[1] != referenceImages[2] {
		t.Fatalf("ref_images mapping mismatch: %#v", capturedSubmitPayload["ref_images"])
	}
	if _, exists := capturedSubmitPayload["reference_images"]; exists {
		t.Fatalf("localai request must not send canonical reference_images: %#v", capturedSubmitPayload)
	}
	if numberAsInt(capturedSubmitPayload["step"]) != 30 {
		t.Fatalf("step mapping mismatch: %#v", capturedSubmitPayload["step"])
	}
	if capturedSubmitPayload["mode"] != "i2i" {
		t.Fatalf("mode mapping mismatch: %#v", capturedSubmitPayload["mode"])
	}

	raw := job.GetArtifacts()[0].GetProviderRaw().AsMap()
	if raw["adapter"] != adapterLocalAINative {
		t.Fatalf("provider_raw adapter mismatch: got=%#v want=%s", raw["adapter"], adapterLocalAINative)
	}
	if raw["localai_prompt"] != "sunrise over city|rain" {
		t.Fatalf("provider_raw localai_prompt mismatch: %#v", raw["localai_prompt"])
	}
	if raw["source_image"] != referenceImages[0] {
		t.Fatalf("provider_raw source_image mismatch: %#v", raw["source_image"])
	}
	if numberAsInt(raw["ref_images_count"]) != 2 {
		t.Fatalf("provider_raw ref_images_count mismatch: %#v", raw["ref_images_count"])
	}
	compat, ok := raw["compat"].(map[string]any)
	if !ok {
		t.Fatalf("provider_raw compat missing: %#v", raw["compat"])
	}
	applied := stringSliceFromAny(compat["applied_options"])
	if !containsString(applied, "steps->step") || !containsString(applied, "method->mode") {
		t.Fatalf("provider_raw applied options mismatch: %#v", compat["applied_options"])
	}
	ignored := stringSliceFromAny(compat["ignored_options"])
	if !containsString(ignored, "guidance_scale") || !containsString(ignored, "eta") || !containsString(ignored, "strength") {
		t.Fatalf("provider_raw ignored options mismatch: %#v", compat["ignored_options"])
	}
}

func TestSubmitMediaJobLocalPrefixUsesNexaAdapterWhenOnlyNexaBackend(t *testing.T) {
	imagePayload := []byte("nexa-local-prefix-image")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"b64_json": imageB64, "mime_type": "image/png"},
				},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"nexa": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/image-1",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "nexa local prefix",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit nexa local-prefix image job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if got := string(job.GetArtifacts()[0].GetBytes()); got != string(imagePayload) {
		t.Fatalf("image payload mismatch: got=%q want=%q", got, string(imagePayload))
	}
	raw := job.GetArtifacts()[0].GetProviderRaw().AsMap()
	if raw["adapter"] != adapterNexaNative {
		t.Fatalf("adapter mismatch for local/ + nexa backend: got=%#v want=%s", raw["adapter"], adapterNexaNative)
	}
}

func stringSliceFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			str, ok := item.(string)
			if !ok {
				continue
			}
			out = append(out, str)
		}
		return out
	default:
		return nil
	}
}

func numberAsInt(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
