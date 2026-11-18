package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

func TestDeepseekExactAdapterPreservesToolProposalsAcrossModes(t *testing.T) {
	profile := mustDeepseekBehavior(t, "deepseek-flash")
	for _, mode := range []string{"default", "thinking"} {
		t.Run(mode, func(t *testing.T) {
			spec := deepseekToolSpec(t)
			message := map[string]any{}
			delta := map[string]any{}
			callIndex := 0
			if mode == "thinking" {
				spec.Temperature = nil
				spec.Reasoning = &runtimev1.ReasoningConfig{
					Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
					Intensity:  &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH},
				}
				message["reasoning_content"] = "native reasoning"
				delta["reasoning_content"] = "native reasoning"
				callIndex = 1
			}
			for _, args := range []string{`{"city":7}`, `{"city":`} {
				call := deepseekCallChunk(0, "a", "lookup", args)
				delete(call, "index")
				message["tool_calls"] = []any{call}
				wire, err := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": "tool_calls"}}})
				if err != nil {
					t.Fatal(err)
				}
				result, syncErr := profile.Parse(wire, spec)

				stream, err := profile.Stream(spec)
				if err != nil {
					t.Fatal(err)
				}
				delta["tool_calls"] = []any{deepseekCallChunk(0, "a", "lookup", args)}
				early, err := stream.Append(deepseekToolChunk(t, delta, nil))
				var published []textbehavior.OrderedDelta
				for _, item := range early {
					if item.HasPublicPayload() {
						published = append(published, item)
					}
				}
				if err != nil || len(published) != callIndex || (callIndex == 1 && published[0].ReasoningContinuity == nil) {
					t.Fatalf("stream published a partial tool call or lost reasoning: %v, %v", early, err)
				}
				deltas, streamErr := stream.Append(deepseekToolChunk(t, map[string]any{}, "tool_calls"))
				if !json.Valid([]byte(args)) {
					for _, err := range []error{syncErr, streamErr} {
						if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TOOL_CALL_INVALID {
							t.Fatalf("malformed JSON error = %v", err)
						}
					}
					if len(deltas) != 0 {
						t.Fatalf("malformed tool call emitted: %v", deltas)
					}
					continue
				}
				if syncErr != nil || len(result.Items) != callIndex+1 || (callIndex == 1 && result.Items[0].ReasoningContinuity == nil) {
					t.Fatalf("sync result = %v, %v", result, syncErr)
				}
				if streamErr != nil || len(deltas) != 1 || deltas[0].ItemIndex != uint32(callIndex) {
					t.Fatalf("stream result = %v, %v", deltas, streamErr)
				}
				if _, err := stream.Append([]byte("[DONE]")); err != nil {
					t.Fatal(err)
				}
				final, err := stream.Finish()
				if err != nil || len(final.Items) != callIndex+1 {
					t.Fatalf("stream completion = %v, %v", final, err)
				}
				for _, toolCall := range []*runtimev1.ToolCall{result.Items[callIndex].ToolCall, deltas[0].ToolCall, final.Items[callIndex].ToolCall} {
					if toolCall.GetId() != "a" || toolCall.GetName() != "lookup" || toolCall.GetArgumentsJson() != args {
						t.Fatalf("tool proposal changed: %v", toolCall)
					}
				}
			}
		})
	}
}

func TestDeepseekReasoningControlsPreserveDefaultAndRejectIgnoredValues(t *testing.T) {
	for _, model := range []string{"deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"} {
		p := mustDeepseekBehavior(t, model)
		spec := deepseekToolSpec(t)
		wire, err := p.Serialize(spec, false)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		_ = json.Unmarshal(wire.Payload, &body)
		if body["thinking"].(map[string]any)["type"] != "disabled" {
			t.Fatal("omitted implementation default changed")
		}
		spec.Temperature = nil
		for effort, native := range map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high", runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "max"} {
			spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: effort}}
			wire, err = p.Serialize(spec, true)
			if err != nil {
				t.Fatal(err)
			}
			_ = json.Unmarshal(wire.Payload, &body)
			if body["model"] != model || body["thinking"].(map[string]any)["type"] != "enabled" || body["reasoning_effort"] != native {
				t.Fatal("exact thinking controls changed")
			}
		}
		for _, change := range []func(*runtimev1.TextGenerateScenarioSpec){
			func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(1) },
			func(s *runtimev1.TextGenerateScenarioSpec) { s.TopP = proto.Float32(.94) },
			func(s *runtimev1.TextGenerateScenarioSpec) { s.PresencePenalty = proto.Float32(0) },
			func(s *runtimev1.TextGenerateScenarioSpec) {
				s.Reasoning.Presentation = runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY
			},
			func(s *runtimev1.TextGenerateScenarioSpec) {
				s.Reasoning.Intensity = &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 1024}
			},
			func(s *runtimev1.TextGenerateScenarioSpec) {
				s.Reasoning.Intensity = &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM}
			},
		} {
			bad := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
			change(bad)
			if _, err := p.Serialize(bad, false); err == nil {
				t.Fatalf("unhonored control admitted for %s", model)
			}
		}
		spec.TopP = proto.Float32(.95)
		_, err = p.Serialize(spec, false)
		if (err != nil) != (model == "deepseek-v4-pro") {
			t.Fatalf("wrong model-specific top_p %s: %v", model, err)
		}
	}
}

func TestDeepseekThinkingVisionAndJSONKeepNativeContentSeparate(t *testing.T) {
	p := mustDeepseekBehavior(t, "deepseek-flash")
	spec := deepseekVisionSpec(deepseekVisionImage(t, 2))
	spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}}
	spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	if _, err := p.Serialize(spec, true); err != nil {
		t.Fatal(err)
	}
	result, err := p.Parse([]byte(`{"choices":[{"index":0,"message":{"reasoning_content":"private-native","content":"{\"answer\":42}"},"finish_reason":"stop"}]}`), spec)
	if err != nil || len(result.Items) != 2 || result.Items[0].Kind != textbehavior.OrderedItemReasoningContinuity || result.Items[1].Kind != textbehavior.OrderedItemText || result.Items[1].Text != `{"answer":42}` {
		t.Fatalf("hidden JSON %v %v", result, err)
	}
	if _, err = p.Parse([]byte(`{"choices":[{"index":0,"message":{"reasoning_content":"private","content":"{}"},"finish_reason":"length"}]}`), spec); err == nil {
		t.Fatal("reasoning/output truncation became JSON success")
	}
	for _, model := range []string{"deepseek-v4-flash", "deepseek-v4-pro"} {
		if _, err := mustDeepseekBehavior(t, model).Serialize(spec, false); err == nil {
			t.Fatal("adjacent target gained vision")
		}
	}
}

func TestDeepseekPlainThinkingCanBeReplayedWhenLaterToolsAreDeclared(t *testing.T) {
	p := mustDeepseekBehavior(t, "deepseek-flash")
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "First assess the request."}}, Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}}}
	first, err := p.Parse([]byte(`{"choices":[{"index":0,"message":{"reasoning_content":"  prior native reasoning\n","content":"Ready."},"finish_reason":"stop"}]}`), spec)
	if err != nil || len(first.Items) != 2 {
		t.Fatalf("plain continuity absent: %v %v", first, err)
	}
	spec.Tools = deepseekToolSpec(t).Tools
	spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: first.Items[0].ReasoningContinuity}}}},
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: first.Items[1].Text}}}}},
	}}, &runtimev1.ChatMessage{Role: "user", Content: "Now use lookup for Paris."})
	wire, err := p.Serialize(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	if body["messages"].([]any)[1].(map[string]any)["reasoning_content"] != "  prior native reasoning\n" {
		t.Fatal("earlier thinking lost on tool introduction")
	}
}
