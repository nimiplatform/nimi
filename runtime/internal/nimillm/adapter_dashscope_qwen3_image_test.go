package nimillm

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestDashscopeQwen3ImagePayloadAndSingleFinalURL(t *testing.T) {
	spec := &runtimev1.ImageGenerateScenarioSpec{Prompt: "Make the apple green", ReferenceImages: []string{"https://example.com/apple.png"}}
	payload := dashscopeQwen3ImagePayload(spec)
	if payload["model"] != dashscopeQwen3ImageModel || payload["parameters"] != nil {
		t.Fatalf("Qwen Image payload model/parameters = %#v", payload)
	}
	messages := payload["input"].(map[string]any)["messages"].([]any)
	content := messages[0].(map[string]any)["content"].([]any)
	if len(messages) != 1 || len(content) != 2 || content[0].(map[string]any)["image"] != spec.ReferenceImages[0] ||
		content[1].(map[string]any)["text"] != spec.Prompt {
		t.Fatalf("Qwen Image exact edit content = %#v", messages)
	}
	response := map[string]any{
		"output": map[string]any{"choices": []any{map[string]any{"finish_reason": "stop",
			"message": map[string]any{"role": "assistant", "content": []any{map[string]any{"image": "https://example.com/result.png?Expires=123"}}}}}},
		"usage": map[string]any{"output_image_count": float64(1)},
	}
	if imageURL, err := dashscopeQwen3ImageURL(response); err != nil || imageURL != "https://example.com/result.png?Expires=123" {
		t.Fatalf("single Qwen Image URL = %q err=%v", imageURL, err)
	}
	for name, invalid := range map[string]map[string]any{
		"missing output":   {},
		"multiple choices": {"output": map[string]any{"choices": []any{response["output"].(map[string]any)["choices"].([]any)[0], response["output"].(map[string]any)["choices"].([]any)[0]}}},
		"not HTTPS":        {"output": map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": []any{map[string]any{"image": "http://example.com/result.png"}}}}}}},
		"wrong count":      {"output": response["output"], "usage": map[string]any{"output_image_count": float64(2)}},
	} {
		if _, err := dashscopeQwen3ImageURL(invalid); err == nil {
			t.Fatalf("%s output accepted", name)
		}
	}
}
