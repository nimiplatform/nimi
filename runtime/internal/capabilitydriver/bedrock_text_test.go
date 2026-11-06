package capabilitydriver

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestBedrockClaudeNativeModelBoundThinkingAndControls(t *testing.T) {
	for _, model := range []string{"anthropic.claude-haiku-5-5", "anthropic.claude-sonnet-5-5", "anthropic.claude-opus-5-5", "anthropic.claude-fable-5-1"} {
		p, err := NewBedrockClaudeBehavior(model)
		if err != nil {
			t.Fatal(err)
		}
		spec := anthropicBehaviorTestSpec(t)
		spec.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
		spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM}}
		wire, err := p.Serialize(spec, true)
		if err != nil {
			t.Fatal(model, err)
		}
		var body map[string]any
		_ = json.Unmarshal(wire.Payload, &body)
		if wire.Protocol != BedrockClaudeInvokeProtocol || body["stream"] != nil || body["model"] != nil || body["anthropic_version"] != "bedrock-2023-05-31" || body["output_config"].(map[string]any)["effort"] != "max" {
			t.Fatal("wrong Invoke body", body)
		}
		output := []byte(`{"content":[{"type":"thinking","thinking":"","signature":"exact-original-signature"},{"type":"tool_use","id":"call-original","name":"lookup","input":{"q":"上海"}}],"stop_reason":"tool_use","usage":{"input_tokens":12,"output_tokens":24,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}`)
		result, err := p.Parse(output, spec)
		if err != nil || len(result.Items) != 2 {
			t.Fatal(model, result, err)
		}
		carrier := result.Items[0].ReasoningContinuity
		if carrier.Kind != p.ContinuityKind() || !strings.Contains(string(carrier.Payload), "exact-original-signature") {
			t.Fatal("native signature lost")
		}
		spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
			{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: carrier}}}},
			{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: result.Items[1].ToolCall}}}},
		}}, &runtimev1.ChatMessage{Role: "tool", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-original", ToolName: "lookup", Result: structpb.NewStringValue("found")}}}}})
		if _, err := p.Serialize(spec, false); err != nil {
			t.Fatal("native replay failed", err)
		}
		carrier.Kind = "anthropic.messages.thinking"
		if _, err := p.Serialize(spec, false); err == nil {
			t.Fatal("foreign provider carrier admitted")
		}
		carrier.Kind = p.ContinuityKind()
		spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
		_, err = p.Serialize(spec, false)
		if (err == nil) != (model == "anthropic.claude-haiku-5-5") {
			t.Fatal("wrong explicit-off admission", model, err)
		}
	}
}

func TestBedrockResponsesNativeJSONAndModelSpecificSchemaModes(t *testing.T) {
	for _, model := range []string{"openai.gpt-6-astra", "openai.gpt-6-luna", "openai.gpt-6.1-sol", "openai.gpt-6.1-terra"} {
		p, err := NewBedrockResponsesBehavior(model)
		if err != nil {
			t.Fatal(err)
		}
		schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
		spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return answer 42."}}, MaxTokens: proto.Int32(1000), ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, Strict: true}}
		wire, err := p.Serialize(spec, false)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		_ = json.Unmarshal(wire.Payload, &body)
		if body["stream"] != false || body["store"] != false || wire.Protocol != BedrockResponsesProtocol {
			t.Fatal("non-streaming request changed")
		}
		result, err := p.Parse([]byte(`{"status":"completed","output":[{"type":"message","id":"message-1","content":[{"type":"output_text","text":"{\"answer\":42}"}]}],"usage":{"input_tokens":10,"output_tokens":12}}`), spec)
		if err != nil || len(result.Items) != 1 || result.Items[0].Text != `{"answer":42}` || result.Usage.InputTokens != 10 {
			t.Fatal(model, result, err)
		}
		_, err = p.Serialize(spec, true)
		if (err == nil) != (model == "openai.gpt-6.1-sol") {
			t.Fatal("streaming schema admission", model, err)
		}
		for _, bad := range []string{`{"status":"incomplete","output":[]}`, `{"status":"completed","output":[{"type":"message","id":"m","content":[{"type":"output_text","text":"{\"answer\":\"wrong\"}"}]}]}`, `{"status":"completed","output":[{"type":"reasoning","id":"r","encrypted_content":"","summary":[]}]}`} {
			if _, err := p.Parse([]byte(bad), spec); err == nil {
				t.Fatal("invalid structured/continuity output passed")
			}
		}
	}
}
