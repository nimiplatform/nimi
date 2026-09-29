package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGemini38FlashSchemaRegistrationIsExactAndNarrow(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: "gemini", DriverId: "nimillm", DriverDialect: "gemini",
	}
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{
		"ok": map[string]any{"type": "boolean"}}, "required": []any{"ok"}, "additionalProperties": false})
	spec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON."}},
		ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA,
			JsonSchema: schema, Strict: true},
	}
	registrations := productionTextBehaviorAdapterRegistrations()
	adapter, err := resolveTextBehaviorAdapter(registrations, identity, "gemini", "gemini-3.8-flash", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec)
	if err != nil || adapter == nil || adapter.registration.AdapterID != "gemini.38-flash.chat-schema" {
		t.Fatalf("exact Gemini schema registration=%+v err=%v", adapter, err)
	}
	for _, target := range []string{"gemini-3.5-flash", "gemini-3.8-flash-lite"} {
		if adapter, err := resolveTextBehaviorAdapter(registrations, identity, "gemini", target, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec); adapter != nil || textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("neighboring target %s inherited schema: %+v %v", target, adapter, err)
		}
	}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB} {
		if adapter, err := resolveTextBehaviorAdapter(registrations, identity, "gemini", "gemini-3.8-flash", mode, spec); adapter != nil || textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("unverified mode %v admitted: %+v %v", mode, adapter, err)
		}
	}
	toolSpec := testTextBehaviorToolSpec()
	if adapter, err := resolveTextBehaviorAdapter(registrations, identity, "gemini", "gemini-3.8-flash", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, toolSpec); adapter != nil || textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("unsigned tool turn admitted: %+v %v", adapter, err)
	}
	plain := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Hello."}}}
	if adapter, err := resolveTextBehaviorAdapter(registrations, identity, "gemini", "gemini-3.8-flash", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, plain); adapter != nil || err != nil {
		t.Fatalf("base Gemini text changed: %+v %v", adapter, err)
	}
}
