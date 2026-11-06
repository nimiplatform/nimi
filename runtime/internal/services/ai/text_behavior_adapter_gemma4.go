package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

const (
	gemma4TextBehaviorAdapterID      = "llama.cpp.gemma4.text-behavior"
	gemma4TextBehaviorAdapterVersion = "2"
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
	registrations = append(registrations, qwen35Q4TextBehaviorRegistration())
	registrations = append(registrations, qwen38Q4TextBehaviorRegistration(), lfm3Q4TextBehaviorRegistration())
	registrations = append(registrations, gemma412BTextBehaviorRegistration())
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
	return registrations
}

func gemma412BTextBehaviorRegistration() textBehaviorAdapterRegistration {
	registration := gemma4TextBehaviorRegistration(capabilitydriver.Gemma4BehaviorCohortEntry{
		ContentID: capabilitydriver.Gemma412BQ4ContentID, EntrySHA256: capabilitydriver.Gemma412BQ4ContentID[len("sha256:"):],
		TemplateIdentity: capabilitydriver.Gemma412BTemplateIdentity, ProjectorContentID: capabilitydriver.Gemma412BProjectorContentID,
	})
	registration.AdapterID, registration.Version = "llama.cpp.gemma4-12b-unified.text-behavior", "1"
	registration.LocalTarget.RecipeID = capabilitydriver.LlamaGemma412BRecipeID
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB}
	registration.Support.Combinations = append(registration.Support.Combinations, textBehaviorCombination{Modes: modes}, textBehaviorCombination{Reasoning: true, StructuredOutput: true, Modes: modes})
	return registration
}

func gemma4TextBehaviorRegistration(entry capabilitydriver.Gemma4BehaviorCohortEntry) textBehaviorAdapterRegistration {
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
	if entry.TemplateIdentity == gemma4E2BTemplateIdentity {
		combinations = append(combinations,
			textBehaviorCombination{OrderedSystemMessages: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
			textBehaviorCombination{ToolUse: true, OrderedSystemMessages: true, Modes: append([]runtimev1.ExecutionMode(nil), modes...)},
		)
	}
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
			RequiredTemplateIdentity: entry.TemplateIdentity,
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
