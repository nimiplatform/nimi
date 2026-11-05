package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/gif"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func mistralTestSpec(t *testing.T) (MistralTextBehavior, *runtimev1.TextGenerateScenarioSpec) {
	t.Helper()
	p, err := NewMistralTextBehavior("mistral-large-4-0")
	if err != nil {
		t.Fatal(err)
	}
	s := deepseekToolSpec(t)
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}}
	return p, s
}

func TestMistralNativeThinkingStreamRoundTrip(t *testing.T) {
	p, s := mistralTestSpec(t)
	a, err := p.Stream(s)
	if err != nil {
		t.Fatal(err)
	}
	chunks := [][]byte{
		deepseekToolChunk(t, map[string]any{"content": []any{map[string]any{"type": "thinking", "thinking": []any{map[string]any{"type": "text", "text": "  原文\r\n"}}, "closed": false}}}, nil),
		deepseekToolChunk(t, map[string]any{"content": []any{map[string]any{"type": "thinking", "thinking": []any{map[string]any{"type": "text", "text": "😀 "}}, "closed": true, "signature": "native-signature"}, map[string]any{"type": "text", "text": "Checking."}}}, nil),
		deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "originalA", "lookup", `{"city":"北京"}`), deepseekCallChunk(1, "originalB", "lookup", `{"city":"Paris"}`)}}, "tool_calls"),
	}
	var published []textbehavior.OrderedDelta
	for i, chunk := range chunks {
		deltas, err := a.Append(chunk)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 && len(deltas) > 0 {
			t.Fatal("partial thinking escaped")
		}
		published = append(published, deltas...)
	}
	if _, err := a.Finish(); err == nil {
		t.Fatal("missing DONE accepted")
	}
	if _, err := a.Append([]byte("[DONE]")); err != nil {
		t.Fatal(err)
	}
	result, err := a.Finish()
	if err != nil || len(result.Items) != 4 {
		t.Fatalf("%+v %v", result, err)
	}
	if published[0].Kind != textbehavior.OrderedItemReasoningContinuity || result.Items[1].Text != "Checking." || result.Items[2].ToolCall.Id != "originalA" || result.Items[3].ToolCall.Id != "originalB" {
		t.Fatal("native output order changed")
	}
	var encoded string
	if json.Unmarshal(result.Items[0].ReasoningContinuity.Payload, &encoded) != nil {
		t.Fatal("bad replay")
	}
	var native []map[string]any
	_ = json.Unmarshal([]byte(encoded), &native)
	if len(native) != 1 || native[0]["closed"] != true || native[0]["signature"] != "native-signature" || len(native[0]["thinking"].([]any)) != 2 {
		t.Fatal("thinking fields lost")
	}
	assistant := &runtimev1.ChatMessage{Role: "assistant"}
	assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: result.Items[0].ReasoningContinuity}}}}, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "Checking."}}}}})
	for _, item := range result.Items[2:] {
		assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: item.ToolCall}}}})
	}
	for _, item := range result.Items[2:] {
		assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: item.ToolCall.Id, ToolName: "lookup", Result: structpb.NewStringValue("unavailable"), IsError: true}}})
	}
	s.Input = append(s.Input, assistant)
	wire, err := p.Serialize(s, true)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	messages := body["messages"].([]any)
	replayed := messages[1].(map[string]any)
	if replayed["reasoning_content"] != nil || len(replayed["content"].([]any)) != 2 || replayed["content"].([]any)[0].(map[string]any)["signature"] != "native-signature" || messages[2].(map[string]any)["content"] != `{"error":"unavailable"}` {
		t.Fatal("native replay or external tool result changed")
	}
	bad := proto.Clone(s).(*runtimev1.TextGenerateScenarioSpec)
	bad.Input[1].TurnItems[0].GetOutput().GetReasoningContinuity().Kind = "mistral.chat.native-thinking-replay.mistral-small-2603"
	if _, err := p.Serialize(bad, false); err == nil {
		t.Fatal("cross-model replay admitted")
	}
}

func TestMistralExactControlsAndNativeStructuredOutput(t *testing.T) {
	p, s := mistralTestSpec(t)
	for _, choice := range []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL} {
		s.ToolChoice = choice
		s.ToolChoiceName = ""
		if choice == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL {
			s.ToolChoiceName = "lookup"
		}
		s.Seed = proto.Int64(0)
		s.TopK = proto.Int32(-1)
		wire, err := p.Serialize(s, false)
		if err != nil {
			t.Fatal(err)
		}
		var b map[string]any
		_ = json.Unmarshal(wire.Payload, &b)
		if b["random_seed"] != float64(0) || b["top_k"] != float64(-1) || b["stream_options"] != nil || b["thinking"] != nil || b["reasoning_effort"] != "high" {
			t.Fatal("native controls changed")
		}
		if choice == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED && b["tool_choice"] != "any" {
			t.Fatal("required choice mapping")
		}
	}
	s.Tools = nil
	s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED
	s.ToolChoiceName = ""
	schema, _ := structpb.NewStruct(map[string]any{"type": "array", "items": map[string]any{"type": "integer"}, "minItems": 1})
	s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, Strict: true, SchemaName: "values", SchemaDescription: "Caller schema"}
	s.Input = []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON [43]."}}
	wire, err := p.Serialize(s, false)
	if err != nil {
		t.Fatal(err)
	}
	var b map[string]any
	_ = json.Unmarshal(wire.Payload, &b)
	if len(b["messages"].([]any)) != 1 || b["response_format"].(map[string]any)["json_schema"].(map[string]any)["name"] != "values" {
		t.Fatal("schema became a prompt or changed")
	}
	for _, output := range []string{`[43]`, `["wrong"]`, `[]`, `[43] {}`} {
		payload, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "message": map[string]any{"content": output}, "finish_reason": "stop"}}})
		_, err := p.Parse(payload, s)
		if (err == nil) != (output == `[43]`) {
			t.Fatalf("sync %s %v", output, err)
		}
		a, _ := p.Stream(s)
		_, err = a.Append(deepseekToolChunk(t, map[string]any{"content": output}, "stop"))
		if err == nil {
			_, err = a.Append([]byte("[DONE]"))
		}
		if err == nil {
			_, err = a.Finish()
		}
		if (err == nil) != (output == `[43]`) {
			t.Fatalf("stream %s %v", output, err)
		}
	}
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
	if _, err := p.Serialize(s, false); err == nil {
		t.Fatal("Large 4 accepted reasoning off")
	}
	small, _ := NewMistralTextBehavior("mistral-small-2603")
	if _, err := small.Serialize(s, false); err != nil {
		t.Fatal(err)
	}
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}}
	if _, err := small.Serialize(s, false); err == nil {
		t.Fatal("Small 4 accepted Large 4 effort")
	}
}

func TestMistralRejectsUnclosedOversizedAndOutOfOrderThinking(t *testing.T) {
	p, s := mistralTestSpec(t)
	for _, content := range []any{
		[]any{map[string]any{"type": "thinking", "thinking": []any{map[string]any{"type": "text", "text": "partial"}}, "closed": false}, map[string]any{"type": "text", "text": "answer"}},
		[]any{map[string]any{"type": "text", "text": "answer"}, map[string]any{"type": "thinking", "thinking": []any{map[string]any{"type": "text", "text": "late"}}}},
		[]any{map[string]any{"type": "thinking", "thinking": []any{map[string]any{"type": "text", "text": strings.Repeat("x", 65537)}}}, map[string]any{"type": "text", "text": "answer"}},
		[]any{map[string]any{"type": "thinking", "thinking": []any{map[string]any{"type": "unknown", "text": "hidden"}}}},
	} {
		payload, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "message": map[string]any{"content": content}, "finish_reason": "stop"}}})
		if _, err := p.Parse(payload, s); err == nil {
			t.Fatal("invalid native thinking accepted")
		}
		a, _ := p.Stream(s)
		if _, err := a.Append(deepseekToolChunk(t, map[string]any{"content": content}, "stop")); err == nil {
			t.Fatal("invalid streamed thinking accepted")
		}
	}
}

func TestMistralImageFormatsCountsAndSingleFrameGIF(t *testing.T) {
	p, _ := NewMistralTextBehavior("mistral-small-2603")
	s := deepseekVisionSpec(deepseekVisionImage(t, 2))
	if _, err := p.Serialize(s, false); err != nil {
		t.Fatal(err)
	}
	frame := image.NewPaletted(image.Rect(0, 0, 2, 2), color.Palette{color.Black, color.White})
	for _, count := range []int{1, 2} {
		var b bytes.Buffer
		g := &gif.GIF{}
		for i := 0; i < count; i++ {
			g.Image = append(g.Image, frame)
			g.Delay = append(g.Delay, 1)
		}
		if err := gif.EncodeAll(&b, g); err != nil {
			t.Fatal(err)
		}
		s.Input[0].Parts[1].GetImageUrl().Url = "data:image/gif;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
		_, err := p.Serialize(s, false)
		if (err == nil) != (count == 1) {
			t.Fatalf("GIF %d: %v", count, err)
		}
	}
	s.Input[0].Parts[1].GetImageUrl().Url = "https://media.example/image.png"
	for len(s.Input[0].Parts) < 9 {
		s.Input[0].Parts = append(s.Input[0].Parts, proto.Clone(s.Input[0].Parts[1]).(*runtimev1.ChatContentPart))
	}
	if _, err := p.Serialize(s, false); err != nil {
		t.Fatal("eight images rejected", err)
	}
	s.Input[0].Parts = append(s.Input[0].Parts, proto.Clone(s.Input[0].Parts[1]).(*runtimev1.ChatContentPart))
	if _, err := p.Serialize(s, false); err == nil {
		t.Fatal("nine images accepted")
	}
}
