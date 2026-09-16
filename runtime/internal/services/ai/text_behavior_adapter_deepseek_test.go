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

func TestDeepseekToolsResolveExactTargetsModesAndCombinations(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "deepseek", DriverId: "nimillm", DriverDialect: "deepseek"}
	for _, model := range []string{"deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"} {
		for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
			for _, choice := range []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL} {
				s := testTextBehaviorToolSpec()
				s.ToolChoice = choice
				if choice == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL {
					s.ToolChoiceName = s.Tools[0].Name
				}
				adapter, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "deepseek", model, mode, s)
				if err != nil || adapter == nil || adapter.registration.Version != "2" {
					t.Fatalf("%s/%v/%v adapter=%+v err=%v", model, mode, choice, adapter, err)
				}
			}
		}
	}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, runtimev1.ExecutionMode_EXECUTION_MODE_UNSPECIFIED} {
		if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "deepseek", "deepseek-flash", mode, testTextBehaviorToolSpec()); err == nil {
			t.Fatal("unsupported mode promoted")
		}
	}
	for _, model := range []string{"deepseek-chat", "deepseek-reasoner", "other-model"} {
		if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "deepseek", model, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, testTextBehaviorToolSpec()); err == nil {
			t.Fatal("unregistered model promoted")
		}
	}
	s := testTextBehaviorToolSpec()
	s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "deepseek", "deepseek-flash", runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, s); err == nil {
		t.Fatal("combined tools/JSON promoted")
	}
	s = testTextBehaviorToolSpec()
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}
	if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "deepseek", "deepseek-flash", runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, s); err == nil {
		t.Fatal("raw reasoning tool roundtrip promoted")
	}
}
