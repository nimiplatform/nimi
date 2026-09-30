package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.anthropic-messages-text-behaviors
// anthropicLegacyTextBehaviorRegistration binds a reviewed Claude target whose
// thinking stays off unless requested: tool use with every choice mode and
// strict JSON Schema, while plain text keeps the base Messages protocol.
func anthropicLegacyTextBehaviorRegistration(modelID string, adapterID string) textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	return textBehaviorAdapterRegistration{
		AdapterID: adapterID, Version: "1",
		ImplementationID: "anthropic", DriverID: "nimillm", DriverDialect: "anthropic",
		CloudTarget: &textBehaviorCloudTarget{Provider: "anthropic", ProviderModelID: modelID},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL},
				SingleCall:  true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true,
			},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations:     []textBehaviorCombination{{ToolUse: true, Modes: modes}, {StructuredOutput: true, Modes: modes}},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "anthropic/messages/request/v1", RequestSerializer: capabilitydriver.AnthropicTextBehaviorRequestSerializer,
		NonStreamParserID: "anthropic/messages/nonstream/v1", NonStreamParser: capabilitydriver.AnthropicTextBehaviorNonStreamParser,
		StreamAssemblerID: "anthropic/messages/stream/v1", StreamAssembler: capabilitydriver.AnthropicTextBehaviorStreamAssembler,
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.anthropic-messages-text-behaviors
// anthropicAdaptiveTextBehaviorRegistration binds a reviewed Claude target
// that always thinks adaptively. Every text step for it, plain text included,
// uses the adaptive Messages hooks: thinking stays omitted and each signed
// block returns as an opaque continuity carrier replayed verbatim. These
// models refuse forced tool use, so only auto and none are admitted.
func anthropicAdaptiveTextBehaviorRegistration(modelID string) textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	return textBehaviorAdapterRegistration{
		AdapterID: "anthropic." + modelID + ".messages", Version: "1",
		ImplementationID: "anthropic", DriverID: "nimillm", DriverDialect: "anthropic",
		CloudTarget: &textBehaviorCloudTarget{Provider: "anthropic", ProviderModelID: modelID},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE},
				SingleCall:  true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true,
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
		RequestSerializerID: "anthropic/messages-adaptive/request/v1", RequestSerializer: capabilitydriver.AnthropicAdaptiveTextBehaviorRequestSerializer,
		NonStreamParserID: "anthropic/messages-adaptive/nonstream/v1", NonStreamParser: capabilitydriver.AnthropicAdaptiveTextBehaviorNonStreamParser,
		StreamAssemblerID: "anthropic/messages-adaptive/stream/v1", StreamAssembler: capabilitydriver.AnthropicAdaptiveTextBehaviorStreamAssembler,
	}
}

// anthropicAdaptiveReviewedTextTargets are the exact current Claude catalog
// rows that always think adaptively.
var anthropicAdaptiveReviewedTextTargets = []string{"claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"}

func anthropicTextBehaviorRegistrations() []textBehaviorAdapterRegistration {
	registrations := []textBehaviorAdapterRegistration{
		anthropicLegacyTextBehaviorRegistration("claude-sonnet-4-6", "anthropic.sonnet46.messages"),
		anthropicLegacyTextBehaviorRegistration("claude-haiku-4-5", "anthropic.haiku45.messages"),
	}
	for _, modelID := range anthropicAdaptiveReviewedTextTargets {
		registrations = append(registrations, anthropicAdaptiveTextBehaviorRegistration(modelID))
	}
	return registrations
}
