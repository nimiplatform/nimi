package capabilitydriver

import (
	"net/http"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textwire"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestApplyCloudTextDefaultsExplicitZeroOverridesDefaults(t *testing.T) {
	defaults, _ := structpb.NewStruct(map[string]any{
		"temperature": 0.7, "top_p": 0.9, "max_tokens": 128.0, "top_k": 40.0,
		"presence_penalty": 1.0, "frequency_penalty": -1.0, "seed": 42.0,
	})
	spec := &runtimev1.TextGenerateScenarioSpec{
		Temperature: testFloat32(0), TopP: testFloat32(0), MaxTokens: testInt32(0), TopK: testInt32(0),
		PresencePenalty: testFloat32(0), FrequencyPenalty: testFloat32(0), Seed: testInt64(0),
	}
	if err := applyCloudTextDefaults(spec, defaults); err != nil {
		t.Fatalf("applyCloudTextDefaults: %v", err)
	}
	if spec.Temperature == nil || spec.TopP == nil || spec.MaxTokens == nil || spec.TopK == nil ||
		spec.PresencePenalty == nil || spec.FrequencyPenalty == nil || spec.Seed == nil ||
		spec.GetTemperature() != 0 || spec.GetTopP() != 0 || spec.GetMaxTokens() != 0 || spec.GetTopK() != 0 ||
		spec.GetPresencePenalty() != 0 || spec.GetFrequencyPenalty() != 0 || spec.GetSeed() != 0 {
		t.Fatalf("explicit zero values were replaced by defaults: %+v", spec)
	}
}

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
	target, _ := structpb.NewStruct(map[string]any{
		"provider":             "openai",
		"providerModelId":      "gpt-4o-mini",
		"remoteModelCatalogId": "remote-model-catalog-gpt-4o-mini",
	})
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

func TestCloudTextDriverMapsReasoningToClosedWireDirectives(t *testing.T) {
	mapRequest := func(provider string, reasoning *runtimev1.ReasoningConfig) (*CloudTextMappedRequest, error) {
		target, err := structpb.NewStruct(map[string]any{
			"provider":             provider,
			"providerModelId":      provider + "-model",
			"remoteModelCatalogId": "catalog-" + provider,
		})
		if err != nil {
			t.Fatal(err)
		}
		driver, validated, err := NewProductionCloudTextRegistry().Resolve(Identity{
			ImplementationID: "cloud.text." + provider,
			DriverID:         "nimi.runtime.driver." + provider,
			DriverDialect:    "openai/chat-completions/v1",
		}, target)
		if err != nil {
			return nil, err
		}
		return driver.MapRequest(validated, &runtimev1.TextGenerateScenarioSpec{
			Input:     []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
			Reasoning: reasoning,
		}, nil, false)
	}

	deepSeek, err := mapRequest("deepseek", &runtimev1.ReasoningConfig{
		Mode:      runtimev1.ReasoningMode_REASONING_MODE_OFF,
		TraceMode: runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_HIDE,
	})
	if err != nil {
		t.Fatalf("map DeepSeek OFF: %v", err)
	}
	if deepSeek.WireDirectives().ReasoningToggle != textwire.ReasoningToggleDisabled {
		t.Fatalf("DeepSeek directives = %#v", deepSeek.WireDirectives())
	}

	ordinary, err := mapRequest("openai", &runtimev1.ReasoningConfig{
		Mode:      runtimev1.ReasoningMode_REASONING_MODE_OFF,
		TraceMode: runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_HIDE,
	})
	if err != nil {
		t.Fatalf("map OpenAI OFF: %v", err)
	}
	if !ordinary.WireDirectives().Empty() {
		t.Fatalf("ordinary OpenAI directives = %#v", ordinary.WireDirectives())
	}

	if _, err := mapRequest("openai", &runtimev1.ReasoningConfig{
		Mode:      runtimev1.ReasoningMode_REASONING_MODE_ON,
		TraceMode: runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_HIDE,
	}); err == nil {
		t.Fatal("expected unsupported reasoning toggle to fail closed")
	}
}
