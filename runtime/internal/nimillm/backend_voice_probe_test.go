package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestListSpeechVoicesFiltersByModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/voices" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"voices": []map[string]any{
				{
					"id":              "Cherry",
					"name":            "Cherry",
					"lang":            "zh",
					"supported_langs": []string{"zh", "en"},
					"models":          []string{"qwen3-tts-instruct-flash-2026-01-26"},
				},
				{
					"id":     "alloy",
					"name":   "Alloy",
					"models": []string{"gpt-4o-mini-tts"},
				},
			},
		})
	}))
	defer server.Close()

	backend := NewBackend("cloud-openai_compatible", server.URL, "", 3*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	voices, err := backend.ListSpeechVoices(context.Background(), "cloud/qwen3-tts-instruct-flash-2026-01-26")
	if err != nil {
		t.Fatalf("ListSpeechVoices failed: %v", err)
	}
	if len(voices) != 1 {
		t.Fatalf("expected 1 voice, got %d", len(voices))
	}
	if voices[0].GetVoiceId() != "Cherry" {
		t.Fatalf("expected Cherry, got %q", voices[0].GetVoiceId())
	}
}

func TestListSpeechVoicesFallsBackToSecondaryPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/audio/voices":
			http.NotFound(w, r)
		case "/v1/voices":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{
						"voice_id": "alloy",
						"name":     "Alloy",
						"language": "en",
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	backend := NewBackend("cloud-openai_compatible", server.URL, "", 3*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	voices, err := backend.ListSpeechVoices(context.Background(), "")
	if err != nil {
		t.Fatalf("ListSpeechVoices failed: %v", err)
	}
	if len(voices) != 1 {
		t.Fatalf("expected 1 voice, got %d", len(voices))
	}
	if voices[0].GetVoiceId() != "alloy" {
		t.Fatalf("expected alloy, got %q", voices[0].GetVoiceId())
	}
}
