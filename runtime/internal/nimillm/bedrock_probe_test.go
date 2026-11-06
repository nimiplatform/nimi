package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBedrockProbeUsesReadOnlyNativeControlPlane(t *testing.T) {
	calls, code := 0, 200
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "GET" || r.URL.Path != "/foundation-models" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("wrong native check", r.Method, r.URL.Path)
		}
		w.WriteHeader(code)
		_, _ = w.Write([]byte(`{"modelSummaries":[]}`))
	}))
	defer server.Close()
	p := NewCloudProvider(CloudConfig{AllowLoopbackEndpoint: true})
	if err := p.ProbeConnector(context.Background(), "bedrock", server.URL, "test-key", nil); err != nil || calls != 1 {
		t.Fatal(err, calls)
	}
	code = 403
	if err := p.ProbeConnector(context.Background(), "bedrock", server.URL, "test-key", nil); err == nil || calls != 2 {
		t.Fatal("permission failure retried or became success", err, calls)
	}
}
