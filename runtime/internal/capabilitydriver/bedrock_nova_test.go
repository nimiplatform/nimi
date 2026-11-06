package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestBedrockNovaConverseToolsReasoningAndNativeLimits(t *testing.T) {
	p, err := NewBedrockNovaBehavior("amazon.nova-2-lite-v1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := anthropicBehaviorTestSpec(t)
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}}
	wire, err := p.Serialize(s, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	if wire.Protocol != BedrockNovaConverseProtocol || body["model"] != nil || body["stream"] != nil || body["additionalModelRequestFields"].(map[string]any)["reasoningConfig"].(map[string]any)["maxReasoningEffort"] != "low" || body["toolConfig"].(map[string]any)["toolChoice"].(map[string]any)["any"] == nil {
		t.Fatal("wrong native Converse body", body)
	}
	result, err := p.Parse([]byte(`{"output":{"message":{"role":"assistant","content":[{"reasoningContent":{"reasoningText":{"text":"[REDACTED]"}}},{"toolUse":{"toolUseId":"original-call","name":"lookup","input":{"q":"上海"}}}]}},"stopReason":"tool_use","usage":{"inputTokens":12,"outputTokens":24}}`), s)
	if err != nil || len(result.Items) != 1 || result.Items[0].Kind != textbehavior.OrderedItemToolCall || result.Items[0].ToolCall.Id != "original-call" || result.Usage.OutputTokens != 24 {
		t.Fatal(result, err)
	}
	s.Input = append(s.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: result.Items[0].ToolCall}}}}}}, &runtimev1.ChatMessage{Role: "tool", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "original-call", ToolName: "lookup", Result: structpb.NewStringValue("found")}}}}})
	if _, err := p.Serialize(s, false); err != nil {
		t.Fatal("tool round trip rejected", err)
	}
	for name, mutate := range map[string]func(*runtimev1.TextGenerateScenarioSpec){
		"none": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE
		},
		"schema": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
		},
		"high sampling": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning.Intensity = &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}
			s.Temperature = proto.Float32(.5)
		},
		"excess output": func(s *runtimev1.TextGenerateScenarioSpec) { s.MaxTokens = proto.Int32(65001) },
		"summary": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning.Presentation = runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY
		},
	} {
		bad := proto.Clone(s).(*runtimev1.TextGenerateScenarioSpec)
		mutate(bad)
		if _, err := p.Serialize(bad, false); err == nil {
			t.Fatal("unsupported Nova request accepted", name)
		}
	}
}

func TestBedrockNovaStreamHidesReasoningAndRequiresSealedToolsAndTerminal(t *testing.T) {
	p, _ := NewBedrockNovaBehavior("amazon.nova-2-lite-v1:0")
	spec := anthropicBehaviorTestSpec(t)
	events := []string{
		`{"messageStart":{"role":"assistant"}}`,
		`{"contentBlockDelta":{"contentBlockIndex":0,"delta":{"reasoningContent":{"text":"[REDACTED]"}}}}`,
		`{"contentBlockStop":{"contentBlockIndex":0}}`,
		`{"contentBlockStart":{"contentBlockIndex":1,"start":{"toolUse":{"toolUseId":"tool-1","name":"lookup"}}}}`,
		`{"contentBlockDelta":{"contentBlockIndex":1,"delta":{"toolUse":{"input":"{\"q\":"}}}}`,
		`{"contentBlockDelta":{"contentBlockIndex":1,"delta":{"toolUse":{"input":"\"上海\"}"}}}}`,
		`{"contentBlockStop":{"contentBlockIndex":1}}`,
		`{"messageStop":{"stopReason":"tool_use"}}`,
		`{"metadata":{"usage":{"inputTokens":10,"outputTokens":20}}}`,
	}
	stream, _ := p.Stream(spec)
	calls := 0
	for i, event := range events {
		deltas, err := stream.Append([]byte(event))
		if err != nil {
			t.Fatal(i, err)
		}
		for _, d := range deltas {
			if d.Text != "" || d.ReasoningContinuity != nil {
				t.Fatal("hidden reasoning exposed")
			}
			if d.ToolCall != nil {
				calls++
				if i != 6 || !d.ItemCompleted || d.ToolCall.ArgumentsJson != `{"q":"上海"}` {
					t.Fatal("partial tool exposed", i, d)
				}
			}
		}
		if i == len(events)-2 {
			if _, err := stream.Finish(); err == nil {
				t.Fatal("missing native metadata accepted")
			}
		}
	}
	result, err := stream.Finish()
	if err != nil || calls != 1 || len(result.Items) != 1 || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		t.Fatal(result, calls, err)
	}
	truncated, _ := p.Stream(spec)
	for _, event := range events[:6] {
		if _, err := truncated.Append([]byte(event)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := truncated.Finish(); err == nil {
		t.Fatal("partial native call completed")
	}
}
