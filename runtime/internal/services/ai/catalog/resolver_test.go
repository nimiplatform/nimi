package catalog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestResolveVoicesDashScopeModel(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	result, err := resolver.ResolveVoices("dashscope", "qwen3-tts-instruct-flash-2026-01-26")
	if err != nil {
		t.Fatalf("ResolveVoices: %v", err)
	}
	if result.Source != SourceBuiltinSnapshot {
		t.Fatalf("unexpected source: %s", result.Source)
	}
	if len(result.Voices) == 0 {
		t.Fatalf("expected non-empty voices")
	}
	foundCherry := false
	for _, voice := range result.Voices {
		if voice.VoiceID == "Cherry" {
			foundCherry = true
		}
		if voice.VoiceID == "Haruto" {
			t.Fatalf("dashscope catalog must not include Haruto")
		}
	}
	if !foundCherry {
		t.Fatalf("expected Cherry in built-in voice catalog")
	}
}

func TestResolveVoicesLocalModel(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	result, err := resolver.ResolveVoices("local", "qwen3-tts-local")
	if err != nil {
		t.Fatalf("ResolveVoices: %v", err)
	}
	if result.Source != SourceBuiltinSnapshot {
		t.Fatalf("unexpected source: %s", result.Source)
	}
	if len(result.Voices) == 0 {
		t.Fatalf("expected non-empty local voices")
	}
	if result.Voices[0].VoiceID != "user-custom" {
		t.Fatalf("unexpected local voice id: %s", result.Voices[0].VoiceID)
	}
}

func TestResolveVoicesElevenLabsModel(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	result, err := resolver.ResolveVoices("elevenlabs", "eleven_multilingual_v2")
	if err != nil {
		t.Fatalf("ResolveVoices: %v", err)
	}
	if result.Source != SourceBuiltinSnapshot {
		t.Fatalf("unexpected source: %s", result.Source)
	}
	if len(result.Voices) == 0 {
		t.Fatalf("expected non-empty elevenlabs voices")
	}
	if result.Voices[0].VoiceID != "preset-dynamic" {
		t.Fatalf("unexpected elevenlabs voice id: %s", result.Voices[0].VoiceID)
	}
}

func TestInferProviderFromModelLocalAndDashScope(t *testing.T) {
	cases := []struct {
		modelID  string
		expected string
	}{
		{modelID: "local/qwen3-tts-local", expected: "local"},
		{modelID: "qwen3-tts-local", expected: "local"},
		{modelID: "Qwen/Qwen3-TTS-8B", expected: "local"},
		{modelID: "qwen3-tts-instruct-flash", expected: "dashscope"},
		{modelID: "elevenlabs/eleven_multilingual_v2", expected: "elevenlabs"},
		{modelID: "eleven_flash_v2_5", expected: "elevenlabs"},
	}
	for _, c := range cases {
		if got := inferProviderFromModel(c.modelID); got != c.expected {
			t.Fatalf("inferProviderFromModel(%q)=%q, want=%q", c.modelID, got, c.expected)
		}
	}
}

func TestResolveVoicesMissingModelReturnsErrModelNotFound(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}
	_, err = resolver.ResolveVoices("dashscope", "qwen3-tts-non-existent")
	if err == nil {
		t.Fatalf("expected ErrModelNotFound")
	}
	if err != ErrModelNotFound {
		t.Fatalf("expected ErrModelNotFound, got: %v", err)
	}
}

func TestRefreshRemoteUsesETagAndKeepsLastKnownGood(t *testing.T) {
	cachePath := filepath.Join(t.TempDir(), "remote-catalog-cache.yaml")

	var mu sync.Mutex
	mode := "ok"
	seenIfNoneMatch := ""
	requestCount := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		requestCount += 1
		seenIfNoneMatch = strings.TrimSpace(r.Header.Get("If-None-Match"))

		switch mode {
		case "ok":
			w.Header().Set("ETag", "\"v1\"")
			_, _ = w.Write([]byte(remoteCatalogBundleYAML("RemoteCherry")))
		case "not-modified":
			if strings.TrimSpace(r.Header.Get("If-None-Match")) == "\"v1\"" {
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("ETag", "\"v1\"")
			_, _ = w.Write([]byte(remoteCatalogBundleYAML("RemoteCherry")))
		case "invalid":
			w.Header().Set("ETag", "\"v2\"")
			_, _ = w.Write([]byte("version: 1\nmodels: ["))
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer server.Close()

	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}
	resolver.remoteURL = server.URL
	resolver.cachePath = cachePath
	resolver.httpClient = server.Client()

	if err := resolver.refreshRemote(context.Background()); err != nil {
		t.Fatalf("refreshRemote first call: %v", err)
	}
	if resolver.source != SourceRemoteCache {
		t.Fatalf("expected SourceRemoteCache after first refresh, got=%s", resolver.source)
	}
	first, err := resolver.ResolveVoices("dashscope", "qwen3-tts-instruct-flash-2026-01-26")
	if err != nil {
		t.Fatalf("ResolveVoices after first refresh: %v", err)
	}
	if len(first.Voices) != 1 || first.Voices[0].VoiceID != "RemoteCherry" {
		t.Fatalf("unexpected remote voices after first refresh: %+v", first.Voices)
	}
	if _, statErr := os.Stat(cachePath); statErr != nil {
		t.Fatalf("expected remote cache file: %v", statErr)
	}

	mu.Lock()
	mode = "not-modified"
	mu.Unlock()
	if err := resolver.refreshRemote(context.Background()); err != nil {
		t.Fatalf("refreshRemote second call: %v", err)
	}
	if strings.TrimSpace(seenIfNoneMatch) != "\"v1\"" {
		t.Fatalf("expected If-None-Match to use cached etag, got=%q", seenIfNoneMatch)
	}

	mu.Lock()
	mode = "invalid"
	mu.Unlock()
	if err := resolver.refreshRemote(context.Background()); err == nil {
		t.Fatalf("expected parse error on invalid remote payload")
	}
	latest, err := resolver.ResolveVoices("dashscope", "qwen3-tts-instruct-flash-2026-01-26")
	if err != nil {
		t.Fatalf("ResolveVoices after invalid refresh: %v", err)
	}
	if len(latest.Voices) != 1 || latest.Voices[0].VoiceID != "RemoteCherry" {
		t.Fatalf("remote invalid refresh should keep last-known-good voices, got=%+v", latest.Voices)
	}

	mu.Lock()
	if requestCount < 3 {
		t.Fatalf("expected at least 3 remote requests, got=%d", requestCount)
	}
	mu.Unlock()
}

func remoteCatalogBundleYAML(voiceID string) string {
	return `version: 1
catalog_version: remote-v1
providers:
  - version: 1
    provider: dashscope
    catalog_version: remote-v1
    models:
      - provider: dashscope
        model_id: qwen3-tts-instruct-flash-2026-01-26
        model_type: tts
        updated_at: "2026-01-26"
        capabilities:
          - tts
          - llm.speech.synthesize
        pricing:
          unit: char
          input: "unknown"
          output: "unknown"
          currency: CNY
          as_of: "2026-03-05"
          notes: remote test payload
        voice_set_id: dashscope:qwen3-tts-system-v1
        source_ref:
          url: https://example.com/model-doc
          retrieved_at: "2026-03-05"
          note: remote test
    voices:
      - voice_set_id: dashscope:qwen3-tts-system-v1
        provider: dashscope
        voice_id: ` + voiceID + `
        name: ` + voiceID + `
        langs: [zh-cn]
        model_ids: [qwen3-tts-instruct-flash-2026-01-26]
        source_ref:
          url: https://example.com/model-doc
          retrieved_at: "2026-03-05"
          note: remote test
`
}
