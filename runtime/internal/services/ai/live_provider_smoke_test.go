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
				VideoSpec: testVideoT2VSpec("Nimi live smoke short video: ocean waves with stable camera", 4),
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
				VideoSpec: testVideoT2VSpec("Nimi NimiLLM live smoke short video: city lights with gentle pan", 4),
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
				VideoSpec: testVideoT2VSpec("Nimi Bytedance live smoke short video: calm forest with cinematic motion", 4),
			},
		})
		assertLiveMediaJobCompleted(t, job)
	})

	t.Run("video-i2v-first-frame", func(t *testing.T) {
		modelID := requiredLiveEnv(t, "NIMI_LIVE_BYTEDANCE_VIDEO_MODEL_ID")
		firstFrameURI := requiredLiveEnv(t, "NIMI_LIVE_BYTEDANCE_I2V_FIRST_FRAME_URI")
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
					Prompt: "Nimi Bytedance live smoke i2v first-frame scene",
					Mode:   runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME,
					Content: []*runtimev1.VideoContentItem{
						{
							Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
							Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
							Text: "Nimi Bytedance live smoke i2v first-frame scene",
						},
						{
							Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
							Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME,
							ImageUrl: &runtimev1.VideoContentImageURL{
								Url: firstFrameURI,
							},
						},
					},
					Options: &runtimev1.VideoGenerationOptions{
						DurationSec: 4,
					},
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
				VideoSpec: testVideoT2VSpec("Nimi Alibaba live smoke short video: river scene with subtle camera movement", 4),
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
				VideoSpec: testVideoT2VSpec("Nimi Gemini live smoke short video: morning city timelapse", 4),
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
				VideoSpec: testVideoT2VSpec("Nimi MiniMax live smoke short video: snow mountain drone shot", 4),
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
				VideoSpec: testVideoT2VSpec("Nimi GLM live smoke short video: desert sunrise with smooth movement", 4),
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

func TestLiveSmokeOpenAIGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_OPENAI_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_OPENAI_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_OPENAI_BASE_URL", "https://api.openai.com/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"openai": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi OpenAI live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live openai generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live openai generate returned empty text output")
	}
}

func TestLiveSmokeAnthropicGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_ANTHROPIC_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_ANTHROPIC_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_ANTHROPIC_BASE_URL", "https://api.anthropic.com")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"anthropic": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi Anthropic live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live anthropic generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live anthropic generate returned empty text output")
	}
}

func TestLiveSmokeDeepSeekGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_DEEPSEEK_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_DEEPSEEK_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"deepseek": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi DeepSeek live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live deepseek generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live deepseek generate returned empty text output")
	}
}

func TestLiveSmokeOpenRouterGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_OPENROUTER_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_OPENROUTER_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"openrouter": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi OpenRouter live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live openrouter generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live openrouter generate returned empty text output")
	}
}

func TestLiveSmokeGeminiGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_GEMINI_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_GEMINI_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"gemini": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi Gemini live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live gemini generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live gemini generate returned empty text output")
	}
}

func TestLiveSmokeVolcengineGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_VOLCENGINE_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_VOLCENGINE_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_VOLCENGINE_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"volcengine": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi Volcengine live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live volcengine generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live volcengine generate returned empty text output")
	}
}

func TestLiveSmokeMiniMaxGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_MINIMAX_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_MINIMAX_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_MINIMAX_BASE_URL", "https://api.minimax.chat/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"minimax": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi MiniMax live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live minimax generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live minimax generate returned empty text output")
	}
}

func TestLiveSmokeKimiGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_KIMI_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_KIMI_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_KIMI_BASE_URL", "https://api.moonshot.cn/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"kimi": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi Kimi live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live kimi generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live kimi generate returned empty text output")
	}
}

func TestLiveSmokeOpenAIEmbed(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_OPENAI_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_OPENAI_EMBED_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_OPENAI_BASE_URL", "https://api.openai.com/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"openai": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Embed(context.Background(), &runtimev1.EmbedRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     30_000,
		Inputs:        []string{"Nimi live smoke embedding test"},
	})
	if err != nil {
		t.Fatalf("live openai embed failed: %v", err)
	}
	if len(resp.GetVectors()) == 0 {
		t.Fatalf("live openai embed returned no vectors")
	}
}

func TestLiveSmokeDashScopeEmbed(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_ALIBABA_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_ALIBABA_EMBED_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_ALIBABA_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Embed(context.Background(), &runtimev1.EmbedRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     30_000,
		Inputs:        []string{"Nimi live smoke embedding test"},
	})
	if err != nil {
		t.Fatalf("live dashscope embed failed: %v", err)
	}
	if len(resp.GetVectors()) == 0 {
		t.Fatalf("live dashscope embed returned no vectors")
	}
}

func TestLiveSmokeGeminiEmbed(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_GEMINI_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_GEMINI_EMBED_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"gemini": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Embed(context.Background(), &runtimev1.EmbedRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     30_000,
		Inputs:        []string{"Nimi live smoke embedding test"},
	})
	if err != nil {
		t.Fatalf("live gemini embed failed: %v", err)
	}
	if len(resp.GetVectors()) == 0 {
		t.Fatalf("live gemini embed returned no vectors")
	}
}

func TestLiveSmokeVolcengineEmbed(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_VOLCENGINE_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_VOLCENGINE_EMBED_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_VOLCENGINE_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"volcengine": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Embed(context.Background(), &runtimev1.EmbedRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     30_000,
		Inputs:        []string{"Nimi live smoke embedding test"},
	})
	if err != nil {
		t.Fatalf("live volcengine embed failed: %v", err)
	}
	if len(resp.GetVectors()) == 0 {
		t.Fatalf("live volcengine embed returned no vectors")
	}
}

func TestLiveSmokeAzureGenerateText(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_AZURE_BASE_URL")
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_AZURE_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_AZURE_MODEL_ID")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"azure": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi Azure live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live azure generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live azure generate returned empty text output")
	}
}

func TestLiveSmokeAzureEmbed(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_AZURE_BASE_URL")
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_AZURE_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_AZURE_EMBED_MODEL_ID")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"azure": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Embed(context.Background(), &runtimev1.EmbedRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     30_000,
		Inputs:        []string{"Nimi live smoke embedding test"},
	})
	if err != nil {
		t.Fatalf("live azure embed failed: %v", err)
	}
	if len(resp.GetVectors()) == 0 {
		t.Fatalf("live azure embed returned no vectors")
	}
}

func TestLiveSmokeMistralGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_MISTRAL_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_MISTRAL_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_MISTRAL_BASE_URL", "https://api.mistral.ai/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"mistral": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi Mistral live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live mistral generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live mistral generate returned empty text output")
	}
}

func TestLiveSmokeMistralEmbed(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_MISTRAL_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_MISTRAL_EMBED_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_MISTRAL_BASE_URL", "https://api.mistral.ai/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"mistral": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Embed(context.Background(), &runtimev1.EmbedRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     30_000,
		Inputs:        []string{"Nimi live smoke embedding test"},
	})
	if err != nil {
		t.Fatalf("live mistral embed failed: %v", err)
	}
	if len(resp.GetVectors()) == 0 {
		t.Fatalf("live mistral embed returned no vectors")
	}
}

func TestLiveSmokeGroqGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_GROQ_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_GROQ_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_GROQ_BASE_URL", "https://api.groq.com/openai/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"groq": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi Groq live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live groq generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live groq generate returned empty text output")
	}
}

func TestLiveSmokeXAIGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_XAI_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_XAI_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_XAI_BASE_URL", "https://api.x.ai/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"xai": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi xAI live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live xai generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live xai generate returned empty text output")
	}
}

func TestLiveSmokeQianfanGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_QIANFAN_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_QIANFAN_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_QIANFAN_BASE_URL", "https://qianfan.baidubce.com/v2")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"qianfan": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi Qianfan live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live qianfan generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live qianfan generate returned empty text output")
	}
}

func TestLiveSmokeQianfanEmbed(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_QIANFAN_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_QIANFAN_EMBED_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_QIANFAN_BASE_URL", "https://qianfan.baidubce.com/v2")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"qianfan": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Embed(context.Background(), &runtimev1.EmbedRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     30_000,
		Inputs:        []string{"Nimi live smoke embedding test"},
	})
	if err != nil {
		t.Fatalf("live qianfan embed failed: %v", err)
	}
	if len(resp.GetVectors()) == 0 {
		t.Fatalf("live qianfan embed returned no vectors")
	}
}

func TestLiveSmokeHunyuanGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_HUNYUAN_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_HUNYUAN_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_HUNYUAN_BASE_URL", "https://api.hunyuan.cloud.tencent.com/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"hunyuan": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi Hunyuan live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live hunyuan generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live hunyuan generate returned empty text output")
	}
}

func TestLiveSmokeHunyuanEmbed(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_HUNYUAN_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_HUNYUAN_EMBED_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_HUNYUAN_BASE_URL", "https://api.hunyuan.cloud.tencent.com/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"hunyuan": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Embed(context.Background(), &runtimev1.EmbedRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     30_000,
		Inputs:        []string{"Nimi live smoke embedding test"},
	})
	if err != nil {
		t.Fatalf("live hunyuan embed failed: %v", err)
	}
	if len(resp.GetVectors()) == 0 {
		t.Fatalf("live hunyuan embed returned no vectors")
	}
}

func TestLiveSmokeSparkGenerateText(t *testing.T) {
	apiKey := requiredLiveEnv(t, "NIMI_LIVE_SPARK_API_KEY")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_SPARK_MODEL_ID")
	baseURL := liveEnvOrDefault(t, "NIMI_LIVE_SPARK_BASE_URL", "https://spark-api-open.xf-yun.com/v1")

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"spark": {BaseURL: baseURL, APIKey: apiKey},
		},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi Spark live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live spark generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live spark generate returned empty text output")
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

func liveEnvOrDefault(t *testing.T, key, defaultValue string) string {
	t.Helper()
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return defaultValue
}
