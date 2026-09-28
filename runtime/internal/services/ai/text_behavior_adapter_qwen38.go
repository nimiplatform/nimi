package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r119
func dashscopeQwen38FlashBehaviorRegistration() textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC}
	return textBehaviorAdapterRegistration{
		AdapterID: "dashscope.qwen38-flash.chat", Version: "1",
		ImplementationID: "dashscope", DriverID: "nimillm", DriverDialect: "dashscope",
		CloudTarget: &textBehaviorCloudTarget{Provider: "dashscope", ProviderModelID: "qwen3.8-flash"},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO},
				SingleCall:  true, ToolOnlyResponse: true, ToolResultRoundTrip: true,
			},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations:     []textBehaviorCombination{{ToolUse: true, Modes: modes}, {StructuredOutput: true, Modes: modes}},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "dashscope/qwen38-flash/chat/request/v1", RequestSerializer: capabilitydriver.DashscopeQwen38RequestSerializer,
		NonStreamParserID: "dashscope/qwen38-flash/chat/response/v1", NonStreamParser: capabilitydriver.DashscopeQwen38NonStreamParser,
		StreamAssemblerID: "dashscope/qwen38-flash/chat/stream/v1", StreamAssembler: capabilitydriver.DeepseekChatStreamAssembler,
	}
}
