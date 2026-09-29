package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r123
// Only the exact Gemini 3.8 Flash target admits the first synchronous,
// text-only strict-schema behavior. Tool turns need thought-signature custody
// and are deliberately absent from this registration.
func gemini38FlashSchemaBehaviorRegistration() textBehaviorAdapterRegistration {
	return textBehaviorAdapterRegistration{
		AdapterID: "gemini.38-flash.chat-schema", Version: "1",
		ImplementationID: "gemini", DriverID: "nimillm", DriverDialect: "gemini",
		CloudTarget: &textBehaviorCloudTarget{Provider: "gemini", ProviderModelID: "gemini-3.8-flash"},
		Support: textBehaviorSupport{
			StructuredOutput: &textBehaviorStructuredOutputSupport{
				Kinds:                    []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA},
				SupportsStrictJSONSchema: true,
			},
			Combinations: []textBehaviorCombination{{StructuredOutput: true, Modes: []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC}}},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "gemini/38-flash/chat-schema/request/v1", RequestSerializer: capabilitydriver.Gemini38FlashSchemaRequestSerializer,
		NonStreamParserID: "gemini/38-flash/chat-schema/response/v1", NonStreamParser: capabilitydriver.Gemini38FlashSchemaNonStreamParser,
		StreamAssemblerID: "gemini/38-flash/chat-schema/stream/v1", StreamAssembler: capabilitydriver.Gemini38FlashSchemaStreamAssembler,
	}
}
