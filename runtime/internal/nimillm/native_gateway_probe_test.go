package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNativeGatewayProbeKeepsBearerBehindAnthropicNamedProxy(t *testing.T) {
	for _, provider := range []string{"openrouter", "together", "siliconflow"} {
		t.Run(provider, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/proxy/anthropic/v1/models" || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("x-api-key") != "" {
					t.Error("proxy name changed native protocol", r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"data":[]}`))
			}))
			defer server.Close()
			b := NewBackend("cloud-"+provider, server.URL+"/proxy/anthropic/v1", "test-key", defaultHTTPTimeout)
			if err := b.ProbeConnector(context.Background()); err != nil || calls != 1 {
				t.Fatal(err, calls)
			}
		})
	}
}
