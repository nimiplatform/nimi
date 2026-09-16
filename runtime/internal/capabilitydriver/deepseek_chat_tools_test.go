package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func deepseekToolSpec(t *testing.T) *runtimev1.TextGenerateScenarioSpec {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}, "unit": map[string]any{"type": "string", "enum": []any{"C", "F"}}}, "required": []any{"city"}, "additionalProperties": false})
	if err != nil {
		t.Fatal(err)
	}
	return &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Check both cities."}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, MaxTokens: proto.Int32(8000), Temperature: proto.Float32(.2)}
}
func deepseekToolChunk(t *testing.T, delta map[string]any, finish any) []byte {
	t.Helper()
	b, err := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}})
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func deepseekCallChunk(index int, id, name, args string) map[string]any {
	f := map[string]any{"arguments": args}
	c := map[string]any{"index": index, "function": f}
	if id != "" {
		c["id"] = id
		c["type"] = "function"
	}
	if name != "" {
		f["name"] = name
	}
	return c
}
func TestDeepseekToolsSerializeChoicesAndOrderedRoundTrip(t *testing.T) {
	for _, choice := range []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL} {
		s := deepseekToolSpec(t)
		s.ToolChoice = choice
		if choice == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL {
			s.ToolChoiceName = "lookup"
		}
		s.Input = append(s.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
			{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "Checking.\n"}}}}},
			{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: &runtimev1.ToolCall{Id: "call-a", Name: "lookup", ArgumentsJson: `{"city":"北京"}`}}}}},
			{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-a", ToolName: "lookup", Result: structpb.NewStringValue("not found"), IsError: true}}},
		}})
		before := proto.Clone(s)
		for _, stream := range []bool{false, true} {
			serialized, err := DeepseekChatRequestSerializer(s, stream)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			if err = json.Unmarshal(serialized.Payload, &body); err != nil {
				t.Fatal(err)
			}
			if body["thinking"].(map[string]any)["type"] != "disabled" || body["max_tokens"] != float64(8000) || body["stream"] != stream {
				t.Fatal(body)
			}
			if body["model"] != nil || body["response_format"] != nil {
				t.Fatal("adapter selected a model or changed response format")
			}
			function := body["tools"].([]any)[0].(map[string]any)["function"].(map[string]any)
			if function["strict"] != nil || len(function["parameters"].(map[string]any)["required"].([]any)) != 1 {
				t.Fatal("schema silently made strict")
			}
			msgs := body["messages"].([]any)
			if len(msgs) != 3 {
				t.Fatal(msgs)
			}
			a := msgs[1].(map[string]any)
			r := msgs[2].(map[string]any)
			if a["content"] != "Checking.\n" || a["tool_calls"].([]any)[0].(map[string]any)["id"] != "call-a" || r["tool_call_id"] != "call-a" || r["content"] != `{"error":"not found"}` {
				t.Fatal(msgs)
			}
			if choice == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL && body["tool_choice"].(map[string]any)["function"].(map[string]any)["name"] != "lookup" {
				t.Fatal(body)
			}
		}
		if !proto.Equal(s, before) {
			t.Fatal("input was mutated")
		}
	}
}
func TestDeepseekToolsStreamPreservesParallelCallsAndWaitsForDone(t *testing.T) {
	s := deepseekToolSpec(t)
	a, err := DeepseekChatStreamAssembler(s)
	if err != nil {
		t.Fatal(err)
	}
	frames := [][]byte{
		deepseekToolChunk(t, map[string]any{"role": "assistant", "content": " checking\n"}, nil),
		deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "id-a", "lookup", `{"city":"北`), deepseekCallChunk(1, "id-b", "lookup", `{"city":"Par`)}}, nil),
		deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(1, "", "", `is"}`), deepseekCallChunk(0, "", "", `京"}`)}}, nil),
	}
	for _, frame := range frames {
		ds, err := a.Append(frame)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range ds {
			if d.ToolCall != nil {
				t.Fatal("partial call escaped")
			}
		}
	}
	ds, err := a.Append(deepseekToolChunk(t, map[string]any{}, "tool_calls"))
	if err != nil {
		t.Fatal(err)
	}
	if len(ds) != 2 || ds[0].ToolCall.GetId() != "id-a" || ds[1].ToolCall.GetId() != "id-b" || ds[0].ItemIndex != 1 || ds[1].ItemIndex != 2 {
		t.Fatalf("deltas=%+v", ds)
	}
	if _, err = a.Finish(); err == nil {
		t.Fatal("EOF without DONE accepted")
	}
	if _, err = a.Append([]byte(`{"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":9}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Append([]byte("[DONE]")); err != nil {
		t.Fatal(err)
	}
	result, err := a.Finish()
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 3 || result.Items[0].Text != " checking\n" || result.Items[1].ToolCall.GetArgumentsJson() != `{"city":"北京"}` || result.Usage.GetOutputTokens() != 9 || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		t.Fatalf("result=%+v", result)
	}
	if _, err = a.Append(frames[0]); err == nil {
		t.Fatal("frame after DONE accepted")
	}
}
func TestDeepseekToolsRejectInvalidCallsWithoutPublishing(t *testing.T) {
	tests := []struct {
		name, id, tool, args, finish string
		choice                       runtimev1.ToolChoiceMode
		want                         runtimev1.ReasonCode
	}{
		{name: "undeclared", id: "a", tool: "unknown", args: `{"city":"x"}`, finish: "tool_calls", want: runtimev1.ReasonCode_AI_TOOL_CALL_INVALID},
		{name: "schema", id: "a", tool: "lookup", args: `{"city":7}`, finish: "tool_calls", want: runtimev1.ReasonCode_AI_TOOL_CALL_INVALID},
		{name: "missing required", id: "a", tool: "lookup", args: `{}`, finish: "tool_calls", want: runtimev1.ReasonCode_AI_TOOL_CALL_INVALID},
		{name: "truncated JSON", id: "a", tool: "lookup", args: `{"city":`, finish: "tool_calls", want: runtimev1.ReasonCode_AI_TOOL_CALL_INVALID},
		{name: "length", id: "a", tool: "lookup", args: `{"city":`, finish: "length", want: runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE},
		{name: "refusal", id: "a", tool: "lookup", args: `{}`, finish: "content_filter", want: runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED},
		{name: "choice none", id: "a", tool: "lookup", args: `{"city":"x"}`, finish: "tool_calls", choice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, want: runtimev1.ReasonCode_AI_TOOL_CALL_INVALID},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := deepseekToolSpec(t)
			if tt.choice != 0 {
				s.ToolChoice = tt.choice
			}
			a, _ := DeepseekChatStreamAssembler(s)
			ds, err := a.Append(deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, tt.id, tt.tool, tt.args)}}, nil))
			if err == nil {
				var more []textbehavior.OrderedDelta
				more, err = a.Append(deepseekToolChunk(t, map[string]any{}, tt.finish))
				ds = append(ds, more...)
			}
			for _, d := range ds {
				if d.ToolCall != nil {
					t.Fatal("invalid call published")
				}
			}
			reason, _ := grpcerr.ExtractReasonCode(err)
			if reason != tt.want {
				t.Fatalf("reason=%v err=%v", reason, err)
			}
		})
	}
}
func TestDeepseekToolsSynchronousSchemaAndChoiceValidation(t *testing.T) {
	s := deepseekToolSpec(t)
	payload := []byte(`{"choices":[{"index":0,"message":{"content":null,"tool_calls":[{"id":"a","type":"function","function":{"name":"lookup","arguments":"{\"city\":\"北京\"}"}}]},"finish_reason":"tool_calls"}]}`)
	r, err := DeepseekChatNonStreamParser(payload, s)
	if err != nil || len(r.Items) != 1 || r.Items[0].ToolCall.GetId() != "a" {
		t.Fatalf("result=%+v err=%v", r, err)
	}
	s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE
	if _, err = DeepseekChatNonStreamParser(payload, s); err == nil {
		t.Fatal("none ignored")
	}
	s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED
	if _, err = DeepseekChatNonStreamParser([]byte(`{"choices":[{"index":0,"message":{"content":"no call"},"finish_reason":"stop"}]}`), s); err == nil {
		t.Fatal("required ignored")
	}
}
func TestDeepseekToolsRejectUnsupportedCombinationsAndRawReasoning(t *testing.T) {
	for _, mutate := range []func(*runtimev1.TextGenerateScenarioSpec){
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
		},
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
		},
		func(s *runtimev1.TextGenerateScenarioSpec) { s.TopK = proto.Int32(10) },
		func(s *runtimev1.TextGenerateScenarioSpec) { s.Seed = proto.Int64(1) },
	} {
		s := deepseekToolSpec(t)
		mutate(s)
		if _, err := DeepseekChatRequestSerializer(s, true); err == nil {
			t.Fatal("unsupported combination admitted")
		}
	}
	a, _ := DeepseekChatStreamAssembler(deepseekToolSpec(t))
	ds, err := a.Append(deepseekToolChunk(t, map[string]any{"reasoning_content": "private"}, nil))
	if err == nil || len(ds) != 0 {
		t.Fatal("raw reasoning was accepted or published")
	}
	a, _ = DeepseekChatStreamAssembler(deepseekToolSpec(t))
	_, _ = a.Append(deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "id-a", "lookup", `{"city":"x"}`)}}, nil))
	_, err = a.Append(deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "changed", "lookup", "")}}, nil))
	if err == nil {
		t.Fatal("conflicting ID admitted")
	}
	a, _ = DeepseekChatStreamAssembler(deepseekToolSpec(t))
	_, _ = a.Append(deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "a", "lookup", `{"city":"x"}`)}}, nil))
	if _, err = a.Append(deepseekToolChunk(t, map[string]any{"content": "late text"}, nil)); err == nil {
		t.Fatal("post-call text reordered")
	}
}
