package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func qianfanTextBehaviorRegistration() textBehaviorAdapterRegistration {
	p := capabilitydriver.QianfanTextBehavior{}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	combinations := []textBehaviorCombination{}
	for _, tool := range []bool{false, true} {
		for _, structured := range []bool{false, true} {
			for _, ordered := range []bool{false, true} {
				if tool && structured {
					continue
				}
				combinations = append(combinations, textBehaviorCombination{ToolUse: tool, StructuredOutput: structured, OrderedSystemMessages: ordered, Modes: modes})
			}
		}
	}
	return textBehaviorAdapterRegistration{
		AdapterID: "qianfan.ernie-5.1.chat", Version: "1", ImplementationID: "qianfan", DriverID: "nimillm", DriverDialect: "qianfan", CloudTarget: &textBehaviorCloudTarget{Provider: "qianfan", ProviderModelID: "ernie-5.1"},
		Support:             textBehaviorSupport{ToolUse: &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true}, StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}, Combinations: combinations},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "qianfan/ernie-5.1/request/v1", RequestSerializer: p.Serialize, MaterializationPlanner: p.PlanMaterialization,
		NonStreamParserID: "qianfan/ernie-5.1/response/v1", NonStreamParser: p.Parse, StreamAssemblerID: "qianfan/ernie-5.1/stream/v1", StreamAssembler: p.Stream,
	}
}
