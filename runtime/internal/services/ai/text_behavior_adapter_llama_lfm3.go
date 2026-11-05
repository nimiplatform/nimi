package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r120
func lfm3Q4TextBehaviorRegistration() textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB}
	tools := capabilitydriver.LlamaFunctionToolUseCapabilityProjection()
	return textBehaviorAdapterRegistration{
		AdapterID: "llama.cpp.lfm3-1.7b.text-behavior", Version: "1",
		ImplementationID: capabilitydriver.LlamaImplementationID, DriverID: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaDriverDialect,
		LocalTarget: &textBehaviorLocalTarget{RecipeID: capabilitydriver.LlamaLFM3RecipeID, RecipeRevision: "1", ModelContents: []textBehaviorModelContent{{SlotID: capabilitydriver.MainGGUFRequirementID, ContentID: capabilitydriver.LFM3Q4ContentID, EntrySHA256: strings.TrimPrefix(capabilitydriver.LFM3Q4ContentID, "sha256:")}}},
		Support: textBehaviorSupport{
			ToolUse:          &textBehaviorToolUseSupport{SpecKinds: tools.GetSupportedToolSpecKinds(), ChoiceModes: tools.GetSupportedToolChoiceModes(), SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true},
			Reasoning:        &textBehaviorReasoningSupport{Activations: []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED, runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, ExactBudget: true},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations:     []textBehaviorCombination{{ToolUse: true, Modes: modes}, {Reasoning: true, Modes: modes}, {StructuredOutput: true, Modes: modes}, {Reasoning: true, StructuredOutput: true, Modes: modes}},
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{RequiredTemplateIdentity: capabilitydriver.LFM3Q4TemplateIdentity, ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "llama.cpp/lfm3-1.7b/openai-chat/request/v1", RequestSerializer: capabilitydriver.Gemma4TextBehaviorRequestSerializer,
		NonStreamParserID: "llama.cpp/lfm3-1.7b/openai-chat/nonstream/v1", NonStreamParser: capabilitydriver.Gemma4TextBehaviorNonStreamParser,
		StreamAssemblerID: "llama.cpp/lfm3-1.7b/openai-chat/stream/v1", StreamAssembler: capabilitydriver.Gemma4TextBehaviorStreamAssembler,
	}
}
