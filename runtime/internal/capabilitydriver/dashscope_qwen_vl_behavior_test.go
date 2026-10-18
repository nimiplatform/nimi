package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
)

func qwenVLOrderedSpec() *runtimev1.TextGenerateScenarioSpec {
	return &runtimev1.TextGenerateScenarioSpec{SystemPrompt: "  policy\n", MaxTokens: proto.Int32(1024), Input: []*runtimev1.ChatMessage{
		{Role: "user", Content: "old question"}, {Role: "assistant", Content: "old answer"},
		{Role: "system", Content: "later capability"},
		{Role: "user", Content: "  看图\n", Parts: []*runtimev1.ChatContentPart{
			{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "https://example.com/picture.png", Detail: "auto"}}},
		}},
	}}
}

func TestQwenVLOrderedTextPreservesMessagesAndImageParts(t *testing.T) {
	for _, stream := range []bool{false, true} {
		spec := qwenVLOrderedSpec()
		before := proto.Clone(spec)
		serialized, err := DashscopeQwenVLRequestSerializer(spec, stream)
		if err != nil {
			t.Fatal(err)
		}
		var body struct {
			Messages []struct {
				Role    string
				Content json.RawMessage
			}
			Stream    bool
			Thinking  bool `json:"enable_thinking"`
			MaxTokens int  `json:"max_tokens"`
		}
		if json.Unmarshal(serialized.Payload, &body) != nil || len(body.Messages) != 5 || body.Stream != stream || body.Thinking || body.MaxTokens != 1024 {
			t.Fatalf("wrong request: %s", serialized.Payload)
		}
		for i, role := range []string{"system", "user", "assistant", "system", "user"} {
			if body.Messages[i].Role != role {
				t.Fatalf("role %d = %q", i, body.Messages[i].Role)
			}
		}
		if string(body.Messages[0].Content) != `"  policy\n"` || string(body.Messages[3].Content) != `"later capability"` {
			t.Fatal("system content was changed")
		}
		var parts []map[string]any
		if json.Unmarshal(body.Messages[4].Content, &parts) != nil || len(parts) != 2 || parts[0]["text"] != "  看图\n" || parts[1]["type"] != "image_url" {
			t.Fatal("image/text order changed")
		}
		if !proto.Equal(before, spec) {
			t.Fatal("serializer mutated input")
		}
	}
}

func TestQwenVLRejectsUnadmittedOptionsAndMedia(t *testing.T) {
	for name, mutate := range map[string]func(*runtimev1.TextGenerateScenarioSpec){
		"reasoning": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
		},
		"schema": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA}
		},
		"tool":         func(s *runtimev1.TextGenerateScenarioSpec) { s.Tools = []*runtimev1.ToolSpec{{Name: "act"}} },
		"raw":          func(s *runtimev1.TextGenerateScenarioSpec) { s.IncludeRawChunks = true },
		"limit":        func(s *runtimev1.TextGenerateScenarioSpec) { s.MaxTokens = proto.Int32(32769) },
		"sampling":     func(s *runtimev1.TextGenerateScenarioSpec) { s.TopP = proto.Float32(0.5) },
		"system image": func(s *runtimev1.TextGenerateScenarioSpec) { s.Input[3].Role = "system" },
		"audio": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Input[3].Parts[0] = &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL, Content: &runtimev1.ChatContentPart_AudioUrl{AudioUrl: "https://example.com/a.wav"}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			s := qwenVLOrderedSpec()
			mutate(s)
			_, err := DashscopeQwenVLRequestSerializer(s, true)
			if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
				t.Fatalf("accepted unsupported request: %v", err)
			}
		})
	}
}

func TestQwenVLStreamsBeforeTerminalAndRejectsMissingDone(t *testing.T) {
	s, err := DashscopeQwenVLStreamAssembler(qwenVLOrderedSpec())
	if err != nil {
		t.Fatal(err)
	}
	deltas, err := s.Append([]byte(`{"choices":[{"index":0,"delta":{"content":"<message>青绿"},"finish_reason":null}]}`))
	if err != nil || len(deltas) != 1 || deltas[0].Text != "<message>青绿" {
		t.Fatalf("body was buffered: %v %v", deltas, err)
	}
	if _, err := s.Finish(); err == nil {
		t.Fatal("premature success")
	}
	if _, err := s.Append([]byte(`{"choices":[{"index":0,"delta":{"content":"</message>"},"finish_reason":"stop"}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Finish(); err == nil {
		t.Fatal("missing DONE accepted")
	}
	if _, err := s.Append([]byte(`{"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":4}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Append([]byte(`[DONE]`)); err != nil {
		t.Fatal(err)
	}
	result, err := s.Finish()
	if err != nil || result.Items[0].Text != "<message>青绿</message>" || result.Usage.GetInputTokens() != 8 {
		t.Fatalf("terminal = %+v %v", result, err)
	}
}

func TestQwenVLLengthPreservesLastTextAndUsage(t *testing.T) {
	stream, err := DashscopeQwenVLStreamAssembler(qwenVLOrderedSpec())
	if err != nil {
		t.Fatal(err)
	}
	deltas, appendErr := stream.Append([]byte(`{"choices":[{"index":0,"delta":{"content":"<message>可保留的最后正文"},"finish_reason":"length"}],"usage":{"prompt_tokens":8,"completion_tokens":4}}`))
	var text string
	for _, delta := range deltas {
		text += delta.Text
	}
	if text != "<message>可保留的最后正文" {
		t.Fatalf("last public text lost: deltas=%+v err=%v; expected the text to survive the length terminal", deltas, appendErr)
	}
	if appendErr != nil {
		t.Fatalf("normal length terminal aborted before usage/DONE: %v", appendErr)
	}
	if _, err := stream.Append([]byte(`[DONE]`)); err != nil {
		t.Fatal(err)
	}
	result, err := stream.Finish()
	if err != nil || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_LENGTH || result.Usage.GetInputTokens() != 8 {
		t.Fatalf("length/usage lost: result=%+v err=%v", result, err)
	}
}

func TestPlainTextLengthSyncAndStrictJSON(t *testing.T) {
	payload := []byte(`{"choices":[{"index":0,"message":{"content":"partial"},"finish_reason":"length"}],"usage":{"prompt_tokens":8,"completion_tokens":4}}`)
	result, err := parseChatTextResponse(payload, false)
	if err != nil || result.Items[0].Text != "partial" || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_LENGTH || result.Usage.GetOutputTokens() != 4 {
		t.Fatalf("length result = %+v %v", result, err)
	}
	if _, err := parseChatTextResponse(payload, true); err == nil {
		t.Fatal("truncated JSON accepted")
	}
	stream := &deepseekJSONStream{plainText: true}
	deltas, err := stream.Append([]byte(`{"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":"length"}]}`))
	if err != nil || len(deltas) == 0 || deltas[0].Text != "partial" {
		t.Fatalf("length delta = %+v %v", deltas, err)
	}
	if _, err := stream.Finish(); err == nil {
		t.Fatal("missing DONE accepted")
	}
	if _, err := stream.Append([]byte(`{"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":4}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Append([]byte(`[DONE]`)); err != nil {
		t.Fatal(err)
	}
	result, err = stream.Finish()
	if err != nil || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_LENGTH || result.Usage.GetInputTokens() != 8 {
		t.Fatalf("usage tail = %+v %v", result, err)
	}
}
