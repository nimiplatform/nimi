package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
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
