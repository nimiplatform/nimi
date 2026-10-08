package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestWorldLabsConnectorCheckUsesOnlyNativeAuthenticatedCreditsRead(t *testing.T) {
	hits := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Method != http.MethodGet || r.URL.Path != "/marble/v1/credits" || r.URL.RawQuery != "" || r.ContentLength > 0 {
			t.Error("probe changed native read-only route")
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("native probe inherited Bearer authentication")
		}
		if r.Header.Get("WLT-Api-Key") != "valid-key" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"message":"Invalid API key"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"remaining_credits":0}`))
	}))
	defer server.Close()
	provider := &CloudProvider{allowLoopbackEndpoint: true}
	if err := provider.ProbeConnector(context.Background(), "worldlabs", server.URL, "valid-key", map[string]string{"wlt-api-key": "shadow-key"}); err != nil {
		t.Fatalf("zero credit still authenticates the connector: %v", err)
	}
	err := provider.ProbeConnector(context.Background(), "worldlabs", server.URL, "invalid-key", nil)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("invalid key was accepted: %v", err)
	}
	if hits != 2 {
		t.Fatalf("expected two single bounded reads, got %d", hits)
	}
	if _, err := NormalizeTokenProviderID("worldlabs"); err == nil {
		t.Fatal("World-only provider entered text token probing")
	}
}

func TestWorldLabsConnectorProbeRejectsMissingOrInvalidCreditFacts(t *testing.T) {
	for _, body := range []string{`{}`, `{"remaining_credits":null}`, `{"remaining_credits":-1}`} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
			defer server.Close()
			provider := &CloudProvider{allowLoopbackEndpoint: true}
			err := provider.ProbeConnector(context.Background(), "worldlabs", server.URL, "valid-key", nil)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
				t.Fatalf("malformed native response accepted: %v", err)
			}
		})
	}
}

func TestWorldLabsNativeProbeKeepsAccountAndServiceFailuresTyped(t *testing.T) {
	for _, tc := range []struct {
		status int
		reason runtimev1.ReasonCode
	}{{http.StatusNotFound, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED}, {http.StatusServiceUnavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE}} {
		t.Run(http.StatusText(tc.status), func(t *testing.T) {
			hits := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits++
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(`{"message":"not available"}`))
			}))
			defer server.Close()
			provider := &CloudProvider{allowLoopbackEndpoint: true}
			err := provider.ProbeConnector(context.Background(), "worldlabs", server.URL, "valid-key", nil)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != tc.reason {
				t.Fatalf("failure was not typed: %v", err)
			}
			if hits != 1 {
				t.Fatalf("probe retried or mutated an account: %d", hits)
			}
		})
	}
}
