package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.deepseek-v4-json-output
func deepseekChatBehaviorRegistration(modelID, adapterID string) textBehaviorAdapterRegistration {
	return textBehaviorAdapterRegistration{
		AdapterID: adapterID, Version: "2",
		ImplementationID: "deepseek", DriverID: "nimillm", DriverDialect: "deepseek",
		CloudTarget: &textBehaviorCloudTarget{Provider: "deepseek", ProviderModelID: modelID},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL},
				SingleCall:  true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true,
			},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}},
			Combinations:     []textBehaviorCombination{{ToolUse: true, Modes: []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}}, {StructuredOutput: true, Modes: []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}}},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "deepseek/chat/request/v2", RequestSerializer: capabilitydriver.DeepseekChatRequestSerializer,
		NonStreamParserID: "deepseek/chat/response/v2", NonStreamParser: capabilitydriver.DeepseekChatNonStreamParser,
		StreamAssemblerID: "deepseek/chat/stream/v2", StreamAssembler: capabilitydriver.DeepseekChatStreamAssembler,
	}
}
