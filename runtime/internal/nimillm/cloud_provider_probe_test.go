package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestNormalizeTokenProviderIDCanonicalOnly(t *testing.T) {
	validCases := map[string]string{"": "nimillm"}
	for _, providerID := range providerregistry.RemoteProviders {
		validCases[providerID] = providerID
	}
	validCases["cloud-dashscope"] = "dashscope"
	validCases["cloud_openai_compatible"] = "openai_compatible"
	for raw, want := range validCases {
		got, err := NormalizeTokenProviderID(raw)
		if err != nil {
			t.Fatalf("NormalizeTokenProviderID(%q) returned error: %v", raw, err)
		}
		if got != want {
			t.Fatalf("NormalizeTokenProviderID(%q) mismatch: got=%q want=%q", raw, got, want)
		}
	}

	invalidCases := []string{
		"alibaba",
		"aliyun",
		"bytedance",
		"byte",
		"moonshot",
		"zhipu",
		"bigmodel",
		"cloudnimillm",
		"cloudbytedance",
		"cloudalibaba",
	}
	for _, raw := range invalidCases {
		_, err := NormalizeTokenProviderID(raw)
		if err == nil {
			t.Fatalf("NormalizeTokenProviderID(%q) should reject legacy alias", raw)
		}
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("NormalizeTokenProviderID(%q) error code mismatch: got=%v want=%v", raw, status.Code(err), codes.InvalidArgument)
		}
	}
}

func TestBackendProbeConnectorAndListModelsUseAnthropicAPI(t *testing.T) {
	var probeHits int
	var listHits int
	var capturedAPIKey string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAPIKey = r.Header.Get("x-api-key")
		switch r.URL.Path {
		case "/v1/models":
			if r.Method == http.MethodGet {
				probeHits++
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"claude-sonnet-4-6","display_name":"Claude Sonnet 4.6","type":"model"}]}`))
			listHits++
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	backend := NewBackendWithHeaders("cloud-anthropic", server.URL, "sk-ant-api-test", anthropicCredentialHeaders("sk-ant-api-test"), defaultHTTPTimeout)
	if backend == nil {
		t.Fatal("expected backend")
	}
	if err := backend.ProbeConnector(context.Background()); err != nil {
		t.Fatalf("ProbeConnector: %v", err)
	}
	models, err := backend.ListModels(context.Background())
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if probeHits < 1 || listHits < 2 {
		t.Fatalf("expected anthropic probe and list hits, probe=%d list=%d", probeHits, listHits)
	}
	if capturedAPIKey != "sk-ant-api-test" {
		t.Fatalf("expected x-api-key auth, got %q", capturedAPIKey)
	}
	if len(models) != 1 || models[0].ModelID != "claude-sonnet-4-6" {
		t.Fatalf("unexpected models: %+v", models)
	}
}
