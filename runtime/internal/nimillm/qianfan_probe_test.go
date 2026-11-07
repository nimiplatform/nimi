package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestQianfanProbeExactV2AndBearer(t *testing.T) {
	for _, suffix := range []string{"/proxy/anthropic", "/proxy/anthropic/v2"} {
		t.Run(suffix, func(t *testing.T) {
			calls := 0
			invalid := false
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/proxy/anthropic/v2/models" || r.Method != "GET" || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("x-api-key") != "" {
					t.Errorf("wrong probe %s", r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				if invalid {
					_, _ = w.Write([]byte(`{"message":"wrong route"}`))
				} else {
					_, _ = w.Write([]byte(`{"data":[]}`))
				}
			}))
			defer server.Close()
			b := NewSecuredBackendWithHeaders("cloud-qianfan", server.URL+suffix, "test-key", nil, time.Second, true)
			if err := b.ProbeConnector(context.Background()); err != nil || calls != 1 {
				t.Fatal(err, calls)
			}
			invalid = true
			if err := b.ProbeConnector(context.Background()); err == nil || calls != 2 {
				t.Fatal("invalid account response accepted", err, calls)
			}
		})
	}
}
