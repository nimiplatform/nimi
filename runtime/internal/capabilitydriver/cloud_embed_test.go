package capabilitydriver

import (
	"errors"
	"net/http"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCloudEmbedDriverOwnsTargetRequestAndResponseNormalization(t *testing.T) {
	registry := NewProductionCloudEmbedRegistry()
	targetValue, err := structpb.NewStruct(map[string]any{
		"provider":             "openai",
		"providerModelId":      "text-embedding-3-small",
		"remoteModelCatalogId": "catalog-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	driver, target, err := registry.Resolve(Identity{
		ImplementationID: "cloud.text.embed.openai",
		DriverID:         "nimi.runtime.driver.openai",
		DriverDialect:    "openai/embeddings/v1",
	}, targetValue)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	mapped, err := driver.MapRequest(target, &runtimev1.TextEmbedScenarioSpec{Inputs: []string{" first ", "second"}}, nil)
	if err != nil {
		t.Fatalf("MapRequest: %v", err)
	}
	if got := mapped.Inputs(); len(got) != 2 || got[0] != "first" {
		t.Fatalf("mapped inputs = %#v", got)
	}
	vector := func(values ...float64) *structpb.ListValue {
		out := &structpb.ListValue{Values: make([]*structpb.Value, 0, len(values))}
		for _, value := range values {
			out.Values = append(out.Values, structpb.NewNumberValue(value))
		}
		return out
	}
	result, err := driver.NormalizeResponse(mapped, CloudEmbedTransportResponse{Vectors: []*structpb.ListValue{
		vector(0.1, 0.2), vector(0.3, 0.4),
	}})
	if err != nil {
		t.Fatalf("NormalizeResponse: %v", err)
	}
	if len(result.Vectors) != 2 || result.Vectors[1].GetValues()[1] != 0.4 || result.Usage == nil {
		t.Fatalf("normalized result = %+v", result)
	}
}

func TestCloudEmbedDriverRejectsUnsupportedDefaultsAndMalformedOutput(t *testing.T) {
	registry := NewProductionCloudEmbedRegistry()
	targetValue, _ := structpb.NewStruct(map[string]any{
		"provider": "openai", "providerModelId": "text-embedding-3-small", "remoteModelCatalogId": "catalog-1",
	})
	driver, target, err := registry.Resolve(Identity{ImplementationID: "impl", DriverID: "driver", DriverDialect: "dialect"}, targetValue)
	if err != nil {
		t.Fatal(err)
	}
	defaults, _ := structpb.NewStruct(map[string]any{"dimensions": 256})
	if _, err := driver.MapRequest(target, &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"input"}}, defaults); cloudInvocationKind(err) != CloudInvocationFailureRequest {
		t.Fatalf("unsupported defaults error = %v", err)
	}
	mapped, err := driver.MapRequest(target, &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"one", "two"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := driver.NormalizeResponse(mapped, CloudEmbedTransportResponse{Vectors: []*structpb.ListValue{{Values: []*structpb.Value{structpb.NewNumberValue(1)}}}}); cloudInvocationKind(err) != CloudInvocationFailureResponse {
		t.Fatalf("malformed output error = %v", err)
	}
}

func TestCloudEmbedReasonNormalization(t *testing.T) {
	driver := providerCloudEmbedDriver{provider: "openai"}
	for statusCode, expected := range map[int]runtimev1.ReasonCode{
		http.StatusUnauthorized:        runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
		http.StatusTooManyRequests:     runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
		http.StatusNotFound:            runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
		http.StatusBadRequest:          runtimev1.ReasonCode_AI_INPUT_INVALID,
		http.StatusGatewayTimeout:      runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
		http.StatusInternalServerError: runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
	} {
		if got := CloudEmbedReasonForHTTPStatus(statusCode); got != expected {
			t.Fatalf("HTTP %d reason = %v, want %v", statusCode, got, expected)
		}
	}
	preserved := grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	if reason, ok := grpcerr.ExtractReasonCode(driver.NormalizeReason(preserved)); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING {
		t.Fatalf("credential reason = %v present=%v", reason, ok)
	}
}

func cloudInvocationKind(err error) CloudInvocationFailureKind {
	var invocation *CloudInvocationError
	if errors.As(err, &invocation) {
		return invocation.Kind
	}
	return ""
}
