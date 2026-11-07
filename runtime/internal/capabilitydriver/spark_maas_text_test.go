package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func sparkMaaSSchemaSpec(t *testing.T) *runtimev1.TextGenerateScenarioSpec {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
	if err != nil {
		t.Fatal(err)
	}
	return &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON."}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, SchemaName: "answer", JsonSchema: schema}, MaxTokens: proto.Int32(4096)}
}
func TestSparkMaaSExactProtocolAndControlMapping(t *testing.T) {
	for _, model := range SparkMaaSTextModels() {
		t.Run(model, func(t *testing.T) {
			p, _ := NewSparkMaaSTextBehavior(model)
			s := sparkMaaSSchemaSpec(t)
			wire, err := p.Serialize(s, true)
			if err != nil {
				t.Fatal(err)
			}
			var b map[string]any
			_ = json.Unmarshal(wire.Payload, &b)
			if wire.Protocol != SparkMaaSResponsesProtocol || b["store"] != nil || b["include"] != nil || b["messages"] != nil || b["tools"] != nil || b["max_output_tokens"] != float64(4096) || b["text"].(map[string]any)["format"].(map[string]any)["strict"] != true {
				t.Fatal(b, wire.Protocol)
			}
			s.ResponseFormat = nil
			s.Temperature = proto.Float32(1)
			s.TopP = proto.Float32(.95)
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}}
			wire, err = p.Serialize(s, false)
			if err != nil {
				t.Fatal(err)
			}
			b = nil
			_ = json.Unmarshal(wire.Payload, &b)
			if wire.Protocol != "" || b["max_completion_tokens"] != float64(4096) || b["max_tokens"] != nil || b["thinking"].(map[string]any)["type"] != "auto" || b["input"] != nil || b["temperature"] != float64(1) || b["top_p"] != .95 {
				t.Fatal(b)
			}
			for name, change := range map[string]func(*runtimev1.TextGenerateScenarioSpec){"temperature": func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(.7) }, "top_p": func(s *runtimev1.TextGenerateScenarioSpec) { s.TopP = proto.Float32(.9) }, "ignored penalty": func(s *runtimev1.TextGenerateScenarioSpec) { s.FrequencyPenalty = proto.Float32(0) }, "budget": func(s *runtimev1.TextGenerateScenarioSpec) {
				s.Reasoning.Intensity = &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 1024}
			}, "unreviewed force": func(s *runtimev1.TextGenerateScenarioSpec) {
				s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL
				s.ToolChoiceName = "lookup"
			}} {
				t.Run(name, func(t *testing.T) {
					copy := proto.Clone(s).(*runtimev1.TextGenerateScenarioSpec)
					change(copy)
					if _, err := p.Serialize(copy, false); err == nil {
						t.Fatal("silently ignored control")
					}
				})
			}
		})
	}
}
func sparkMaaSResponseFixture(model string, answer any) map[string]any {
	return map[string]any{"id": "resp-original", "model": model, "status": "completed", "output": []any{map[string]any{"id": "thought", "type": "reasoning", "summary": []any{map[string]any{"type": "summary_text", "text": "native summary hidden"}}}, map[string]any{"id": "message", "type": "message", "status": "completed", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": answer}}}}, "usage": map[string]any{"input_tokens": 13, "output_tokens": 21}}
}
func TestSparkMaaSStructuredTerminalAndSchemaAreActual(t *testing.T) {
	p, _ := NewSparkMaaSTextBehavior("spark-x2.6")
	s := sparkMaaSSchemaSpec(t)
	body := sparkMaaSResponseFixture(p.model, `{"answer":19}`)
	data, _ := json.Marshal(body)
	r, err := p.Parse(data, s)
	if err != nil || len(r.Items) != 1 || r.Items[0].Text != `{"answer":19}` || r.Usage.GetOutputTokens() != 21 {
		t.Fatal(r, err)
	}
	a, _ := p.Stream(s)
	d, err := a.Append([]byte(`{"type":"response.created","response":{"id":"resp-original","model":"spark-x2.6","status":"in_progress"}}`))
	if err != nil || len(d) != 0 {
		t.Fatal(d, err)
	}
	d, err = a.Append([]byte(`{"type":"response.output_text.delta","response_id":"resp-original","delta":"unvalidated"}`))
	if err != nil || len(d) != 0 {
		t.Fatal("schema streamed before validation", d, err)
	}
	completed, _ := json.Marshal(map[string]any{"type": "response.completed", "response": body})
	d, err = a.Append(completed)
	if err != nil || len(d) != 1 || d[0].Text != `{"answer":19}` || !d[0].ItemCompleted {
		t.Fatal(d, err)
	}
	if _, err = a.Finish(); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(map[string]any){"wrong model": func(b map[string]any) { b["model"] = "other" }, "incomplete": func(b map[string]any) { b["status"] = "incomplete" }, "business": func(b map[string]any) { b["code"] = 10005 }, "wrong schema": func(b map[string]any) {
		b["output"] = sparkMaaSResponseFixture(p.model, `{"answer":"wrong"}`)["output"]
	}, "null text": func(b map[string]any) { b["output"] = sparkMaaSResponseFixture(p.model, nil)["output"] }, "unknown tool": func(b map[string]any) {
		b["output"] = []any{map[string]any{"id": "call", "type": "function_call", "name": "unknown", "arguments": "{}"}}
	}} {
		t.Run(name, func(t *testing.T) {
			b := sparkMaaSResponseFixture(p.model, `{"answer":19}`)
			mutate(b)
			raw, _ := json.Marshal(b)
			if _, err := p.Parse(raw, s); err == nil {
				t.Fatal("invalid native output succeeded")
			}
		})
	}
	a, _ = p.Stream(s)
	if _, err = a.Finish(); err == nil {
		t.Fatal("missing terminal succeeded")
	}
	a, _ = p.Stream(s)
	if _, err = a.Append([]byte(`{"type":"response.output_text.delta","code":10005,"delta":"must not publish"}`)); err == nil {
		t.Fatal("stream business error ignored")
	}
	a, _ = p.Stream(s)
	_, _ = a.Append([]byte(`{"type":"response.created","response":{"id":"other","model":"spark-x2.6"}}`))
	if _, err = a.Append(completed); err == nil {
		t.Fatal("different response id succeeded")
	}
}

func TestSparkMaaSChatIdentityErrorsAndHiddenReasoning(t *testing.T) {
	p, _ := NewSparkMaaSTextBehavior("spark-x2.6-4b")
	s := &runtimev1.TextGenerateScenarioSpec{}
	first := []byte(`{"id":"chat-original","model":"spark-x2.6-4b","choices":[{"index":0,"delta":{"reasoning_content":"hidden"}}]}`)
	for name, frame := range map[string]string{
		"business": `{"code":10005,"id":"chat-original","model":"spark-x2.6-4b","choices":[{"index":0,"delta":{"content":"must not publish"}}]}`,
		"model":    `{"id":"chat-original","model":"another","choices":[{"index":0,"delta":{"content":"must not publish"}}]}`,
		"id":       `{"id":"another","model":"spark-x2.6-4b","choices":[{"index":0,"delta":{"content":"must not publish"}}]}`,
		"raw type": `{"id":"chat-original","choices":[{"index":0,"delta":{"reasoning_content":{}}}]}`,
		"filter":   `{"id":"chat-original","choices":[{"index":0,"delta":{"content":"blocked"},"finish_reason":"content_filter"}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			a, _ := p.Stream(s)
			if d, err := a.Append(first); err != nil || len(d) != 0 {
				t.Fatal(d, err)
			}
			if d, err := a.Append([]byte(frame)); err == nil || len(d) != 0 {
				t.Fatal("bad native frame published", d, err)
			}
		})
	}
	a, _ := p.Stream(s)
	_, _ = a.Append(first)
	if _, err := a.Append([]byte("[DONE]")); err == nil {
		t.Fatal("reasoning-only success")
	}
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
	a, _ = p.Stream(s)
	if _, err := a.Append(first); err == nil {
		t.Fatal("off contradiction")
	}
}
