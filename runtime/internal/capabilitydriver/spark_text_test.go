package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestSparkNativeModelControls(t *testing.T) {
	for _, target := range [][2]string{{"spark", "4.0Ultra"}, {"spark", "lite"}, {"spark_reasoning", "spark-x"}} {
		t.Run(target[0]+target[1], func(t *testing.T) {
			p, _ := NewSparkTextBehavior(target[0], target[1])
			s := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "原文"}}}
			wire, err := p.Serialize(s, true)
			if err != nil {
				t.Fatal(err)
			}
			var b map[string]any
			_ = json.Unmarshal(wire.Payload, &b)
			if b["stream_options"] != nil || b["thinking"] != nil || b["max_tokens"] != nil {
				t.Fatal("native default changed", b)
			}
			if p.model == "4.0Ultra" || p.Reasoning() {
				if b["tools"].([]any)[0].(map[string]any)["web_search"].(map[string]any)["enable"] != false {
					t.Fatal("implicit search")
				}
			} else if b["tools"] != nil {
				t.Fatal("Lite search parameter")
			}
			if p.Reasoning() {
				s.MaxTokens = proto.Int32(100)
				if _, err := p.Serialize(s, false); err == nil {
					t.Fatal("unreviewed total cap accepted")
				}
				s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
				wire, err = p.Serialize(s, false)
				if err != nil {
					t.Fatal(err)
				}
				_ = json.Unmarshal(wire.Payload, &b)
				if b["max_tokens"] != float64(100) || b["thinking"].(map[string]any)["type"] != "disabled" {
					t.Fatal(b)
				}
			}
			s.MaxTokens = nil
			s.Reasoning = nil
			if p.Tools() {
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{}})
				s.Tools = []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", Description: "Look up an entry", InputSchema: schema}}
				s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL
				s.ToolChoiceName = "lookup"
				wire, err = p.Serialize(s, false)
				if err != nil {
					t.Fatal(err)
				}
				b = nil
				_ = json.Unmarshal(wire.Payload, &b)
				choice := b["tool_choice"].(map[string]any)
				if p.Reasoning() {
					if choice["name"] != "lookup" || choice["function"] != nil || len(b["tools"].([]any)) != 1 || b["tool_calls_switch"] != nil {
						t.Fatal(b)
					}
				} else {
					if choice["function"].(map[string]any)["name"] != "lookup" || b["tool_calls_switch"] != true || len(b["tools"].([]any)) != 2 {
						t.Fatal(b)
					}
				}
			}
			s.SystemPrompt = "policy"
			_, err = p.Serialize(s, false)
			if p.OrderedSystem() && err != nil || !p.OrderedSystem() && err == nil {
				t.Fatal("model-specific system roles", err)
			}
		})
	}
}

func TestSparkAndQianfanEmptyHiddenReasoningKeepsNativeDefault(t *testing.T) {
	q := QianfanTextBehavior{}
	serializers := []func(*runtimev1.TextGenerateScenarioSpec, bool) (textbehavior.SerializedRequest, error){q.Serialize}
	for _, target := range [][2]string{{"spark", "4.0Ultra"}, {"spark", "lite"}, {"spark_reasoning", "spark-x"}} {
		p, _ := NewSparkTextBehavior(target[0], target[1])
		serializers = append(serializers, p.Serialize)
	}
	for i, serialize := range serializers {
		s := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}}
		before, err := serialize(s, false)
		if err != nil {
			t.Fatal(i, err)
		}
		s.Reasoning = &runtimev1.ReasoningConfig{Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN}
		after, err := serialize(s, false)
		if err != nil || string(before.Payload) != string(after.Payload) {
			t.Fatal("empty reasoning changed native defaults", i, err)
		}
	}
}

func TestSparkOriginalNativeEndFramesAndErrors(t *testing.T) {
	p, _ := NewSparkTextBehavior("spark_reasoning", "spark-x")
	s := &runtimev1.TextGenerateScenarioSpec{}
	prefix := `{"code":0,"sid":"original","id":"original","choices":[{"index":0,"delta":`
	first := []byte(prefix + `{"role":"assistant","reasoning_content":"raw hidden"}}]}`)
	last := []byte(prefix + `{"role":"assistant","content":"answer"}}],"usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12}}`)
	stream, _ := p.Stream(s)
	if d, e := stream.Append(first); e != nil || len(d) != 0 {
		t.Fatal("raw thought leaked", d, e)
	}
	if _, err := stream.Append(last); err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Append([]byte("[DONE]")); err != nil {
		t.Fatal(err)
	}
	result, err := stream.Finish()
	if err != nil || len(result.Items) != 1 || result.Items[0].Kind != textbehavior.OrderedItemText || result.Items[0].Text != "answer" || result.Usage.GetOutputTokens() != 7 {
		t.Fatal(result, err)
	}
	for name, frame := range map[string]string{
		"business error":  `{"code":10005,"sid":"original","choices":[{"index":0,"delta":{"content":"must not publish"}}]}`,
		"different sid":   `{"code":0,"sid":"other","choices":[{"index":0,"delta":{"content":"must not publish"}}]}`,
		"different model": `{"code":0,"sid":"original","model":"another","choices":[{"index":0,"delta":{"content":"must not publish"}}]}`,
		"hidden content":  prefix + `{"content":"filtered","security_suggest":{"action":"HIDE_CONTINUE"}}]}`,
		"hidden thought":  prefix + `{"reasoning_content":"filtered","security_suggest":{"action":"HIDE_CONTINUE"}}]}`,
		"invalid thought": prefix + `{"reasoning_content":42}}]}`,
		"unknown status":  prefix + `{"content":"partial"}}],"status":"aborted"}`,
	} {
		t.Run(name, func(t *testing.T) {
			a, _ := p.Stream(s)
			_, _ = a.Append(first)
			if d, err := a.Append([]byte(frame)); err == nil || len(d) != 0 {
				t.Fatal("invalid native frame published", d, err)
			}
		})
	}
	a, _ := p.Stream(s)
	_, _ = a.Append(first)
	if _, err := a.Append([]byte("[DONE]")); err == nil {
		t.Fatal("unfinished thought became success")
	}
	a, _ = p.Stream(s)
	_, _ = a.Append(last)
	if _, err := a.Finish(); err == nil {
		t.Fatal("missing DONE became success")
	}
	disabled := &runtimev1.TextGenerateScenarioSpec{Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}}
	a, _ = p.Stream(disabled)
	if _, err := a.Append(first); err == nil {
		t.Fatal("thinking-off contradiction")
	}
}
