package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func geminiToolTestSpec(t *testing.T) *runtimev1.TextGenerateScenarioSpec {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{
		"centimeters": map[string]any{"type": "number"},
	}, "required": []any{"centimeters"}, "additionalProperties": false})
	if err != nil {
		t.Fatal(err)
	}
	return &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Use the tool to convert 30 centimeters."}},
		Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION,
			Name: "lab_convert_centimeters", InputSchema: schema}},
		ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO,
	}
}

func geminiToolResponse(t *testing.T, signature string) []byte {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"choices": []any{map[string]any{"index": 0, "finish_reason": "tool_calls", "message": map[string]any{
			"content": nil, "tool_calls": []any{map[string]any{
				"id": "function-call-1", "type": "function",
				"function":      map[string]any{"name": "lab_convert_centimeters", "arguments": `{"centimeters":30}`},
				"extra_content": map[string]any{"google": map[string]any{"thought_signature": signature}},
			}},
		}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestGemini38ToolSignatureRoundTripKeepsCallAndResultOrdered(t *testing.T) {
	spec := geminiToolTestSpec(t)
	initial, err := Gemini38FlashRequestSerializer(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var first map[string]any
	if err := json.Unmarshal(initial.Payload, &first); err != nil {
		t.Fatal(err)
	}
	if first["tool_choice"] != "auto" || len(first["tools"].([]any)) != 1 ||
		first["response_format"] != nil || first["model"] != nil {
		t.Fatalf("unexpected Gemini initial request: %+v", first)
	}
	parsed, err := Gemini38FlashNonStreamParser(geminiToolResponse(t, "opaque-sig-1"), spec)
	if err != nil || parsed.FinishReason != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL ||
		len(parsed.Items) != 2 || parsed.Items[0].ToolCall.GetName() != "lab_convert_centimeters" ||
		parsed.Items[1].ReasoningContinuity.GetKind() != gemini38ToolSignatureKind {
		t.Fatalf("Gemini signed call=%+v err=%v", parsed, err)
	}
	result, _ := structpb.NewValue(map[string]any{"inches": 11.811})
	spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: parsed.Items[0].ToolCall}}}},
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: parsed.Items[1].ReasoningContinuity}}}},
		{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "function-call-1", ToolName: "lab_convert_centimeters", Result: result}}},
	}})
	continued, err := Gemini38FlashRequestSerializer(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var second map[string]any
	if err := json.Unmarshal(continued.Payload, &second); err != nil {
		t.Fatal(err)
	}
	messages := second["messages"].([]any)
	if len(messages) != 3 || messages[1].(map[string]any)["role"] != "assistant" ||
		messages[2].(map[string]any)["role"] != "tool" {
		t.Fatalf("ordered continuation changed: %+v", messages)
	}
	returnedCall := messages[1].(map[string]any)["tool_calls"].([]any)[0].(map[string]any)
	returnedSignature := returnedCall["extra_content"].(map[string]any)["google"].(map[string]any)["thought_signature"]
	if returnedSignature != "opaque-sig-1" || messages[2].(map[string]any)["tool_call_id"] != "function-call-1" {
		t.Fatalf("signature or call identity lost: %+v", messages)
	}
	final, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{
		"index": 0, "finish_reason": "stop", "message": map[string]any{"content": "30 centimeters is 11.811 inches."},
	}}})
	output, err := Gemini38FlashNonStreamParser(final, spec)
	if err != nil || output.FinishReason != runtimev1.FinishReason_FINISH_REASON_STOP ||
		len(output.Items) != 1 || output.Items[0].Text != "30 centimeters is 11.811 inches." {
		t.Fatalf("final continuation=%+v err=%v", output, err)
	}
}

func TestGemini38ToolRejectsMissingSignatureAndUnsupportedControls(t *testing.T) {
	spec := geminiToolTestSpec(t)
	if _, err := Gemini38FlashNonStreamParser(geminiToolResponse(t, ""), spec); textBehaviorReasonForTest(err) != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("unsigned Gemini call was accepted: %v", err)
	}
	spec.TopK = new(int32)
	if _, err := Gemini38FlashRequestSerializer(spec, false); textBehaviorReasonForTest(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("unverified sampling control was accepted: %v", err)
	}
	spec.TopK = nil
	if _, err := Gemini38FlashRequestSerializer(spec, true); textBehaviorReasonForTest(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("unverified tool stream was accepted: %v", err)
	}
}

func textBehaviorReasonForTest(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}
