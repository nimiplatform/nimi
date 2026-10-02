package capabilitydriver

import (
	"errors"
	"fmt"
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
	if len(result.Vectors) != 2 || result.Vectors[1].GetValues()[1] != 0.4 || result.Usage != nil {
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

func TestCloudEmbedDimensionsAreNativeAndExactTargetBounded(t *testing.T) {
	for _, tc := range []struct {
		provider, model string
		dimensions      uint32
		valid           bool
	}{
		{"openai", "text-embedding-3-small", 1, true},
		{"openai", "text-embedding-3-small", 1536, true},
		{"openai", "text-embedding-3-small", 1537, false},
		{"openai", "text-embedding-3-large", 1024, true},
		{"openai", "text-embedding-3-large", 3072, true},
		{"openai", "text-embedding-3-large", 3073, false},
		{"openai", "text-embedding-3-small", 0, false},
		{"openai", "text-embedding-ada-002", 256, false},
		{"gemini", "text-embedding-3-small", 256, false},
		{"gemini", "gemini-embedding-2", 0, false},
		{"gemini", "gemini-embedding-2", 127, false},
		{"gemini", "gemini-embedding-2", 128, true},
		{"gemini", "gemini-embedding-2", 768, true},
		{"gemini", "gemini-embedding-2", 3072, true},
		{"gemini", "gemini-embedding-2", 3073, false},
		{"gemini", "gemini-embedding-001", 768, false},
		{"gemini", "gemini-embedding-2-preview", 768, false},
		{"openai", "gemini-embedding-2", 768, false},
	} {
		t.Run(tc.provider+"/"+tc.model+"/"+fmt.Sprint(tc.dimensions), func(t *testing.T) {
			driver := providerCloudEmbedDriver{provider: tc.provider}
			target := CloudEmbedTarget{provider: tc.provider, providerModelID: tc.model}
			value := tc.dimensions
			mapped, err := driver.MapRequest(target, &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"hello"}, Dimensions: &value}, nil)
			if !tc.valid {
				if cloudInvocationKind(err) != CloudInvocationFailureRequest {
					t.Fatalf("unsupported dimensions accepted: %v", err)
				}
				return
			}
			if err != nil || mapped.Dimensions() == nil || *mapped.Dimensions() != tc.dimensions {
				t.Fatalf("mapped dimensions: %+v %v", mapped, err)
			}
			value = 0
			copy := mapped.Dimensions()
			*copy = 0
			if *mapped.Dimensions() != tc.dimensions {
				t.Fatal("mapped dimensions changed with caller state")
			}
			omitted, err := driver.MapRequest(target, &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"hello"}}, nil)
			if err != nil || omitted.Dimensions() != nil {
				t.Fatalf("default dimensions should stay omitted: %v", err)
			}
			if tc.provider == "gemini" {
				if mapped.Protocol() != CloudEmbedProtocolGeminiV1 || omitted.Protocol() != mapped.Protocol() || mapped.DefaultDimensions() != 3072 {
					t.Fatalf("native Gemini protocol/default not captured: %+v", mapped)
				}
			}
		})
	}
}
