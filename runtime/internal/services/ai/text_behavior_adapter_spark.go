package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func sparkTextBehaviorRegistration(provider, model string) textBehaviorAdapterRegistration {
	p, err := capabilitydriver.NewSparkTextBehavior(provider, model)
	if err != nil {
		panic("invalid reviewed Spark target")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	support := textBehaviorSupport{}
	for _, tool := range []bool{false, true} {
		for _, reasoning := range []bool{false, true} {
			for _, structured := range []bool{false, true} {
				for _, ordered := range []bool{false, true} {
					if tool && !p.Tools() || reasoning && !p.Reasoning() || structured && (p.Reasoning() || tool) || ordered && !p.OrderedSystem() {
						continue
					}
					support.Combinations = append(support.Combinations, textBehaviorCombination{ToolUse: tool, Reasoning: reasoning, StructuredOutput: structured, OrderedSystemMessages: ordered, Modes: modes})
				}
			}
		}
	}
	if p.Tools() {
		support.ToolUse = &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true}
	}
	if p.Reasoning() {
		support.Reasoning = &textBehaviorReasoningSupport{Activations: []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED, runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE}, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}}
	} else {
		support.StructuredOutput = &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}
	}
	return textBehaviorAdapterRegistration{AdapterID: provider + "." + model + ".chat", Version: "1", ImplementationID: provider, DriverID: "nimillm", DriverDialect: provider, CloudTarget: &textBehaviorCloudTarget{Provider: provider, ProviderModelID: model}, Support: support, ExecutionSemantics: textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected}, RequestSerializerID: provider + "/" + model + "/request/v1", RequestSerializer: p.Serialize, MaterializationPlanner: p.PlanMaterialization, NonStreamParserID: provider + "/" + model + "/response/v1", NonStreamParser: p.Parse, StreamAssemblerID: provider + "/" + model + "/stream/v1", StreamAssembler: p.Stream}
}
