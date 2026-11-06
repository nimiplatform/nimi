package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func kimiK3TextBehaviorRegistration(model string) textBehaviorAdapterRegistration {
	p, err := capabilitydriver.NewKimiK3TextBehavior(model)
	if err != nil {
		panic("invalid reviewed Kimi registration")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	combinations := []textBehaviorCombination{}
	for _, tool := range []bool{false, true} {
		for _, reasoning := range []bool{false, true} {
			for _, structured := range []bool{false, true} {
				combinations = append(combinations, textBehaviorCombination{ToolUse: tool, Reasoning: reasoning, StructuredOutput: structured, Modes: modes})
			}
		}
	}
	return textBehaviorAdapterRegistration{
		AdapterID: "kimi." + model + ".chat", Version: "1", ImplementationID: "kimi", DriverID: "nimillm", DriverDialect: "kimi",
		CloudTarget: &textBehaviorCloudTarget{Provider: "kimi", ProviderModelID: model},
		Support: textBehaviorSupport{
			ToolUse:          &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true},
			Reasoning:        &textBehaviorReasoningSupport{Activations: []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT, runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM}, ContinuityCarrier: true, ContinuityKind: p.ContinuityKind(), ContinuityVersion: 1},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations:     combinations,
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "kimi/" + model + "/request/v1", RequestSerializer: p.Serialize, MaterializationPlanner: p.PlanMaterialization,
		NonStreamParserID: "kimi/" + model + "/response/v1", NonStreamParser: p.Parse,
		StreamAssemblerID: "kimi/" + model + "/stream/v1", StreamAssembler: p.Stream,
	}
}
