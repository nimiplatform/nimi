package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.mimo-v26-tool-text
func mimoChatBehaviorRegistration(modelID, adapterID string) textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	return textBehaviorAdapterRegistration{
		AdapterID: adapterID, Version: "1",
		ImplementationID: "mimo", DriverID: "nimillm", DriverDialect: "mimo",
		CloudTarget: &textBehaviorCloudTarget{Provider: "mimo", ProviderModelID: modelID},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO},
				SingleCall:  true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true,
			},
			Combinations: []textBehaviorCombination{{ToolUse: true, Modes: modes}, {ToolUse: true, OrderedSystemMessages: true, Modes: modes}},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "mimo/chat-tools/request/v1", RequestSerializer: capabilitydriver.MimoChatRequestSerializer,
		NonStreamParserID: "mimo/chat-tools/response/v1", NonStreamParser: capabilitydriver.MimoChatNonStreamParser,
		StreamAssemblerID: "mimo/chat-tools/stream/v1", StreamAssembler: capabilitydriver.MimoChatStreamAssembler,
	}
}
