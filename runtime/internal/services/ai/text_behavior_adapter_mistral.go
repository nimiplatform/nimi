package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.mistral-native-text
func mistralTextBehaviorRegistration(model string) textBehaviorAdapterRegistration {
	profile, err := capabilitydriver.NewMistralTextBehavior(model)
	if err != nil {
		panic("invalid reviewed Mistral registration")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	combinations := []textBehaviorCombination{}
	for _, reasoning := range []bool{false, true} {
		for _, ordered := range []bool{false, true} {
			combinations = append(combinations, textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, Modes: modes}, textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, ToolUse: true, Modes: modes}, textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, StructuredOutput: true, Modes: modes})
		}
	}
	activations := []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
	efforts := []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}
	if model == "mistral-large-4" || model == "mistral-large-4-0" {
		efforts = append(efforts, runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT)
	} else {
		activations = append(activations, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED)
	}
	return textBehaviorAdapterRegistration{
		AdapterID: "mistral." + model + ".chat", Version: "1", ImplementationID: "mistral", DriverID: "nimillm", DriverDialect: "mistral",
		CloudTarget: &textBehaviorCloudTarget{Provider: "mistral", ProviderModelID: model},
		Support: textBehaviorSupport{
			ToolUse:          &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true},
			Reasoning:        &textBehaviorReasoningSupport{Activations: activations, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: efforts, ContinuityCarrier: true, ContinuityKind: profile.ContinuityKind(), ContinuityVersion: 1},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true}, Combinations: combinations,
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "mistral/" + model + "/request/v1", RequestSerializer: profile.Serialize, MaterializationPlanner: profile.PlanMaterialization,
		NonStreamParserID: "mistral/" + model + "/response/v1", NonStreamParser: profile.Parse,
		StreamAssemblerID: "mistral/" + model + "/stream/v1", StreamAssembler: profile.Stream,
	}
}
