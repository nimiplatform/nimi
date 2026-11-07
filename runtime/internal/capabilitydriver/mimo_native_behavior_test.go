package capabilitydriver

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

func mimoThinking() *runtimev1.ReasoningConfig {
	return &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}}
}

func TestMimoThinkingStreamAndLaterHistoryWithoutTools(t *testing.T) {
	p := testMimoProfile(t)
	spec := deepseekToolSpec(t)
	spec.Temperature, spec.TopP, spec.Reasoning = nil, nil, mimoThinking()
	a, err := p.Stream(spec)
	if err != nil {
		t.Fatal(err)
	}
	for i, frame := range [][]byte{
		deepseekToolChunk(t, map[string]any{"reasoning_content": " native\r\n"}, nil),
		deepseekToolChunk(t, map[string]any{"reasoning_content": "原文 😀 "}, nil),
		deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "original", "lookup", `{"city":"北京"}`)}}, "tool_calls"),
	} {
		deltas, err := a.Append(frame)
		if err != nil {
			t.Fatal(err)
		}
		if i < 2 && len(deltas) != 0 {
			t.Fatal("partial reasoning escaped")
		}
		for _, d := range deltas {
			if d.Kind == textbehavior.OrderedItemReasoningSummary || d.Text != "" {
				t.Fatal("raw reasoning displayed")
			}
		}
	}
	if _, err = a.Finish(); err == nil {
		t.Fatal("missing DONE accepted")
	}
	if _, err = a.Append([]byte("[DONE]")); err != nil {
		t.Fatal(err)
	}
	result, err := a.Finish()
	if err != nil || len(result.Items) != 2 {
		t.Fatalf("%+v %v", result, err)
	}
	carrier := result.Items[0].ReasoningContinuity
	var raw string
	if json.Unmarshal(carrier.Payload, &raw) != nil || raw != " native\r\n原文 😀 " {
		t.Fatal("reasoning changed")
	}
	spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: carrier}}}},
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: result.Items[1].ToolCall}}}},
	}})
	spec.Tools, spec.ToolChoice = nil, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED
	wire, err := p.Serialize(spec, false)
	if err != nil || !strings.Contains(string(wire.Payload), `"reasoning_content":" native\r\n原文 😀 "`) {
		t.Fatalf("replay %s %v", wire.Payload, err)
	}
	for _, bad := range []func(*runtimev1.TextGenerateScenarioSpec){
		func(s *runtimev1.TextGenerateScenarioSpec) { s.Input[1].TurnItems = s.Input[1].TurnItems[1:] },
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Input[1].TurnItems[0].GetOutput().GetReasoningContinuity().Kind = "mimo.chat.native-reasoning-replay.mimo-v2.6-pro"
		},
		func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(1) },
		func(s *runtimev1.TextGenerateScenarioSpec) { s.TopP = proto.Float32(.95) },
	} {
		s := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
		bad(s)
		if _, err := p.Serialize(s, false); err == nil {
			t.Fatal("unsupported thinking request admitted")
		}
	}
}

func TestMimoJSONObjectPreservesInstructionsAndRequiresCompleteObject(t *testing.T) {
	p := testMimoProfile(t)
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "system", Content: "Return JSON only."}, {Role: "user", Content: "Give answer 43."}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}
	for _, thinking := range []bool{false, true} {
		if thinking {
			spec.Reasoning = mimoThinking()
		}
		wire, err := p.Serialize(spec, false)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		_ = json.Unmarshal(wire.Payload, &body)
		if len(body["messages"].([]any)) != 2 || body["response_format"].(map[string]any)["type"] != "json_object" {
			t.Fatal("JSON format or instructions changed")
		}
		for _, output := range []string{`{"answer":43}`, `[]`, `null`, `43`, `{"answer":`, `{} {}`} {
			payload, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "message": map[string]any{"content": output}, "finish_reason": "stop"}}})
			_, err = p.Parse(payload, spec)
			if (err == nil) != (output == `{"answer":43}`) {
				t.Fatalf("output %s: %v", output, err)
			}
			a, _ := p.Stream(spec)
			_, err = a.Append(deepseekToolChunk(t, map[string]any{"content": output}, "stop"))
			if err == nil {
				_, err = a.Append([]byte("[DONE]"))
			}
			if err == nil {
				_, err = a.Finish()
			}
			if (err == nil) != (output == `{"answer":43}`) {
				t.Fatalf("stream output %s: %v", output, err)
			}
		}
	}
}

func TestMimoMediaPreservesMIMEAndOrderingAndBounds(t *testing.T) {
	p := testMimoProfile(t)
	spec := deepseekVisionSpec(deepseekVisionImage(t, 2))
	spec.Input[0].Parts = append(spec.Input[0].Parts,
		&runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL, Content: &runtimev1.ChatContentPart_AudioUrl{AudioUrl: "data:audio/wav;base64,AQIDBA=="}},
		&runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL, Content: &runtimev1.ChatContentPart_VideoUrl{VideoUrl: "https://media.example/clip"}})
	wire, err := p.Serialize(spec, true)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	parts := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
	if len(parts) != 4 || parts[2].(map[string]any)["input_audio"].(map[string]any)["data"] != "data:audio/wav;base64,AQIDBA==" || parts[3].(map[string]any)["video_url"].(map[string]any)["url"] != "https://media.example/clip" {
		t.Fatal("media changed")
	}
	for _, location := range []string{"data:audio/wav;base64," + strings.Repeat("A", 50_000_001), "data:audio/unknown;base64,AQIDBA==", "file:///private.wav", "http://media.example/a", "https://user:secret@media.example/a", "data:audio/wav;base64,!!"} { // pragma: allowlist secret -- URL userinfo rejection fixture
		bad := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
		bad.Input[0].Parts[2].Content = &runtimev1.ChatContentPart_AudioUrl{AudioUrl: location}
		if _, err := p.Serialize(bad, false); err == nil {
			t.Fatal("invalid media accepted")
		}
	}
	bad := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	bad.Input[0].Role = "system"
	if _, err := p.Serialize(bad, false); err == nil {
		t.Fatal("system media admitted")
	}
	bad = proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	bad.Input[0].Parts[0].Content = &runtimev1.ChatContentPart_Text{Text: strings.Repeat("x", mimoMaxRequestBytes)}
	if _, err := p.Serialize(bad, false); err == nil {
		t.Fatal("whole request limit ignored")
	}
}
