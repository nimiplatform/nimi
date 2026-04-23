package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestHasMultimodalParts(t *testing.T) {
	t.Run("no parts returns false", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
			{Role: "assistant", Content: "hi"},
		}
		if hasMultimodalParts(input) {
			t.Fatal("expected false for messages without parts")
		}
	})

	t.Run("nil input returns false", func(t *testing.T) {
		if hasMultimodalParts(nil) {
			t.Fatal("expected false for nil input")
		}
	})

	t.Run("empty input returns false", func(t *testing.T) {
		if hasMultimodalParts([]*runtimev1.ChatMessage{}) {
			t.Fatal("expected false for empty input")
		}
	})

	t.Run("text-only parts returns true", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("hello"),
				},
			},
		}
		if !hasMultimodalParts(input) {
			t.Fatal("expected true when parts are present even if text-only")
		}
	})

	t.Run("image url parts returns true", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("describe this"),
					imagePartWithDetail("https://example.com/img.png", "auto"),
				},
			},
		}
		if !hasMultimodalParts(input) {
			t.Fatal("expected true for messages with image url parts")
		}
	})

	t.Run("mixed messages some with parts", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Role: "user", Content: "no parts here"},
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					imagePart("https://example.com/img.png"),
				},
			},
		}
		if !hasMultimodalParts(input) {
			t.Fatal("expected true when at least one message has parts")
		}
	})
}

func TestHasUnsupportedOpenAITextChatParts(t *testing.T) {
	t.Run("nil input returns false", func(t *testing.T) {
		if hasUnsupportedOpenAITextChatParts(nil) {
			t.Fatal("expected false for nil input")
		}
	})

	t.Run("text and image parts are allowed", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("describe"),
					imagePart("https://example.com/img.png"),
				},
			},
		}
		if hasUnsupportedOpenAITextChatParts(input) {
			t.Fatal("expected image_url to remain supported")
		}
	})

	t.Run("audio parts are allowed for provider-native openai path", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("transcribe"),
					audioPart("https://example.com/sample.wav"),
				},
			},
		}
		if hasUnsupportedOpenAITextChatParts(input) {
			t.Fatal("expected audio_url to remain supported for provider-native openai path")
		}
	})

	t.Run("video parts are rejected", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("watch"),
					videoPart("https://example.com/demo.mp4"),
				},
			},
		}
		if !hasUnsupportedOpenAITextChatParts(input) {
			t.Fatal("expected video_url to be rejected")
		}
	})
}

func TestBuildLlamaTextMessages(t *testing.T) {
	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("describe"),
				imagePart("/tmp/image.png"),
				videoPart("/tmp/video.mp4"),
				audioPart("/tmp/audio.wav"),
			},
		},
	}
	msgs := buildLlamaTextMessages("system prompt", input)
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
	if msgs[0].StringContent != "system prompt" {
		t.Fatalf("unexpected system prompt: %q", msgs[0].StringContent)
	}
	if msgs[1].StringContent != "describe" {
		t.Fatalf("unexpected string content: %q", msgs[1].StringContent)
	}
	if len(msgs[1].StringImages) != 1 || msgs[1].StringImages[0] != "/tmp/image.png" {
		t.Fatalf("unexpected string images: %#v", msgs[1].StringImages)
	}
	if len(msgs[1].StringVideos) != 1 || msgs[1].StringVideos[0] != "/tmp/video.mp4" {
		t.Fatalf("unexpected string videos: %#v", msgs[1].StringVideos)
	}
	if len(msgs[1].StringAudios) != 1 || msgs[1].StringAudios[0] != "/tmp/audio.wav" {
		t.Fatalf("unexpected string audios: %#v", msgs[1].StringAudios)
	}
}

func TestBuildOpenAIMultimodalMessages(t *testing.T) {
	t.Run("system prompt as string content", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		}
		msgs := buildOpenAIMultimodalMessages("  You are helpful  ", input)
		if len(msgs) != 2 {
			t.Fatalf("expected 2 messages, got %d", len(msgs))
		}
		sysMsg := msgs[0]
		if sysMsg.Role != "system" {
			t.Fatalf("expected system role, got %q", sysMsg.Role)
		}
		sysContent, ok := sysMsg.Content.(string)
		if !ok {
			t.Fatalf("expected system content to be string, got %T", sysMsg.Content)
		}
		if sysContent != "You are helpful" {
			t.Fatalf("unexpected system content: %q", sysContent)
		}
	})

	t.Run("empty system prompt omitted", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		}
		msgs := buildOpenAIMultimodalMessages("", input)
		if len(msgs) != 1 {
			t.Fatalf("expected 1 message, got %d", len(msgs))
		}
		if msgs[0].Role != "user" {
			t.Fatalf("expected user role, got %q", msgs[0].Role)
		}
	})

	t.Run("text-only message stays string", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello world"},
		}
		msgs := buildOpenAIMultimodalMessages("", input)
		if len(msgs) != 1 {
			t.Fatalf("expected 1 message, got %d", len(msgs))
		}
		content, ok := msgs[0].Content.(string)
		if !ok {
			t.Fatalf("expected string content for text-only message, got %T", msgs[0].Content)
		}
		if content != "hello world" {
			t.Fatalf("unexpected content: %q", content)
		}
	})

	t.Run("message with image part uses array content", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("describe this"),
					imagePartWithDetail("https://example.com/img.png", "high"),
				},
			},
		}
		msgs := buildOpenAIMultimodalMessages("", input)
		if len(msgs) != 1 {
			t.Fatalf("expected 1 message, got %d", len(msgs))
		}
		parts, ok := msgs[0].Content.([]openAIContentPart)
		if !ok {
			t.Fatalf("expected []openAIContentPart, got %T", msgs[0].Content)
		}
		if len(parts) != 2 {
			t.Fatalf("expected 2 content parts, got %d", len(parts))
		}
		if parts[0].Type != "text" || parts[0].Text != "describe this" {
			t.Fatalf("unexpected text part: %+v", parts[0])
		}
		if parts[1].Type != "image_url" || parts[1].ImageURL == nil {
			t.Fatalf("unexpected image part: %+v", parts[1])
		}
		if parts[1].ImageURL.URL != "https://example.com/img.png" {
			t.Fatalf("unexpected image url: %q", parts[1].ImageURL.URL)
		}
		if parts[1].ImageURL.Detail != "high" {
			t.Fatalf("unexpected detail: %q", parts[1].ImageURL.Detail)
		}
	})

	t.Run("mixed messages text and multimodal", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Role: "user", Content: "plain text"},
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("with image"),
					imagePart("https://example.com/img.png"),
				},
			},
			{Role: "assistant", Content: "response"},
		}
		msgs := buildOpenAIMultimodalMessages("system", input)
		if len(msgs) != 4 {
			t.Fatalf("expected 4 messages, got %d", len(msgs))
		}
		// System message is string
		if _, ok := msgs[0].Content.(string); !ok {
			t.Fatalf("system content should be string, got %T", msgs[0].Content)
		}
		// Plain text message is string
		if _, ok := msgs[1].Content.(string); !ok {
			t.Fatalf("plain text content should be string, got %T", msgs[1].Content)
		}
		// Multimodal message is []openAIContentPart
		if _, ok := msgs[2].Content.([]openAIContentPart); !ok {
			t.Fatalf("multimodal content should be []openAIContentPart, got %T", msgs[2].Content)
		}
		// Assistant response is string
		if _, ok := msgs[3].Content.(string); !ok {
			t.Fatalf("assistant content should be string, got %T", msgs[3].Content)
		}
	})

	t.Run("empty role defaults to user", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Content: "no role set"},
		}
		msgs := buildOpenAIMultimodalMessages("", input)
		if len(msgs) != 1 {
			t.Fatalf("expected 1 message, got %d", len(msgs))
		}
		if msgs[0].Role != "user" {
			t.Fatalf("expected default role 'user', got %q", msgs[0].Role)
		}
	})

	t.Run("empty content messages skipped", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Role: "user", Content: ""},
			{Role: "user", Content: "   "},
		}
		msgs := buildOpenAIMultimodalMessages("", input)
		if len(msgs) != 0 {
			t.Fatalf("expected 0 messages for empty content, got %d", len(msgs))
		}
	})

	t.Run("empty parts after filtering skipped", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("  "),
				},
			},
		}
		msgs := buildOpenAIMultimodalMessages("", input)
		if len(msgs) != 0 {
			t.Fatalf("expected 0 messages for whitespace-only parts, got %d", len(msgs))
		}
	})

	t.Run("name is preserved", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Role: "user", Content: "hi", Name: "  alice  "},
		}
		msgs := buildOpenAIMultimodalMessages("", input)
		if len(msgs) != 1 {
			t.Fatalf("expected 1 message, got %d", len(msgs))
		}
		if msgs[0].Name != "alice" {
			t.Fatalf("expected trimmed name 'alice', got %q", msgs[0].Name)
		}
	})

	t.Run("image with no detail omits detail", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					imagePart("https://example.com/img.png"),
				},
			},
		}
		msgs := buildOpenAIMultimodalMessages("", input)
		if len(msgs) != 1 {
			t.Fatalf("expected 1 message, got %d", len(msgs))
		}
		parts := msgs[0].Content.([]openAIContentPart)
		if parts[0].ImageURL.Detail != "" {
			t.Fatalf("expected empty detail, got %q", parts[0].ImageURL.Detail)
		}
	})
}

func TestBuildOpenAIMultimodalMessagesJSON(t *testing.T) {
	t.Run("system message marshals as string content", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		}
		msgs := buildOpenAIMultimodalMessages("system prompt", input)
		data, err := json.Marshal(msgs)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}

		var raw []map[string]any
		if err := json.Unmarshal(data, &raw); err != nil {
			t.Fatalf("unmarshal error: %v", err)
		}
		if len(raw) != 2 {
			t.Fatalf("expected 2 messages, got %d", len(raw))
		}

		// System message content should be a string
		sysContent, ok := raw[0]["content"].(string)
		if !ok {
			t.Fatalf("system content should be string in JSON, got %T", raw[0]["content"])
		}
		if sysContent != "system prompt" {
			t.Fatalf("unexpected system content: %q", sysContent)
		}
	})

	t.Run("multimodal message marshals as array content", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("describe"),
					imagePartWithDetail("https://example.com/img.png", "auto"),
				},
			},
		}
		msgs := buildOpenAIMultimodalMessages("", input)
		data, err := json.Marshal(msgs)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}

		var raw []map[string]any
		if err := json.Unmarshal(data, &raw); err != nil {
			t.Fatalf("unmarshal error: %v", err)
		}
		if len(raw) != 1 {
			t.Fatalf("expected 1 message, got %d", len(raw))
		}

		contentArr, ok := raw[0]["content"].([]any)
		if !ok {
			t.Fatalf("content should be array in JSON, got %T", raw[0]["content"])
		}
		if len(contentArr) != 2 {
			t.Fatalf("expected 2 content parts, got %d", len(contentArr))
		}

		// First part is text
		textPart, ok := contentArr[0].(map[string]any)
		if !ok {
			t.Fatalf("expected text part as object, got %T", contentArr[0])
		}
		if textPart["type"] != "text" {
			t.Fatalf("expected type 'text', got %v", textPart["type"])
		}
		if textPart["text"] != "describe" {
			t.Fatalf("expected text 'describe', got %v", textPart["text"])
		}

		// Second part is image_url
		imgPart, ok := contentArr[1].(map[string]any)
		if !ok {
			t.Fatalf("expected image part as object, got %T", contentArr[1])
		}
		if imgPart["type"] != "image_url" {
			t.Fatalf("expected type 'image_url', got %v", imgPart["type"])
		}
		imgURL, ok := imgPart["image_url"].(map[string]any)
		if !ok {
			t.Fatalf("expected image_url as object, got %T", imgPart["image_url"])
		}
		if imgURL["url"] != "https://example.com/img.png" {
			t.Fatalf("unexpected url: %v", imgURL["url"])
		}
		if imgURL["detail"] != "auto" {
			t.Fatalf("unexpected detail: %v", imgURL["detail"])
		}
	})

	t.Run("text-only message content is string in JSON", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Role: "user", Content: "just text"},
		}
		msgs := buildOpenAIMultimodalMessages("", input)
		data, err := json.Marshal(msgs)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}

		var raw []map[string]any
		if err := json.Unmarshal(data, &raw); err != nil {
			t.Fatalf("unmarshal error: %v", err)
		}
		content, ok := raw[0]["content"].(string)
		if !ok {
			t.Fatalf("expected string content in JSON for text-only message, got %T", raw[0]["content"])
		}
		if content != "just text" {
			t.Fatalf("unexpected content: %q", content)
		}
	})
}

func TestGenerateTextRejectsUnsupportedOpenAITextChatParts(t *testing.T) {
	backend := NewBackend("test", "https://example.com", "", 0)
	if backend == nil {
		t.Fatal("expected backend")
	}
	input := []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("watch this"),
				videoPart("https://example.com/demo.mp4"),
			},
		},
	}
	_, _, _, err := backend.GenerateText(t.Context(), "openai/gpt-4o", input, "", 0, 0, 0)
	if err == nil {
		t.Fatal("expected unsupported video input to reject before provider call")
	}
}

func TestGenerateTextOpenAIProviderNativeAudioRequest(t *testing.T) {
	var captured map[string]any
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/sample.wav" {
			w.Header().Set("Content-Type", "audio/wav")
			_, _ = w.Write([]byte("RIFFdemo"))
			return
		}
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"heard it"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}`))
	}))
	defer server.Close()

	backend := newBackend("cloud-openai", server.URL, "", nil, 0, server.Client().Transport, false, true)
	if backend == nil {
		t.Fatal("expected backend")
	}
	text, _, _, err := backend.GenerateText(context.Background(), "gpt-4o-audio-preview", []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("transcribe this"),
				audioPart(server.URL + "/sample.wav"),
			},
		},
	}, "", 0, 0, 0)
	if err != nil {
		t.Fatalf("generate text: %v", err)
	}
	if text != "heard it" {
		t.Fatalf("unexpected text output: %q", text)
	}

	messages, ok := captured["messages"].([]any)
	if !ok || len(messages) != 1 {
		t.Fatalf("expected single captured message, got=%T len=%d", captured["messages"], len(messages))
	}
	message, ok := messages[0].(map[string]any)
	if !ok {
		t.Fatalf("expected message object, got %T", messages[0])
	}
	content, ok := message["content"].([]any)
	if !ok || len(content) != 2 {
		t.Fatalf("expected text+audio content array, got=%T len=%d", message["content"], len(content))
	}
	audioPart, ok := content[1].(map[string]any)
	if !ok {
		t.Fatalf("expected audio part object, got %T", content[1])
	}
	if audioPart["type"] != "input_audio" {
		t.Fatalf("expected input_audio type, got %v", audioPart["type"])
	}
	audioPayload, ok := audioPart["input_audio"].(map[string]any)
	if !ok {
		t.Fatalf("expected input_audio payload, got %T", audioPart["input_audio"])
	}
	if audioPayload["format"] != "wav" {
		t.Fatalf("expected wav format, got %v", audioPayload["format"])
	}
	if audioPayload["data"] == "" {
		t.Fatal("expected base64 audio payload")
	}
}

func TestGenerateTextGenericOpenAICompatibleRejectsAudioPart(t *testing.T) {
	backend := NewBackend("cloud-generic", "https://example.com", "", 0)
	if backend == nil {
		t.Fatal("expected backend")
	}
	_, _, _, err := backend.GenerateText(context.Background(), "generic-model", []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("transcribe"),
				audioPart("https://example.com/sample.wav"),
			},
		},
	}, "", 0, 0, 0)
	if err == nil {
		t.Fatal("expected generic openai-compatible path to reject audio")
	}
}

func TestBuildOpenAIProviderNativeMessagesAcceptsDataURLImage(t *testing.T) {
	backend := newBackend("cloud-openai", "https://example.com", "", nil, 0, nil, false, true)
	if backend == nil {
		t.Fatal("expected backend")
	}

	imageDataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("png-bytes"))
	messages, err := backend.buildOpenAIProviderNativeMessages(context.Background(), "", []*runtimev1.ChatMessage{
		{
			Role: "user",
			Parts: []*runtimev1.ChatContentPart{
				textPart("describe"),
				imagePartWithDetail(imageDataURL, "high"),
			},
		},
	})
	if err != nil {
		t.Fatalf("buildOpenAIProviderNativeMessages() error = %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(messages))
	}
	content, ok := messages[0].Content.([]openAIContentPart)
	if !ok || len(content) != 2 {
		t.Fatalf("expected text+image content parts, got=%T len=%d", messages[0].Content, len(content))
	}
	if content[1].Type != "image_url" || content[1].ImageURL == nil {
		t.Fatalf("unexpected image part: %+v", content[1])
	}
	if !strings.HasPrefix(content[1].ImageURL.URL, "data:image/png;base64,") {
		t.Fatalf("expected normalized data URL image payload, got %q", content[1].ImageURL.URL)
	}
}
