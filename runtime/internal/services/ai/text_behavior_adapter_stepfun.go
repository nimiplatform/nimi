package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.stepfun-current-text
func stepfunTextBehaviorRegistration(model string) textBehaviorAdapterRegistration {
	p, err := capabilitydriver.NewStepFunTextBehavior(model)
	if err != nil {
		panic("invalid reviewed StepFun registration")
	}
	modes := []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM}
	combinations := []textBehaviorCombination{}
	for _, reasoning := range []bool{false, true} {
		for _, ordered := range []bool{false, true} {
			combinations = append(combinations, textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, Modes: modes}, textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, ToolUse: true, Modes: modes}, textBehaviorCombination{Reasoning: reasoning, OrderedSystemMessages: ordered, StructuredOutput: true, Modes: modes})
		}
	}
	efforts := []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}
	if model != "step-3.5-flash-2603" {
		efforts = append(efforts, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM)
	}
	return textBehaviorAdapterRegistration{
		AdapterID: "stepfun." + model + ".chat", Version: "1", ImplementationID: "stepfun", DriverID: "nimillm", DriverDialect: "stepfun", CloudTarget: &textBehaviorCloudTarget{Provider: "stepfun", ProviderModelID: model},
		Support: textBehaviorSupport{
			ToolUse:          &textBehaviorToolUseSupport{SpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION}, ChoiceModes: []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO}, SingleCall: true, MultipleCalls: true, ParallelCalls: true, ToolOnlyResponse: true, MixedTextAndCall: true, ToolResultRoundTrip: true},
			Reasoning:        &textBehaviorReasoningSupport{Activations: []runtimev1.ReasoningActivation{runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}, Presentations: []runtimev1.ReasoningPresentation{runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}, Efforts: efforts},
			StructuredOutput: &textBehaviorStructuredOutputSupport{Kinds: []runtimev1.ResponseFormatKind{runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}, SupportsStrictJSONSchema: true}, Combinations: combinations,
		},
		ExecutionSemantics:  textBehaviorExecutionSemantics{ProcessIdentityImpact: textBehaviorProcessIdentityUnaffected},
		RequestSerializerID: "stepfun/" + model + "/request/v1", RequestSerializer: p.Serialize, MaterializationPlanner: p.PlanMaterialization,
		NonStreamParserID: "stepfun/" + model + "/response/v1", NonStreamParser: p.Parse, StreamAssemblerID: "stepfun/" + model + "/stream/v1", StreamAssembler: p.Stream,
	}
}
