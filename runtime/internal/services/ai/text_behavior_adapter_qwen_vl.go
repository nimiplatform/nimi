package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.dashscope-qwen3-vl-plus-ordered-text
func dashscopeQwenVLPlusBehaviorRegistration() textBehaviorAdapterRegistration {
	return textBehaviorAdapterRegistration{
		AdapterID: "dashscope.qwen3-vl-plus.ordered-text", Version: "1",
		ImplementationID: "dashscope", DriverID: "nimillm", DriverDialect: "dashscope",
		CloudTarget: &textBehaviorCloudTarget{Provider: "dashscope", ProviderModelID: "qwen3-vl-plus"},
		Support: textBehaviorSupport{
			Reasoning: &textBehaviorReasoningSupport{
				Activations:   []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED},
				Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN},
			},
			Combinations: []textBehaviorCombination{{OrderedSystemMessages: true, Modes: []runtimev1.ExecutionMode{
				runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
			}}},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "dashscope/qwen3-vl-plus/ordered-text/request/v1", RequestSerializer: capabilitydriver.DashscopeQwenVLRequestSerializer,
		NonStreamParserID: "dashscope/qwen3-vl-plus/ordered-text/response/v1", NonStreamParser: capabilitydriver.DashscopeQwenVLNonStreamParser,
		StreamAssemblerID: "dashscope/qwen3-vl-plus/ordered-text/stream/v1", StreamAssembler: capabilitydriver.DashscopeQwenVLStreamAssembler,
	}
}
