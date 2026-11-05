package ai

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestLFM3BehaviorCapturesOnlyExactWeightsAndTemplate(t *testing.T) {
	r := lfm3Q4TextBehaviorRegistration()
	facts := textBehaviorAdapterResolutionFacts{ImplementationID: r.ImplementationID, DriverID: r.DriverID, DriverDialect: r.DriverDialect, LocalTarget: &textBehaviorLocalResolutionTarget{RecipeID: r.LocalTarget.RecipeID, RecipeRevision: "1", ModelContents: r.LocalTarget.ModelContents, TemplateIdentity: capabilitydriver.LFM3Q4TemplateIdentity}}
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"ok": map[string]any{"type": "boolean"}}, "required": []any{"ok"}, "additionalProperties": false})
	tools := testTextBehaviorToolSpec()
	tools.SystemPrompt = "  Keep exact boundaries.\n"
	tools.Input = []*runtimev1.ChatMessage{{Role: "user", Content: "Use lookup"}}
	reasoning := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Solve 17*19"}}, Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Intensity: &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 128}}}
	structured := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON"}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, JsonSchema: schema}}
	structuredThinking := proto.Clone(structured).(*runtimev1.TextGenerateScenarioSpec)
	structuredThinking.Reasoning = proto.Clone(reasoning.Reasoning).(*runtimev1.ReasoningConfig)
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB} {
		for name, spec := range map[string]*runtimev1.TextGenerateScenarioSpec{"tools": tools, "reasoning": reasoning, "schema": structured, "schema with budget": structuredThinking} {
			resolved, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{r}, facts, mode, spec)
			if err != nil || resolved == nil {
				t.Fatalf("%s %v=%v", name, mode, err)
			}
			wire, err := r.RequestSerializer(spec, mode == runtimev1.ExecutionMode_EXECUTION_MODE_STREAM)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			_ = json.Unmarshal(wire.Payload, &body)
			if name == "tools" && body["messages"].([]any)[0].(map[string]any)["content"] != "  Keep exact boundaries.\n" {
				t.Fatal("system whitespace lost")
			}
			if name == "reasoning" && (body["reasoning_budget_tokens"] != float64(128) || body["reasoning_format"] != "deepseek" || body["chat_template_kwargs"].(map[string]any)["enable_thinking"] != true) {
				t.Fatalf("reasoning mapping=%v", body)
			}
			if name == "schema with budget" && (body["chat_template_kwargs"].(map[string]any)["enable_thinking"] != true || body["reasoning_budget_tokens"] != float64(128) || body["response_format"] == nil) {
				t.Fatalf("budget/schema mapping=%v", body)
			}
		}
	}
	for _, change := range []func(*textBehaviorLocalResolutionTarget){
		func(f *textBehaviorLocalResolutionTarget) {
			f.TemplateIdentity = capabilitydriver.Qwen35Q4TemplateIdentity
		},
		func(f *textBehaviorLocalResolutionTarget) { f.RecipeID = capabilitydriver.LlamaQwen35RecipeID },
		func(f *textBehaviorLocalResolutionTarget) {
			f.ModelContents = []textBehaviorModelContent{{SlotID: capabilitydriver.MainGGUFRequirementID, ContentID: "sha256:" + strings.Repeat("a", 64), EntrySHA256: strings.Repeat("a", 64)}}
		},
	} {
		copy := *facts.LocalTarget
		change(&copy)
		wrong := facts
		wrong.LocalTarget = &copy
		if _, err := resolveTextBehaviorAdapterForFacts([]textBehaviorAdapterRegistration{r}, wrong, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, tools); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("different facts inherited behavior: %v", err)
		}
	}
}
