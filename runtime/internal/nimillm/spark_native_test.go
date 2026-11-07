package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSparkNativeEndpointIdentityAndProbe(t *testing.T) {
	for _, tc := range []struct{ provider, suffix, path string }{{"spark", "/proxy/anthropic/v1", "/proxy/anthropic/v1/models"}, {"spark_reasoning", "/proxy/x2", "/proxy/x2/models"}, {"spark_reasoning", "/proxy", "/proxy/x2/models"}} {
		t.Run(tc.provider+tc.suffix, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "GET" || r.URL.Path != tc.path || r.Header.Get("Authorization") != "Bearer native-password" || r.Header.Get("x-api-key") != "" {
					t.Errorf("native target %s", r.URL.Path)
				}
				w.WriteHeader(http.StatusUnauthorized)
			}))
			defer server.Close()
			b := NewSecuredBackendWithHeaders("cloud-"+tc.provider, server.URL+tc.suffix, "native-password", nil, time.Second, true)
			if err := b.ProbeConnector(context.Background()); err == nil || calls != 1 {
				t.Fatal("authentication failure or endpoint fallback", err, calls)
			}
		})
	}
	if _, err := sparkAPIPath("spark_reasoning", "https://example.test/proxy/v2", "/chat/completions"); err == nil {
		t.Fatal("X1.5 endpoint accepted as X2 target")
	}
}
