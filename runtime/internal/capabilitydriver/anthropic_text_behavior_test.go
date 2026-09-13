package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/types/known/structpb"
)

func anthropicBehaviorTestSpec(t *testing.T) *runtimev1.TextGenerateScenarioSpec {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"q": map[string]any{"type": "string"}}, "required": []any{"q"}, "additionalProperties": false})
	if err != nil {
		t.Fatal(err)
	}
	return &runtimev1.TextGenerateScenarioSpec{
		Input:      []*runtimev1.ChatMessage{{Role: "user", Content: "Find a document"}},
		Tools:      []*runtimev1.ToolSpec{{Name: "lookup", Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, InputSchema: schema}},
		ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED,
	}
}

func TestAnthropicBehaviorMapsOrderedToolResultsAndChoices(t *testing.T) {
	spec := anthropicBehaviorTestSpec(t)
	spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: " Checking "}}}}},
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: `{"q":"上海"}`}}}}},
		{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup", Result: structpb.NewStringValue("not available"), IsError: true}}},
	}})
	for mode, expected := range map[runtimev1.ToolChoiceMode]string{
		runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO: "auto", runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE: "none", runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED: "any", runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL: "tool",
	} {
		spec.ToolChoice, spec.ToolChoiceName = mode, "lookup"
		serialized, err := AnthropicTextBehaviorRequestSerializer(spec, true)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		if err := json.Unmarshal(serialized.Payload, &body); err != nil {
			t.Fatal(err)
		}
		if _, hasModel := body["model"]; hasModel {
			t.Fatal("adapter selected a model")
		}
		if body["tool_choice"].(map[string]any)["type"] != expected {
			t.Fatalf("choice = %v", body["tool_choice"])
		}
		messages := body["messages"].([]any)
		if len(messages) != 3 || messages[1].(map[string]any)["role"] != "assistant" || messages[2].(map[string]any)["role"] != "user" {
			t.Fatalf("roles = %v", messages)
		}
		blocks := messages[1].(map[string]any)["content"].([]any)
		if blocks[0].(map[string]any)["text"] != " Checking " || blocks[1].(map[string]any)["id"] != "call-1" {
			t.Fatalf("assistant order = %v", blocks)
		}
		result := messages[2].(map[string]any)["content"].([]any)[0].(map[string]any)
		if result["tool_use_id"] != "call-1" || result["is_error"] != true {
			t.Fatalf("result association = %v", result)
		}
	}
}

func TestAnthropicBehaviorStreamKeepsArgumentsPrivateUntilBlockStop(t *testing.T) {
	spec := anthropicBehaviorTestSpec(t)
	stream, _ := AnthropicTextBehaviorStreamAssembler(spec)
	frames := []string{
		`{"type":"message_start","message":{"content":[],"usage":{"input_tokens":10,"output_tokens":1}}}`,
		`{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Checking "}}`,
		`{"type":"content_block_stop","index":0}`,
		`{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-1","name":"lookup","input":{}}}`,
		`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"q\":\"上"}}`,
		`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"海\"}"}}`,
	}
	for _, frame := range frames {
		deltas, err := stream.Append([]byte(frame))
		if err != nil {
			t.Fatal(err)
		}
		for _, delta := range deltas {
			if delta.ToolCall != nil {
				t.Fatal("partial call was published")
			}
		}
	}
	deltas, err := stream.Append([]byte(`{"type":"content_block_stop","index":1}`))
	if err != nil || len(deltas) != 1 || deltas[0].ToolCall.GetArgumentsJson() != `{"q":"上海"}` {
		t.Fatalf("complete call = %+v %v", deltas, err)
	}
	if _, err := stream.Finish(); err == nil {
		t.Fatal("missing message_stop accepted")
	}
	for _, frame := range []string{`{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":12}}`, `{"type":"message_stop"}`} {
		if _, err := stream.Append([]byte(frame)); err != nil {
			t.Fatal(err)
		}
	}
	result, err := stream.Finish()
	if err != nil || len(result.Items) != 2 || result.Items[0].Text != "Checking " || result.Items[1].ToolCall.GetId() != "call-1" || result.Usage.GetOutputTokens() != 12 {
		t.Fatalf("result = %+v %v", result, err)
	}
}

func TestAnthropicBehaviorSyncPreservesMixedOrderAndValidatesArguments(t *testing.T) {
	spec := anthropicBehaviorTestSpec(t)
	result, err := AnthropicTextBehaviorNonStreamParser([]byte(`{"content":[{"type":"tool_use","id":"call-1","name":"lookup","input":{"q":"one"}},{"type":"text","text":" then "},{"type":"tool_use","id":"call-2","name":"lookup","input":{"q":"two"}}],"stop_reason":"tool_use","usage":{"input_tokens":1,"output_tokens":2}}`), spec)
	if err != nil || len(result.Items) != 3 || result.Items[1].Kind != textbehavior.OrderedItemText || result.Items[1].Text != " then " {
		t.Fatalf("mixed order = %+v %v", result, err)
	}
	if _, err := AnthropicTextBehaviorNonStreamParser([]byte(`{"content":[{"type":"tool_use","id":"call-1","name":"lookup","input":{"q":42}}],"stop_reason":"tool_use"}`), spec); err == nil {
		t.Fatal("schema-invalid arguments accepted")
	}
}

func TestAnthropicBehaviorUsesNativeStructuredOutputWithoutSchemaRepair(t *testing.T) {
	spec := anthropicBehaviorTestSpec(t)
	spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: spec.Tools[0].InputSchema, Strict: true}
	spec.Tools = nil
	serialized, err := AnthropicTextBehaviorRequestSerializer(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		t.Fatal(err)
	}
	format := body["output_config"].(map[string]any)["format"].(map[string]any)
	if format["type"] != "json_schema" {
		t.Fatalf("native format = %v", format)
	}
	if _, err := AnthropicTextBehaviorNonStreamParser([]byte(`{"content":[{"type":"text","text":"{\"q\":\"yes\"}"}],"stop_reason":"end_turn"}`), spec); err != nil {
		t.Fatal(err)
	}
	for _, output := range []string{`{"content":[{"type":"text","text":"{\"q\":2}"}],"stop_reason":"end_turn"}`, `{"content":[{"type":"text","text":"{\"q\":\"yes\"}"}],"stop_reason":"max_tokens"}`} {
		if _, err := AnthropicTextBehaviorNonStreamParser([]byte(output), spec); err == nil {
			t.Fatal("invalid/truncated structured output accepted")
		}
	}
	spec.ResponseFormat.JsonSchema.Fields["minProperties"] = structpb.NewNumberValue(1)
	if _, err := AnthropicTextBehaviorRequestSerializer(spec, false); err == nil {
		t.Fatal("unsupported constraint erased")
	}
}
