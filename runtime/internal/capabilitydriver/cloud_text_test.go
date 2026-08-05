package capabilitydriver

import (
	"net/http"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCloudTextDriverReasonNormalizationTable(t *testing.T) {
	cases := []struct {
		status int
		want   runtimev1.ReasonCode
	}{
		{http.StatusUnauthorized, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED},
		{http.StatusForbidden, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED},
		{http.StatusTooManyRequests, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED},
		{http.StatusInternalServerError, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL},
		{http.StatusBadGateway, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL},
		{http.StatusServiceUnavailable, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL},
		{http.StatusRequestTimeout, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT},
		{http.StatusGatewayTimeout, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT},
	}
	for _, tc := range cases {
		if got := CloudTextReasonForHTTPStatus(tc.status); got != tc.want {
			t.Fatalf("HTTP %d reason = %s, want %s", tc.status, got, tc.want)
		}
	}
}

func TestCloudTextDriverNormalizesTransportHTTPMetadata(t *testing.T) {
	target, _ := structpb.NewStruct(map[string]any{"provider": "openai", "model": "gpt-4o-mini"})
	driver, _, err := NewProductionCloudTextRegistry().Resolve(Identity{
		ImplementationID: "cloud.text.openai", DriverID: "driver.openai", DriverDialect: "openai/chat-completions/v1",
	}, target)
	if err != nil {
		t.Fatal(err)
	}
	transportErr := grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
		Metadata: map[string]string{"provider_http_status": "503"},
	})
	normalized := driver.NormalizeReason(transportErr)
	if reason, ok := grpcerr.ExtractReasonCode(normalized); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_INTERNAL {
		t.Fatalf("503 normalized reason = %v present=%v err=%v", reason, ok, normalized)
	}
}

func TestCloudTextDriverSeparatesTargetAndRequestMapping(t *testing.T) {
	registry := NewProductionCloudTextRegistry()
	target, err := structpb.NewStruct(map[string]any{
		"provider":             "openai",
		"providerModelId":      "gpt-4o-mini",
		"remoteModelCatalogId": "catalog-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	driver, validated, err := registry.Resolve(Identity{
		ImplementationID: "cloud.text.openai",
		DriverID:         "nimi.runtime.driver.openai",
		DriverDialect:    "openai/chat-completions/v1",
	}, target)
	if err != nil {
		t.Fatalf("validate target: %v", err)
	}
	defaults, _ := structpb.NewStruct(map[string]any{"temperature": 0.25, "maxTokens": 64})
	mapped, err := driver.MapRequest(validated, &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
	}, defaults, true)
	if err != nil {
		t.Fatalf("map request: %v", err)
	}
	if mapped.ProviderModelID() != "gpt-4o-mini" || !mapped.Stream() || mapped.Spec().GetMaxTokens() != 64 {
		t.Fatalf("mapped request = %+v", mapped)
	}
	if validated.Provider() != "openai" || validated.RemoteModelCatalogID() != "catalog-1" {
		t.Fatalf("validated target = %+v", validated)
	}
}
