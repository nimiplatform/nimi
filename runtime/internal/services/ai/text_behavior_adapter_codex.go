package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.codex-text-behaviors
func codexTextBehaviorRegistration(modelID, adapterID string) textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	return textBehaviorAdapterRegistration{
		AdapterID: adapterID, Version: "1",
		ImplementationID: "openai_codex", DriverID: "nimillm", DriverDialect: "openai_codex",
		CloudTarget: &textBehaviorCloudTarget{Provider: "openai_codex", ProviderModelID: modelID},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL},
				SingleCall:  true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true,
			},
			Reasoning:        &textBehaviorReasoningSupport{OpaqueContinuityCarrier: true},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations: []textBehaviorCombination{
				{Modes: modes},
				{ToolUse: true, Modes: modes}, {StructuredOutput: true, Modes: modes}, {Reasoning: true, Modes: modes},
				{ToolUse: true, Reasoning: true, Modes: modes}, {StructuredOutput: true, Reasoning: true, Modes: modes},
			},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "openai_codex/responses/request/v1", RequestSerializer: capabilitydriver.CodexTextBehaviorRequestSerializer,
		NonStreamParserID: "openai_codex/responses/nonstream/v1", NonStreamParser: capabilitydriver.CodexTextBehaviorNonStreamParser,
		StreamAssemblerID: "openai_codex/responses/stream/v1", StreamAssembler: capabilitydriver.CodexTextBehaviorStreamAssembler,
	}
}
