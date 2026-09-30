package capabilitydriver

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

func anthropicCarrier(t *testing.T, block map[string]any) *runtimev1.TextOutputItem {
	t.Helper()
	payload, err := json.Marshal(block)
	if err != nil {
		t.Fatal(err)
	}
	return &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{Kind: "anthropic.messages.thinking", Version: 1, Payload: payload}}}
}

func decodeAnthropicBody(t *testing.T, serialized textbehavior.SerializedRequest) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		t.Fatal(err)
	}
	return body
}

// Adaptive-thinking models keep thinking omitted, get room for thinking and
// replay each signed block exactly where it was returned.
func TestAnthropicAdaptiveSerializerOmitsThinkingAndReplaysSignedBlocks(t *testing.T) {
	spec := anthropicBehaviorTestSpec(t)
	spec.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
	spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: anthropicCarrier(t, map[string]any{"type": "thinking", "thinking": "", "signature": "sig-1"})}},
		{Item: &runtimev1.TextTurnItem_Output{Output: anthropicCarrier(t, map[string]any{"type": "redacted_thinking", "data": "enc-1"})}},
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: `{"q":"one"}`}}}}},
		{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup"}}},
	}})
	body := decodeAnthropicBody(t, mustSerialize(t, AnthropicAdaptiveTextBehaviorRequestSerializer, spec))
	thinking, _ := body["thinking"].(map[string]any)
	if thinking["type"] != "adaptive" || thinking["display"] != "omitted" || body["max_tokens"] != float64(16384) {
		t.Fatalf("thinking or output budget = %v %v", body["thinking"], body["max_tokens"])
	}
	blocks := body["messages"].([]any)[1].(map[string]any)["content"].([]any)
	if len(blocks) != 3 || blocks[0].(map[string]any)["type"] != "thinking" || blocks[0].(map[string]any)["signature"] != "sig-1" || blocks[0].(map[string]any)["thinking"] != "" ||
		blocks[1].(map[string]any)["type"] != "redacted_thinking" || blocks[1].(map[string]any)["data"] != "enc-1" || blocks[2].(map[string]any)["type"] != "tool_use" {
		t.Fatalf("replayed assistant blocks = %v", blocks)
	}

	// The legacy profile does not send thinking and does not replay carriers.
	legacy := decodeAnthropicBody(t, mustSerialize(t, AnthropicTextBehaviorRequestSerializer, anthropicBehaviorTestSpec(t)))
	if _, present := legacy["thinking"]; present || legacy["max_tokens"] != float64(4096) {
		t.Fatalf("legacy request = %v", legacy)
	}
	if _, err := AnthropicTextBehaviorRequestSerializer(spec, false); !hasReason(err, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED) {
		t.Fatalf("legacy replay of a thinking carrier = %v", err)
	}
}

func TestAnthropicAdaptiveSerializerRefusesSamplingForcedChoiceAndForeignCarriers(t *testing.T) {
	temperature := float32(0.5)
	sampled := anthropicBehaviorTestSpec(t)
	sampled.ToolChoice, sampled.Temperature = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, &temperature
	forced := anthropicBehaviorTestSpec(t)
	foreign := anthropicBehaviorTestSpec(t)
	foreign.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
	foreign.Input = append(foreign.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{Kind: "openai.responses.encrypted-reasoning", Version: 1, Payload: []byte(`{}`)}}}}},
	}})
	summarized := anthropicBehaviorTestSpec(t)
	summarized.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
	summarized.Input = append(summarized.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: anthropicCarrier(t, map[string]any{"type": "thinking", "thinking": "raw reasoning", "signature": "sig"})}},
	}})
	for name, test := range map[string]struct {
		spec   *runtimev1.TextGenerateScenarioSpec
		reason runtimev1.ReasonCode
	}{
		"sampling":           {sampled, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED},
		"forced tool choice": {forced, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED},
		"foreign carrier":    {foreign, runtimev1.ReasonCode_AI_INPUT_INVALID},
		"thinking text":      {summarized, runtimev1.ReasonCode_AI_INPUT_INVALID},
	} {
		if _, err := AnthropicAdaptiveTextBehaviorRequestSerializer(test.spec, false); !hasReason(err, test.reason) {
			t.Fatalf("%s = %v", name, err)
		}
	}
}

// Signed thinking and redacted_thinking blocks come back as ordered opaque
// carriers in both modes; returned thinking text is never published.
func TestAnthropicAdaptiveParsersCarrySignedThinkingInOrder(t *testing.T) {
	spec := anthropicBehaviorTestSpec(t)
	spec.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
	message := `{"content":[{"type":"thinking","thinking":"","signature":"sig-1"},{"type":"redacted_thinking","data":"enc-1"},{"type":"tool_use","id":"call-1","name":"lookup","input":{"q":"one"}}],"stop_reason":"tool_use","usage":{"input_tokens":3,"output_tokens":4}}`
	result, err := AnthropicAdaptiveTextBehaviorNonStreamParser([]byte(message), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 3 || result.Items[0].Kind != textbehavior.OrderedItemReasoningContinuity || result.Items[1].Kind != textbehavior.OrderedItemReasoningContinuity ||
		result.Items[2].ToolCall.GetId() != "call-1" || !strings.Contains(string(result.Items[0].ReasoningContinuity.GetPayload()), "sig-1") {
		t.Fatalf("sync items = %+v", result.Items)
	}
	if _, err := AnthropicTextBehaviorNonStreamParser([]byte(message), spec); !hasReason(err, runtimev1.ReasonCode_AI_OUTPUT_INVALID) {
		t.Fatalf("legacy parser accepted thinking = %v", err)
	}
	leaked := strings.Replace(message, `"thinking":""`, `"thinking":"raw"`, 1)
	if _, err := AnthropicAdaptiveTextBehaviorNonStreamParser([]byte(leaked), spec); !hasReason(err, runtimev1.ReasonCode_AI_OUTPUT_INVALID) {
		t.Fatalf("thinking text was carried = %v", err)
	}

	assembler, err := AnthropicAdaptiveTextBehaviorStreamAssembler(spec)
	if err != nil {
		t.Fatal(err)
	}
	var published []textbehavior.OrderedDelta
	for _, event := range []string{
		`{"type":"message_start","message":{"content":[],"usage":{"input_tokens":3,"output_tokens":1}}}`,
		`{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-"}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"2"}}`,
		`{"type":"content_block_stop","index":0}`,
		`{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
		`{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"{\"q\":\"ok\"}"}}`,
		`{"type":"content_block_stop","index":1}`,
		`{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":6}}`,
		`{"type":"message_stop"}`,
	} {
		deltas, err := assembler.Append([]byte(event))
		if err != nil {
			t.Fatalf("event %s: %v", event, err)
		}
		published = append(published, deltas...)
	}
	schema := anthropicBehaviorTestSpec(t).GetTools()[0].GetInputSchema()
	spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, Strict: true}
	streamed, err := assembler.Finish()
	if err != nil {
		t.Fatal(err)
	}
	if len(streamed.Items) != 2 || streamed.Items[0].Kind != textbehavior.OrderedItemReasoningContinuity ||
		!strings.Contains(string(streamed.Items[0].ReasoningContinuity.GetPayload()), `"signature":"sig-2"`) || streamed.Items[1].Text != `{"q":"ok"}` {
		t.Fatalf("stream items = %+v", streamed.Items)
	}
	// The only published item before the text is the sealed carrier.
	if len(published) == 0 || published[0].ItemIndex != 0 || published[0].ReasoningContinuity == nil || published[0].Text != "" {
		t.Fatalf("published before text = %+v", published)
	}
	rawText := newAnthropicBehaviorStream(anthropicAdaptiveMessages, spec)
	for _, event := range []string{
		`{"type":"message_start","message":{"content":[],"usage":{}}}`,
		`{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}`,
	} {
		if _, err := rawText.Append([]byte(event)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := rawText.Append([]byte(`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"raw"}}`)); !hasReason(err, runtimev1.ReasonCode_AI_OUTPUT_INVALID) {
		t.Fatalf("streamed thinking text = %v", err)
	}
}

// User images keep their order as base64 or URL image blocks; other image
// sources and non-user images are rejected.
func TestAnthropicImageBlocksAreOrderedAndBounded(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Describe"}},
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "data:image/jpeg;base64,AAAA"}}},
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "https://example.com/cat.png"}}},
	}}}}
	body := decodeAnthropicBody(t, mustSerialize(t, AnthropicAdaptiveTextBehaviorRequestSerializer, spec))
	content := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
	base64Source := content[1].(map[string]any)["source"].(map[string]any)
	urlSource := content[2].(map[string]any)["source"].(map[string]any)
	if len(content) != 3 || content[0].(map[string]any)["text"] != "Describe" || base64Source["type"] != "base64" || base64Source["media_type"] != "image/jpeg" || base64Source["data"] != "AAAA" ||
		urlSource["type"] != "url" || urlSource["url"] != "https://example.com/cat.png" {
		t.Fatalf("image blocks = %v", content)
	}
	for _, bad := range []string{"data:image/bmp;base64,AAAA", "data:image/png,AAAA", "file:///C:/cat.png", "https://user:pass@example.com/cat.png"} { // pragma: allowlist secret
		if _, err := AnthropicImageBlock(bad); !hasReason(err, runtimev1.ReasonCode_AI_INPUT_INVALID) {
			t.Fatalf("%s = %v", bad, err)
		}
	}
	spec.Input[0].Role = "assistant"
	if _, err := AnthropicAdaptiveTextBehaviorRequestSerializer(spec, false); !hasReason(err, runtimev1.ReasonCode_AI_INPUT_INVALID) {
		t.Fatalf("assistant image = %v", err)
	}
}

func mustSerialize(t *testing.T, serializer func(*runtimev1.TextGenerateScenarioSpec, bool) (textbehavior.SerializedRequest, error), spec *runtimev1.TextGenerateScenarioSpec) textbehavior.SerializedRequest {
	t.Helper()
	serialized, err := serializer(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	return serialized
}

func hasReason(err error, reason runtimev1.ReasonCode) bool {
	got, _ := grpcerr.ExtractReasonCode(err)
	return err != nil && got == reason
}
