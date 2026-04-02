package engine

import "testing"

func TestDefaultMediaConfig(t *testing.T) {
	cfg := DefaultMediaConfig()
	if cfg.Kind != EngineMedia {
		t.Errorf("expected kind %s, got %s", EngineMedia, cfg.Kind)
	}
	if cfg.HealthPath != "/healthz" {
		t.Errorf("expected health path /healthz, got %s", cfg.HealthPath)
	}
	if cfg.HealthResponse != "\"ready\": true" {
		t.Errorf("expected readiness response matcher, got %s", cfg.HealthResponse)
	}
}

func TestEngineConfigEndpoint(t *testing.T) {
	cfg := EngineConfig{Port: 5678}
	if got := cfg.Endpoint(); got != "http://127.0.0.1:5678" {
		t.Errorf("expected http://127.0.0.1:5678, got %s", got)
	}

	cfg.Address = "  localhost:1234  "
	if got := cfg.Endpoint(); got != "http://localhost:1234" {
		t.Fatalf("expected trimmed endpoint, got %q", got)
	}
}
