package entrypoint

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFetchHealthFailsClosedOnNonSuccessStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "runtime unavailable", http.StatusBadGateway)
	}))
	defer func() { server.Close() }()

	httpAddr := strings.TrimPrefix(server.URL, "http://")
	_, err := FetchHealth(httpAddr, 0)
	if err == nil {
		t.Fatal("expected non-2xx health request to fail")
	}
	if !strings.Contains(err.Error(), "HTTP 502") {
		t.Fatalf("expected HTTP status in error, got=%v", err)
	}
}
