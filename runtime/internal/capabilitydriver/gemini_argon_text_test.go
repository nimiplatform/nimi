package capabilitydriver

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGeminiArgonMapsMediaSchemaAndControlsWithoutCompatFields(t *testing.T) {
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"ok": map[string]any{"type": "boolean"}}, "required": []any{"ok"}, "additionalProperties": false})
	spec := &runtimev1.TextGenerateScenarioSpec{SystemPrompt: " Keep whitespace\n", Input: []*runtimev1.ChatMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "识别🌧 "}}, {Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "data:image/png;base64,YWJj"}}}}}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, JsonSchema: schema}}
	request, err := GeminiArgonRequestSerializer(spec, true)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(request.Payload, &body)
	content := body["input"].([]any)[0].(map[string]any)["content"].([]any)
	if request.Protocol != GeminiArgonInteractionsProtocol || body["system_instruction"] != " Keep whitespace\n" || content[0].(map[string]any)["text"] != "识别🌧 " || content[1].(map[string]any)["data"] != "YWJj" || body["response_format"].(map[string]any)["mime_type"] != "application/json" {
		t.Fatalf("request=%s", request.Payload)
	}
	nativeDefault := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	nativeDefault.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}}
	defaultRequest, err := GeminiArgonRequestSerializer(nativeDefault, true)
	if err != nil {
		t.Fatal(err)
	}
	var defaultBody map[string]any
	_ = json.Unmarshal(defaultRequest.Payload, &defaultBody)
	if defaultBody["generation_config"].(map[string]any)["thinking_level"] != nil {
		t.Fatal("native-default intensity invented an effort")
	}
	for _, mutation := range []func(*runtimev1.TextGenerateScenarioSpec){
		func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(1) },
		func(s *runtimev1.TextGenerateScenarioSpec) { s.MaxTokens = proto.Int32(65537) },
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
		},
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH}}
		},
	} {
		rejected := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
		mutation(rejected)
		if _, err := GeminiArgonRequestSerializer(rejected, false); err == nil {
			t.Fatalf("unsupported control accepted: %v", rejected)
		}
	}
}

func TestGeminiArgonStreamRequiresNativeTerminalAndAccountsThinking(t *testing.T) {
	frames := []string{
		`{"event_type":"interaction.created","interaction":{"id":"a","object":"interaction","model":"gemini-4-argon","status":"in_progress"}}`,
		`{"event_type":"step.start","index":0,"step":{"type":"model_output"}}`,
		`{"event_type":"step.delta","index":0,"delta":{"type":"text","text":" hello "}}`,
		`{"event_type":"step.stop","index":0}`,
		`{"event_type":"interaction.completed","interaction":{"id":"a","object":"interaction","model":"gemini-4-argon","status":"completed","usage":{"total_input_tokens":3,"total_tokens":10}}}`,
	}
	for end := 1; end <= len(frames); end++ {
		s, _ := GeminiArgonStreamAssembler(nil)
		for _, frame := range frames[:end] {
			if _, err := s.Append([]byte(frame)); err != nil {
				t.Fatal(err)
			}
		}
		result, err := s.Finish()
		if end < len(frames) {
			if err == nil {
				t.Fatalf("EOF after frame %d succeeded", end)
			}
			continue
		}
		if err != nil || result.Items[0].Text != " hello " || result.Usage.GetOutputTokens() != 7 {
			t.Fatalf("result=%+v %v", result, err)
		}
		if _, err := s.Append([]byte(frames[2])); err == nil {
			t.Fatal("accepted late text")
		}
	}
	for _, payload := range []string{
		`{"id":"a","object":"interaction","model":"gemini-4-argon","status":"requires_continuation","steps":[{"type":"model_output","content":[{"type":"text","text":"partial"}]}]}`,
		`{"id":"a","object":"interaction","model":"other","status":"completed","steps":[{"type":"model_output","content":[{"type":"text","text":"wrong"}]}]}`,
		`{"id":"a","object":"interaction","model":"gemini-4-argon","status":"completed","steps":[{"type":"thought","signature":""}]}`,
	} {
		if _, err := GeminiArgonNonStreamParser([]byte(payload), nil); err == nil {
			t.Fatalf("invalid output accepted: %s", payload)
		}
	}
	result, err := GeminiArgonNonStreamParser([]byte(`{"id":"a","object":"interaction","model":"gemini-4-argon","status":"completed","steps":[{"type":"model_output","content":[{"type":"text","text":"ok"}]}],"usage":{"total_input_tokens":3}}`), nil)
	if err != nil || result.Usage != nil || result.Items[0].Kind != textbehavior.OrderedItemText {
		t.Fatalf("partial usage invented: %+v %v", result, err)
	}
}

func TestGeminiArgonRejectsEditedPublicSummaryReplay(t *testing.T) {
	carrier := &runtimev1.ReasoningContinuityCarrier{Kind: GeminiArgonThoughtKind, Version: 1, Payload: []byte(`{"type":"thought","signature":"opaque","summary":[{"type":"text","text":"Original summary"}]}`)}
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Continue"}, {Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummary{Text: "Edited summary"}}}}},
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: carrier}}}},
	}}}}
	if _, err := GeminiArgonRequestSerializer(spec, false); err == nil {
		t.Fatal("edited public summary became a native thought")
	}
	spec.Input[1].TurnItems = spec.Input[1].TurnItems[:1]
	if _, err := GeminiArgonRequestSerializer(spec, false); err == nil {
		t.Fatal("summary without its signed thought was replayed")
	}
}

func TestGeminiArgonBoundsPrivateThoughtBeforeStepStop(t *testing.T) {
	a, _ := GeminiArgonStreamAssembler(nil)
	for _, event := range []string{`{"event_type":"interaction.created","interaction":{}}`, `{"event_type":"step.start","index":0,"step":{"type":"thought"}}`} {
		if _, err := a.Append([]byte(event)); err != nil {
			t.Fatal(err)
		}
	}
	event, _ := json.Marshal(map[string]any{"event_type": "step.delta", "index": 0, "delta": map[string]any{"type": "thought_summary", "content": map[string]any{"type": "text", "text": strings.Repeat("x", textbehavior.MaxReasoningContinuityPayloadBytes+1)}}})
	if _, err := a.Append(event); err == nil {
		t.Fatal("private thought exceeded the carrier bound before its terminal")
	}
}
