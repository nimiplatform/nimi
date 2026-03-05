package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestResolveSpeechVoicesUsesProviderLiveWhenAvailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/v1/audio/voices" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"voices": []map[string]any{
					{
						"id":              "LiveCherry",
						"name":            "LiveCherry",
						"lang":            "zh",
						"supported_langs": []string{"zh", "en"},
						"models":          []string{"tts-1"},
					},
				},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	backend := nimillm.NewBackend("cloud-openai", server.URL, "test-key", 0)
	voices, source, _, err := resolveSpeechVoicesForModelWithProviderType(
		context.Background(),
		"openai/tts-1",
		"openai",
		backend,
		svc.speechCatalog,
	)
	if err != nil {
		t.Fatalf("resolveSpeechVoicesForModelWithProviderType: %v", err)
	}
	if source != speechVoiceSourceProviderLive {
		t.Fatalf("expected live source, got=%s", source)
	}
	if len(voices) != 1 || voices[0].GetVoiceId() != "LiveCherry" {
		t.Fatalf("unexpected live voices response")
	}
}

func TestResolveSpeechVoicesVolcengineCatalogForBareModel(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	voices, source, _, err := resolveSpeechVoicesForModelWithProviderType(
		context.Background(),
		"doubao-tts",
		"volcengine",
		nil,
		svc.speechCatalog,
	)
	if err != nil {
		t.Fatalf("resolveSpeechVoicesForModelWithProviderType: %v", err)
	}
	if source != speechVoiceSourceCatalogBuiltin {
		t.Fatalf("expected catalog source, got=%s", source)
	}
	if len(voices) != 2 {
		t.Fatalf("expected 2 Volcengine catalog voices, got=%d", len(voices))
	}
}

func TestResolveSpeechVoicesDashScopeCatalogExcludesHaruto(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	voices, source, _, err := resolveSpeechVoicesForModelWithProviderType(
		context.Background(),
		"qwen3-tts-instruct-flash-2026-01-26",
		"dashscope",
		nil,
		svc.speechCatalog,
	)
	if err != nil {
		t.Fatalf("resolveSpeechVoicesForModelWithProviderType: %v", err)
	}
	if source != speechVoiceSourceCatalogBuiltin {
		t.Fatalf("expected dashscope catalog source, got=%s", source)
	}
	if len(voices) == 0 {
		t.Fatalf("expected non-empty dashscope catalog voices")
	}
	for _, voice := range voices {
		if voice.GetVoiceId() == "Haruto" {
			t.Fatalf("dashscope catalog must not include Haruto")
		}
	}
}
