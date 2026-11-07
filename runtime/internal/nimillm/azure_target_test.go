package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAzureEndpointAndReadOnlyProbeUseNativeNamespaceAndKey(t *testing.T) {
	for _, raw := range []string{"https://tenant.example", "https://tenant.example/", "https://tenant.example/openai", "https://tenant.example/openai/v1/"} {
		got, err := AzureOpenAIEndpoint(raw)
		if err != nil || got != "https://tenant.example/openai/v1" {
			t.Fatalf("%s: %s %v", raw, got, err)
		}
	}
	for _, raw := range []string{"https://tenant.example/v1", "https://tenant.example/openai/deployments/name", "https://tenant.example/openai/v1?api-version=old", "https://user:pass@tenant.example", "http://tenant.example"} { // pragma: allowlist secret -- URL userinfo rejection fixture
		if _, err := AzureOpenAIEndpoint(raw); err == nil {
			t.Fatal("unsupported Azure endpoint admitted")
		}
	}
	calls := 0
	status := http.StatusOK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "GET" || r.URL.Path != "/proxy/openai/v1/models" || r.Header.Get("api-key") != "selected-key" || r.Header.Get("Authorization") != "" {
			t.Error("incorrect Azure probe", r.Method, r.URL.Path)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()
	p := NewCloudProvider(CloudConfig{AllowLoopbackEndpoint: true})
	if err := p.ProbeConnector(context.Background(), "azure", server.URL+"/proxy/openai/v1", "selected-key", map[string]string{"Authorization": "must-not-forward"}); err != nil || calls != 1 {
		t.Fatal(err, calls)
	}
	status = http.StatusNotFound
	if err := p.ProbeConnector(context.Background(), "azure", server.URL+"/proxy/openai/v1", "selected-key", nil); err == nil || calls != 2 {
		t.Fatal("probe tried an undocumented alternate path", err, calls)
	}
}

func TestAzureDeploymentChangesWireModelWithoutLosingCanonicalControls(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "tenant-deployment" || r.Header.Get("api-key") != "selected-key" || r.Header.Get("Authorization") != "" {
			t.Error("model or native credential mapping")
		}
		switch r.URL.Path {
		case "/openai/v1/embeddings":
			_, _ = w.Write([]byte(`{"data":[{"index":0,"embedding":[0.1,0.2]}],"usage":{"prompt_tokens":2,"total_tokens":2}}`))
		case "/openai/v1/chat/completions":
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Actual response."},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}`))
		default:
			t.Error("wrong namespace", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	p := NewCloudProvider(CloudConfig{AllowLoopbackEndpoint: true})
	target := &RemoteTarget{ProviderType: "azure", Endpoint: server.URL, APIKey: "selected-key", ProviderModelID: "text-embedding-3-small", AzureDeploymentName: "tenant-deployment", AllowLoopback: true}
	b := p.backendFromTarget(target)
	if b == nil {
		t.Fatal("valid Azure target rejected")
	}
	if _, _, err := b.Embed(context.Background(), "text-embedding-3-small", []string{"Input"}, nil); err != nil {
		t.Fatal(err)
	}
	target.AzureDeploymentName = ""
	if p.backendFromTarget(target) != nil {
		t.Fatal("missing binding guessed the model name")
	}
}
