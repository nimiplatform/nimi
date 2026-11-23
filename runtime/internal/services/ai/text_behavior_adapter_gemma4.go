package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

const (
	gemma4TextBehaviorAdapterID      = "llama.cpp.gemma4.text-behavior"
	gemma4TextBehaviorAdapterVersion = "3"
	llamaGenericTextRecipeID         = capabilitydriver.LlamaGenericGGUFRecipeID
	llamaTextRecipeRevision          = "1"
	llamaTextDriverDialect           = capabilitydriver.LlamaDriverDialect
	gemma4E2BTemplateIdentity        = capabilitydriver.Gemma4E2BTemplateIdentity
	gemma426BTemplateIdentity        = capabilitydriver.Gemma426BTemplateIdentity
)

// @nimi-authority: rule.nimi.runtime.local-compute.r112
// @nimi-authority: rule.nimi.runtime.ai-provider.r120
func productionTextBehaviorAdapterRegistrations() []textBehaviorAdapterRegistration {
	registrations := []textBehaviorAdapterRegistration{
		// Tier 1 (LlamaGenericGGUFRecipeID): verified narrow protocol cohorts matched
		// by effective template identity (default + tokenizer.chat_template.* variants),
		// without per-sample weight SHA-256 whitelists.
		gemma4TemplateTextBehaviorRegistration("llama.cpp.gemma4-e2b.text-behavior", gemma4TextBehaviorAdapterVersion, gemma4E2BTemplateIdentity, true),
		gemma4TemplateTextBehaviorRegistration("llama.cpp.gemma4-26b.text-behavior", gemma4TextBehaviorAdapterVersion, gemma426BTemplateIdentity, false),
		qwen35TemplateTextBehaviorRegistration(),
		qwen38TemplateTextBehaviorRegistration(),
		lfm3TemplateTextBehaviorRegistration(),
		// Tier 2 (LlamaGenericGGUFRecipeID): mutually exclusive unknown non-empty
		// chat templates (or known templates on a different architecture) admit
		// Structured Output (json_object / json_schema) only. Tool Use, Reasoning,
		// and explicit REASONING_ACTIVATION_DISABLED stay unavailable.
		llamaUnknownTemplateStructuredOutputRegistration(
			"llama.cpp.gguf.structured-output",
			llamaGenericTextRecipeID,
			capabilitydriver.KnownStandardLlamaTemplateCohorts(),
		),
		// Tier 1 & Tier 2 (LlamaGemma412BRecipeID): unified multimodal recipe.
		gemma412BTextBehaviorRegistration(),
		llamaUnknownTemplateStructuredOutputRegistration(
			"llama.cpp.gemma4-12b-unified.structured-output",
			capabilitydriver.LlamaGemma412BRecipeID,
			[]capabilitydriver.KnownLlamaTemplateCohort{{
				TemplateIdentity:  capabilitydriver.Gemma412BTemplateIdentity,
				Architectures:     []string{"gemma4"},
				TokenizerProtocol: capabilitydriver.LlamaTokenizerProtocolGemma4,
			}},
		),
	}
	registrations = append(registrations, anthropicTextBehaviorRegistrations()...)
	registrations = append(registrations, dashscopeQwen38FlashBehaviorRegistration())
	registrations = append(registrations, dashscopeQwen38Max0902BehaviorRegistration())
	registrations = append(registrations, qwen38OmniTextBehaviorRegistration())
	registrations = append(registrations, dashscopeQwenVLPlusBehaviorRegistration())
	registrations = append(registrations, gemini38FlashSchemaBehaviorRegistration())
	registrations = append(registrations, geminiArgonBehaviorRegistration())
	registrations = append(registrations, miniMaxMessagesRegistration("MiniMax-M3.1-Flash"), miniMaxMessagesRegistration("MiniMax-M3"))
	for _, model := range []string{"mistral-large-4", "mistral-large-4-0", "mistral-small-2603"} {
		registrations = append(registrations, mistralTextBehaviorRegistration(model))
	}
	for _, model := range []string{"step-5-preview", "step-3.7-flash", "step-3.5-flash-2603"} {
		registrations = append(registrations, stepfunTextBehaviorRegistration(model))
	}
	for _, model := range []string{"glm-5.3", "glm-5.3-flash", "glm-5.3-flashx", "glm-5.3-flashx-legal"} {
		registrations = append(registrations, glm53TextBehaviorRegistration(model))
	}
	registrations = append(registrations,
		mimoChatBehaviorRegistration("mimo-v2.6-flash", "mimo.v26-flash.chat-tools"),
		mimoChatBehaviorRegistration("mimo-v2.6-pro", "mimo.v26-pro.chat-tools"),
		deepseekChatBehaviorRegistration("deepseek-flash", "deepseek.flash.chat"),
		deepseekChatBehaviorRegistration("deepseek-v4-flash", "deepseek.v4-flash.chat"),
		deepseekChatBehaviorRegistration("deepseek-v4-pro", "deepseek.v4-pro.chat"),
	)
	for _, modelID := range chatGPTPlanReviewedTextTargets {
		registrations = append(registrations, chatGPTPlanTextBehaviorRegistration(modelID))
	}
	for _, modelID := range openAIResponsesReviewedTextTargets {
		registrations = append(registrations, openAIResponsesTextBehaviorRegistration(modelID))
	}
	for _, modelID := range azureResponsesReviewedTextTargets {
		registrations = append(registrations, azureResponsesTextBehaviorRegistration(modelID))
	}
	registrations = append(registrations, bedrockTextBehaviorRegistrations()...)
	registrations = append(registrations, xaiGrok47TextBehaviorRegistration())
	for _, model := range []string{"kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k3"} {
		registrations = append(registrations, kimiK3TextBehaviorRegistration(model))
	}
	for _, model := range []string{"openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "meta-models/muse-spark-open", "minimaxai/minimax-m2.7"} {
		registrations = append(registrations, groqTextBehaviorRegistration(model))
	}
	for _, model := range capabilitydriver.PerplexityTextModels() {
		registrations = append(registrations, perplexityTextBehaviorRegistration(model))
	}
	for _, model := range capabilitydriver.FireworksTextModels() {
		registrations = append(registrations, fireworksTextBehaviorRegistration(model))
	}
	for _, model := range capabilitydriver.OpenRouterTextModels() {
		registrations = append(registrations, openRouterTextBehaviorRegistration(model))
	}
	for _, model := range capabilitydriver.TogetherTextModels() {
		registrations = append(registrations, togetherTextBehaviorRegistration(model))
	}
	for _, model := range capabilitydriver.SiliconFlowTextModels() {
		registrations = append(registrations, siliconFlowTextBehaviorRegistration(model))
	}
	registrations = append(registrations, qianfanTextBehaviorRegistration())
	for _, model := range capabilitydriver.VolcengineTextModels() {
		registrations = append(registrations, volcengineTextBehaviorRegistration(model))
	}
	registrations = append(registrations, sparkTextBehaviorRegistration("spark", "4.0Ultra"), sparkTextBehaviorRegistration("spark", "lite"), sparkTextBehaviorRegistration("spark_reasoning", "spark-x"))
	for _, model := range capabilitydriver.SparkMaaSTextModels() {
		registrations = append(registrations, sparkMaaSTextBehaviorRegistration(model))
	}
	return registrations
}

func gemma412BTextBehaviorRegistration() textBehaviorAdapterRegistration {
	registration := gemma4TemplateTextBehaviorRegistration(
		"llama.cpp.gemma4-12b-unified.text-behavior",
		"2",
		capabilitydriver.Gemma412BTemplateIdentity,
		false,
	)
	registration.LocalTarget.RecipeID = capabilitydriver.LlamaGemma412BRecipeID
	modes := []runtimev1.ExecutionMode{
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
	}
	registration.Support.Combinations = append(
		registration.Support.Combinations,
		textBehaviorCombination{Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
		textBehaviorCombination{Reasoning: true, StructuredOutput: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
	)
	return registration
}

func gemma4TemplateTextBehaviorRegistration(adapterID, version, templateIdentity string, orderedSystemMessages bool) textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
	}
	toolProjection := capabilitydriver.LlamaFunctionToolUseCapabilityProjection()
	combinations := []textBehaviorCombination{
		{ToolUse: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
		{Reasoning: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
		{StructuredOutput: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
	}
	// The pinned E2B template renders each later system message in place as
	// its own system turn. The serializer already preserves these boundaries,
	// including around tool round trips; no hoisting or role rewriting is needed.
	if orderedSystemMessages {
		combinations = append(combinations,
			textBehaviorCombination{OrderedSystemMessages: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
			textBehaviorCombination{ToolUse: true, OrderedSystemMessages: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
		)
	}
	return textBehaviorAdapterRegistration{
		AdapterID:        adapterID,
		Version:          version,
		ImplementationID: capabilitydriver.LlamaImplementationID,
		DriverID:         capabilitydriver.LlamaDriverID,
		DriverDialect:    llamaTextDriverDialect,
		LocalTarget: &textBehaviorLocalTarget{
			RecipeID:                  llamaGenericTextRecipeID,
			RecipeRevision:            llamaTextRecipeRevision,
			RequiredArchitectures:     []string{"gemma4"},
			RequiredTokenizerProtocol: capabilitydriver.LlamaTokenizerProtocolGemma4,
		},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:           append([]runtimev1.ToolSpecKind(nil), toolProjection.GetSupportedToolSpecKinds()...),
				ChoiceModes:         append([]runtimev1.ToolChoiceMode(nil), toolProjection.GetSupportedToolChoiceModes()...),
				SingleCall:          toolProjection.GetSupportsSingleCall(),
				MultipleCalls:       toolProjection.GetSupportsMultipleCalls(),
				ParallelCalls:       toolProjection.GetSupportsParallelCalls(),
				ToolOnlyResponse:    toolProjection.GetSupportsToolOnlyResponse(),
				MixedTextAndCall:    toolProjection.GetSupportsMixedTextAndToolCalls(),
				ToolResultRoundTrip: toolProjection.GetSupportsToolResultRoundTrip(),
			},
			Reasoning: &textBehaviorReasoningSupport{
				Activations: []runtimev1.ReasoningActivation{
					runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED,
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
			Combinations: combinations,
		},
		ExecutionSemantics: textBehaviorExecutionSemantics{
			RequiredTemplateIdentity: templateIdentity,
			// Thinking travels in each request and the verified template is the
			// bound model's own, so this adapter changes no process launch.
			ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected,
		},
		RequestSerializerID: "llama.cpp/gemma4/openai-chat/request/v1",
		RequestSerializer:   capabilitydriver.Gemma4TextBehaviorRequestSerializer,
		NonStreamParserID:   "llama.cpp/gemma4/openai-chat/nonstream/v1",
		NonStreamParser:     capabilitydriver.Gemma4TextBehaviorNonStreamParser,
		StreamAssemblerID:   "llama.cpp/gemma4/openai-chat/stream/v1",
		StreamAssembler:     capabilitydriver.Gemma4TextBehaviorStreamAssembler,
	}
}

func qwen35TemplateTextBehaviorRegistration() textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC}
	toolProjection := capabilitydriver.Qwen35ToolUseCapabilityProjection()
	return textBehaviorAdapterRegistration{
		AdapterID:        "llama.cpp.qwen35-4b.text-behavior",
		Version:          "2",
		ImplementationID: capabilitydriver.LlamaImplementationID,
		DriverID:         capabilitydriver.LlamaDriverID,
		DriverDialect:    llamaTextDriverDialect,
		LocalTarget: &textBehaviorLocalTarget{
			RecipeID:                  llamaGenericTextRecipeID,
			RecipeRevision:            llamaTextRecipeRevision,
			RequiredArchitectures:     []string{"qwen35", "qwen35moe"},
			RequiredTokenizerProtocol: capabilitydriver.LlamaTokenizerProtocolQwen3Coder,
		},
		Support: textBehaviorSupport{
			Reasoning: &textBehaviorReasoningSupport{
				Activations:   []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED},
				Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN},
			},
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:           append([]runtimev1.ToolSpecKind(nil), toolProjection.GetSupportedToolSpecKinds()...),
				ChoiceModes:         append([]runtimev1.ToolChoiceMode(nil), toolProjection.GetSupportedToolChoiceModes()...),
				SingleCall:          true,
				ToolOnlyResponse:    true,
				ToolResultRoundTrip: true,
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

func qwen38TemplateTextBehaviorRegistration() textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
	}
	tools := capabilitydriver.LlamaFunctionToolUseCapabilityProjection()
	return textBehaviorAdapterRegistration{
		AdapterID:        "llama.cpp.qwen38-27b.text-behavior",
		Version:          "2",
		ImplementationID: capabilitydriver.LlamaImplementationID,
		DriverID:         capabilitydriver.LlamaDriverID,
		DriverDialect:    llamaTextDriverDialect,
		LocalTarget: &textBehaviorLocalTarget{
			RecipeID:                  llamaGenericTextRecipeID,
			RecipeRevision:            llamaTextRecipeRevision,
			RequiredArchitectures:     []string{"qwen35", "qwen35moe"},
			RequiredTokenizerProtocol: capabilitydriver.LlamaTokenizerProtocolQwen3Coder,
		},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:           tools.GetSupportedToolSpecKinds(),
				ChoiceModes:         tools.GetSupportedToolChoiceModes(),
				SingleCall:          true,
				MultipleCalls:       true,
				ParallelCalls:       true,
				ToolOnlyResponse:    true,
				MixedTextAndCall:    true,
				ToolResultRoundTrip: true,
			},
			Reasoning: &textBehaviorReasoningSupport{
				Activations: []runtimev1.ReasoningActivation{
					runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED,
					runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE,
					runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
				},
				Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN},
				Efforts: []runtimev1.ReasoningEffort{
					runtimev1.ReasoningEffort_REASONING_EFFORT_LOW,
					runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM,
					runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH,
				},
				ExactBudget: true,
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
				{Reasoning: true, StructuredOutput: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
			},
		},
		ExecutionSemantics: textBehaviorExecutionSemantics{
			RequiredTemplateIdentity: capabilitydriver.Qwen38Q4TemplateIdentity,
			ProcessIdentityImpact:    textBehaviorProcessIdentityUnaffected,
		},
		RequestSerializerID: "llama.cpp/qwen38-27b/openai-chat/request/v1",
		RequestSerializer:   capabilitydriver.Qwen38TextBehaviorRequestSerializer,
		NonStreamParserID:   "llama.cpp/qwen38-27b/openai-chat/nonstream/v1",
		NonStreamParser:     capabilitydriver.Gemma4TextBehaviorNonStreamParser,
		StreamAssemblerID:   "llama.cpp/qwen38-27b/openai-chat/stream/v1",
		StreamAssembler:     capabilitydriver.Gemma4TextBehaviorStreamAssembler,
	}
}

func lfm3TemplateTextBehaviorRegistration() textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
	}
	tools := capabilitydriver.LlamaFunctionToolUseCapabilityProjection()
	return textBehaviorAdapterRegistration{
		AdapterID:        "llama.cpp.lfm3-1.7b.text-behavior",
		Version:          "2",
		ImplementationID: capabilitydriver.LlamaImplementationID,
		DriverID:         capabilitydriver.LlamaDriverID,
		DriverDialect:    llamaTextDriverDialect,
		LocalTarget: &textBehaviorLocalTarget{
			RecipeID:                  llamaGenericTextRecipeID,
			RecipeRevision:            llamaTextRecipeRevision,
			RequiredArchitectures:     []string{"lfm3"},
			RequiredTokenizerProtocol: capabilitydriver.LlamaTokenizerProtocolLFM3,
		},
		Support: textBehaviorSupport{
			ToolUse: &textBehaviorToolUseSupport{
				SpecKinds:           tools.GetSupportedToolSpecKinds(),
				ChoiceModes:         tools.GetSupportedToolChoiceModes(),
				SingleCall:          true,
				MultipleCalls:       true,
				ParallelCalls:       true,
				ToolOnlyResponse:    true,
				MixedTextAndCall:    true,
				ToolResultRoundTrip: true,
			},
			Reasoning: &textBehaviorReasoningSupport{
				Activations: []runtimev1.ReasoningActivation{
					runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED,
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
				{Reasoning: true, StructuredOutput: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
			},
		},
		ExecutionSemantics: textBehaviorExecutionSemantics{
			RequiredTemplateIdentity: capabilitydriver.LFM3Q4TemplateIdentity,
			ProcessIdentityImpact:    textBehaviorProcessIdentityUnaffected,
		},
		RequestSerializerID: "llama.cpp/lfm3-1.7b/openai-chat/request/v1",
		RequestSerializer:   capabilitydriver.Gemma4TextBehaviorRequestSerializer,
		NonStreamParserID:   "llama.cpp/lfm3-1.7b/openai-chat/nonstream/v1",
		NonStreamParser:     capabilitydriver.Gemma4TextBehaviorNonStreamParser,
		StreamAssemblerID:   "llama.cpp/lfm3-1.7b/openai-chat/stream/v1",
		StreamAssembler:     capabilitydriver.Gemma4TextBehaviorStreamAssembler,
	}
}

func llamaUnknownTemplateStructuredOutputRegistration(adapterID, recipeID string, excludedCohorts []capabilitydriver.KnownLlamaTemplateCohort) textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
	}
	cohorts := make([]textBehaviorTemplateCohort, 0, len(excludedCohorts))
	for _, cohort := range excludedCohorts {
		cohorts = append(cohorts, textBehaviorTemplateCohort{
			TemplateIdentity:  cohort.TemplateIdentity,
			Architectures:     append([]string(nil), cohort.Architectures...),
			TokenizerProtocol: cohort.TokenizerProtocol,
		})
	}
	return textBehaviorAdapterRegistration{
		AdapterID:        adapterID,
		Version:          "1",
		ImplementationID: capabilitydriver.LlamaImplementationID,
		DriverID:         capabilitydriver.LlamaDriverID,
		DriverDialect:    llamaTextDriverDialect,
		LocalTarget: &textBehaviorLocalTarget{
			RecipeID:                recipeID,
			RecipeRevision:          llamaTextRecipeRevision,
			TemplateMatchMode:       textBehaviorLocalTemplateMatchUnknownNonEmpty,
			ExcludedTemplateCohorts: cohorts,
		},
		Support: textBehaviorSupport{
			StructuredOutput: &textBehaviorStructuredOutputSupport{
				Kinds: []runtimev1.ResponseFormatKind{
					runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT,
					runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA,
				},
				SupportsStrictJSONSchema: true,
			},
			Combinations: []textBehaviorCombination{
				{StructuredOutput: true, Modes: modes},
			},
		},
		ExecutionSemantics: textBehaviorExecutionSemantics{
			ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected,
		},
		RequestSerializerID: "llama.cpp/gguf/structured-output/request/v1",
		RequestSerializer:   capabilitydriver.LlamaStructuredOutputRequestSerializer,
		NonStreamParserID:   "llama.cpp/gguf/structured-output/nonstream/v1",
		NonStreamParser:     capabilitydriver.Gemma4TextBehaviorNonStreamParser,
		StreamAssemblerID:   "llama.cpp/gguf/structured-output/stream/v1",
		StreamAssembler:     capabilitydriver.Gemma4TextBehaviorStreamAssembler,
	}
}
