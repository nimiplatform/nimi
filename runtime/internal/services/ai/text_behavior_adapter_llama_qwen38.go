package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r120
func qwen38Q4TextBehaviorRegistration() textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB}
	tools := capabilitydriver.LlamaFunctionToolUseCapabilityProjection()
	return textBehaviorAdapterRegistration{
		AdapterID: "llama.cpp.qwen38-27b.text-behavior", Version: "1",
		ImplementationID: capabilitydriver.LlamaImplementationID, DriverID: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaDriverDialect,
		LocalTarget: &textBehaviorLocalTarget{RecipeID: capabilitydriver.LlamaQwen38RecipeID, RecipeRevision: "1", ModelContents: []textBehaviorModelContent{{SlotID: capabilitydriver.MainGGUFRequirementID, ContentID: capabilitydriver.Qwen38Q4ContentID, EntrySHA256: strings.TrimPrefix(capabilitydriver.Qwen38Q4ContentID, "sha256:")}}},
		Support: textBehaviorSupport{
			ToolUse:          &textBehaviorToolUseSupport{SpecKinds: tools.GetSupportedToolSpecKinds(), ChoiceModes: tools.GetSupportedToolChoiceModes(), SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true},
			Reasoning:        &textBehaviorReasoningSupport{Activations: []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED, runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH}, ExactBudget: true},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations:     []textBehaviorCombination{{ToolUse: true, Modes: modes}, {Reasoning: true, Modes: modes}, {StructuredOutput: true, Modes: modes}, {Reasoning: true, StructuredOutput: true, Modes: modes}},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{RequiredTemplateIdentity: capabilitydriver.Qwen38Q4TemplateIdentity, ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "llama.cpp/qwen38-27b/openai-chat/request/v1", RequestSerializer: capabilitydriver.Qwen38TextBehaviorRequestSerializer,
		NonStreamParserID: "llama.cpp/qwen38-27b/openai-chat/nonstream/v1", NonStreamParser: capabilitydriver.Gemma4TextBehaviorNonStreamParser,
		StreamAssemblerID: "llama.cpp/qwen38-27b/openai-chat/stream/v1", StreamAssembler: capabilitydriver.Gemma4TextBehaviorStreamAssembler,
	}
}
