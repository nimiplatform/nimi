package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

var bedrockClaudeTargets = []string{"anthropic.claude-haiku-5-5", "anthropic.claude-sonnet-5-5", "anthropic.claude-opus-5-5", "anthropic.claude-fable-5-1"}
var bedrockResponsesTargets = []string{"openai.gpt-6-astra", "openai.gpt-6-luna", "openai.gpt-6.1-sol", "openai.gpt-6.1-terra"}
var bedrockNovaTargets = []string{"amazon.nova-2-lite-v1:0", "amazon.nova-pro-v1:0", "amazon.nova-lite-v1:0", "amazon.nova-micro-v1:0"}

// @nimi-authority: rule.nimi.runtime.ai-provider.bedrock-native-routing
func bedrockTextBehaviorRegistrations() []textBehaviorAdapterRegistration {
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	efforts := []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM}
	out := []textBehaviorAdapterRegistration{}
	for _, model := range bedrockClaudeTargets {
		p, err := capabilitydriver.NewBedrockClaudeBehavior(model)
		if err != nil {
			panic("invalid reviewed Bedrock Claude model")
		}
		r := bedrockTextRegistration(model, "invoke")
		choices := []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE}
		activations := []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE}
		if model == "anthropic.claude-haiku-5-5" {
			choices = append(choices, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL)
			activations = append(activations, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED)
		}
		r.Support = textBehaviorSupport{
			ToolUse:          bedrockToolSupport(choices),
			Reasoning:        &textBehaviorReasoningSupport{Activations: activations, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: efforts, ContinuityCarrier: true, ContinuityKind: p.ContinuityKind(), ContinuityVersion: 1},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations:     []textBehaviorCombination{{Modes: modes}, {Reasoning: true, Modes: modes}, {ToolUse: true, Modes: modes}, {ToolUse: true, Reasoning: true, Modes: modes}, {StructuredOutput: true, Modes: modes}, {StructuredOutput: true, Reasoning: true, Modes: modes}},
		}
		r.RequestSerializer, r.NonStreamParser, r.StreamAssembler = p.Serialize, p.Parse, p.Stream
		out = append(out, r)
	}
	for _, model := range bedrockResponsesTargets {
		p, err := capabilitydriver.NewBedrockResponsesBehavior(model)
		if err != nil {
			panic("invalid reviewed Bedrock Responses model")
		}
		r := bedrockTextRegistration(model, "responses")
		activations := []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
		if model == "openai.gpt-6-luna" || model == "openai.gpt-6.1-terra" {
			activations = append(activations, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED)
		}
		schemaModes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC}
		if model == "openai.gpt-6.1-sol" {
			schemaModes = modes
		}
		r.Support = textBehaviorSupport{
			ToolUse:          bedrockToolSupport([]runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL}),
			Reasoning:        &textBehaviorReasoningSupport{Activations: activations, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN, runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}, Efforts: efforts, SummaryTranscript: true, ContinuityCarrier: true, ContinuityKind: p.ContinuityKind(), ContinuityVersion: 1},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true},
			Combinations:     []textBehaviorCombination{{Modes: modes}, {Reasoning: true, Modes: modes}, {ToolUse: true, Modes: modes}, {ToolUse: true, Reasoning: true, Modes: modes}, {StructuredOutput: true, Modes: schemaModes}, {StructuredOutput: true, Reasoning: true, Modes: schemaModes}},
		}
		r.RequestSerializer, r.NonStreamParser, r.StreamAssembler = p.Serialize, p.Parse, p.Stream
		out = append(out, r)
	}
	for _, model := range bedrockNovaTargets {
		p, err := capabilitydriver.NewBedrockNovaBehavior(model)
		if err != nil {
			panic("invalid reviewed Bedrock Nova model")
		}
		r := bedrockTextRegistration(model, "converse")
		r.Support = textBehaviorSupport{ToolUse: bedrockToolSupport([]runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL}), Combinations: []textBehaviorCombination{{Modes: modes}, {ToolUse: true, Modes: modes}}}
		if model == "amazon.nova-2-lite-v1:0" {
			r.Support.Reasoning = &textBehaviorReasoningSupport{Activations: []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}}
			r.Support.Combinations = append(r.Support.Combinations, textBehaviorCombination{Reasoning: true, Modes: modes}, textBehaviorCombination{ToolUse: true, Reasoning: true, Modes: modes})
		}
		r.RequestSerializer, r.NonStreamParser, r.StreamAssembler = p.Serialize, p.Parse, p.Stream
		out = append(out, r)
	}
	return out
}

func bedrockTextRegistration(model, protocol string) textBehaviorAdapterRegistration {
	prefix := "bedrock/" + model + "/" + protocol
	return textBehaviorAdapterRegistration{
		AdapterID: "bedrock." + model + "." + protocol, Version: "1", ImplementationID: "bedrock", DriverID: "nimillm", DriverDialect: "bedrock",
		CloudTarget:         &textBehaviorCloudTarget{Provider: "bedrock", ProviderModelID: model},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: prefix + "/request/v1", NonStreamParserID: prefix + "/nonstream/v1", StreamAssemblerID: prefix + "/stream/v1",
	}
}

func bedrockToolSupport(choices []runtimev1.ToolChoiceMode) *textBehaviorToolUseSupport {
	return &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: choices, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true}
}
