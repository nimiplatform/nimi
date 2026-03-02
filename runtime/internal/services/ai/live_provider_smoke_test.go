package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/metadata"
)

func TestLiveSmokeLocalGenerateText(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_BASE_URL")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_MODEL_ID")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_API_KEY"))

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"localai": {BaseURL: baseURL, APIKey: apiKey},
			"nexa":    {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live local generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live local generate returned empty text output")
	}
}

func TestLiveSmokeNimiLLMGenerateText(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_NIMILLM_BASE_URL")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_NIMILLM_MODEL_ID")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_NIMILLM_API_KEY"))

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"nimillm": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi NimiLLM live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live nimillm generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live nimillm generate returned empty text output")
	}
}

func TestLiveSmokeLocalSubmitMediaJobModalities(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_BASE_URL")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_API_KEY"))
	audioURI := requiredLiveEnv(t, "NIMI_LIVE_STT_AUDIO_URI")
	audioMIME := strings.TrimSpace(os.Getenv("NIMI_LIVE_STT_MIME_TYPE"))
	if audioMIME == "" {
		audioMIME = "audio/wav"
	}

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"localai": {BaseURL: baseURL, APIKey: apiKey},
			"nexa":    {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	t.Run("image", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_IMAGE_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
				ImageSpec: &runtimev1.ImageGenerationSpec{
					Prompt:         "Nimi live smoke image: minimal mountain at dawn",
					ResponseFormat: "png",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("video", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_VIDEO_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_VIDEO,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     300_000,
			Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
				VideoSpec: &runtimev1.VideoGenerationSpec{
					Prompt:      "Nimi live smoke short video: ocean waves with stable camera",
					DurationSec: 4,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("tts", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_TTS_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_TTS,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{
					Text:        "This is Nimi local live smoke TTS.",
					AudioFormat: "mp3",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("stt", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_STT_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_STT,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
				TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: audioURI},
					},
					MimeType: audioMIME,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})
}

func TestLiveSmokeNimiLLMSubmitMediaJobModalities(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_NIMILLM_BASE_URL")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_NIMILLM_API_KEY"))
	audioURI := requiredLiveEnv(t, "NIMI_LIVE_STT_AUDIO_URI")
	audioMIME := strings.TrimSpace(os.Getenv("NIMI_LIVE_STT_MIME_TYPE"))
	if audioMIME == "" {
		audioMIME = "audio/wav"
	}

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"nimillm": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	t.Run("image", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_NIMILLM_IMAGE_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
				ImageSpec: &runtimev1.ImageGenerationSpec{
					Prompt:         "Nimi NimiLLM live smoke image: skyline at sunset",
					ResponseFormat: "png",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("video", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_NIMILLM_VIDEO_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_VIDEO,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     300_000,
			Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
				VideoSpec: &runtimev1.VideoGenerationSpec{
					Prompt:      "Nimi NimiLLM live smoke short video: city lights with gentle pan",
					DurationSec: 4,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("tts", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_NIMILLM_TTS_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_TTS,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{
					Text:        "This is Nimi NimiLLM live smoke TTS.",
					AudioFormat: "mp3",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("stt", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_NIMILLM_STT_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_STT,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
				TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: audioURI},
					},
					MimeType: audioMIME,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})
}

func TestLiveSmokeBytedanceSubmitMediaJobModalities(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_BYTEDANCE_BASE_URL")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_BYTEDANCE_API_KEY"))
	speechBaseURL := strings.TrimSpace(os.Getenv("NIMI_LIVE_BYTEDANCE_SPEECH_BASE_URL"))
	if speechBaseURL == "" {
		speechBaseURL = baseURL
	}
	speechAPIKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_BYTEDANCE_SPEECH_API_KEY"))
	if speechAPIKey == "" {
		speechAPIKey = apiKey
	}
	audioURI := requiredLiveEnv(t, "NIMI_LIVE_STT_AUDIO_URI")
	audioMIME := strings.TrimSpace(os.Getenv("NIMI_LIVE_STT_MIME_TYPE"))
	if audioMIME == "" {
		audioMIME = "audio/wav"
	}

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"volcengine":           {BaseURL: baseURL, APIKey: apiKey},
			"volcengine_openspeech": {BaseURL: speechBaseURL, APIKey: speechAPIKey},
		},
	})

	t.Run("image", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_BYTEDANCE_IMAGE_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
				ImageSpec: &runtimev1.ImageGenerationSpec{
					Prompt:         "Nimi Bytedance live smoke image: bright sunrise over a lake",
					ResponseFormat: "png",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("video", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_BYTEDANCE_VIDEO_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_VIDEO,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     300_000,
			Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
				VideoSpec: &runtimev1.VideoGenerationSpec{
					Prompt:      "Nimi Bytedance live smoke short video: calm forest with cinematic motion",
					DurationSec: 4,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("tts", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_BYTEDANCE_TTS_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_TTS,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{
					Text:        "This is Nimi Bytedance live smoke TTS.",
					AudioFormat: "mp3",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("stt", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_BYTEDANCE_STT_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_STT,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
				TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: audioURI},
					},
					MimeType: audioMIME,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})
}

func TestLiveSmokeAlibabaSubmitMediaJobModalities(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_ALIBABA_BASE_URL")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_ALIBABA_API_KEY"))
	audioURI := requiredLiveEnv(t, "NIMI_LIVE_STT_AUDIO_URI")
	audioMIME := strings.TrimSpace(os.Getenv("NIMI_LIVE_STT_MIME_TYPE"))
	if audioMIME == "" {
		audioMIME = "audio/wav"
	}

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	t.Run("image", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_ALIBABA_IMAGE_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
				ImageSpec: &runtimev1.ImageGenerationSpec{
					Prompt:         "Nimi Alibaba live smoke image: clean city skyline at sunset",
					ResponseFormat: "png",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("video", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_ALIBABA_VIDEO_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_VIDEO,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     300_000,
			Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
				VideoSpec: &runtimev1.VideoGenerationSpec{
					Prompt:      "Nimi Alibaba live smoke short video: river scene with subtle camera movement",
					DurationSec: 4,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("tts", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_ALIBABA_TTS_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_TTS,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{
					Text:        "This is Nimi Alibaba live smoke TTS.",
					AudioFormat: "mp3",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("stt", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_ALIBABA_STT_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_STT,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
				TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: audioURI},
					},
					MimeType: audioMIME,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})
}

func TestLiveSmokeGeminiSubmitMediaJobModalities(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_GEMINI_BASE_URL")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_GEMINI_API_KEY"))
	audioURI := requiredLiveEnv(t, "NIMI_LIVE_STT_AUDIO_URI")
	audioMIME := strings.TrimSpace(os.Getenv("NIMI_LIVE_STT_MIME_TYPE"))
	if audioMIME == "" {
		audioMIME = "audio/wav"
	}

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"gemini": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	t.Run("image", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_GEMINI_IMAGE_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
				ImageSpec: &runtimev1.ImageGenerationSpec{
					Prompt:         "Nimi Gemini live smoke image: floating island with waterfalls",
					ResponseFormat: "png",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("video", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_GEMINI_VIDEO_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_VIDEO,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     300_000,
			Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
				VideoSpec: &runtimev1.VideoGenerationSpec{
					Prompt:      "Nimi Gemini live smoke short video: morning city timelapse",
					DurationSec: 4,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("tts", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_GEMINI_TTS_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_TTS,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{
					Text:        "This is Nimi Gemini live smoke TTS.",
					AudioFormat: "mp3",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("stt", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_GEMINI_STT_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_STT,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
				TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: audioURI},
					},
					MimeType: audioMIME,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})
}

func TestLiveSmokeMiniMaxSubmitMediaJobModalities(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_MINIMAX_BASE_URL")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_MINIMAX_API_KEY"))
	audioURI := requiredLiveEnv(t, "NIMI_LIVE_STT_AUDIO_URI")
	audioMIME := strings.TrimSpace(os.Getenv("NIMI_LIVE_STT_MIME_TYPE"))
	if audioMIME == "" {
		audioMIME = "audio/wav"
	}

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"minimax": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	t.Run("image", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_MINIMAX_IMAGE_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
				ImageSpec: &runtimev1.ImageGenerationSpec{
					Prompt:         "Nimi MiniMax live smoke image: cyberpunk street at night",
					ResponseFormat: "png",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("video", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_MINIMAX_VIDEO_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_VIDEO,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     300_000,
			Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
				VideoSpec: &runtimev1.VideoGenerationSpec{
					Prompt:      "Nimi MiniMax live smoke short video: snow mountain drone shot",
					DurationSec: 4,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("tts", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_MINIMAX_TTS_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_TTS,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{
					Text:        "This is Nimi MiniMax live smoke TTS.",
					AudioFormat: "mp3",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("stt", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_MINIMAX_STT_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_STT,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
				TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: audioURI},
					},
					MimeType: audioMIME,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})
}

func TestLiveSmokeKimiSubmitMediaJobModalities(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_KIMI_BASE_URL")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_KIMI_API_KEY"))
	audioURI := requiredLiveEnv(t, "NIMI_LIVE_STT_AUDIO_URI")
	audioMIME := strings.TrimSpace(os.Getenv("NIMI_LIVE_STT_MIME_TYPE"))
	if audioMIME == "" {
		audioMIME = "audio/wav"
	}

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"kimi": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	t.Run("image", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_KIMI_IMAGE_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
				ImageSpec: &runtimev1.ImageGenerationSpec{
					Prompt:         "Nimi Kimi live smoke image: minimalist illustration of a flying whale",
					ResponseFormat: "png",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("tts", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_KIMI_TTS_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_TTS,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{
					Text:        "This is Nimi Kimi live smoke TTS.",
					AudioFormat: "mp3",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("stt", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_KIMI_STT_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_STT,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
				TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: audioURI},
					},
					MimeType: audioMIME,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})
}

func TestLiveSmokeGLMSubmitMediaJobModalities(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_GLM_BASE_URL")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_GLM_API_KEY"))
	audioURI := requiredLiveEnv(t, "NIMI_LIVE_STT_AUDIO_URI")
	audioMIME := strings.TrimSpace(os.Getenv("NIMI_LIVE_STT_MIME_TYPE"))
	if audioMIME == "" {
		audioMIME = "audio/wav"
	}

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"glm": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	t.Run("image", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_GLM_IMAGE_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
				ImageSpec: &runtimev1.ImageGenerationSpec{
					Prompt:         "Nimi GLM live smoke image: astronaut walking in bamboo forest",
					ResponseFormat: "png",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("video", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_GLM_VIDEO_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_VIDEO,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     300_000,
			Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
				VideoSpec: &runtimev1.VideoGenerationSpec{
					Prompt:      "Nimi GLM live smoke short video: desert sunrise with smooth movement",
					DurationSec: 4,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("tts", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_GLM_TTS_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_TTS,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{
					Text:        "This is Nimi GLM live smoke TTS.",
					AudioFormat: "mp3",
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("stt", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_GLM_STT_MODEL_ID")
		job := runLiveSmokeMediaJob(t, svc, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.live-smoke",
			SubjectUserId: "smoke-user",
			ModelId:       modelID,
			Modal:         runtimev1.Modal_MODAL_STT,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
			Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
				TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: audioURI},
					},
					MimeType: audioMIME,
				},
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})
}

func TestLiveSmokeDashScopeGenerateText(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_ALIBABA_BASE_URL")
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_ALIBABA_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_ALIBABA_CHAT_MODEL_ID")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi DashScope live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live dashscope generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live dashscope generate returned empty text output")
	}
}

func TestLiveSmokeConnectorDashScopeTTS(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_DASHSCOPE_CONNECTOR_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_DASHSCOPE_CONNECTOR_TTS_MODEL_ID")

	// Set up a temporary connector store with a dashscope connector.
	store := connector.NewConnectorStore(t.TempDir())
	connectorID := "smoke-dashscope-tts"
	rec := connector.ConnectorRecord{
		ConnectorID: connectorID,
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "smoke-user",
		Provider:    "dashscope",
		Endpoint:    "https://dashscope.aliyuncs.com/compatible-mode/v1",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}
	if err := store.Create(rec, apiKey); err != nil {
		t.Fatalf("create connector: %v", err)
	}

	svc := newFromProviderConfig(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil, nil, nil, store,
		Config{}.normalized(),
		8, 2,
	)
	svc.allowLoopback = true

	// Inject managed key-source via gRPC metadata.
	md := metadata.Pairs("x-nimi-key-source", "managed")
	ctx := metadata.NewIncomingContext(context.Background(), md)

	response, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		ConnectorId:   connectorID,
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     120_000,
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text:        "This is Nimi connector DashScope live smoke TTS test.",
				AudioFormat: "mp3",
			},
		},
	})
	if err != nil {
		t.Fatalf("live connector dashscope TTS submit failed: %v", err)
	}

	job := waitMediaJobTerminal(t, svc, response.GetJob().GetJobId(), 3*time.Minute)
	assertLiveMediaJobCompleted(t, job)
}

func runLiveSmokeMediaJob(
	t *testing.T,
	svc *Service,
	request *runtimev1.SubmitMediaJobRequest,
) *runtimev1.MediaJob {
	t.Helper()
	response, err := svc.SubmitMediaJob(context.Background(), request)
	if err != nil {
		t.Fatalf("live submit media job failed: modal=%s err=%v", request.GetModal().String(), err)
	}
	waitTimeout := 3 * time.Minute
	if request.GetModal() == runtimev1.Modal_MODAL_VIDEO {
		waitTimeout = 6 * time.Minute
	}
	return waitMediaJobTerminal(t, svc, response.GetJob().GetJobId(), waitTimeout)
}

func assertLiveMediaJobCompleted(t *testing.T, job *runtimev1.MediaJob) {
	t.Helper()
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("live media job status mismatch: status=%v reason=%v detail=%s", job.GetStatus(), job.GetReasonCode(), strings.TrimSpace(job.GetReasonDetail()))
	}
	if len(job.GetArtifacts()) == 0 {
		t.Fatalf("live media job must return at least one artifact")
	}
}

func requiredLiveEnv(t *testing.T, key string) string {
	t.Helper()
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		t.Skipf("set %s to run live smoke test", key)
	}
	return value
}
