package capabilitydriver

import (
	"encoding/json"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
	"testing"
)

func deepseekJSONSpec() *runtimev1.TextGenerateScenarioSpec {
	return &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON with the original text."}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}
}

func TestDeepseekJSONSerializerPreservesInputAndDisablesThinking(t *testing.T) {
	spec := deepseekJSONSpec()
	serialized, err := DeepseekJSONRequestSerializer(spec, true)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		t.Fatal(err)
	}
	if body["thinking"].(map[string]any)["type"] != "disabled" || body["response_format"].(map[string]any)["type"] != "json_object" || body["stream"] != true {
		t.Fatal(body)
	}
	messages := body["messages"].([]any)
	if len(messages) != 1 || messages[0].(map[string]any)["content"] != spec.Input[0].Content {
		t.Fatal("caller prompt changed")
	}
	if _, ok := body["model"]; ok {
		t.Fatal("serializer selected a model")
	}
	spec.TopK = proto.Int32(10)
	if _, err := DeepseekJSONRequestSerializer(spec, true); err == nil {
		t.Fatal("unsupported top_k admitted")
	}
}

func TestDeepseekJSONStreamRequiresValidCompleteObjectAndDone(t *testing.T) {
	stream, err := DeepseekJSONStreamAssembler(deepseekJSONSpec())
	if err != nil {
		t.Fatal(err)
	}
	frames := []string{
		`{"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
		`{"choices":[{"index":0,"delta":{"content":"{\"ok\":"},"finish_reason":null}]}`,
		`{"choices":[{"index":0,"delta":{"content":"true}"},"finish_reason":"stop"}]}`,
		`{"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5}}`,
	}
	for _, frame := range frames {
		if _, err := stream.Append([]byte(frame)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := stream.Finish(); err == nil {
		t.Fatal("truncated SSE accepted")
	}
	if _, err := stream.Append([]byte("[DONE]")); err != nil {
		t.Fatal(err)
	}
	result, err := stream.Finish()
	if err != nil || len(result.Items) != 1 || result.Items[0].Text != `{"ok":true}` || result.Usage.GetInputTokens() != 12 {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if _, err := stream.Append([]byte(frames[0])); err == nil {
		t.Fatal("content after DONE accepted")
	}
}

func TestDeepseekJSONDoesNotRepairInvalidProviderOutput(t *testing.T) {
	valid := []byte(`{"choices":[{"index":0,"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}`)
	result, err := DeepseekJSONNonStreamParser(valid, deepseekJSONSpec())
	if err != nil || result.Items[0].Text != `{"ok":true}` || result.Usage.GetOutputTokens() != 2 {
		t.Fatalf("valid JSON rejected: %+v %v", result, err)
	}
	for _, content := range []string{"", "[]", "null", "not JSON", "{broken"} {
		payload, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "message": map[string]any{"content": content}, "finish_reason": "stop"}}})
		_, err := DeepseekJSONNonStreamParser(payload, deepseekJSONSpec())
		reason, _ := grpcerr.ExtractReasonCode(err)
		if reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			t.Fatalf("content %q err=%v", content, err)
		}
	}
}
