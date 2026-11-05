package capabilitydriver

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGLM53NativeReasoningRoundTripPreservesOriginalBytesAndExactModel(t *testing.T) {
	for _, model := range []string{"glm-5.3", "glm-5.3-flash", "glm-5.3-flashx", "glm-5.3-flashx-legal"} {
		t.Run(model, func(t *testing.T) {
			p, err := NewGLM53TextBehavior(model)
			if err != nil {
				t.Fatal(err)
			}
			spec := deepseekToolSpec(t)
			raw := "  原生推理\r\n\t preserve whitespace 😀  "
			wantCarrier, _ := json.Marshal(raw)
			response, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "finish_reason": "tool_calls", "message": map[string]any{"reasoning_content": raw, "content": "Checking.", "tool_calls": []any{map[string]any{"id": "call-original", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}}}}}, "usage": map[string]any{"prompt_tokens": 12, "completion_tokens": 34}})
			result, err := p.Parse(response, spec)
			if err != nil || len(result.Items) != 3 || result.Items[0].Kind != textbehavior.OrderedItemReasoningContinuity || string(result.Items[0].ReasoningContinuity.Payload) != string(wantCarrier) || result.Items[1].Text != "Checking." || result.Items[2].ToolCall.Id != "call-original" || result.Usage.OutputTokens != 34 {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			carrier := result.Items[0].ReasoningContinuity
			spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
				{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: carrier}}}},
				{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "Checking."}}}}},
				{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: result.Items[2].ToolCall}}}},
				{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-original", ToolName: "lookup", Result: structpb.NewStringValue("unavailable"), IsError: true}}},
			}})
			wire, err := p.Serialize(spec, true)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			_ = json.Unmarshal(wire.Payload, &body)
			messages := body["messages"].([]any)
			if body["model"] != model || body["tool_stream"] != true || body["thinking"].(map[string]any)["clear_thinking"] != false || messages[1].(map[string]any)["reasoning_content"] != raw || messages[2].(map[string]any)["tool_call_id"] != "call-original" {
				t.Fatal("native replay or result association changed")
			}
			for _, change := range []func(*runtimev1.TextGenerateScenarioSpec){
				func(s *runtimev1.TextGenerateScenarioSpec) { s.Input[1].TurnItems = s.Input[1].TurnItems[1:] },
				func(s *runtimev1.TextGenerateScenarioSpec) {
					s.Input[1].TurnItems[0].GetOutput().GetReasoningContinuity().Kind = "glm.chat.native-reasoning-replay.other"
				},
				func(s *runtimev1.TextGenerateScenarioSpec) {
					s.Input[1].TurnItems[0].GetOutput().GetReasoningContinuity().Version = 2
				},
				func(s *runtimev1.TextGenerateScenarioSpec) {
					s.Input[1].TurnItems[0].GetOutput().GetReasoningContinuity().Payload = []byte(strings.Repeat("x", 65537))
				},
				func(s *runtimev1.TextGenerateScenarioSpec) {
					s.Input[1].TurnItems[0], s.Input[1].TurnItems[1] = s.Input[1].TurnItems[1], s.Input[1].TurnItems[0]
				},
			} {
				bad := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
				change(bad)
				_, err := p.Serialize(bad, false)
				if code, _ := grpcerr.ExtractReasonCode(err); code != runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID {
					t.Fatalf("invalid replay: %v", err)
				}
			}
		})
	}
}

func TestGLM53StreamKeepsPrivateReasoningBeforeCompleteCallsAndRequiresDONE(t *testing.T) {
	p, _ := NewGLM53TextBehavior("glm-5.3")
	spec := deepseekToolSpec(t)
	a, _ := p.Stream(spec)
	var published []textbehavior.OrderedDelta
	chunks := [][]byte{
		deepseekToolChunk(t, map[string]any{"reasoning_content": "  原生"}, nil),
		deepseekToolChunk(t, map[string]any{"reasoning_content": "\n推理 "}, nil),
		deepseekToolChunk(t, map[string]any{"content": "Checking. "}, nil),
		deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "call-1", "lookup", `{"city":`)}}, nil),
		deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "", "", `"Paris"}`)}}, "tool_calls"),
	}
	for i, chunk := range chunks {
		d, err := a.Append(chunk)
		if err != nil {
			t.Fatal(err)
		}
		if i < 2 && len(d) != 0 {
			t.Fatal("partial native reasoning published")
		}
		for _, v := range d {
			if v.Kind == textbehavior.OrderedItemReasoningSummary || strings.Contains(v.Text, "原生") {
				t.Fatal("raw reasoning displayed")
			}
		}
		for _, delta := range d {
			if delta.HasPublicPayload() {
				published = append(published, delta)
			}
		}
	}
	if _, err := a.Finish(); err == nil {
		t.Fatal("missing DONE succeeded")
	}
	if _, err := a.Append([]byte("[DONE]")); err != nil {
		t.Fatal(err)
	}
	result, err := a.Finish()
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 3 || string(result.Items[0].ReasoningContinuity.Payload) != `"  原生\n推理 "` || result.Items[2].ToolCall.ArgumentsJson != `{"city":"Paris"}` || published[0].Kind != textbehavior.OrderedItemReasoningContinuity || !published[0].ItemCompleted {
		t.Fatalf("ordered result=%+v deltas=%+v", result, published)
	}
	for _, v := range published {
		if v.Kind == textbehavior.OrderedItemToolCall && (v.ItemIndex != 2 || !v.ItemCompleted) {
			t.Fatal("partial/misindexed call")
		}
	}
	for _, bad := range [][]byte{deepseekToolChunk(t, map[string]any{"reasoning_content": strings.Repeat("x", 65537)}, nil), []byte(`{"choices":[{"index":0,"delta":{"reasoning_content":"only thinking"},"finish_reason":"stop"}]}`)} {
		x, _ := p.Stream(spec)
		if _, err := x.Append(bad); err == nil {
			t.Fatal("oversized or reasoning-only response succeeded")
		}
	}
}

func TestGLM53ControlsAndImageBoundariesAreExact(t *testing.T) {
	p, _ := NewGLM53TextBehavior("glm-5.3-flash")
	spec := deepseekVisionSpec(deepseekVisionImage(t, 2))
	spec.Temperature = proto.Float32(.2)
	spec.TopP = proto.Float32(.95)
	wire, err := p.Serialize(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	parts := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
	if parts[1].(map[string]any)["image_url"].(map[string]any)["url"] != spec.Input[0].Parts[1].GetImageUrl().Url {
		t.Fatal("image bytes changed")
	}
	for _, effort := range []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM} {
		spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: effort}}
		if _, err := p.Serialize(spec, true); err != nil {
			t.Fatal(err)
		}
	}
	for _, change := range []func(*runtimev1.TextGenerateScenarioSpec){
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning.Activation = runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED
		},
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning.Presentation = runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY
		},
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning.Intensity = &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM}
		},
		func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(.123) },
		func(s *runtimev1.TextGenerateScenarioSpec) { s.Input[0].Parts[1].GetImageUrl().Detail = "high" },
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Input[0].Parts[1].GetImageUrl().Url = deepseekVisionImage(t, 6001)
		},
		func(s *runtimev1.TextGenerateScenarioSpec) { s.Input[0].Role = "assistant" },
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}
		},
	} {
		bad := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
		change(bad)
		if _, err := p.Serialize(bad, false); err == nil {
			t.Fatal("unsupported GLM input admitted")
		}
	}
	flagship, _ := NewGLM53TextBehavior("glm-5.3")
	if _, err := flagship.Serialize(spec, false); err == nil {
		t.Fatal("flagship gained vision")
	}
	plain := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON."}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}
	r, err := p.Parse([]byte(`{"choices":[{"index":0,"message":{"reasoning_content":"private","content":"{\"ok\":true}"},"finish_reason":"stop"}]}`), plain)
	if err != nil || len(r.Items) != 2 || !reflect.DeepEqual(r.Items[1:], []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemText, Text: `{"ok":true}`}}) || r.Items[0].Kind != textbehavior.OrderedItemReasoningContinuity {
		t.Fatalf("hidden JSON=%+v %v", r, err)
	}
}

func TestNativeReasoningReplayPreservesExplicitEmptyString(t *testing.T) {
	p, _ := NewGLM53TextBehavior("glm-5.3")
	spec := deepseekToolSpec(t)
	result, err := p.Parse([]byte(`{"choices":[{"index":0,"message":{"reasoning_content":"","content":"","tool_calls":[{"id":"a","type":"function","function":{"name":"lookup","arguments":"{\"city\":\"Paris\"}"}}]},"finish_reason":"tool_calls"}]}`), spec)
	if err != nil || len(result.Items) != 2 || string(result.Items[0].ReasoningContinuity.Payload) != `""` {
		t.Fatalf("explicit empty native string lost: %v %v", result, err)
	}
	value, err := readNativeReasoningReplay(result.Items[0].ReasoningContinuity, p.ContinuityKind())
	if err != nil || value != "" {
		t.Fatal("native empty replay changed")
	}
	for _, payload := range []string{`null`, `{}`, `"" "extra"`} {
		if _, err := readNativeReasoningReplay(&runtimev1.ReasoningContinuityCarrier{Kind: p.ContinuityKind(), Version: 1, Payload: []byte(payload)}, p.ContinuityKind()); err == nil {
			t.Fatal("malformed replay accepted")
		}
	}
}
