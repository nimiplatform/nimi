package httpserver

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/health"
)

func TestHandleRuntimeHealthOmitsRetiredProviderSnapshots(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusReady, "ready")
	state.SetActivity(2, 3)
	state.SetResource(200, 1024, 2048)

	server := New("127.0.0.1:0", state, slog.New(slog.NewTextHandler(io.Discard, nil)))

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/runtime/health", nil)
	server.handleRuntimeHealth(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status mismatch: got=%d", recorder.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, exists := payload["ai_providers"]; exists {
		t.Fatalf("retired provider-health projection leaked through runtime health: %#v", payload)
	}
}

func TestHandleRuntimeHealthReturnsUnavailableWhenNotReady(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusDegraded, "warming")
	server := New("127.0.0.1:0", state, slog.New(slog.NewTextHandler(io.Discard, nil)))

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/runtime/health", nil)
	server.handleRuntimeHealth(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status mismatch: got=%d want=%d", recorder.Code, http.StatusServiceUnavailable)
	}
}

func TestHandleRuntimeHealthRejectsNonReadMethods(t *testing.T) {
	state := health.NewState()
	server := New("127.0.0.1:0", state, slog.New(slog.NewTextHandler(io.Discard, nil)))

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/runtime/health", nil)
	server.handleRuntimeHealth(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status mismatch: got=%d want=%d", recorder.Code, http.StatusMethodNotAllowed)
	}
	if got := recorder.Header().Get("Allow"); got != "GET, HEAD" {
		t.Fatalf("allow header mismatch: got=%q", got)
	}
}

func TestAllowReadMethodRejectsNilRequests(t *testing.T) {
	recorder := httptest.NewRecorder()

	if allowReadMethod(recorder, nil) {
		t.Fatal("nil request should fail closed")
	}
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status mismatch: got=%d want=%d", recorder.Code, http.StatusMethodNotAllowed)
	}
	if got := recorder.Header().Get("Allow"); got != "GET, HEAD" {
		t.Fatalf("allow header mismatch: got=%q", got)
	}
}

func TestNewSetsMaxHeaderBytes(t *testing.T) {
	server := New("127.0.0.1:0", health.NewState(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if got := server.http.MaxHeaderBytes; got != 1<<16 {
		t.Fatalf("max header bytes mismatch: got=%d want=%d", got, 1<<16)
	}
}

func TestDiagnosticEndpointsExposeExpectedStatusesAndHeaders(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusDegraded, "warming")
	server := New("127.0.0.1:0", state, slog.New(slog.NewTextHandler(io.Discard, nil)))

	testCases := []struct {
		name       string
		method     string
		path       string
		statusCode int
	}{
		{name: "livez", method: http.MethodGet, path: "/livez", statusCode: http.StatusOK},
		{name: "readyz degraded", method: http.MethodGet, path: "/readyz", statusCode: http.StatusServiceUnavailable},
		{name: "healthz degraded", method: http.MethodHead, path: "/healthz", statusCode: http.StatusServiceUnavailable},
	}

	for _, tc := range testCases {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(tc.method, tc.path, nil)
		server.http.Handler.ServeHTTP(recorder, request)

		if recorder.Code != tc.statusCode {
			t.Fatalf("%s status mismatch: got=%d want=%d", tc.name, recorder.Code, tc.statusCode)
		}
		if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("%s cache-control mismatch: got=%q", tc.name, got)
		}
		if got := recorder.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Fatalf("%s x-content-type-options mismatch: got=%q", tc.name, got)
		}
	}
}
