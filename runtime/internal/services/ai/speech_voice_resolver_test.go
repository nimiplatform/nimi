package ai

import (
	"io"
	"log/slog"
	"testing"
)

func TestResolveSpeechVoicesVolcengineCatalogForBareModel(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	voices, source, _, err := resolveSpeechVoicesForModelWithProviderType(
		"volc.service_type.10029",
		"volcengine_openspeech",
		svc.speechCatalog,
	)
	if err != nil {
		t.Fatalf("resolveSpeechVoicesForModelWithProviderType: %v", err)
	}
	if source != speechVoiceSourceCatalogBuiltin {
		t.Fatalf("expected catalog source, got=%s", source)
	}
	if len(voices) != 2 {
		t.Fatalf("expected 2 Volcengine OpenSpeech catalog voices, got=%d", len(voices))
	}
}

func TestResolveSpeechVoicesDashScopeCatalogExcludesHaruto(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	voices, source, _, err := resolveSpeechVoicesForModelWithProviderType(
		"qwen3-tts-instruct-flash-2026-01-26",
		"dashscope",
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
