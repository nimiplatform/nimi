package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestStepFunNativeStopWithCallsAndHiddenReasoning(t *testing.T) {
	for _, model := range []string{"step-5-preview", "step-3.7-flash", "step-3.5-flash-2603"} {
		t.Run(model, func(t *testing.T) {
			p, _ := NewStepFunTextBehavior(model)
			s := deepseekToolSpec(t)
			payload := []byte(`{"choices":[{"index":0,"message":{"content":"Checking.","reasoning":"private native thought","tool_calls":[{"id":"original","type":"function","function":{"name":"lookup","arguments":"{\"city\":\"Paris\"}"}}]},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":22}}`)
			result, err := p.Parse(payload, s)
			if err != nil || len(result.Items) != 2 || result.Items[0].Text != "Checking." || result.Items[1].ToolCall.Id != "original" || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL || result.Usage.GetInputTokens() != 11 || result.Usage.GetOutputTokens() != 22 {
				t.Fatalf("%+v %v", result, err)
			}
			a, _ := p.Stream(s)
			for _, chunk := range [][]byte{
				deepseekToolChunk(t, map[string]any{"reasoning": "private", "content": ""}, nil),
				deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "original", "lookup", `{"city":"Pa`)}}, nil),
				deepseekToolChunk(t, map[string]any{"tool_calls": []any{deepseekCallChunk(0, "", "", `ris"}`)}}, nil),
			} {
				d, err := a.Append(chunk)
				if err != nil {
					t.Fatal(err)
				}
				for _, delta := range d {
					if delta.HasPublicPayload() {
						t.Fatalf("partial public output escaped %v", delta)
					}
				}
			}
			d, err := a.Append(deepseekToolChunk(t, map[string]any{}, "stop"))
			if err != nil || len(d) != 1 || d[0].ToolCall.GetArgumentsJson() != `{"city":"Paris"}` {
				t.Fatalf("native stop %v %v", d, err)
			}
			if _, err := a.Finish(); err == nil {
				t.Fatal("missing DONE accepted")
			}
			_, _ = a.Append([]byte("[DONE]"))
			result, err = a.Finish()
			if err != nil || len(result.Items) != 1 || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
				t.Fatalf("%+v %v", result, err)
			}
			bad := []byte(`{"choices":[{"index":0,"message":{"content":"","tool_calls":[{"id":"bad","type":"function","function":{"name":"lookup","arguments":"{\"city\":3}"}}]},"finish_reason":"stop"}]}`)
			if _, err := p.Parse(bad, s); err == nil {
				t.Fatal("invalid call became executable on native stop")
			}
		})
	}
}

func TestStepFunControlsAndStructuredOutputUseNativeFields(t *testing.T) {
	p, _ := NewStepFunTextBehavior("step-5-preview")
	s := deepseekToolSpec(t)
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM}}
	s.FrequencyPenalty = proto.Float32(1)
	s.Stop = []string{"END"}
	wire, err := p.Serialize(s, true)
	if err != nil {
		t.Fatal(err)
	}
	var b map[string]any
	_ = json.Unmarshal(wire.Payload, &b)
	if b["model"] != "step-5-preview" || b["reasoning_format"] != "general" || b["reasoning_effort"] != "medium" || b["tool_choice"] != nil || b["parallel_tool_calls"] != nil || b["stream_options"] != nil || b["frequency_penalty"] != float64(1) {
		t.Fatal("native controls changed")
	}
	for _, change := range []func(*runtimev1.TextGenerateScenarioSpec){
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED
		},
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
		},
		func(s *runtimev1.TextGenerateScenarioSpec) { s.Seed = proto.Int64(0) },
		func(s *runtimev1.TextGenerateScenarioSpec) { s.PresencePenalty = proto.Float32(0) },
		func(s *runtimev1.TextGenerateScenarioSpec) { s.FrequencyPenalty = proto.Float32(-1) },
		func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(2.1) },
	} {
		bad := proto.Clone(s).(*runtimev1.TextGenerateScenarioSpec)
		change(bad)
		if _, err := p.Serialize(bad, false); err == nil {
			t.Fatal("unsupported control accepted")
		}
	}
	fast, _ := NewStepFunTextBehavior("step-3.5-flash-2603")
	if _, err := fast.Serialize(s, false); err == nil {
		t.Fatal("2603 accepted medium effort")
	}
	s.Tools = nil
	s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED
	s.Input = []*runtimev1.ChatMessage{{Role: "user", Content: "Extract the integer answer."}}
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
	s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, SchemaName: "answer", JsonSchema: schema}
	wire, err = p.Serialize(s, false)
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(wire.Payload, &b)
	if len(b["messages"].([]any)) != 1 || b["response_format"].(map[string]any)["json_schema"].(map[string]any)["schema"].(map[string]any)["additionalProperties"] != false {
		t.Fatal("schema injected as prose or changed")
	}
	for _, text := range []string{`{"answer":43}`, `{"answer":"bad"}`, `{"answer":43,"extra":true}`, `{"answer":`, `[]`} {
		payload, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "message": map[string]any{"reasoning": "private", "content": text}, "finish_reason": "stop"}}})
		_, err := p.Parse(payload, s)
		if (err == nil) != (text == `{"answer":43}`) {
			t.Fatalf("sync %s %v", text, err)
		}
		a, _ := p.Stream(s)
		_, err = a.Append(deepseekToolChunk(t, map[string]any{"reasoning": "private", "content": text}, "stop"))
		if err == nil {
			_, err = a.Append([]byte("[DONE]"))
		}
		if err == nil {
			_, err = a.Finish()
		}
		if (err == nil) != (text == `{"answer":43}`) {
			t.Fatalf("stream %s %v", text, err)
		}
	}
	s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	r, err := p.Parse([]byte(`{"choices":[{"index":0,"message":{"reasoning":"private","content":"{\"answer\":43}"},"finish_reason":"stop"}]}`), s)
	if err != nil || len(r.Items) != 1 || r.Items[0].Kind != textbehavior.OrderedItemText {
		t.Fatal(r, err)
	}
}

func TestStepFunMediaOrderAndModelBoundaries(t *testing.T) {
	p, _ := NewStepFunTextBehavior("step-5-preview")
	s := deepseekVisionSpec(deepseekVisionImage(t, 2))
	s.Input[0].Parts[1].GetImageUrl().Detail = "high"
	s.Input[0].Parts = append(s.Input[0].Parts, &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL, Content: &runtimev1.ChatContentPart_VideoUrl{VideoUrl: "data:video/mp4;base64,AQIDBA=="}})
	wire, err := p.Serialize(s, false)
	if err != nil {
		t.Fatal(err)
	}
	var b map[string]any
	_ = json.Unmarshal(wire.Payload, &b)
	parts := b["messages"].([]any)[0].(map[string]any)["content"].([]any)
	if len(parts) != 3 || parts[2].(map[string]any)["video_url"].(map[string]any)["url"] != "data:video/mp4;base64,AQIDBA==" || parts[1].(map[string]any)["image_url"].(map[string]any)["detail"] != "high" {
		t.Fatal("media bytes or order changed")
	}
	fast, _ := NewStepFunTextBehavior("step-3.5-flash-2603")
	if _, err := fast.Serialize(s, false); err == nil {
		t.Fatal("2603 accepted media")
	}
	for _, change := range []func(*runtimev1.TextGenerateScenarioSpec){
		func(s *runtimev1.TextGenerateScenarioSpec) { s.Input[0].Parts[1].GetImageUrl().Detail = "auto" },
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Input[0].Parts = append(s.Input[0].Parts, proto.Clone(s.Input[0].Parts[2]).(*runtimev1.ChatContentPart))
		},
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Input[0].Parts[2].Content = &runtimev1.ChatContentPart_VideoUrl{VideoUrl: "stepfile://unowned"}
		},
		func(s *runtimev1.TextGenerateScenarioSpec) { s.Input[0].Role = "system" },
	} {
		bad := proto.Clone(s).(*runtimev1.TextGenerateScenarioSpec)
		change(bad)
		if _, err := p.Serialize(bad, false); err == nil {
			t.Fatal("unsupported media accepted")
		}
	}
	s.Input[0].Parts = s.Input[0].Parts[:2]
	s.Input[0].Parts[1].GetImageUrl().Url = "https://media.example/image.png"
	for len(s.Input[0].Parts) < 61 {
		s.Input[0].Parts = append(s.Input[0].Parts, proto.Clone(s.Input[0].Parts[1]).(*runtimev1.ChatContentPart))
	}
	if _, err := p.Serialize(s, false); err != nil {
		t.Fatal("sixty images rejected", err)
	}
	s.Input[0].Parts = append(s.Input[0].Parts, proto.Clone(s.Input[0].Parts[1]).(*runtimev1.ChatContentPart))
	if _, err := p.Serialize(s, false); err == nil {
		t.Fatal("61 images accepted")
	}
}

func TestStepFunToolLimitAndNoSyntheticContinuity(t *testing.T) {
	p, _ := NewStepFunTextBehavior("step-5-preview")
	s := deepseekToolSpec(t)
	for len(s.Tools) < 128 {
		next := proto.Clone(s.Tools[0]).(*runtimev1.ToolSpec)
		next.Name = fmt.Sprintf("tool%d", len(s.Tools))
		s.Tools = append(s.Tools, next)
	}
	if _, err := p.Serialize(s, false); err != nil {
		t.Fatal(err)
	}
	s.Tools = append(s.Tools, proto.Clone(s.Tools[0]).(*runtimev1.ToolSpec))
	if _, err := p.Serialize(s, false); err == nil {
		t.Fatal("129 tools accepted")
	}
	s.Tools = s.Tools[:1]
	s.Input = append(s.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{Kind: "invented.stepfun.reasoning", Version: 1, Payload: []byte(`"thought"`)}}}}}}})
	if _, err := p.Serialize(s, false); err == nil {
		t.Fatal("invented replay accepted")
	}
}
