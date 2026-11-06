package capabilitydriver

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestTogetherNativeReasoningFieldAndBytesRoundTrip(t *testing.T) {
	p, _ := NewTogetherTextBehavior("moonshotai/Kimi-K3")
	for _, field := range []string{"reasoning", "reasoning_content"} {
		s := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "question"}}}
		thought := " \r\n原文 😀 "
		data, _ := json.Marshal(map[string]any{"model": p.model, "choices": []any{map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": "answer", field: thought}, "finish_reason": "stop"}}})
		r, err := p.Parse(data, s)
		if err != nil || len(r.Items) != 2 {
			t.Fatal(r, err)
		}
		c := r.Items[0].ReasoningContinuity
		s.Input = append(s.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: c}}}}}})
		wire, err := p.Serialize(s, false)
		if err != nil {
			t.Fatal(err)
		}
		var out struct {
			Messages []map[string]any `json:"messages"`
		}
		_ = json.Unmarshal(wire.Payload, &out)
		if out.Messages[1][field] != thought {
			t.Fatal("native field or whitespace changed", out.Messages[1])
		}
		if _, err := p.readReplay(c); err != nil {
			t.Fatal("serializer mutated caller carrier", err)
		}
		c.Payload = []byte(`{"field":"reasoning"}`)
		if _, err := p.Serialize(s, false); err == nil {
			t.Fatal("missing native text became empty reasoning")
		}
	}
}

func TestTogetherRejectsCorruptNativeStreamsAndUnreviewedControls(t *testing.T) {
	p, _ := NewTogetherTextBehavior("moonshotai/Kimi-K3")
	s := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "question"}}}
	for _, body := range []string{
		`{"model":"wrong","choices":[]}`,
		`{"model":"moonshotai/Kimi-K3","choices":[{"index":0,"delta":{"reasoning":"one","reasoning_content":"two"}}]}`,
		`{"model":"moonshotai/Kimi-K3","choices":[{"index":0,"delta":{},"finish_reason":"length"}]}`,
	} {
		stream, _ := p.Stream(s)
		if _, err := stream.Append([]byte(body)); err == nil {
			t.Fatal("bad envelope accepted", body)
		}
	}
	stream, _ := p.Stream(s)
	if _, err := stream.Append([]byte(`{"model":"moonshotai/Kimi-K3","choices":[{"index":0,"delta":{"reasoning":"original"}}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Append([]byte(`{"choices":[{"index":0,"delta":{"reasoning_content":"different field"}}]}`)); err == nil {
		t.Fatal("native field changed midstream")
	}
	stream, _ = p.Stream(s)
	tooLarge, _ := json.Marshal(map[string]any{"model": p.model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"reasoning": strings.Repeat("x", 65537)}}}})
	if _, err := stream.Append(tooLarge); err == nil {
		t.Fatal("unbounded native reasoning")
	}
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM}}
	if _, err := p.Serialize(s, false); err == nil {
		t.Fatal("Kimi silently ignored effort accepted")
	}
	s.Reasoning.Intensity = &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}
	if _, err := p.Serialize(s, false); err != nil {
		t.Fatal(err)
	}
	glm, _ := NewTogetherTextBehavior("zai-org/GLM-5.3")
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
	if _, err := glm.Serialize(s, false); err == nil {
		t.Fatal("GLM thinking disabled silently")
	}
	s.Reasoning = nil
	s.Temperature = proto.Float32(1.1)
	if _, err := p.Serialize(s, false); err == nil {
		t.Fatal("unsupported temperature")
	}
}
