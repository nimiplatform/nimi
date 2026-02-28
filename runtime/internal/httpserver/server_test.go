package httpserver

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

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

	server := New("127.0.0.1:0", state, slog.New(slog.NewTextHandler(io.Discard, nil)))
	tracker := providerhealth.New()
	tracker.Mark("cloud-nimillm", true, "")
	tracker.Mark("cloud-alibaba", false, "timeout")
	server.SetAIHealthTracker(tracker)

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
