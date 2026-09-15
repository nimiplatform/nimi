package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"testing"
)

func TestDeepseekJSONRegistrationAdmitsOnlyExactJSONTargets(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "deepseek", DriverId: "nimillm", DriverDialect: "deepseek"}
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON."}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}
	for _, model := range []string{"deepseek-v4-flash", "deepseek-v4-pro"} {
		adapter, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "deepseek", model, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, spec)
		if err != nil || adapter == nil {
			t.Fatalf("JSON target %s: %v", model, err)
		}
	}
	if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "deepseek", "other-model", runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, spec); err == nil {
		t.Fatal("unknown model was promoted")
	}
	spec.ResponseFormat.Kind = runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA
	if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "deepseek", "deepseek-v4-flash", runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, spec); err == nil {
		t.Fatal("unsupported schema was admitted")
	}
}
