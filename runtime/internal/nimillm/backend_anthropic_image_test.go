package nimillm

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// Claude rows declare input.image, so the base Messages path keeps admitted
// user images in order as image blocks instead of refusing every image.
func TestAnthropicMessageContentKeepsUserImagesInOrder(t *testing.T) {
	image := func(url string) *runtimev1.ChatContentPart {
		return &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: url}}}
	}
	text := &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Count the cats"}}
	content, err := buildAnthropicMessageContent(&runtimev1.ChatMessage{Role: "user", Parts: []*runtimev1.ChatContentPart{text, image("data:image/png;base64,iVBORw0KGgo=")}})
	if err != nil {
		t.Fatal(err)
	}
	source, _ := content[1]["source"].(map[string]any)
	if len(content) != 2 || content[0]["text"] != "Count the cats" || content[1]["type"] != "image" || source["type"] != "base64" || source["media_type"] != "image/png" || source["data"] != "iVBORw0KGgo=" {
		t.Fatalf("content = %v", content)
	}
	if _, err := buildAnthropicMessageContent(&runtimev1.ChatMessage{Role: "assistant", Parts: []*runtimev1.ChatContentPart{image("https://example.com/cat.png")}}); err == nil {
		t.Fatal("assistant image was admitted")
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("assistant image = %v", err)
	}
	if _, err := buildAnthropicMessageContent(&runtimev1.ChatMessage{Role: "user", Parts: []*runtimev1.ChatContentPart{image("data:image/tiff;base64,AAAA")}}); err == nil {
		t.Fatal("unsupported image media type was admitted")
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("unsupported image = %v", err)
	}
}
