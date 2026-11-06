package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

var azureResponsesReviewedTextTargets = []string{"gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"}

// @nimi-authority: rule.nimi.runtime.ai-provider.azure-current-responses
func azureResponsesTextBehaviorRegistration(model string) textBehaviorAdapterRegistration {
	p, err := capabilitydriver.NewAzureResponsesTextBehavior(model)
	if err != nil {
		panic("invalid reviewed Azure registration")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	activations := []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
	if model == "gpt-6-luna" || model == "gpt-6.1-terra" {
		activations = append(activations, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED)
	}
	return textBehaviorAdapterRegistration{
		AdapterID: "azure." + model + ".responses", Version: "1", ImplementationID: "azure", DriverID: "nimillm", DriverDialect: "azure",
		CloudTarget: &textBehaviorCloudTarget{Provider: "azure", ProviderModelID: model},
		Support: textBehaviorSupport{
			ToolUse:          &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true},
			Reasoning:        &textBehaviorReasoningSupport{Activations: activations, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN, runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}, Efforts: []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM}, SummaryTranscript: true, ContinuityCarrier: true, ContinuityKind: p.ContinuityKind(), ContinuityVersion: 1},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations:     []textBehaviorCombination{{Modes: modes}, {Reasoning: true, Modes: modes}, {ToolUse: true, Modes: modes}, {ToolUse: true, Reasoning: true, Modes: modes}, {StructuredOutput: true, Modes: modes}, {StructuredOutput: true, Reasoning: true, Modes: modes}},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "azure/" + model + "/request/v1", RequestSerializer: p.Serialize,
		NonStreamParserID: "azure/" + model + "/nonstream/v1", NonStreamParser: p.Parse,
		StreamAssemblerID: "azure/" + model + "/stream/v1", StreamAssembler: p.Stream,
	}
}
