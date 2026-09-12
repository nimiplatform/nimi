package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.anthropic-sonnet46-text-behaviors
func anthropicSonnet46TextBehaviorRegistration() textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	return textBehaviorAdapterRegistration{
		AdapterID: "anthropic.sonnet46.messages", Version: "1",
		ImplementationID: "anthropic", DriverID: "nimillm", DriverDialect: "anthropic",
		CloudTarget: &textBehaviorCloudTarget{Provider: "anthropic", ProviderModelID: "claude-sonnet-4-6"},
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
