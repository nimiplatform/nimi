package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestQwen35SyncToolAndSchemaWireAndOutput(t *testing.T) {
	tool := gemma4ToolForTest(t, "lookup")
	toolSpec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Look up Paris."}},
		Tools: []*runtimev1.ToolSpec{tool}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO,
		Temperature: new(float32),
		Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED,
			Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN},
	}
	serialized, err := Qwen35TextBehaviorRequestSerializer(toolSpec, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		t.Fatal(err)
	}
	if body["tool_choice"] != "auto" || body["parallel_tool_calls"] != false || body["temperature"] != float64(0) ||
		body["chat_template_kwargs"].(map[string]any)["enable_thinking"] != false {
		t.Fatalf("Qwen tool wire = %#v", body)
	}
	response := []byte(`{"choices":[{"finish_reason":"tool_calls","message":{"content":"","tool_calls":[{"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{\"city\":\"Paris\"}"}}]}}]}`)
	result, err := Qwen35TextBehaviorNonStreamParser(response, toolSpec)
	if err != nil || len(result.Items) != 1 || result.Items[0].Kind != textbehavior.OrderedItemToolCall || result.Items[0].ToolCall.Id != "call-1" {
		t.Fatalf("Qwen tool result = %+v err=%v", result, err)
	}
	toolSpec.Input = append(toolSpec.Input,
		&runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
			{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: result.Items[0].ToolCall}}}},
			{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup", Result: structpb.NewStringValue("sunny")}}},
		}},
	)
	serialized, err = Qwen35TextBehaviorRequestSerializer(toolSpec, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		t.Fatal(err)
	}
	messages := body["messages"].([]any)
	if len(messages) != 3 || messages[2].(map[string]any)["tool_call_id"] != "call-1" {
		t.Fatalf("Qwen tool continuation = %#v", messages)
	}

	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"priority": map[string]any{"type": "string"}},
		"required": []any{"priority"}, "additionalProperties": false})
	structured := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return priority medium."}},
		ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA,
			JsonSchema: schema, Strict: true, SchemaName: "priority"},
	}
	serialized, err = Qwen35TextBehaviorRequestSerializer(structured, false)
	if err != nil {
		t.Fatal(err)
	}
	body = nil
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		t.Fatal(err)
	}
	format := body["response_format"].(map[string]any)
	if format["type"] != "json_schema" || format["json_schema"].(map[string]any)["strict"] != true || body["parallel_tool_calls"] != nil {
		t.Fatalf("Qwen strict schema wire = %#v", body)
	}
	valid := gemma4CompletionForTest(t, `{"priority":"medium"}`, "stop")
	if _, err := Qwen35TextBehaviorNonStreamParser(valid, structured); err != nil {
		t.Fatalf("Qwen valid schema output: %v", err)
	}
	invalid := gemma4CompletionForTest(t, `{"unexpected":true}`, "stop")
	if _, err := Qwen35TextBehaviorNonStreamParser(invalid, structured); textBehaviorReasonForDriverTest(err) != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("Qwen invalid schema output: %v", err)
	}
}

func TestQwen35AdvancedBehaviorRejectsUnverifiedModesAndMalformedOutput(t *testing.T) {
	tool := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Look up Paris."}},
		Tools: []*runtimev1.ToolSpec{gemma4ToolForTest(t, "lookup")}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO}
	for _, mutate := range []func(*runtimev1.TextGenerateScenarioSpec){
		func(spec *runtimev1.TextGenerateScenarioSpec) {
			spec.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED
		},
		func(spec *runtimev1.TextGenerateScenarioSpec) {
			spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
		},
		func(spec *runtimev1.TextGenerateScenarioSpec) {
			spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
		},
		func(spec *runtimev1.TextGenerateScenarioSpec) {
			spec.Tools = append(spec.Tools, gemma4ToolForTest(t, "other"))
		},
	} {
		copy := *tool
		mutate(&copy)
		if _, err := Qwen35TextBehaviorRequestSerializer(&copy, false); textBehaviorReasonForDriverTest(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("unverified Qwen option accepted: %v", err)
		}
	}
	if _, err := Qwen35TextBehaviorRequestSerializer(tool, true); textBehaviorReasonForDriverTest(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("Qwen advanced stream accepted: %v", err)
	}
	for _, response := range [][]byte{
		[]byte(`{"choices":[{"finish_reason":"tool_calls","message":{"content":"text","tool_calls":[{},{}]}}]}`),
		[]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"answer","reasoning_content":"private reasoning"}}]}`),
	} {
		if _, err := Qwen35TextBehaviorNonStreamParser(response, tool); err == nil {
			t.Fatalf("invalid Qwen output accepted: %s", response)
		}
	}
}
