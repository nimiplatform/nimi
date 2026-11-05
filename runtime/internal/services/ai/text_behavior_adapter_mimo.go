package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.mimo-v26-tool-text
func mimoChatBehaviorRegistration(modelID, adapterID string) textBehaviorAdapterRegistration {
	profile, err := capabilitydriver.NewMimoTextBehavior(modelID)
	if err != nil {
		panic("invalid reviewed MiMo registration")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	combinations := []textBehaviorCombination{}
	for _, reasoning := range []bool{false, true} {
		for _, ordered := range []bool{false, true} {
			combinations = append(combinations,
				textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, Modes: modes},
				textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, ToolUse: true, Modes: modes},
				textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, StructuredOutput: true, Modes: modes})
		}
	}
	return textBehaviorAdapterRegistration{
		AdapterID: adapterID, Version: "2",
		ImplementationID: "mimo", DriverID: "nimillm", DriverDialect: "mimo",
		CloudTarget: &textBehaviorCloudTarget{Provider: "mimo", ProviderModelID: modelID},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO},
				SingleCall:  true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true,
			},
			Reasoning:        &textBehaviorReasoningSupport{Activations: []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}, ContinuityCarrier: true, ContinuityKind: profile.ContinuityKind(), ContinuityVersion: 1},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}},
			Combinations:     combinations,
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "mimo/" + modelID + "/request/v2", RequestSerializer: profile.Serialize, MaterializationPlanner: profile.PlanMaterialization,
		NonStreamParserID: "mimo/" + modelID + "/response/v2", NonStreamParser: profile.Parse,
		StreamAssemblerID: "mimo/" + modelID + "/stream/v2", StreamAssembler: profile.Stream,
	}
}
