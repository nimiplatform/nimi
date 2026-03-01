package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestLocalProviderNexaTextAndEmbed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/chat/completions":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{
						"finish_reason": "stop",
						"message": map[string]any{
							"content": "nexa text",
						},
					},
				},
				"usage": map[string]any{
					"prompt_tokens":     6,
					"completion_tokens": 3,
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/embeddings":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"embedding": []float64{0.11, 0.22}},
				},
				"usage": map[string]any{
					"prompt_tokens": 3,
					"total_tokens":  5,
				},
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	p := &localProvider{
		nexa: nimillm.NewBackend("nexa", server.URL, "", 3*time.Second),
	}

	text, _, finishReason, err := p.GenerateText(context.Background(), "nexa/qwen", &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, "hello")
	if err != nil {
		t.Fatalf("nexa generate text: %v", err)
	}
	if text != "nexa text" || finishReason != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("nexa text mismatch: text=%s finish=%v", text, finishReason)
	}

	vectors, _, err := p.Embed(context.Background(), "nexa/embed", []string{"embed me"})
	if err != nil {
		t.Fatalf("nexa embed: %v", err)
	}
	if len(vectors) != 1 || len(vectors[0].GetValues()) != 2 {
		t.Fatalf("nexa embed mismatch")
	}

	// Verify ResolveMediaBackend returns the underlying backend.
	backend, resolvedModelID := p.ResolveMediaBackend("nexa/tts-model")
	if backend == nil {
		t.Fatalf("ResolveMediaBackend should return nexa backend")
	}
	if resolvedModelID != "tts-model" {
		t.Fatalf("ResolveMediaBackend model mismatch: got=%s want=tts-model", resolvedModelID)
	}
}

func TestLocalProviderFailCloseWithoutBackend(t *testing.T) {
	p := &localProvider{}

	if _, _, _, err := p.GenerateText(context.Background(), "local/qwen2.5", &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, "hello"); status.Code(err) != codes.Unavailable {
		t.Fatalf("generateText should fail-close: %v", status.Code(err))
	}

	_, finishReason, err := p.StreamGenerateText(context.Background(), "local/qwen2.5", &runtimev1.StreamGenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, nil)
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("streamGenerateText should fail-close: %v", status.Code(err))
	}
	if finishReason != runtimev1.FinishReason_FINISH_REASON_ERROR {
		t.Fatalf("stream finish reason mismatch: %v", finishReason)
	}
}
