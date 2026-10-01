package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestQwen35Q4BehaviorRegistrationIsExactAndSyncOnly(t *testing.T) {
	registration := qwen35Q4TextBehaviorRegistration()
	if !validTextBehaviorAdapterRegistration(registration) {
		t.Fatal("Qwen3.5 Q4 behavior registration is invalid")
	}
	facts := textBehaviorAdapterResolutionFacts{
		ImplementationID: capabilitydriver.LlamaImplementationID,
		DriverID:         capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaDriverDialect,
		LocalTarget: &textBehaviorLocalResolutionTarget{
			RecipeID: capabilitydriver.LlamaQwen35RecipeID, RecipeRevision: "1",
			ModelContents: []textBehaviorModelContent{{SlotID: capabilitydriver.MainGGUFRequirementID,
				ContentID: capabilitydriver.Qwen35Q4ContentID, EntrySHA256: capabilitydriver.Qwen35Q4EntrySHA256}},
			TemplateIdentity: capabilitydriver.Qwen35Q4TemplateIdentity,
		},
	}
	tool := testTextBehaviorToolSpec()
	tool.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
	if resolved, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{registration}, facts,
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, tool); err != nil || resolved == nil {
		t.Fatalf("exact Qwen tool adapter = %+v err=%v", resolved, err)
	}
	schema, _ := structpb.NewStruct(map[string]any{"type": "object"})
	structured := &runtimev1.TextGenerateScenarioSpec{ResponseFormat: &runtimev1.ResponseFormat{
		Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, Strict: true,
	}}
	if resolved, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{registration}, facts,
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, structured); err != nil || resolved == nil {
		t.Fatalf("exact Qwen schema adapter = %+v err=%v", resolved, err)
	}
	for name, spec := range map[string]*runtimev1.TextGenerateScenarioSpec{
		"required tool choice": func() *runtimev1.TextGenerateScenarioSpec {
			copy := proto.Clone(tool).(*runtimev1.TextGenerateScenarioSpec)
			copy.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED
			return copy
		}(),
		"tool plus schema": func() *runtimev1.TextGenerateScenarioSpec {
			copy := proto.Clone(tool).(*runtimev1.TextGenerateScenarioSpec)
			copy.ResponseFormat = structured.ResponseFormat
			return copy
		}(),
		"reasoning": {Reasoning: &runtimev1.ReasoningConfig{
			Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
			Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
			Intensity:    &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 32},
		}},
	} {
		if _, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{registration}, facts,
			runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("%s was admitted: %v", name, err)
		}
	}
	if _, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{registration}, facts,
		runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, tool); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("Qwen advanced stream admitted: %v", err)
	}
	wrong := facts
	copy := *facts.LocalTarget
	copy.TemplateIdentity = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	wrong.LocalTarget = &copy
	if _, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{registration}, wrong,
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, tool); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("wrong Qwen template admitted: %v", err)
	}
}
