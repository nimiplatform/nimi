package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r120
func qwen35Q4TextBehaviorRegistration() textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC}
	toolProjection := capabilitydriver.Qwen35ToolUseCapabilityProjection()
	return textBehaviorAdapterRegistration{
		AdapterID: "llama.cpp.qwen35-4b.text-behavior", Version: "1",
		ImplementationID: capabilitydriver.LlamaImplementationID,
		DriverID:         capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaDriverDialect,
		LocalTarget: &textBehaviorLocalTarget{
			RecipeID: capabilitydriver.LlamaQwen35RecipeID, RecipeRevision: "1",
			ModelContents: []textBehaviorModelContent{{
				SlotID:    capabilitydriver.MainGGUFRequirementID,
				ContentID: capabilitydriver.Qwen35Q4ContentID, EntrySHA256: capabilitydriver.Qwen35Q4EntrySHA256,
			}},
		},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   append([]runtimev1.ToolSpecKind(nil), toolProjection.GetSupportedToolSpecKinds()...),
				ChoiceModes: append([]runtimev1.ToolChoiceMode(nil), toolProjection.GetSupportedToolChoiceModes()...),
				SingleCall:  true, ToolOnlyResponse: true, ToolResultRoundTrip: true,
			},
			StructuredOutput: &textBehaviorStructuredOutputSupport{
				Kinds:                    []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA},
				SupportsStrictJSONSchema: true,
			},
			Combinations: []textBehaviorCombination{
				{ToolUse: true, Modes: modes},
				{StructuredOutput: true, Modes: modes},
			},
		},
		ExecutionSemantics: textBehaviorExecutionSemantics{
			RequiredTemplateIdentity: capabilitydriver.Qwen35Q4TemplateIdentity,
			ProcessIdentityImpact:    textBehaviorProcessIdentityAdapterAndTemplate,
		},
		RequestSerializerID: "llama.cpp/qwen35-4b/openai-chat/request/v1",
		RequestSerializer:   capabilitydriver.Qwen35TextBehaviorRequestSerializer,
		NonStreamParserID:   "llama.cpp/qwen35-4b/openai-chat/nonstream/v1",
		NonStreamParser:     capabilitydriver.Qwen35TextBehaviorNonStreamParser,
		StreamAssemblerID:   "llama.cpp/qwen35-4b/openai-chat/stream-unsupported/v1",
		StreamAssembler:     capabilitydriver.Qwen35TextBehaviorStreamAssembler,
	}
}
