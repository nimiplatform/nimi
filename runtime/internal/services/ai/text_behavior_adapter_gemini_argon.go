package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-argon-text-behaviors
func geminiArgonBehaviorRegistration() textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	return textBehaviorAdapterRegistration{
		AdapterID: "gemini.argon.interactions", Version: "2",
		ImplementationID: "gemini", DriverID: "nimillm", DriverDialect: "gemini",
		CloudTarget: &textBehaviorCloudTarget{Provider: "gemini", ProviderModelID: "gemini-4-argon"},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL},
				SingleCall:  true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true,
			},
			Reasoning: &textBehaviorReasoningSupport{
				Activations:       []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE},
				Presentations:     []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN, runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY},
				SummaryTranscript: true,
				Efforts:           []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT},
				ContinuityCarrier: true, ContinuityKind: capabilitydriver.GeminiArgonThoughtKind, ContinuityVersion: 1,
			},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations: []textBehaviorCombination{
				{Modes: modes}, {Reasoning: true, Modes: modes},
				{ToolUse: true, Modes: modes}, {ToolUse: true, Reasoning: true, Modes: modes},
				{StructuredOutput: true, Modes: modes}, {StructuredOutput: true, Reasoning: true, Modes: modes},
			},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "gemini/argon/interactions/request/v2", RequestSerializer: capabilitydriver.GeminiArgonRequestSerializer,
		MaterializationPlanner: capabilitydriver.GeminiArgonPlanMaterialization,
		NonStreamParserID:      "gemini/argon/interactions/response/v2", NonStreamParser: capabilitydriver.GeminiArgonNonStreamParser,
		StreamAssemblerID: "gemini/argon/interactions/stream/v2", StreamAssembler: capabilitydriver.GeminiArgonStreamAssembler,
	}
}
