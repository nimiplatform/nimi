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
		ModelId:       "kimi/moonshot-v1-vision",
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
