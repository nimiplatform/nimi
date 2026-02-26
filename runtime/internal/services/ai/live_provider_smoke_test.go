package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLiveSmokeLocalGenerateText(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_BASE_URL")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_LOCAL_MODEL_ID")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_LOCAL_API_KEY"))

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL:   baseURL,
		LocalAIAPIKey:    apiKey,
		LocalNexaBaseURL: baseURL,
		LocalNexaAPIKey:  apiKey,
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

func TestLiveSmokeLiteLLMGenerateText(t *testing.T) {
	baseURL := requiredLiveEnv(t, "NIMI_LIVE_LITELLM_BASE_URL")
	modelID := requiredLiveEnv(t, "NIMI_LIVE_LITELLM_MODEL_ID")
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_LITELLM_API_KEY"))

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudLiteLLMBaseURL: baseURL,
		CloudLiteLLMAPIKey:  apiKey,
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.live-smoke",
		SubjectUserId: "smoke-user",
		ModelId:       modelID,
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Say hello from Nimi LiteLLM live smoke test."},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   45_000,
	})
	if err != nil {
		t.Fatalf("live litellm generate failed: %v", err)
	}

	text := strings.TrimSpace(resp.GetOutput().GetFields()["text"].GetStringValue())
	if text == "" {
		t.Fatalf("live litellm generate returned empty text output")
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
