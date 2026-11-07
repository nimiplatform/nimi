package nimillm

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLoudlyProbePreservesRootPrefixAndNativeAuth(t *testing.T) {
	for _, suffix := range []string{"/proxy/anthropic", "/proxy/v1"} {
		t.Run(suffix, func(t *testing.T) {
			code := 200
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "GET" || r.URL.Path != suffix+"/api/account/credits" || r.Header.Get("API-KEY") != "test-key" || r.Header.Get("Authorization") != "" || r.Header.Get("X-Api-Key") != "" {
					t.Errorf("wrong account check %s", r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(code)
				_, _ = fmt.Fprint(w, `{"id":"account","payg_credits":0,"subscription_credits":0}`)
			}))
			defer server.Close()
			p := &CloudProvider{allowLoopbackEndpoint: true}
			if err := p.ProbeConnector(context.Background(), "loudly", server.URL+suffix, "test-key", nil); err != nil || calls != 1 {
				t.Fatal(err, calls)
			}
			code = 401
			if err := p.ProbeConnector(context.Background(), "loudly", server.URL+suffix, "test-key", nil); err == nil || calls != 2 {
				t.Fatal("unauthorized accepted", err, calls)
			}
		})
	}
}
