package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func siliconFlowTextBehaviorRegistration(model string) textBehaviorAdapterRegistration {
	p, err := capabilitydriver.NewSiliconFlowTextBehavior(model)
	if err != nil {
		panic("invalid reviewed SiliconFlow target")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	combinations := []textBehaviorCombination{}
	for _, tool := range []bool{false, true} {
		for _, reasoning := range []bool{false, true} {
			for _, structured := range []bool{false, true} {
				for _, ordered := range []bool{false, true} {
					if tool && structured {
						continue
					}
					combinations = append(combinations, textBehaviorCombination{ToolUse: tool, Reasoning: reasoning, StructuredOutput: structured, OrderedSystemMessages: ordered, Modes: modes})
				}
			}
		}
	}
	r := &textBehaviorReasoningSupport{ContinuityCarrier: true, ContinuityKind: p.ContinuityKind(), ContinuityVersion: 1}
	if p.Qwen() || p.NativeEffort() {
		r.Presentations = []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}
		r.Activations = []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
		r.Efforts = []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}
		if p.Qwen() {
			r.Activations = append(r.Activations, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED)
			r.ExactBudget = true
		} else {
			r.Efforts = append(r.Efforts, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM)
		}
	}
	return textBehaviorAdapterRegistration{
		AdapterID: "siliconflow." + model + ".chat", Version: "1", ImplementationID: "siliconflow", DriverID: "nimillm", DriverDialect: "siliconflow", CloudTarget: &textBehaviorCloudTarget{Provider: "siliconflow", ProviderModelID: model},
		Support: textBehaviorSupport{
			ToolUse:   &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true},
			Reasoning: r, StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true}, Combinations: combinations,
		}, ExecutionSemantics: textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "siliconflow/" + model + "/request/v1", RequestSerializer: p.Serialize, MaterializationPlanner: p.PlanMaterialization,
		NonStreamParserID: "siliconflow/" + model + "/response/v1", NonStreamParser: p.Parse,
		StreamAssemblerID: "siliconflow/" + model + "/stream/v1", StreamAssembler: p.Stream,
	}
}
