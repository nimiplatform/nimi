package capabilitydriver

import (
	"encoding/json"
	"math"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestMimoToolsSerializeNativeParametersAndOrderedResultRoundTrip(t *testing.T) {
	s := deepseekToolSpec(t)
	s.SystemPrompt = "First instruction."
	s.Input = append(s.Input,
		&runtimev1.ChatMessage{Role: "system", Content: "Keep this later instruction here."},
		&runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
			{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "  checking\n"}}}}},
			{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: `{"city":"北京"}`}}}}},
			{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup", IsError: true, Result: structpb.NewStringValue("not found")}}},
		}})
	before := proto.Clone(s)
	for _, stream := range []bool{false, true} {
		request, err := MimoChatRequestSerializer(s, stream)
		if err != nil {
			t.Fatal(err)
		}
		var b map[string]any
		if err = json.Unmarshal(request.Payload, &b); err != nil {
			t.Fatal(err)
		}
		if b["max_completion_tokens"] != float64(8000) || b["max_tokens"] != nil || b["stream_options"] != nil || b["model"] != nil || b["stream"] != stream || b["thinking"].(map[string]any)["type"] != "disabled" || b["tool_choice"] != "auto" {
			t.Fatalf("wire mapping=%v", b)
		}
		msgs := b["messages"].([]any)
		if len(msgs) != 5 || msgs[2].(map[string]any)["role"] != "system" || msgs[2].(map[string]any)["content"] != "Keep this later instruction here." {
			t.Fatal(msgs)
		}
		a, r := msgs[3].(map[string]any), msgs[4].(map[string]any)
		if a["content"] != "  checking\n" || a["tool_calls"].([]any)[0].(map[string]any)["id"] != "call-1" || r["tool_call_id"] != "call-1" || r["content"] != `{"error":"not found"}` {
			t.Fatal(msgs)
		}
		fn := b["tools"].([]any)[0].(map[string]any)["function"].(map[string]any)
		if fn["strict"] != nil || len(fn["parameters"].(map[string]any)["required"].([]any)) != 1 {
			t.Fatal("original schema changed")
		}
	}
	if !proto.Equal(s, before) {
		t.Fatal("input mutated")
	}
}

func TestMimoToolsRefuseUnsupportedChoicesAndParameters(t *testing.T) {
	cases := map[string]func(*runtimev1.TextGenerateScenarioSpec){
		"none": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE
		},
		"required": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED
		},
		"named": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL
			s.ToolChoiceName = "lookup"
		},
		"json": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
		},
		"reasoning": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
		},
		"temperature": func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(1.6) },
		"nan":         func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(float32(math.NaN())) },
		"top-p":       func(s *runtimev1.TextGenerateScenarioSpec) { s.TopP = proto.Float32(0) },
		"max-tokens":  func(s *runtimev1.TextGenerateScenarioSpec) { s.MaxTokens = proto.Int32(131073) },
		"stop":        func(s *runtimev1.TextGenerateScenarioSpec) { s.Stop = []string{"1", "2", "3", "4", "5"} },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			s := deepseekToolSpec(t)
			mutate(s)
			if _, err := MimoChatRequestSerializer(s, true); err == nil {
				t.Fatal("unsupported request admitted")
			}
		})
	}
}

func TestMimoToolStreamKeepsParallelFragmentsPrivateAndRequiresTerminalEvidence(t *testing.T) {
	s := deepseekToolSpec(t)
	a, err := MimoChatStreamAssembler(s)
	if err != nil {
		t.Fatal(err)
	}
	for _, frame := range [][]byte{
		deepseekToolChunk(t, map[string]any{"content": " checking\n"}, nil),
		deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "a", "lookup", `{"city":"北`), deepseekCallChunk(1, "b", "lookup", `{"city":"Par`)}}, nil),
		deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(1, "", "", `is"}`), deepseekCallChunk(0, "", "", `京"}`)}}, nil),
	} {
		deltas, err := a.Append(frame)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range deltas {
			if d.ToolCall != nil {
				t.Fatal("partial tool escaped")
			}
		}
	}
	deltas, err := a.Append(deepseekToolChunk(t, map[string]any{}, "tool_calls"))
	if err != nil {
		t.Fatal(err)
	}
	if len(deltas) != 2 || deltas[0].ToolCall.GetId() != "a" || deltas[1].ToolCall.GetId() != "b" || deltas[0].ItemIndex != 1 || deltas[1].ToolCall.GetArgumentsJson() != `{"city":"Paris"}` {
		t.Fatalf("deltas=%+v", deltas)
	}
	if _, err = a.Finish(); err == nil {
		t.Fatal("missing DONE accepted")
	}
	if _, err = a.Append([]byte(`{"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":12}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Append([]byte("[DONE]")); err != nil {
		t.Fatal(err)
	}
	result, err := a.Finish()
	if err != nil || len(result.Items) != 3 || result.Items[0].Text != " checking\n" || result.Usage.GetOutputTokens() != 12 {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestMimoToolOutputsFailClosed(t *testing.T) {
	for _, tc := range []struct {
		name, finish, args string
		reason             runtimev1.ReasonCode
	}{
		{"schema", "tool_calls", `{"city":7}`, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID},
		{"length", "length", `{"city":"北京"}`, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE},
		{"repetition", "repetition_truncation", `{"city":"北京"}`, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE},
		{"filtered", "content_filter", `{"city":"北京"}`, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := deepseekToolSpec(t)
			payload, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "finish_reason": tc.finish, "message": map[string]any{"tool_calls": []any{map[string]any{"id": "call-a", "type": "function", "function": map[string]any{"name": "lookup", "arguments": tc.args}}}}}}})
			_, err := MimoChatNonStreamParser(payload, s)
			reason, _ := grpcerr.ExtractReasonCode(err)
			if reason != tc.reason {
				t.Fatalf("nonstream err=%v", err)
			}
			a, _ := MimoChatStreamAssembler(s)
			if _, err := a.Append(deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "a", "lookup", tc.args)}}, nil)); err != nil {
				t.Fatal(err)
			}
			deltas, err := a.Append(deepseekToolChunk(t, map[string]any{}, tc.finish))
			reason, _ = grpcerr.ExtractReasonCode(err)
			if reason != tc.reason {
				t.Fatalf("stream err=%v", err)
			}
			for _, d := range deltas {
				if d.ToolCall != nil {
					t.Fatal("failed tool escaped")
				}
			}
		})
	}
	s := deepseekToolSpec(t)
	call := []byte(`{"choices":[{"index":0,"message":{"tool_calls":[{"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{\"city\":\"北京\"}"}}]},"finish_reason":"tool_calls"}]}`)
	toolResult, err := MimoChatNonStreamParser(call, s)
	if err != nil || len(toolResult.Items) != 1 || toolResult.Items[0].ToolCall.GetId() != "call-1" || toolResult.Items[0].ToolCall.GetArgumentsJson() != `{"city":"北京"}` || toolResult.FinishReason != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		t.Fatalf("synchronous tool result=%+v err=%v", toolResult, err)
	}
	good := []byte(`{"choices":[{"index":0,"message":{"content":"  done\n"},"finish_reason":"stop"}]}`)
	r, err := MimoChatNonStreamParser(good, s)
	if err != nil || len(r.Items) != 1 || r.Items[0].Kind != textbehavior.OrderedItemText || r.Items[0].Text != "  done\n" {
		t.Fatalf("result=%+v err=%v", r, err)
	}
}
