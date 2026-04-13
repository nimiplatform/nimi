package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
)

func TestProviderSnapshotsPayloadNilTracker(t *testing.T) {
	items := providerSnapshotsPayload(nil)
	if len(items) != 0 {
		t.Fatalf("expected empty providers payload, got=%d", len(items))
	}
}

func TestHandleRuntimeHealthIncludesProviders(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusReady, "ready")
	state.SetActivity(2, 1, 3)
	state.SetResource(200, 1024, 2048)

	tracker := providerhealth.New()
	if err := tracker.Mark("cloud-nimillm", true, ""); err != nil {
		t.Fatalf("Mark healthy provider: %v", err)
	}
	if err := tracker.Mark("cloud-dashscope", false, "timeout"); err != nil {
		t.Fatalf("Mark unhealthy provider: %v", err)
	}
	server := New("127.0.0.1:0", state, slog.New(slog.NewTextHandler(io.Discard, nil)), tracker, nil)

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
	providersRaw, ok := payload["ai_providers"].([]any)
	if !ok {
		t.Fatalf("ai_providers missing or invalid")
	}
	if len(providersRaw) != 1 {
		t.Fatalf("ai_providers length mismatch: got=%d want=1", len(providersRaw))
	}

	first, ok := providersRaw[0].(map[string]any)
	if !ok {
		t.Fatalf("first provider shape invalid")
	}
	if first["name"] != "cloud-nimillm" {
		t.Fatalf("first provider name mismatch: %v", first["name"])
	}
	if first["state"] != "unhealthy" {
		t.Fatalf("first provider state mismatch: %v", first["state"])
	}
	subHealth, ok := first["sub_health"].([]any)
	if !ok {
		t.Fatalf("sub_health missing or invalid")
	}
	if len(subHealth) != 2 {
		t.Fatalf("sub_health length mismatch: got=%d want=2", len(subHealth))
	}
}

func TestHandleRuntimeHealthReturnsUnavailableWhenNotReady(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusDegraded, "warming")
	server := New("127.0.0.1:0", state, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/runtime/health", nil)
	server.handleRuntimeHealth(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status mismatch: got=%d want=%d", recorder.Code, http.StatusServiceUnavailable)
	}
}

func TestHandleRuntimeHealthRejectsNonReadMethods(t *testing.T) {
	state := health.NewState()
	server := New("127.0.0.1:0", state, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil)

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
	server := New("127.0.0.1:0", health.NewState(), slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil)
	if got := server.http.MaxHeaderBytes; got != 1<<16 {
		t.Fatalf("max header bytes mismatch: got=%d want=%d", got, 1<<16)
	}
}

func TestDiagnosticEndpointsExposeExpectedStatusesAndHeaders(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusDegraded, "warming")
	server := New("127.0.0.1:0", state, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil)

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

func TestHandleCanonicalBindRejectsNonLoopbackRequests(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusReady, "ready")
	server := New("127.0.0.1:0", state, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, func(context.Context, string) (CanonicalBindResult, error) {
		t.Fatal("bind handler should not run for non-loopback request")
		return CanonicalBindResult{}, nil
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/runtime/private/memory/canonical-bind", strings.NewReader(`{"agentId":"agent-1"}`))
	request.RemoteAddr = "192.168.1.20:40123"
	server.http.Handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status mismatch: got=%d want=%d", recorder.Code, http.StatusForbidden)
	}
}

func TestHandleCanonicalBindReturnsBoundBank(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusReady, "ready")
	server := New("127.0.0.1:0", state, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, func(_ context.Context, agentID string) (CanonicalBindResult, error) {
		if agentID != "agent-1" {
			t.Fatalf("agentID mismatch: %s", agentID)
		}
		return CanonicalBindResult{
			AlreadyBound: false,
			Bank: &runtimev1.MemoryBank{
				BankId: "bank-agent-1",
				EmbeddingProfile: &runtimev1.MemoryEmbeddingProfile{
					Provider: "local",
					ModelId:  "local/embed-alpha",
				},
			},
		}, nil
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/runtime/private/memory/canonical-bind", strings.NewReader(`{"agentId":"agent-1"}`))
	request.RemoteAddr = "127.0.0.1:40123"
	server.http.Handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status mismatch: got=%d want=%d", recorder.Code, http.StatusOK)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["alreadyBound"] != false {
		t.Fatalf("alreadyBound mismatch: %#v", payload["alreadyBound"])
	}
	bank, ok := payload["bank"].(map[string]any)
	if !ok {
		t.Fatalf("bank payload missing: %#v", payload["bank"])
	}
	if bank["bankId"] != "bank-agent-1" {
		t.Fatalf("bankId mismatch: %#v", bank["bankId"])
	}
}
