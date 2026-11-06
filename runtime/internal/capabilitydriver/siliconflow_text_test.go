package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestSiliconFlowTotalCapAndThinkingControls(t *testing.T) {
	qwen, _ := NewSiliconFlowTextBehavior("Qwen/Qwen3.8-27B")
	s := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "17 plus 26"}}, MaxTokens: proto.Int32(256)}
	if _, err := qwen.Serialize(s, false); err == nil {
		t.Fatal("answer-only cap became total cap")
	}
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
	wire, err := qwen.Serialize(s, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	if body["max_tokens"] != float64(256) || body["enable_thinking"] != false || body["thinking_budget"] != nil {
		t.Fatal(body)
	}
	bad := []byte(`{"model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"message":{"role":"assistant","content":"43","reasoning_content":"unexpected thinking"},"finish_reason":"stop"}]}`)
	if _, err := qwen.Parse(bad, s); err == nil {
		t.Fatal("thinking-off ignored by native result")
	}
	s.MaxTokens = nil
	for _, tc := range []struct {
		budget uint32
		valid  bool
	}{{127, false}, {128, true}, {32768, true}, {32769, false}} {
		s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: tc.budget}}
		wire, err := qwen.Serialize(s, true)
		if (err == nil) != tc.valid {
			t.Fatal(tc, err)
		}
		if err == nil {
			_ = json.Unmarshal(wire.Payload, &body)
			if body["thinking_budget"] != float64(tc.budget) {
				t.Fatal(body)
			}
		}
	}
	ds, _ := NewSiliconFlowTextBehavior("deepseek-ai/DeepSeek-V4-Flash")
	for _, effort := range []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH} {
		s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: effort}}
		if _, err := ds.Serialize(s, false); err == nil {
			t.Fatal("collapsed effort admitted", effort)
		}
	}
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 1024}}
	if _, err := ds.Serialize(s, false); err == nil {
		t.Fatal("best-effort budget presented as exact")
	}
}

func TestSiliconFlowNoneToolsAndMalformedOutput(t *testing.T) {
	p, _ := NewSiliconFlowTextBehavior("Qwen/Qwen3.8-27B")
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false})
	s := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Answer without tools."}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE}
	wire, err := p.Serialize(s, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	if body["tools"] != nil || body["tool_choice"] != nil {
		t.Fatal("disabled tools still advertised", body)
	}
	for _, choice := range []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL} {
		s.ToolChoice = choice
		if _, err := p.Serialize(s, false); err == nil {
			t.Fatal("unreviewed forced choice admitted")
		}
	}
	s.Tools = nil
	s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED
	for _, raw := range []string{`{"model":"other","choices":[]}`, `{"model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"message":{"role":"assistant","content":"partial"},"finish_reason":"length"}]}`, `{"code":50505,"message":"overloaded"}`} {
		if _, err := p.Parse([]byte(raw), s); err == nil {
			t.Fatal("bad output succeeded", raw)
		}
	}
	s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT, Strict: true, JsonSchema: schema}
	if _, err := p.Serialize(s, false); err == nil {
		t.Fatal("structured fields silently ignored")
	}
}
