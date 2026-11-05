package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.dashscope-qwen38-omni
func qwen38OmniTextBehaviorRegistration() textBehaviorAdapterRegistration {
	profile := capabilitydriver.Qwen38OmniTextBehavior{}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	combinations := []textBehaviorCombination{}
	for _, reasoning := range []bool{false, true} {
		for _, ordered := range []bool{false, true} {
			combinations = append(combinations,
				textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, Modes: modes},
				textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, ToolUse: true, Modes: modes},
				textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, StructuredOutput: true, Modes: modes})
		}
	}
	return textBehaviorAdapterRegistration{
		AdapterID: "dashscope.qwen38-omni-flash.chat", Version: "1", ImplementationID: "dashscope", DriverID: "nimillm", DriverDialect: "dashscope",
		CloudTarget: &textBehaviorCloudTarget{Provider: "dashscope", ProviderModelID: capabilitydriver.Qwen38OmniModel},
		Support: textBehaviorSupport{
			ToolUse:          &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true},
			Reasoning:        &textBehaviorReasoningSupport{Activations: []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}, ContinuityCarrier: true, ContinuityKind: profile.ContinuityKind(), ContinuityVersion: 1},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}, Combinations: combinations,
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "dashscope/qwen38-omni-flash/chat/request/v1", RequestSerializer: profile.Serialize, MaterializationPlanner: profile.PlanMaterialization,
		NonStreamParserID: "dashscope/qwen38-omni-flash/chat/response/v1", NonStreamParser: profile.Parse,
		StreamAssemblerID: "dashscope/qwen38-omni-flash/chat/stream/v1", StreamAssembler: profile.Stream,
	}
}
