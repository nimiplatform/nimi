package entrypoint

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestExecuteScenarioGRPCRequiresAppID(t *testing.T) {
	_, err := ExecuteScenarioGRPC("127.0.0.1:50051", 0, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{},
	})
	if err == nil || err.Error() != "app_id is required" {
		t.Fatalf("expected app_id validation error, got=%v", err)
	}
}

func TestStreamScenarioGRPCRequiresAppID(t *testing.T) {
	_, _, err := StreamScenarioGRPC(nil, "127.0.0.1:50051", &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{},
	})
	if err == nil || err.Error() != "app_id is required" {
		t.Fatalf("expected app_id validation error, got=%v", err)
	}
}

func TestFetchHealthFailsClosedOnNonSuccessStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "runtime unavailable", http.StatusBadGateway)
	}))
	defer server.Close()

	httpAddr := strings.TrimPrefix(server.URL, "http://")
	_, err := FetchHealth(httpAddr, 0)
	if err == nil {
		t.Fatal("expected non-2xx health request to fail")
	}
	if !strings.Contains(err.Error(), "HTTP 502") {
		t.Fatalf("expected HTTP status in error, got=%v", err)
	}
}
