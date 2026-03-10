package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeleteProviderVoice_ElevenLabs(t *testing.T) {
	var (
		gotMethod string
		gotPath   string
		gotAPIKey string
	)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotMethod = request.Method
		gotPath = request.URL.Path
		gotAPIKey = request.Header.Get("xi-api-key")
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	err := DeleteProviderVoice(context.Background(), "elevenlabs", "voice_123", MediaAdapterConfig{
		BaseURL: server.URL,
		APIKey:  "test-key",
	}, nil)
	if err != nil {
		t.Fatalf("DeleteProviderVoice: %v", err)
	}
	if gotMethod != http.MethodDelete {
		t.Fatalf("unexpected method: %q", gotMethod)
	}
	if gotPath != "/v1/voices/voice_123" {
		t.Fatalf("unexpected path: %q", gotPath)
	}
	if gotAPIKey != "test-key" {
		t.Fatalf("unexpected xi-api-key: %q", gotAPIKey)
	}
}

func TestDeleteProviderVoice_ElevenLabsNotFoundIsIgnored(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusNotFound)
		_, _ = writer.Write([]byte(`{"detail":{"message":"voice not found"}}`))
	}))
	defer server.Close()

	err := DeleteProviderVoice(context.Background(), "elevenlabs", "voice_missing", MediaAdapterConfig{
		BaseURL: server.URL,
		APIKey:  "test-key",
	}, nil)
	if err != nil {
		t.Fatalf("DeleteProviderVoice notfound should be ignored: %v", err)
	}
}
