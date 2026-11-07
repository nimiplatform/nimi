package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func volcengineTextBehaviorRegistration(model string) textBehaviorAdapterRegistration {
	p, err := capabilitydriver.NewVolcengineTextBehavior(model)
	if err != nil {
		panic("invalid reviewed Volcengine target")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	combinations := []textBehaviorCombination{}
	for _, tool := range []bool{false, true} {
		for _, reasoning := range []bool{false, true} {
			for _, structured := range []bool{false, true} {
				for _, ordered := range []bool{false, true} {
					if tool && structured || structured && !p.Schema() {
						continue
					}
					combinations = append(combinations, textBehaviorCombination{ToolUse: tool, Reasoning: reasoning, StructuredOutput: structured, OrderedSystemMessages: ordered, Modes: modes})
				}
			}
		}
	}
	r := &textBehaviorReasoningSupport{ContinuityCarrier: true, ContinuityKind: p.ContinuityKind(), ContinuityVersion: 1}
	r.SummaryTranscript = p.EncryptedReasoning()
	if p.HasThinking() {
		r.Activations = []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
		if !p.AlwaysThinking() {
			r.Activations = append(r.Activations, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED)
		}
		r.Efforts = p.Efforts()
		r.Presentations = []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}
		if p.EncryptedReasoning() {
			r.Presentations = append(r.Presentations, runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY)
		}
	}
	support := textBehaviorSupport{Reasoning: r, Combinations: combinations}
	support.ToolUse = &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true}
	if p.Schema() {
		support.StructuredOutput = &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true}
	}
	return textBehaviorAdapterRegistration{
		AdapterID: "volcengine." + model + ".chat", Version: "1", ImplementationID: "volcengine", DriverID: "nimillm", DriverDialect: "volcengine", CloudTarget: &textBehaviorCloudTarget{Provider: "volcengine", ProviderModelID: model},
		Support: support, ExecutionSemantics: textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "volcengine/" + model + "/request/v1", RequestSerializer: p.Serialize, MaterializationPlanner: p.PlanMaterialization,
		NonStreamParserID: "volcengine/" + model + "/response/v1", NonStreamParser: p.Parse, StreamAssemblerID: "volcengine/" + model + "/stream/v1", StreamAssembler: p.Stream,
	}
}
