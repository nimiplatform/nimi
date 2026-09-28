package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestQwen38FlashAdvancedBehaviorAdmissionIsExact(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "dashscope", DriverId: "nimillm", DriverDialect: "dashscope"}
	registrations := productionTextBehaviorAdapterRegistrations()
	tools := testTextBehaviorToolSpec()
	tools.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC} {
		adapter, err := resolveTextBehaviorAdapter(registrations, identity, "dashscope", "qwen3.8-flash", mode, tools)
		if err != nil || adapter == nil || adapter.registration.Version != "1" {
			t.Fatalf("Qwen tool mode=%v adapter=%+v err=%v", mode, adapter, err)
		}
		schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"ok": map[string]any{"type": "boolean"}}, "required": []any{"ok"}})
		jsonSpec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON."}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, Strict: true}}
		adapter, err = resolveTextBehaviorAdapter(registrations, identity, "dashscope", "qwen3.8-flash", mode, jsonSpec)
		if err != nil || adapter == nil {
			t.Fatalf("Qwen JSON mode=%v adapter=%+v err=%v", mode, adapter, err)
		}
	}
	if _, err := resolveTextBehaviorAdapter(registrations, identity, "dashscope", "qwen3.8-flash", runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, tools); err == nil {
		t.Fatal("unverified streaming tool mode was promoted")
	}
	for _, mutate := range []func(*runtimev1.TextGenerateScenarioSpec){
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE
		},
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED
		},
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL
			s.ToolChoiceName = s.Tools[0].Name
		},
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
		},
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
				Intensity:    &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH},
				Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}
		},
	} {
		candidate := testTextBehaviorToolSpec()
		mutate(candidate)
		_, err := resolveTextBehaviorAdapter(registrations, identity, "dashscope", "qwen3.8-flash", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, candidate)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("unsupported Qwen combination reason=%v present=%v err=%v", reason, ok, err)
		}
	}
	if _, err := resolveTextBehaviorAdapter(registrations, identity, "dashscope", "qwen3.7-plus", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, tools); err == nil {
		t.Fatal("neighboring Qwen model inherited advanced behavior")
	}
}
