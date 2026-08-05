package localservice

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDefaultEndpointProbeMediaRejectsEmptyReadyCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"detail": "warming complete",
			})
		case "/v1/catalog":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"detail": "catalog missing ready models",
				"models": []map[string]any{},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	probe := defaultEndpointProbe(context.Background(), "media", server.URL)
	if probe.healthy {
		t.Fatal("expected media probe to fail when catalog has no ready models")
	}
	if !probe.responded {
		t.Fatal("expected media probe to record HTTP response")
	}
	if !strings.Contains(probe.detail, "catalog") {
		t.Fatalf("expected catalog detail in probe failure, got %q", probe.detail)
	}
}

func TestDefaultEndpointProbeMediaCollectsReadyModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"detail": "ready",
			})
		case "/v1/catalog":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"models": []map[string]any{
					{"id": "flux.1-schnell", "ready": true},
					{"id": "wan2.1-video", "ready": true},
					{"id": "broken-model", "ready": false},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	probe := defaultEndpointProbe(context.Background(), "media", server.URL)
	if !probe.healthy {
		t.Fatalf("expected media probe to succeed, got detail=%q", probe.detail)
	}
	if !strings.Contains(probe.probeURL, "/v1/catalog") {
		t.Fatalf("expected canonical catalog probe url, got %q", probe.probeURL)
	}
	if got := strings.Join(probe.models, ","); got != "flux.1-schnell,wan2.1-video" {
		t.Fatalf("unexpected ready model list: %s", got)
	}
}

func TestDefaultEndpointProbeMediaProxyAllowsReadyEmptyCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"checks": map[string]any{
					"proxy_mode": true,
				},
			})
		case "/v1/catalog":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"detail": "proxy execution catalog is informational only",
				"models": []map[string]any{},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	probe := defaultEndpointProbe(context.Background(), "media", server.URL)
	if !probe.healthy {
		t.Fatalf("expected media proxy probe to succeed, got detail=%q", probe.detail)
	}
}

func TestDefaultEndpointProbeSpeechRejectsCatalogReadyFalse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"ready":  true,
				"detail": "health endpoint reachable",
			})
		case "/v1/catalog":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "placeholder",
				"ready":  false,
				"detail": "speech placeholder catalog",
				"models": []map[string]any{
					{"id": "speech-default", "ready": true, "capabilities": []string{"audio.synthesize"}},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	probe := defaultEndpointProbe(context.Background(), "speech", server.URL)
	if probe.healthy {
		t.Fatal("expected speech probe to fail when catalog reports ready=false")
	}
	if !strings.Contains(probe.detail, "placeholder") && !strings.Contains(probe.detail, "ready=false") {
		t.Fatalf("expected placeholder-ready=false detail, got %q", probe.detail)
	}
}
