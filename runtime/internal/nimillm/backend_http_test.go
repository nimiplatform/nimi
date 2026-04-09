package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestBackendPostJSONUsesContextDeadlineOverClientTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(250 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	backend := NewBackend("llama", server.URL, "", 50*time.Millisecond)
	if backend == nil {
		t.Fatal("expected backend")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	var resp struct {
		OK bool `json:"ok"`
	}
	if err := backend.postJSON(ctx, "/slow", map[string]any{"ping": true}, &resp); err != nil {
		t.Fatalf("postJSON with context deadline: %v", err)
	}
	if !resp.OK {
		t.Fatalf("expected ok response, got %+v", resp)
	}
}

func TestBackendStreamGenerateTextBrokenChunkReturnsReasonCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {not-json}\n\n"))
	}))
	defer server.Close()

	backend := NewBackend("openai", server.URL, "", 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	_, _, err := backend.StreamGenerateText(
		context.Background(),
		"gpt-4o-mini",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
		func(string) error { return nil },
	)
	if err == nil {
		t.Fatal("expected broken chunk error")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_STREAM_BROKEN {
		t.Fatalf("expected AI_STREAM_BROKEN, got %v", reason)
	}
}

func TestBackendGenerateTextUsesFlexibleMessageExtraction(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices":[{
				"finish_reason":"stop",
				"message":{
					"content":[
						{"text":"这本书是《三体：地球往事》。"},
						{"text":"它讲的是背叛、生存与死亡。"}
					]
				}
			}],
			"usage":{"prompt_tokens":8,"total_tokens":20}
		}`))
	}))
	defer server.Close()

	backend := NewBackend("openai", server.URL, "", 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	text, usage, finish, err := backend.GenerateText(
		context.Background(),
		"gpt-4o-mini",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
	)
	if err != nil {
		t.Fatalf("unexpected generate error: %v", err)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("unexpected finish reason: %v", finish)
	}
	if usage == nil || usage.GetInputTokens() != 8 || usage.GetOutputTokens() != 12 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if got, want := text, "这本书是《三体：地球往事》。\n它讲的是背叛、生存与死亡。"; got != want {
		t.Fatalf("text mismatch: got=%q want=%q", got, want)
	}
}

func TestBackendStreamGenerateTextCountsNonContentChunksAsActivity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}` + "\n\n"))
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":0,"total_tokens":5}}` + "\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	backend := NewBackend("openai", server.URL, "", 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	callbacks := make([]string, 0, 2)
	usage, finish, err := backend.StreamGenerateText(
		context.Background(),
		"gpt-4o-mini",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
		func(part string) error {
			callbacks = append(callbacks, part)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("unexpected streaming error: %v", err)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		t.Fatalf("unexpected finish reason: %v", finish)
	}
	if usage == nil || usage.GetInputTokens() != 5 || usage.GetOutputTokens() != 0 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if len(callbacks) < 2 {
		t.Fatalf("expected callbacks for non-content stream chunks, got=%d", len(callbacks))
	}
	for i, part := range callbacks {
		if part != "" {
			t.Fatalf("callback %d should be empty activity-only chunk, got=%q", i, part)
		}
	}
}
