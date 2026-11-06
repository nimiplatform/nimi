package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func togetherTextBehaviorRegistration(model string) textBehaviorAdapterRegistration {
	p, err := capabilitydriver.NewTogetherTextBehavior(model)
	if err != nil {
		panic("invalid reviewed Together target")
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
	if len(p.Efforts()) > 0 {
		r.Presentations = []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}
		r.Activations = []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
		if p.CanDisableReasoning() {
			r.Activations = append(r.Activations, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED)
		}
		r.Efforts = []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}
		for _, effort := range p.Efforts() {
			r.Efforts = append(r.Efforts, map[string]runtimev1.ReasoningEffort{"low": runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, "medium": runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, "high": runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH, "max": runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM}[effort])
		}
	}
	return textBehaviorAdapterRegistration{
		AdapterID: "together." + model + ".chat", Version: "1", ImplementationID: "together", DriverID: "nimillm", DriverDialect: "together", CloudTarget: &textBehaviorCloudTarget{Provider: "together", ProviderModelID: model},
		Support: textBehaviorSupport{
			ToolUse:   &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true},
			Reasoning: r, StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true}, Combinations: combinations,
		}, ExecutionSemantics: textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "together/" + model + "/request/v1", RequestSerializer: p.Serialize, MaterializationPlanner: p.PlanMaterialization,
		NonStreamParserID: "together/" + model + "/response/v1", NonStreamParser: p.Parse,
		StreamAssemblerID: "together/" + model + "/stream/v1", StreamAssembler: p.Stream,
	}
}
