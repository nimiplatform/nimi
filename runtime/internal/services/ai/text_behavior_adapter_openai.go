package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.openai-responses-text-behaviors
// openAIResponsesTextBehaviorRegistration binds one reviewed standard OpenAI
// target to the stateless Responses adapter, so every text step for it,
// including plain text, uses one protocol. Each registered step may return the
// encrypted reasoning items the adapter requests and may replay its own
// carriers in the same mode; this is continuity only, with no reasoning
// activation, effort or presentation control.
func openAIResponsesTextBehaviorRegistration(modelID string) textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	return textBehaviorAdapterRegistration{
		AdapterID: "openai." + modelID + ".responses", Version: "1",
		ImplementationID: "openai", DriverID: "nimillm", DriverDialect: "openai",
		CloudTarget: &textBehaviorCloudTarget{Provider: "openai", ProviderModelID: modelID},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{
					runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE,
					runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL,
				},
				SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true,
			},
			Reasoning:        &textBehaviorReasoningSupport{OpaqueContinuityCarrier: true},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations: []textBehaviorCombination{
				{Modes: modes}, {Reasoning: true, Modes: modes},
				{ToolUse: true, Modes: modes}, {ToolUse: true, Reasoning: true, Modes: modes},
				{StructuredOutput: true, Modes: modes}, {StructuredOutput: true, Reasoning: true, Modes: modes},
			},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "openai/responses/request/v1", RequestSerializer: capabilitydriver.OpenAIResponsesTextBehaviorRequestSerializer,
		NonStreamParserID: "openai/responses/nonstream/v1", NonStreamParser: capabilitydriver.OpenAIResponsesTextBehaviorNonStreamParser,
		StreamAssemblerID: "openai/responses/stream/v1", StreamAssembler: capabilitydriver.OpenAIResponsesTextBehaviorStreamAssembler,
	}
}

// openAIResponsesReviewedTextTargets are the exact standard OpenAI catalog
// rows admitted to the Responses adapter.
var openAIResponsesReviewedTextTargets = []string{"gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"}
