package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestBackendPostJSONUsesContextDeadlineOverClientTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(250 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	backend := NewBackend("llama", server.URL, "", 50*time.Millisecond)
	if backend == nil {
		t.Fatal("expected backend")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	var resp struct {
		OK bool `json:"ok"`
	}
	if err := backend.postJSON(ctx, "/slow", map[string]any{"ping": true}, &resp); err != nil {
		t.Fatalf("postJSON with context deadline: %v", err)
	}
	if !resp.OK {
		t.Fatalf("expected ok response, got %+v", resp)
	}
}

func TestBackendStreamGenerateTextBrokenChunkReturnsReasonCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {not-json}\n\n"))
	}))
	defer server.Close()

	backend := NewBackend("openai", server.URL, "", 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	_, _, err := backend.StreamGenerateText(
		context.Background(),
		"gpt-4o-mini",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
		func(string) error { return nil },
	)
	if err == nil {
		t.Fatal("expected broken chunk error")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_STREAM_BROKEN {
		t.Fatalf("expected AI_STREAM_BROKEN, got %v", reason)
	}
}

func TestBackendGenerateTextUsesFlexibleMessageExtraction(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices":[{
				"finish_reason":"stop",
				"message":{
					"content":[
						{"text":"这本书是《三体：地球往事》。"},
						{"text":"它讲的是背叛、生存与死亡。"}
					]
				}
			}],
			"usage":{"prompt_tokens":8,"total_tokens":20}
		}`))
	}))
	defer server.Close()

	backend := NewBackend("openai", server.URL, "", 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	text, usage, finish, err := backend.GenerateText(
		context.Background(),
		"gpt-4o-mini",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
	)
	if err != nil {
		t.Fatalf("unexpected generate error: %v", err)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("unexpected finish reason: %v", finish)
	}
	if usage == nil || usage.GetInputTokens() != 8 || usage.GetOutputTokens() != 12 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if got, want := text, "这本书是《三体：地球往事》。\n它讲的是背叛、生存与死亡。"; got != want {
		t.Fatalf("text mismatch: got=%q want=%q", got, want)
	}
}

func TestBackendGenerateTextUsesOpenAICompatibleRootPathForGeminiBase(t *testing.T) {
	var capturedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices":[{"finish_reason":"stop","message":{"content":"hello from gemini"}}],
			"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}
		}`))
	}))
	defer server.Close()

	backend := NewBackend("gemini", server.URL+"/openai", "", 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	text, _, _, err := backend.GenerateText(
		context.Background(),
		"gemini-2.5-flash",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
	)
	if err != nil {
		t.Fatalf("unexpected generate error: %v", err)
	}
	if capturedPath != "/openai/chat/completions" {
		t.Fatalf("expected Gemini-compatible chat path, got %q", capturedPath)
	}
	if text != "hello from gemini" {
		t.Fatalf("unexpected text: %q", text)
	}
}

func TestBackendStreamGenerateTextUsesOpenAICompatibleRootPathForGeminiBase(t *testing.T) {
	var capturedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hello\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1,\"total_tokens\":3}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	backend := NewBackend("gemini", server.URL+"/openai", "", 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	var full strings.Builder
	_, _, err := backend.StreamGenerateText(
		context.Background(),
		"gemini-2.5-flash",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
		func(part string) error {
			full.WriteString(part)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("unexpected stream error: %v", err)
	}
	if capturedPath != "/openai/chat/completions" {
		t.Fatalf("expected Gemini-compatible stream path, got %q", capturedPath)
	}
	if full.String() != "hello" {
		t.Fatalf("unexpected stream text: %q", full.String())
	}
}

func TestBackendStreamGenerateTextCountsNonContentChunksAsActivity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}` + "\n\n"))
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":0,"total_tokens":5}}` + "\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	backend := NewBackend("openai", server.URL, "", 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	callbacks := make([]string, 0, 2)
	usage, finish, err := backend.StreamGenerateText(
		context.Background(),
		"gpt-4o-mini",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
		func(part string) error {
			callbacks = append(callbacks, part)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("unexpected streaming error: %v", err)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		t.Fatalf("unexpected finish reason: %v", finish)
	}
	if usage == nil || usage.GetInputTokens() != 5 || usage.GetOutputTokens() != 0 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if len(callbacks) < 2 {
		t.Fatalf("expected callbacks for non-content stream chunks, got=%d", len(callbacks))
	}
	for i, part := range callbacks {
		if part != "" {
			t.Fatalf("callback %d should be empty activity-only chunk, got=%q", i, part)
		}
	}
}

func TestBackendGenerateTextUsesCodexResponses(t *testing.T) {
	var capturedPath string
	var capturedAuthorization string
	var capturedOriginator string
	var capturedRequestBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedAuthorization = r.Header.Get("Authorization")
		capturedOriginator = r.Header.Get("originator")
		if err := json.NewDecoder(r.Body).Decode(&capturedRequestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"status":"completed",
			"output":[{"type":"message","content":[{"type":"output_text","text":"hello from codex"}]}],
			"usage":{"input_tokens":3,"output_tokens":2}
		}`))
	}))
	defer server.Close()

	backend := NewBackendWithHeaders("cloud-openai_codex", server.URL+"/backend-api/codex", "token-123", map[string]string{
		"originator": "codex_cli_rs",
	}, 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	text, usage, finish, err := backend.GenerateText(
		context.Background(),
		"gpt-5.4",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		4096,
	)
	if err != nil {
		t.Fatalf("unexpected generate error: %v", err)
	}
	if capturedPath != "/backend-api/codex/responses" {
		t.Fatalf("expected codex responses path, got %q", capturedPath)
	}
	if capturedAuthorization != "Bearer token-123" {
		t.Fatalf("expected bearer auth header, got %q", capturedAuthorization)
	}
	if capturedOriginator != "codex_cli_rs" {
		t.Fatalf("expected codex originator header, got %q", capturedOriginator)
	}
	if capturedRequestBody["instructions"] != codexDefaultInstructions {
		t.Fatalf("expected default Codex instructions, got %+v", capturedRequestBody["instructions"])
	}
	if _, exists := capturedRequestBody["max_output_tokens"]; exists {
		t.Fatalf("expected Codex request to omit max_output_tokens, got %+v", capturedRequestBody)
	}
	input, ok := capturedRequestBody["input"].([]any)
	if !ok || len(input) != 1 {
		t.Fatalf("expected a single Codex input item, got %+v", capturedRequestBody["input"])
	}
	firstItem, ok := input[0].(map[string]any)
	if !ok {
		t.Fatalf("expected Codex input item object, got %+v", input[0])
	}
	if _, exists := firstItem["type"]; exists {
		t.Fatalf("expected Codex text input to omit message type, got %+v", firstItem)
	}
	if firstItem["content"] != "hello" {
		t.Fatalf("expected Codex text input content string, got %+v", firstItem["content"])
	}
	if text != "hello from codex" {
		t.Fatalf("unexpected text: %q", text)
	}
	if usage == nil || usage.GetInputTokens() != 3 || usage.GetOutputTokens() != 2 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("unexpected finish reason: %v", finish)
	}
}

func TestBackendStreamGenerateTextUsesCodexResponsesSSE(t *testing.T) {
	var capturedPath string
	var capturedRequestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&capturedRequestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello \"}\n\n"))
		_, _ = w.Write([]byte("data: {\"type\":\"response.output_text.delta\",\"delta\":\"codex\"}\n\n"))
		_, _ = w.Write([]byte("data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	backend := NewBackendWithHeaders("cloud-openai_codex", server.URL+"/backend-api/codex", "token-123", map[string]string{
		"originator": "codex_cli_rs",
	}, 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	var full strings.Builder
	usage, finish, err := backend.StreamGenerateText(
		context.Background(),
		"gpt-5.4",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		4096,
		func(part string) error {
			full.WriteString(part)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("unexpected stream error: %v", err)
	}
	if capturedPath != "/backend-api/codex/responses" {
		t.Fatalf("expected codex responses path, got %q", capturedPath)
	}
	if capturedRequestBody["instructions"] != codexDefaultInstructions {
		t.Fatalf("expected default Codex instructions, got %+v", capturedRequestBody["instructions"])
	}
	if _, exists := capturedRequestBody["max_output_tokens"]; exists {
		t.Fatalf("expected Codex stream request to omit max_output_tokens, got %+v", capturedRequestBody)
	}
	input, ok := capturedRequestBody["input"].([]any)
	if !ok || len(input) != 1 {
		t.Fatalf("expected a single Codex stream input item, got %+v", capturedRequestBody["input"])
	}
	firstItem, ok := input[0].(map[string]any)
	if !ok {
		t.Fatalf("expected Codex stream input item object, got %+v", input[0])
	}
	if _, exists := firstItem["type"]; exists {
		t.Fatalf("expected Codex stream text input to omit message type, got %+v", firstItem)
	}
	if firstItem["content"] != "hello" {
		t.Fatalf("expected Codex stream input content string, got %+v", firstItem["content"])
	}
	if full.String() != "hello codex" {
		t.Fatalf("unexpected stream text: %q", full.String())
	}
	if usage == nil || usage.GetInputTokens() != 5 || usage.GetOutputTokens() != 2 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("unexpected finish reason: %v", finish)
	}
}

func TestBackendStreamGenerateTextUsesCodexResponsesSSEDespiteUnexpectedContentType(t *testing.T) {
	var capturedPath string
	var capturedRequestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&capturedRequestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello \"}\n\n"))
		_, _ = w.Write([]byte("data: {\"type\":\"response.output_text.delta\",\"delta\":\"codex\"}\n\n"))
		_, _ = w.Write([]byte("data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	backend := NewBackendWithHeaders("cloud-openai_codex", server.URL+"/backend-api/codex", "token-123", map[string]string{
		"originator": "codex_cli_rs",
	}, 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	var full strings.Builder
	usage, finish, err := backend.StreamGenerateText(
		context.Background(),
		"gpt-5.4",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		4096,
		func(part string) error {
			full.WriteString(part)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("unexpected stream error: %v", err)
	}
	if capturedPath != "/backend-api/codex/responses" {
		t.Fatalf("expected codex responses path, got %q", capturedPath)
	}
	if capturedRequestBody["instructions"] != codexDefaultInstructions {
		t.Fatalf("expected default Codex instructions, got %+v", capturedRequestBody["instructions"])
	}
	if full.String() != "hello codex" {
		t.Fatalf("unexpected stream text: %q", full.String())
	}
	if usage == nil || usage.GetInputTokens() != 5 || usage.GetOutputTokens() != 2 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("unexpected finish reason: %v", finish)
	}
}

func TestBuildCodexResponsesInputUsesOutputTextForAssistantParts(t *testing.T) {
	items, err := buildCodexResponsesInput([]*runtimev1.ChatMessage{
		{
			Role: "assistant",
			Parts: []*runtimev1.ChatContentPart{textPart("hello from assistant")},
		},
	})
	if err != nil {
		t.Fatalf("unexpected build input error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one input item, got %d", len(items))
	}
	content, ok := items[0]["content"].([]map[string]any)
	if !ok || len(content) != 1 {
		t.Fatalf("expected assistant content parts, got %+v", items[0]["content"])
	}
	if content[0]["type"] != "output_text" {
		t.Fatalf("expected assistant part type output_text, got %+v", content[0]["type"])
	}
}

func TestBackendGenerateTextUsesAnthropicMessagesAPI(t *testing.T) {
	var capturedPath string
	var capturedAPIKey string
	var capturedVersion string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedAPIKey = r.Header.Get("x-api-key")
		capturedVersion = r.Header.Get("anthropic-version")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"content":[{"type":"text","text":"hello from anthropic"}],
			"stop_reason":"end_turn",
			"usage":{"input_tokens":4,"output_tokens":3}
		}`))
	}))
	defer server.Close()

	backend := NewBackendWithHeaders("cloud-anthropic", server.URL, "sk-ant-api-test", anthropicCredentialHeaders("sk-ant-api-test"), 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	text, usage, finish, err := backend.GenerateText(
		context.Background(),
		"claude-sonnet-4-6",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
	)
	if err != nil {
		t.Fatalf("unexpected generate error: %v", err)
	}
	if capturedPath != "/v1/messages" {
		t.Fatalf("expected anthropic messages path, got %q", capturedPath)
	}
	if capturedAPIKey != "sk-ant-api-test" {
		t.Fatalf("expected x-api-key auth, got %q", capturedAPIKey)
	}
	if capturedVersion != anthropicVersionHeaderValue {
		t.Fatalf("expected anthropic version header, got %q", capturedVersion)
	}
	if text != "hello from anthropic" {
		t.Fatalf("unexpected text: %q", text)
	}
	if usage == nil || usage.GetInputTokens() != 4 || usage.GetOutputTokens() != 3 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("unexpected finish reason: %v", finish)
	}
}

func TestBackendGenerateTextUsesAnthropicOAuthBearer(t *testing.T) {
	var capturedAuthorization string
	var capturedBeta string
	var capturedApp string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuthorization = r.Header.Get("Authorization")
		capturedBeta = r.Header.Get("anthropic-beta")
		capturedApp = r.Header.Get("x-app")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"content":[{"type":"text","text":"hello oauth"}],
			"stop_reason":"end_turn",
			"usage":{"input_tokens":2,"output_tokens":2}
		}`))
	}))
	defer server.Close()

	token := "sk-ant-oat-test"
	backend := NewBackendWithHeaders("cloud-anthropic", server.URL, token, anthropicCredentialHeaders(token), 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	_, _, _, err := backend.GenerateText(
		context.Background(),
		"claude-sonnet-4-6",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
	)
	if err != nil {
		t.Fatalf("unexpected generate error: %v", err)
	}
	if capturedAuthorization != "Bearer "+token {
		t.Fatalf("expected bearer auth, got %q", capturedAuthorization)
	}
	if !strings.Contains(capturedBeta, "oauth-2025-04-20") {
		t.Fatalf("expected oauth beta header, got %q", capturedBeta)
	}
	if capturedApp != "cli" {
		t.Fatalf("expected x-app header, got %q", capturedApp)
	}
}

func TestBackendGenerateTextUsesOpenAICompatibleOAuthBearer(t *testing.T) {
	var capturedPath string
	var capturedAuthorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedAuthorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices":[{"finish_reason":"stop","message":{"content":"hello from qwen oauth"}}],
			"usage":{"prompt_tokens":2,"completion_tokens":4,"total_tokens":6}
		}`))
	}))
	defer server.Close()

	backend := NewBackendWithHeaders("cloud-openai_compatible", server.URL+"/v1", "qwen-oauth-token", nil, 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	text, usage, finish, err := backend.GenerateText(
		context.Background(),
		"qwen-max",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
	)
	if err != nil {
		t.Fatalf("unexpected generate error: %v", err)
	}
	if capturedPath != "/v1/chat/completions" {
		t.Fatalf("expected openai-compatible chat path, got %q", capturedPath)
	}
	if capturedAuthorization != "Bearer qwen-oauth-token" {
		t.Fatalf("expected bearer oauth authorization, got %q", capturedAuthorization)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("unexpected finish reason: %v", finish)
	}
	if usage == nil || usage.GetInputTokens() != 2 || usage.GetOutputTokens() != 4 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if text != "hello from qwen oauth" {
		t.Fatalf("unexpected text: %q", text)
	}
}

func TestBackendStreamGenerateTextUsesAnthropicMessagesSSE(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: content_block_delta\n"))
		_, _ = w.Write([]byte("data: {\"delta\":{\"type\":\"text_delta\",\"text\":\"hello \"}}\n\n"))
		_, _ = w.Write([]byte("event: content_block_delta\n"))
		_, _ = w.Write([]byte("data: {\"delta\":{\"type\":\"text_delta\",\"text\":\"anthropic\"}}\n\n"))
		_, _ = w.Write([]byte("event: message_delta\n"))
		_, _ = w.Write([]byte("data: {\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n"))
		_, _ = w.Write([]byte("event: message_start\n"))
		_, _ = w.Write([]byte("data: {\"message\":{\"usage\":{\"input_tokens\":6,\"output_tokens\":2}}}\n\n"))
	}))
	defer server.Close()

	backend := NewBackendWithHeaders("cloud-anthropic", server.URL, "sk-ant-api-test", anthropicCredentialHeaders("sk-ant-api-test"), 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}

	var full strings.Builder
	usage, finish, err := backend.StreamGenerateText(
		context.Background(),
		"claude-sonnet-4-6",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		0,
		func(part string) error {
			full.WriteString(part)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("unexpected stream error: %v", err)
	}
	if full.String() != "hello anthropic" {
		t.Fatalf("unexpected stream text: %q", full.String())
	}
	if usage == nil || usage.GetInputTokens() != 6 || usage.GetOutputTokens() != 2 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("unexpected finish reason: %v", finish)
	}
}
