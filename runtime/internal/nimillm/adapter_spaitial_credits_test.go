package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestSpaitialPaymentRequiredDoesNotInvalidateCredentialsOrRetry(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"error":{"code":"INSUFFICIENT_CREDITS","message":"API key cannot generate with the current credit balance"}}`))
	}))
	defer server.Close()
	ctx := loopbackProviderTestContext(context.Background())
	result := map[string]any{}
	err := spaitialJSON(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture"}, http.MethodPost, "/v1/worlds", map[string]any{"model": "echo-2"}, "nimi-world-test", &result)
	reason, _ := grpcerr.ExtractReasonCode(err)
	metadata := extractErrorInfoMetadata(err)
	if reason != runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED || status.Code(err) != codes.ResourceExhausted || metadata["action_hint"] != "replenish_provider_balance_or_adjust_quota" || calls != 1 {
		t.Fatalf("payment classification: %v calls=%d", err, calls)
	}
	assertProviderMessageAbsent(t, metadata)
}
