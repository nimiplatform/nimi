package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestHaiku55EffortSchemaAndForcedToolsPreserveExactControls(t *testing.T) {
	for effort, want := range map[runtimev1.ReasoningEffort]string{
		runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high", runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH: "xhigh", runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "max",
	} {
		spec := anthropicBehaviorTestSpec(t)
		spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: effort}}
		body := decodeAnthropicBody(t, mustSerialize(t, AnthropicHaiku55TextBehaviorRequestSerializer, spec))
		if body["output_config"].(map[string]any)["effort"] != want || body["thinking"].(map[string]any)["display"] != "omitted" || body["tool_choice"].(map[string]any)["type"] != "any" {
			t.Fatalf("forced tool/adaptive effort: %+v", body)
		}
		schema := spec.Tools[0].InputSchema
		spec.Tools = nil
		spec.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED
		spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, Strict: true}
		body = decodeAnthropicBody(t, mustSerialize(t, AnthropicHaiku55TextBehaviorRequestSerializer, spec))
		output := body["output_config"].(map[string]any)
		if output["effort"] != want || output["format"].(map[string]any)["type"] != "json_schema" {
			t.Fatalf("effort lost to schema: %+v", output)
		}
	}
	spec := anthropicBehaviorTestSpec(t)
	spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
	body := decodeAnthropicBody(t, mustSerialize(t, AnthropicHaiku55TextBehaviorRequestSerializer, spec))
	if body["thinking"].(map[string]any)["type"] != "disabled" {
		t.Fatal("explicit off ignored")
	}
	spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", Content: "Prefill"})
	if _, err := AnthropicHaiku55TextBehaviorRequestSerializer(spec, false); err == nil {
		t.Fatal("assistant prefill admitted")
	}
	for _, reasoning := range []*runtimev1.ReasoningConfig{
		{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}},
		{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}},
		{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM}},
	} {
		spec = anthropicBehaviorTestSpec(t)
		spec.Reasoning = reasoning
		if _, err := AnthropicHaiku55TextBehaviorRequestSerializer(spec, true); err == nil {
			t.Fatal("unsupported reasoning combination admitted")
		}
	}
}
