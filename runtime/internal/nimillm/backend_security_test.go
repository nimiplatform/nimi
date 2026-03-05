package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestNewSecuredBackendRejectsInsecureEndpoint(t *testing.T) {
	backend := NewSecuredBackend("cloud-openai", "http://example.com", "k", 3*time.Second, false)
	if backend != nil {
		t.Fatal("expected secured backend to reject non-loopback HTTP endpoint")
	}
}

func TestNewSecuredBackendAllowsLoopbackEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"finish_reason": "stop",
					"message": map[string]any{
						"content": "ok",
					},
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     1,
				"completion_tokens": 1,
			},
		})
	}))
	defer server.Close()

	backend := NewSecuredBackend("cloud-openai", server.URL, "", 3*time.Second, true)
	if backend == nil {
		t.Fatal("expected secured backend to allow loopback endpoint with allowLoopback=true")
	}

	text, _, _, err := backend.GenerateText(context.Background(), "gpt-4o-mini", []*runtimev1.ChatMessage{
		{Role: "user", Content: "hello"},
	}, "", 0, 0, 0)
	if err != nil {
		t.Fatalf("generate text failed: %v", err)
	}
	if text != "ok" {
		t.Fatalf("unexpected text output: %q", text)
	}
}

func TestCloudProviderWithTargetLoopbackPolicy(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"finish_reason": "stop",
					"message": map[string]any{
						"content": "loopback-target-ok",
					},
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     2,
				"completion_tokens": 2,
			},
		})
	}))
	defer server.Close()

	provider := NewCloudProvider(CloudConfig{
		Providers:               map[string]ProviderCredentials{},
		HTTPTimeout:             3 * time.Second,
		EnforceEndpointSecurity: true,
		AllowLoopbackEndpoint:   false,
	}, nil, nil)

	req := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
	}

	_, _, _, err := provider.GenerateTextWithTarget(context.Background(), "openai/gpt-4o-mini", req, "hello", &RemoteTarget{
		ProviderType:  "openai",
		Endpoint:      server.URL,
		APIKey:        "",
		AllowLoopback: false,
	})
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("expected unavailable when loopback not allowed, got: %v", err)
	}

	text, _, _, err := provider.GenerateTextWithTarget(context.Background(), "openai/gpt-4o-mini", req, "hello", &RemoteTarget{
		ProviderType:  "openai",
		Endpoint:      server.URL,
		APIKey:        "",
		AllowLoopback: true,
	})
	if err != nil {
		t.Fatalf("expected success with loopback allowed: %v", err)
	}
	if text != "loopback-target-ok" {
		t.Fatalf("unexpected target text: %q", text)
	}
}

func TestDoJSONRequestRejectsForbiddenEndpoint(t *testing.T) {
	err := DoJSONRequest(context.Background(), http.MethodGet, "http://example.com/v1/models", "", nil, nil)
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected failed precondition, got: %v", err)
	}
}
