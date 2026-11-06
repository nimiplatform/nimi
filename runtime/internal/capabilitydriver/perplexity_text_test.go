package capabilitydriver

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func perplexitySpec(t *testing.T) *runtimev1.TextGenerateScenarioSpec {
	t.Helper()
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}, "additionalProperties": false})
	return &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "  查询北京\n"}}, MaxTokens: proto.Int32(512), Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}}
}

func TestPerplexityNativeControlsAndUnsupportedCombinations(t *testing.T) {
	for _, model := range PerplexityTextModels() {
		p, _ := NewPerplexityTextBehavior(model)
		spec := perplexitySpec(t)
		wire, err := p.Serialize(spec, false)
		if err != nil {
			t.Fatal(model, err)
		}
		var body map[string]any
		_ = json.Unmarshal(wire.Payload, &body)
		if body["max_steps"] != float64(1) || body["store"] != false || body["include"] != nil || body["parallel_tool_calls"] != nil || body["stream"] != true {
			t.Fatalf("unexpected native request %s", wire.Payload)
		}
		if body["input"].([]any)[0].(map[string]any)["content"] != "  查询北京\n" {
			t.Fatal("text changed")
		}
		spec.Tools = nil
		wire, err = p.Serialize(spec, true)
		if err != nil {
			t.Fatal(err)
		}
		_ = json.Unmarshal(wire.Payload, &body)
		if len(body["tools"].([]any)) != 0 || body["tool_choice"] != "none" {
			t.Fatal("provider default tools not disabled")
		}
		for name, mutate := range map[string]func(*runtimev1.TextGenerateScenarioSpec){
			"sampling": func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(.8) },
			"json object": func(s *runtimev1.TextGenerateScenarioSpec) {
				s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
			},
			"off": func(s *runtimev1.TextGenerateScenarioSpec) {
				s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
			},
			"summary": func(s *runtimev1.TextGenerateScenarioSpec) {
				s.Reasoning = &runtimev1.ReasoningConfig{Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}
			},
		} {
			copy := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
			mutate(copy)
			if _, err := p.Serialize(copy, false); err == nil {
				t.Fatal(model, name, "accepted")
			}
		}
	}
	p, _ := NewPerplexityTextBehavior("perplexity/kimi-k3")
	s := perplexitySpec(t)
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM}}
	wire, err := p.Serialize(s, false)
	if err != nil || !strings.Contains(string(wire.Payload), `"reasoning":{"effort":"max"}`) {
		t.Fatal(string(wire.Payload), err)
	}
}

func TestPerplexitySignatureReplayAndTerminalEvidence(t *testing.T) {
	p, _ := NewPerplexityTextBehavior("google/gemini-4-argon")
	spec := perplexitySpec(t)
	call := map[string]any{"type": "function_call", "id": "native-item", "call_id": "call-1", "name": "lookup", "arguments": `{"city":"北京"}`, "thought_signature": "c2lnbmF0dXJl", "status": "completed"}
	for _, defect := range []string{"", "wrong model", "missing signature", "incomplete", "changed terminal", "unrequested tool", "sequence"} {
		t.Run(defect, func(t *testing.T) {
			stream, _ := p.Stream(spec)
			sequence := 0
			appendEvent := func(e map[string]any) error {
				e["sequence_number"] = sequence
				sequence++
				b, _ := json.Marshal(e)
				_, err := stream.Append(b)
				return err
			}
			model := p.model
			if defect == "wrong model" {
				model = "openai/gpt-6.1-sol"
			}
			err := appendEvent(map[string]any{"type": "response.created", "response": map[string]any{"model": model, "status": "in_progress"}})
			if defect == "wrong model" {
				if err == nil {
					t.Fatal("wrong model accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if defect == "sequence" {
				sequence = 0
			}
			item := map[string]any{}
			for k, v := range call {
				item[k] = v
			}
			if defect == "missing signature" {
				delete(item, "thought_signature")
			}
			if defect == "unrequested tool" {
				item["type"] = "search_results"
			}
			err = appendEvent(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
			if defect == "unrequested tool" || defect == "sequence" {
				if err == nil {
					t.Fatal("invalid event accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			err = appendEvent(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
			if defect == "missing signature" {
				if err == nil {
					t.Fatal("signature missing accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			status := "completed"
			if defect == "incomplete" {
				status = "incomplete"
			}
			if defect == "changed terminal" {
				item["arguments"] = `{"city":"上海"}`
			}
			err = appendEvent(map[string]any{"type": "response.completed", "response": map[string]any{"model": model, "status": status, "output": []any{item}, "usage": map[string]any{"input_tokens": 5, "output_tokens": 8}}})
			if defect != "" {
				if err == nil {
					t.Fatal("bad terminal accepted")
				}
				if defect == "incomplete" {
					code, _ := grpcerr.ExtractReasonCode(err)
					if code != runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE {
						t.Fatal(err)
					}
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			result, err := stream.Finish()
			if err != nil || len(result.Items) != 2 || result.Items[0].Kind != textbehavior.OrderedItemReasoningContinuity || result.Items[1].ToolCall.Id != "call-1" || result.Usage.OutputTokens != 8 {
				t.Fatal(result, err)
			}
			replay := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
			replay.Input = append(replay.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
				{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: result.Items[0].ReasoningContinuity}}}},
				{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: result.Items[1].ToolCall}}}},
				{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup", Result: structpb.NewStringValue("ok")}}},
			}})
			wire, err := p.Serialize(replay, false)
			if err != nil || !strings.Contains(string(wire.Payload), `"thought_signature":"c2lnbmF0dXJl"`) {
				t.Fatal(string(wire.Payload), err)
			}
			replay.Input[1].TurnItems = replay.Input[1].TurnItems[1:]
			if _, err := p.Serialize(replay, false); err == nil {
				t.Fatal("lost signature replay accepted")
			}
		})
	}
}
