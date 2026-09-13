package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/types/known/structpb"
)

func codexBehaviorSpec(t *testing.T) *runtimev1.TextGenerateScenarioSpec {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"q": map[string]any{"type": "string"}}, "required": []any{"q"}, "additionalProperties": false})
	if err != nil {
		t.Fatal(err)
	}
	return &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "look up both"}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED}
}

func TestCodexBehaviorPreservesOpaqueContinuityAndResultAssociation(t *testing.T) {
	spec := codexBehaviorSpec(t)
	result, err := CodexTextBehaviorNonStreamParser([]byte(`{"status":"completed","output":[{"type":"reasoning","id":"rs_1","encrypted_content":"opaque-test-value","summary":[]},{"type":"function_call","id":"fc_1","call_id":"call_1","name":"lookup","arguments":"{\"q\":\"one\"}"},{"type":"message","id":"msg_1","content":[{"type":"output_text","text":" then "}]},{"type":"function_call","id":"fc_2","call_id":"call_2","name":"lookup","arguments":"{\"q\":\"two\"}"}]}`), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 4 || result.Items[0].Kind != textbehavior.OrderedItemReasoningContinuity || result.Items[1].ToolCall.Id != "call_1" || result.Items[2].Text != " then " {
		t.Fatalf("ordered result = %+v", result)
	}
	turn := &runtimev1.ChatMessage{Role: "assistant"}
	turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: result.Items[0].ReasoningContinuity}}}})
	for _, index := range []int{1, 3} {
		turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: result.Items[index].ToolCall}}}})
	}
	for _, index := range []int{3, 1} {
		call := result.Items[index].ToolCall
		turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: call.Id, ToolName: call.Name, Result: structpb.NewStringValue("failed"), IsError: true}}})
	}
	spec.Input = append(spec.Input, turn)
	for _, publicStream := range []bool{false, true} {
		request, err := CodexTextBehaviorRequestSerializer(spec, publicStream)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		if err := json.Unmarshal(request.Payload, &body); err != nil {
			t.Fatal(err)
		}
		input := body["input"].([]any)
		if body["store"] != false || body["stream"] != true || body["tool_choice"] != "required" || input[1].(map[string]any)["encrypted_content"] != "opaque-test-value" || input[4].(map[string]any)["call_id"] != "call_2" || input[5].(map[string]any)["call_id"] != "call_1" {
			t.Fatalf("request projection = %v", body)
		}
		var failure map[string]any
		_ = json.Unmarshal([]byte(input[4].(map[string]any)["output"].(string)), &failure)
		if failure["isError"] != true {
			t.Fatal("tool failure status lost")
		}
	}
}

func TestCodexBehaviorStreamCollectsInterleavedCompleteCallsAndRequiresTerminal(t *testing.T) {
	stream, _ := CodexTextBehaviorStreamAssembler(codexBehaviorSpec(t))
	frames := []string{
		`{"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"lookup","arguments":""}}`,
		`{"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_2","call_id":"call_2","name":"lookup","arguments":""}}`,
		`{"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_1","delta":"{\"q\":\"上"}`,
		`{"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","id":"fc_2","call_id":"call_2","name":"lookup","arguments":"{\"q\":\"two\"}"}}`,
		`{"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_1","delta":"海\"}"}`,
	}
	for _, frame := range frames {
		deltas, err := stream.Append([]byte(frame))
		if err != nil {
			t.Fatal(err)
		}
		if len(deltas) > 0 {
			t.Fatal("unfinished or out-of-order call exposed")
		}
	}
	deltas, err := stream.Append([]byte(`{"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"lookup","arguments":"{\"q\":\"上海\"}"}}`))
	if err != nil || len(deltas) != 2 || deltas[0].ToolCall.GetId() != "call_1" || deltas[1].ToolCall.GetId() != "call_2" {
		t.Fatalf("complete ordered calls = %+v %v", deltas, err)
	}
	if _, err := stream.Finish(); err == nil {
		t.Fatal("missing terminal accepted")
	}
	if _, err := stream.Append([]byte(`{"type":"response.completed","response":{"status":"completed","output":[],"usage":{"input_tokens":3,"output_tokens":7}}}`)); err != nil {
		t.Fatal(err)
	}
	result, err := stream.Finish()
	if err != nil || result.Usage.GetOutputTokens() != 7 || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		t.Fatalf("result = %+v %v", result, err)
	}
}

func TestCodexBehaviorStructuredOutputIsNativeAndValidatesFinalValue(t *testing.T) {
	spec := codexBehaviorSpec(t)
	spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: spec.Tools[0].InputSchema, Strict: true}
	spec.Tools, spec.ToolChoice = nil, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED
	request, err := CodexTextBehaviorRequestSerializer(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(request.Payload, &body)
	if body["text"].(map[string]any)["format"].(map[string]any)["type"] != "json_schema" {
		t.Fatal("not native structured output")
	}
	for _, value := range []string{`{"q":"valid"}`, `{"q":2}`} {
		response, _ := json.Marshal(map[string]any{"status": "completed", "output": []any{map[string]any{"type": "message", "id": "msg_1", "content": []any{map[string]any{"type": "output_text", "text": value}}}}})
		_, err := CodexTextBehaviorNonStreamParser(response, spec)
		if (err == nil) != (value == `{"q":"valid"}`) {
			t.Fatalf("schema result %s: %v", value, err)
		}
	}
	spec.ResponseFormat.JsonSchema.Fields["minLength"] = structpb.NewNumberValue(1)
	if _, err := CodexTextBehaviorRequestSerializer(spec, true); err == nil {
		t.Fatal("unsupported schema constraint erased")
	}
}

func TestCodexBehaviorRejectsInvalidArgumentsAndCarrierOnlyOutput(t *testing.T) {
	for _, response := range []string{
		`{"status":"completed","output":[{"type":"function_call","id":"fc_1","call_id":"call_1","name":"lookup","arguments":"{\"q\":2}"}]}`,
		`{"status":"completed","output":[{"type":"reasoning","id":"rs_1","encrypted_content":"test"}]}`,
	} {
		if _, err := CodexTextBehaviorNonStreamParser([]byte(response), codexBehaviorSpec(t)); err == nil {
			t.Fatal("invalid output accepted")
		}
	}
}
