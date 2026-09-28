package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestDashscopeQwen38RequestCapturesNonThinkingOptions(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Find a value."}},
		Tools:      []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup"}},
		ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO}
	serialized, err := DashscopeQwen38RequestSerializer(spec, true)
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{}
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		t.Fatal(err)
	}
	if body["enable_thinking"] != false || body["thinking"] != nil || body["parallel_tool_calls"] != false ||
		body["tool_choice"] != "auto" || body["stream"] != true || len(body["tools"].([]any)) != 1 {
		t.Fatalf("Qwen non-thinking tool request=%+v", body)
	}
	for _, choice := range []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL} {
		spec.ToolChoice = choice
		_, err := DashscopeQwen38RequestSerializer(spec, true)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("unsupported choice=%v reason=%v present=%v err=%v", choice, reason, ok, err)
		}
	}
	spec.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
	temperature := float32(0.5)
	spec.Temperature = &temperature
	_, err = DashscopeQwen38RequestSerializer(spec, false)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("unverified sampling control reason=%v present=%v err=%v", reason, ok, err)
	}
}

func TestDashscopeQwen38SchemaRequestAndResponseAreExact(t *testing.T) {
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"ok": map[string]any{"type": "boolean"}}, "required": []any{"ok"}, "additionalProperties": false})
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return a JSON object."}},
		ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, SchemaName: "result", Strict: true}}
	serialized, err := DashscopeQwen38RequestSerializer(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{}
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		t.Fatal(err)
	}
	format := body["response_format"].(map[string]any)
	wrapper := format["json_schema"].(map[string]any)
	if body["enable_thinking"] != false || body["thinking"] != nil || body["parallel_tool_calls"] != nil ||
		format["type"] != "json_schema" || wrapper["strict"] != true || wrapper["name"] != "result" || body["stream"] != false {
		t.Fatalf("Qwen JSON request=%+v", body)
	}
	valid := []byte(`{"choices":[{"index":0,"finish_reason":"stop","message":{"content":"{\"ok\":true}"}}],"usage":{"prompt_tokens":8,"completion_tokens":4}}`)
	result, err := DashscopeQwen38NonStreamParser(valid, spec)
	if err != nil || len(result.Items) != 1 || result.Items[0].Text != `{"ok":true}` {
		t.Fatalf("Qwen schema result=%+v err=%v", result, err)
	}
	invalid := []byte(`{"choices":[{"index":0,"finish_reason":"stop","message":{"content":"{\"ok\":\"true\"}"}}]}`)
	_, err = DashscopeQwen38NonStreamParser(invalid, spec)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("schema mismatch reason=%v present=%v err=%v", reason, ok, err)
	}
}

func TestDashscopeQwen38RejectsUnadmittedMultipleToolCalls(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Look up two values."}},
		Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup"}}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO}
	payload := []byte(`{"choices":[{"index":0,"finish_reason":"tool_calls","message":{"content":null,"tool_calls":[{"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{\"x\":1}"}},{"id":"call-2","type":"function","function":{"name":"lookup","arguments":"{\"x\":2}"}}]}}]}`)
	_, err := DashscopeQwen38NonStreamParser(payload, spec)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("multiple call reason=%v present=%v err=%v", reason, ok, err)
	}
}
