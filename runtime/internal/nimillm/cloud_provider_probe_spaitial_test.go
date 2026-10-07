package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestSpaitialConnectorCheckUsesAuthenticatedNativeReadOnlyEndpoint(t *testing.T) {
	hits := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Method != http.MethodGet || r.URL.Path != "/v1/models" || r.URL.RawQuery != "" {
			t.Error("connection diagnostic attempted an alternate route or mutation")
		}
		if r.Header.Get("Authorization") != "Bearer valid-key" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"invalid key"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"models":[{"id":"default"},{"id":"Echo 2 (HQ)"}]}`))
	}))
	defer server.Close()
	provider := &CloudProvider{allowLoopbackEndpoint: true}
	if err := provider.ProbeConnector(context.Background(), "spaitial", server.URL, "valid-key", nil); err != nil {
		t.Fatalf("native connection check: %v", err)
	}
	err := provider.ProbeConnector(context.Background(), "spaitial", server.URL, "invalid-key", nil)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("bad credential was not rejected: %v", err)
	}
	if hits != 2 {
		t.Fatalf("expected two bounded reads, got %d", hits)
	}
	if _, err := NormalizeTokenProviderID("spaitial"); err == nil {
		t.Fatal("world-only provider entered token probe admission")
	}
}
