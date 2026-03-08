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

	backend := NewBackend("localai", server.URL, "", 50*time.Millisecond)
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
