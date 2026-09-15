package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.deepseek-v4-json-output
func deepseekJSONBehaviorRegistration(modelID, adapterID string) textBehaviorAdapterRegistration {
	return textBehaviorAdapterRegistration{
		AdapterID: adapterID, Version: "1",
		ImplementationID: "deepseek", DriverID: "nimillm", DriverDialect: "deepseek",
		CloudTarget: &textBehaviorCloudTarget{Provider: "deepseek", ProviderModelID: modelID},
		Support: textBehaviorSupport{
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}},
			Combinations:     []textBehaviorCombination{{StructuredOutput: true, Modes: []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}}},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "deepseek/chat-json/request/v1", RequestSerializer: capabilitydriver.DeepseekJSONRequestSerializer,
		NonStreamParserID: "deepseek/chat-json/response/v1", NonStreamParser: capabilitydriver.DeepseekJSONNonStreamParser,
		StreamAssemblerID: "deepseek/chat-json/stream/v1", StreamAssembler: capabilitydriver.DeepseekJSONStreamAssembler,
	}
}
