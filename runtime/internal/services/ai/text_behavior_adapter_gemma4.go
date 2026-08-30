package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

const (
	gemma4TextBehaviorAdapterID      = "llama.cpp.gemma4.text-behavior"
	gemma4TextBehaviorAdapterVersion = "1"
	gemma4TextRecipeID               = capabilitydriver.LlamaGemma4RecipeID
	gemma4TextRecipeRevision         = "1"
	gemma4TextDriverDialect          = capabilitydriver.LlamaDriverDialect
	gemma4E2BTemplateIdentity        = capabilitydriver.Gemma4E2BTemplateIdentity
	gemma426BTemplateIdentity        = capabilitydriver.Gemma426BTemplateIdentity
)

func productionTextBehaviorAdapterRegistrations() []textBehaviorAdapterRegistration {
	cohort := capabilitydriver.Gemma4BehaviorCohort()
	registrations := make([]textBehaviorAdapterRegistration, 0, len(cohort))
	for _, entry := range cohort {
		registrations = append(registrations, gemma4TextBehaviorRegistration(entry))
	}
	return registrations
}

func gemma4TextBehaviorRegistration(entry capabilitydriver.Gemma4BehaviorCohortEntry) textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
	}
	toolProjection := capabilitydriver.Gemma4ToolUseCapabilityProjection()
	return textBehaviorAdapterRegistration{
		AdapterID: gemma4TextBehaviorAdapterID, Version: gemma4TextBehaviorAdapterVersion,
		ImplementationID: "local.text.generate.llama-cpp", DriverID: "nimi.runtime.driver.llama-cpp",
		DriverDialect: gemma4TextDriverDialect,
		LocalTarget: &textBehaviorLocalTarget{
			RecipeID: gemma4TextRecipeID, RecipeRevision: gemma4TextRecipeRevision,
			ModelContents: []textBehaviorModelContent{{
				SlotID: "main.gguf", ContentID: entry.ContentID, EntrySHA256: entry.EntrySHA256,
			}},
		},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:   append([]runtimev1.ToolSpecKind(nil), toolProjection.GetSupportedToolSpecKinds()...),
				ChoiceModes: append([]runtimev1.ToolChoiceMode(nil), toolProjection.GetSupportedToolChoiceModes()...),
				SingleCall:  toolProjection.GetSupportsSingleCall(), MultipleCalls: toolProjection.GetSupportsMultipleCalls(),
				ParallelCalls: toolProjection.GetSupportsParallelCalls(), ToolOnlyResponse: toolProjection.GetSupportsToolOnlyResponse(),
				MixedTextAndCall: toolProjection.GetSupportsMixedTextAndToolCalls(), ToolResultRoundTrip: toolProjection.GetSupportsToolResultRoundTrip(),
			},
			Reasoning: &textBehaviorReasoningSupport{
				Activations: []runtimev1.ReasoningActivation{
					runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE,
					runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
				},
				Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN},
				ExactBudget:   true,
			},
			StructuredOutput: &textBehaviorStructuredOutputSupport{
				Kinds: []runtimev1.ResponseFormatKind{
					runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT,
					runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA,
				},
				SupportsStrictJSONSchema: true,
			},
			Combinations: []textBehaviorCombination{
				{ToolUse: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
				{Reasoning: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
				{StructuredOutput: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
			},
		},
		ExecutionSemantics: textBehaviorExecutionSemantics{
			RequiredTemplateIdentity: entry.TemplateIdentity,
			ProcessIdentityImpact:    textBehaviorProcessIdentityAdapterAndTemplate,
		},
		RequestSerializerID: "llama.cpp/gemma4/openai-chat/request/v1",
		RequestSerializer:   capabilitydriver.Gemma4TextBehaviorRequestSerializer,
		NonStreamParserID:   "llama.cpp/gemma4/openai-chat/nonstream/v1",
		NonStreamParser:     capabilitydriver.Gemma4TextBehaviorNonStreamParser,
		StreamAssemblerID:   "llama.cpp/gemma4/openai-chat/stream/v1",
		StreamAssembler:     capabilitydriver.Gemma4TextBehaviorStreamAssembler,
	}
}
