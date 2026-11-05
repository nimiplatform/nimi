package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.minimax-m3-messages
func miniMaxMessagesRegistration(model string) textBehaviorAdapterRegistration {
	p, err := capabilitydriver.NewMiniMaxMessagesBehavior(model)
	if err != nil {
		panic("invalid reviewed MiniMax target")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	reasoning := &textBehaviorReasoningSupport{Activations: []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE}, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}, ContinuityCarrier: true, ContinuityKind: p.ContinuityKind(), ContinuityVersion: 1}
	if model == "MiniMax-M3" {
		reasoning.Activations = append(reasoning.Activations, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED)
	} else {
		reasoning.Efforts = append(reasoning.Efforts, runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM)
	}
	combinations := []textBehaviorCombination{}
	for _, thinking := range []bool{false, true} {
		for _, ordered := range []bool{false, true} {
			combinations = append(combinations, textBehaviorCombination{Reasoning: thinking, OrderedSystemMessages: ordered, Modes: modes}, textBehaviorCombination{Reasoning: thinking, OrderedSystemMessages: ordered, ToolUse: true, Modes: modes})
		}
	}
	return textBehaviorAdapterRegistration{
		AdapterID: "minimax." + model + ".messages", Version: "1", ImplementationID: "minimax", DriverID: "nimillm", DriverDialect: "minimax",
		CloudTarget:         &textBehaviorCloudTarget{Provider: "minimax", ProviderModelID: model},
		Support:             textBehaviorSupport{Reasoning: reasoning, ToolUse: &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true}, Combinations: combinations},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "minimax/" + model + "/messages/request/v1", RequestSerializer: p.Serialize, MaterializationPlanner: p.PlanMaterialization,
		NonStreamParserID: "minimax/" + model + "/messages/response/v1", NonStreamParser: p.Parse,
		StreamAssemblerID: "minimax/" + model + "/messages/stream/v1", StreamAssembler: p.Stream,
	}
}
