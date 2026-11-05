package capabilitydriver

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestQwen38OmniReasoningEffortAndExactReplay(t *testing.T) {
	p := Qwen38OmniTextBehavior{}
	spec := deepseekToolSpec(t)
	spec.Temperature = nil
	raw := " native\r\n思考 😀 "
	response, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "finish_reason": "tool_calls", "message": map[string]any{"reasoning_content": raw, "content": "Checking.", "tool_calls": []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}}}}}})
	result, err := p.Parse(response, spec)
	if err != nil || len(result.Items) != 3 || result.Items[0].Kind != textbehavior.OrderedItemReasoningContinuity || result.Items[1].Text != "Checking." {
		t.Fatalf("parse: %+v %v", result, err)
	}
	var recovered string
	_ = json.Unmarshal(result.Items[0].ReasoningContinuity.Payload, &recovered)
	if recovered != raw {
		t.Fatal("native whitespace changed")
	}
	spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: result.Items[0].ReasoningContinuity}}}},
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "Checking."}}}}},
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: result.Items[2].ToolCall}}}},
		{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup", Result: structpb.NewStringValue("tool result")}}},
	}})
	wire, err := p.Serialize(spec, true)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	if _, present := body["reasoning_effort"]; present {
		t.Fatal("native default replaced")
	}
	if body["preserve_thinking"] != true || body["enable_search"] != false || body["messages"].([]any)[1].(map[string]any)["reasoning_content"] != raw {
		t.Fatal("replay or delegated behavior changed")
	}
	bad := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	bad.Input[1].TurnItems[0].GetOutput().GetReasoningContinuity().Kind = "other-model"
	if _, err = p.Serialize(bad, false); err == nil {
		t.Fatal("cross-model replay accepted")
	}
	for _, effort := range []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT} {
		spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: effort}}
		if _, err = p.Serialize(spec, false); err != nil {
			t.Fatalf("effort %v: %v", effort, err)
		}
	}
	// Native history from a disabled turn has no reasoning to reconstruct.
	spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
	spec.Input[1].TurnItems = spec.Input[1].TurnItems[1:]
	wire, err = p.Serialize(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(wire.Payload, &body)
	if body["reasoning_effort"] != "none" {
		t.Fatal("explicit off ignored")
	}
}

func TestQwen38OmniCombinedMediaEnvelopeAndLimits(t *testing.T) {
	p := Qwen38OmniTextBehavior{}
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Compare these inputs"}},
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "https://media.example/image.png"}}},
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL, Content: &runtimev1.ChatContentPart_AudioUrl{AudioUrl: "data:audio/wav;base64,AQIDBA=="}},
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL, Content: &runtimev1.ChatContentPart_VideoUrl{VideoUrl: "data:video/mp4;base64,AQIDBA=="}},
	}}}}
	wire, err := p.Serialize(spec, true)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	parts := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
	if len(parts) != 4 || parts[2].(map[string]any)["input_audio"].(map[string]any)["data"] != "data:;base64,AQIDBA==" || parts[3].(map[string]any)["video_url"].(map[string]any)["url"] != "data:;base64,AQIDBA==" {
		t.Fatal("media envelope or order changed")
	}
	for _, location := range []string{"data:audio/wav;base64," + strings.Repeat("A", 10_000_000), "data:audio/ogg;base64,AQIDBA==", "file:///private.wav", "https://media.example/audio"} {
		spec.Input[0].Parts[2].Content = &runtimev1.ChatContentPart_AudioUrl{AudioUrl: location}
		if _, err = p.Serialize(spec, true); err == nil {
			t.Fatalf("unsupported media accepted: %.50s", location)
		}
	}
}

func TestQwen38OmniStreamSeparatesReplayAndRequiresTerminal(t *testing.T) {
	p := Qwen38OmniTextBehavior{}
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Reply"}}}
	stream, err := p.Stream(spec)
	if err != nil {
		t.Fatal(err)
	}
	for _, chunk := range []string{
		`{"choices":[{"index":0,"delta":{"reasoning_content":"private"}}]}`,
		`{"choices":[{"index":0,"delta":{"content":"Answer."},"finish_reason":"stop"}]}`,
		`{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}}`,
		`[DONE]`,
	} {
		if _, err = stream.Append([]byte(chunk)); err != nil {
			t.Fatal(err)
		}
	}
	result, err := stream.Finish()
	if err != nil || len(result.Items) != 2 || result.Items[1].Text != "Answer." || result.Usage.GetOutputTokens() != 20 {
		t.Fatalf("finish %+v %v", result, err)
	}
	short, _ := p.Stream(spec)
	_, _ = short.Append([]byte(`{"choices":[{"index":0,"delta":{"reasoning_content":"private"}}]}`))
	if _, err = short.Finish(); err == nil {
		t.Fatal("reasoning-only stream accepted")
	}
}
