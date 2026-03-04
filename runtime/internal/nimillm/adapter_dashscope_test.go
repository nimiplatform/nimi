package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestNativeOriginURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "strip compatible-mode path",
			input: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			want:  "https://dashscope.aliyuncs.com",
		},
		{
			name:  "already origin only",
			input: "https://dashscope.aliyuncs.com",
			want:  "https://dashscope.aliyuncs.com",
		},
		{
			name:  "custom host with port and path",
			input: "https://custom.host:8080/some/path",
			want:  "https://custom.host:8080",
		},
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := nativeOriginURL(tc.input)
			if got != tc.want {
				t.Fatalf("nativeOriginURL(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestExecuteAlibabaNativeTTSNormalizesQwenVoice(t *testing.T) {
	var capturedVoice string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/aigc/multimodal-generation/generation" {
			http.NotFound(w, r)
			return
		}
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		input, _ := payload["input"].(map[string]any)
		capturedVoice = strings.TrimSpace(toString(input["voice"]))
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("dashscope-tts-bytes"))
	}))
	defer server.Close()

	artifacts, _, _, err := ExecuteAlibabaNative(
		context.Background(),
		MediaAdapterConfig{
			BaseURL: server.URL,
			APIKey:  "test-api-key",
		},
		nil,
		"job-test",
		&runtimev1.SubmitMediaJobRequest{
			Modal: runtimev1.Modal_MODAL_TTS,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{
					Text:  "hello",
					Voice: "alloy",
				},
			},
		},
		"qwen3-tts-instruct-flash-2026-01-26",
	)
	if err != nil {
		t.Fatalf("ExecuteAlibabaNative tts failed: %v", err)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected 1 artifact, got=%d", len(artifacts))
	}
	if capturedVoice != "Cherry" {
		t.Fatalf("expected normalized voice Cherry, got=%q", capturedVoice)
	}
}

func toString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}
