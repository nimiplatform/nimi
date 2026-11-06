package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func groqTextBehaviorRegistration(model string) textBehaviorAdapterRegistration {
	p, err := capabilitydriver.NewGroqTextBehavior(model)
	if err != nil {
		panic("invalid reviewed Groq target")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	combinations := []textBehaviorCombination{}
	for _, tool := range []bool{false, true} {
		for _, reasoning := range []bool{false, true} {
			for _, structured := range []bool{false, true} {
				for _, ordered := range []bool{false, true} {
					combinations = append(combinations, textBehaviorCombination{ToolUse: tool, Reasoning: reasoning, StructuredOutput: structured, OrderedSystemMessages: ordered, Modes: modes})
				}
			}
		}
	}
	activations := []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
	efforts := []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT, runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}
	if model == "qwen/qwen3.8-27b" {
		activations = append(activations, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED)
		efforts = efforts[1:]
	}
	if model == "meta-models/muse-spark-open" {
		efforts = append(efforts, runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH)
	}
	if model == "minimaxai/minimax-m2.7" {
		efforts = efforts[:1]
	}
	kinds := []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	if p.StrictSchema() {
		kinds = append(kinds, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA)
	}
	return textBehaviorAdapterRegistration{
		AdapterID: "groq." + model + ".chat", Version: "1", ImplementationID: "groq", DriverID: "nimillm", DriverDialect: "groq", CloudTarget: &textBehaviorCloudTarget{Provider: "groq", ProviderModelID: model},
		Support: textBehaviorSupport{
			ToolUse:          &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL}, SingleCall: true, MultipleCalls: p.ParallelTools(), ParallelCalls: p.ParallelTools(), ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true},
			Reasoning:        &textBehaviorReasoningSupport{Activations: activations, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: efforts},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: kinds, SupportsStrictJSONSchema: p.StrictSchema()}, Combinations: combinations,
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "groq/" + model + "/request/v1", RequestSerializer: p.Serialize, MaterializationPlanner: p.PlanMaterialization,
		NonStreamParserID: "groq/" + model + "/response/v1", NonStreamParser: p.Parse, StreamAssemblerID: "groq/" + model + "/stream/v1", StreamAssembler: p.Stream,
	}
}
