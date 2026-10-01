package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r123
// Only the exact Gemini 3.8 Flash target admits these synchronous text cells.
// Tool turns carry the provider's signature in the bounded opaque transcript.
func gemini38FlashSchemaBehaviorRegistration() textBehaviorAdapterRegistration {
	return textBehaviorAdapterRegistration{
		AdapterID: "gemini.38-flash.chat", Version: "2",
		ImplementationID: "gemini", DriverID: "nimillm", DriverDialect: "gemini",
		CloudTarget: &textBehaviorCloudTarget{Provider: "gemini", ProviderModelID: "gemini-3.8-flash"},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
				ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO},
				SingleCall:  true, ToolOnlyResponse: true, ToolResultRoundTrip: true,
			},
			Reasoning: &textBehaviorReasoningSupport{OpaqueContinuityCarrier: true, ContinuityKind: capabilitydriver.Gemini38ToolSignatureKind, ContinuityVersion: 1},
			StructuredOutput: &textBehaviorStructuredOutputSupport{
				Kinds:                    []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA},
				SupportsStrictJSONSchema: true,
			},
			Combinations: []textBehaviorCombination{
				{ToolUse: true, Modes: []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC}},
				{ToolUse: true, Reasoning: true, Modes: []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC}},
				{StructuredOutput: true, Modes: []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC}},
			},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "gemini/38-flash/chat/request/v2", RequestSerializer: capabilitydriver.Gemini38FlashRequestSerializer,
		NonStreamParserID: "gemini/38-flash/chat/response/v2", NonStreamParser: capabilitydriver.Gemini38FlashNonStreamParser,
		StreamAssemblerID: "gemini/38-flash/chat/stream/v2", StreamAssembler: capabilitydriver.Gemini38FlashSchemaStreamAssembler,
	}
}
