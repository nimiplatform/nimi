package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func openRouterTextBehaviorRegistration(model string) textBehaviorAdapterRegistration {
	p, err := capabilitydriver.NewOpenRouterTextBehavior(model)
	if err != nil {
		panic("unreviewed OpenRouter target")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	combinations := []textBehaviorCombination{}
	for _, tool := range []bool{false, true} {
		for _, reasoning := range []bool{false, true} {
			for _, structured := range []bool{false, true} {
				for _, ordered := range []bool{false, true} {
					if ordered && !strings.HasPrefix(model, "openai/") {
						continue
					}
					combinations = append(combinations, textBehaviorCombination{ToolUse: tool, Reasoning: reasoning, StructuredOutput: structured, OrderedSystemMessages: ordered, Modes: modes})
				}
			}
		}
	}
	activations := []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
	if strings.HasPrefix(model, "anthropic/") {
		activations = append(activations, runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE)
	}
	if p.CanDisableReasoning() {
		activations = append(activations, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED)
	}
	efforts := []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}
	for _, effort := range p.Efforts() {
		efforts = append(efforts, map[string]runtimev1.ReasoningEffort{"low": runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, "medium": runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, "high": runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH, "xhigh": runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH, "max": runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM}[effort])
	}
	kinds := []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	if p.StrictSchema() {
		kinds = append(kinds, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA)
	}
	return textBehaviorAdapterRegistration{AdapterID: "openrouter." + model + ".responses", Version: "1", ImplementationID: "openrouter", DriverID: "nimillm", DriverDialect: "openrouter", CloudTarget: &textBehaviorCloudTarget{Provider: "openrouter", ProviderModelID: model}, Support: textBehaviorSupport{
		ToolUse:          &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true},
		Reasoning:        &textBehaviorReasoningSupport{Activations: activations, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN, runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}, Efforts: efforts, SummaryTranscript: true, ContinuityCarrier: true, ContinuityKind: p.ContinuityKind(), ContinuityVersion: 1},
		StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: kinds, SupportsStrictJSONSchema: p.StrictSchema()}, Combinations: combinations}, ExecutionSemantics: textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected}, RequestSerializerID: "openrouter/" + model + "/request/v1", RequestSerializer: p.Serialize, MaterializationPlanner: p.PlanMaterialization, NonStreamParserID: "openrouter/" + model + "/response/v1", NonStreamParser: p.Parse, StreamAssemblerID: "openrouter/" + model + "/stream/v1", StreamAssembler: p.Stream}
}
