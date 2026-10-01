package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.chatgpt-plan-text-behaviors
// chatGPTPlanTextBehaviorRegistration binds one reviewed ChatGPT-plan target to
// the stateless public Responses adapter. Every text step, including plain
// text, uses the same stream-only hooks; no primitive protocol fallback exists.
// Registered steps are plain text in both modes, and synchronous
// function-tool round trips and strict JSON Schema. Every step may return the
// encrypted reasoning items the adapter requests, so each registered step also
// admits replaying its own opaque continuity carriers in the same mode. This is
// continuity only: no reasoning activation, effort or presentation control is
// admitted, and streamed tool or schema steps stay unregistered.
func chatGPTPlanTextBehaviorRegistration(modelID string) textBehaviorAdapterRegistration {
	sync := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC}
	syncAndStream := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	return textBehaviorAdapterRegistration{
		AdapterID: "openai_chatgpt_plan." + modelID + ".responses", Version: "1",
		ImplementationID: "openai_chatgpt_plan", DriverID: "nimillm", DriverDialect: "openai_chatgpt_plan",
		CloudTarget: &textBehaviorCloudTarget{Provider: "openai_chatgpt_plan", ProviderModelID: modelID},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED},
				SingleCall:  true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true,
			},
			Reasoning:        &textBehaviorReasoningSupport{OpaqueContinuityCarrier: true, ContinuityKind: capabilitydriver.ChatGPTPlanContinuityKind, ContinuityVersion: 1},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations: []textBehaviorCombination{
				{Modes: syncAndStream}, {Reasoning: true, Modes: syncAndStream},
				{ToolUse: true, Modes: sync}, {ToolUse: true, Reasoning: true, Modes: sync},
				{StructuredOutput: true, Modes: sync}, {StructuredOutput: true, Reasoning: true, Modes: sync},
			},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "openai_chatgpt_plan/responses/request/v1", RequestSerializer: capabilitydriver.ChatGPTPlanTextBehaviorRequestSerializer,
		NonStreamParserID: "openai_chatgpt_plan/responses/nonstream/v1", NonStreamParser: capabilitydriver.ChatGPTPlanTextBehaviorNonStreamParser,
		StreamAssemblerID: "openai_chatgpt_plan/responses/stream/v1", StreamAssembler: capabilitydriver.ChatGPTPlanTextBehaviorStreamAssembler,
	}
}

// chatGPTPlanReviewedTextTargets are the exact catalog rows admitted for the
// ChatGPT-plan text cohort. Account availability is checked separately.
var chatGPTPlanReviewedTextTargets = []string{"gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"}
