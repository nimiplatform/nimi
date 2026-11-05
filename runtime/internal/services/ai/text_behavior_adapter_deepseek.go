package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.deepseek-v4-json-output
func deepseekChatBehaviorRegistration(modelID, adapterID string) textBehaviorAdapterRegistration {
	profile, err := capabilitydriver.NewDeepseekTextBehavior(modelID)
	if err != nil {
		panic("invalid reviewed DeepSeek registration")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	registration := textBehaviorAdapterRegistration{
		AdapterID: adapterID, Version: "5",
		ImplementationID: "deepseek", DriverID: "nimillm", DriverDialect: "deepseek",
		CloudTarget: &textBehaviorCloudTarget{Provider: "deepseek", ProviderModelID: modelID},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL},
				SingleCall:  true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true,
			},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}},
			Reasoning:        &textBehaviorReasoningSupport{Activations: []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED, runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM}, ContinuityCarrier: true, ContinuityKind: profile.ContinuityKind(), ContinuityVersion: 1},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "deepseek/chat/request/v5", RequestSerializer: profile.Serialize, MaterializationPlanner: profile.PlanMaterialization,
		NonStreamParserID: "deepseek/chat/response/v5", NonStreamParser: profile.Parse,
		StreamAssemblerID: "deepseek/chat/stream/v5", StreamAssembler: profile.Stream,
	}
	for _, reasoning := range []bool{false, true} {
		for _, ordered := range []bool{false, true} {
			registration.Support.Combinations = append(registration.Support.Combinations,
				textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, Modes: modes},
				textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, ToolUse: true, Modes: modes},
				textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, StructuredOutput: true, Modes: modes})
		}
	}
	return registration

}
