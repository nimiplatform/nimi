package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestBuildTextGenParamsCarriesTopK(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{
		TopK:             testInt32(19),
		IncludeRawChunks: true,
		Tools: []*runtimev1.ToolSpec{{
			Name:           "web_search",
			Kind:           runtimev1.ToolSpecKind_TOOL_SPEC_KIND_PROVIDER,
			ProviderToolId: "test.web_search",
		}},
	}
	params := BuildTextGenParams(spec)
	if params.topK != 19 {
		t.Fatalf("expected topK 19, got %d", params.topK)
	}
	if !params.includeRawChunks {
		t.Fatal("expected includeRawChunks to be preserved")
	}
	if !params.hasProviderTools() {
		t.Fatal("expected provider tool detection")
	}
}

func TestOpenAIToolsPayloadDoesNotCoerceProviderTools(t *testing.T) {
	payload := openAIToolsPayload([]*runtimev1.ToolSpec{{
		Name:           "web_search",
		Kind:           runtimev1.ToolSpecKind_TOOL_SPEC_KIND_PROVIDER,
		ProviderToolId: "test.web_search",
	}})
	if len(payload) != 0 {
		t.Fatalf("provider tools must not be coerced into function tools: %+v", payload)
	}
}

func TestGenerateTextOpenAIProviderToolsFailClosed(t *testing.T) {
	backend := newBackend("cloud-openai", "https://api.openai.test", "", nil, 0, nil, false, true)
	if backend == nil {
		t.Fatal("expected backend")
	}
	params := textGenParams{
		tools: []*runtimev1.ToolSpec{{
			Name:           "web_search",
			Kind:           runtimev1.ToolSpecKind_TOOL_SPEC_KIND_PROVIDER,
			ProviderToolId: "test.web_search",
		}},
	}
	_, _, _, _, err := backend.GenerateText(
		context.Background(),
		"gpt-4o-mini",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "search"}},
		"",
		0, 0, 0,
		params,
	)
	if err == nil {
		t.Fatal("expected provider tool request to fail closed")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("unexpected reason: %v ok=%v err=%v", reason, ok, err)
	}
}

func TestGenerateTextOpenAIRawChunksFailClosed(t *testing.T) {
	backend := newBackend("cloud-openai", "https://api.openai.test", "", nil, 0, nil, false, true)
	if backend == nil {
		t.Fatal("expected backend")
	}
	_, _, _, _, err := backend.GenerateText(
		context.Background(),
		"gpt-4o-mini",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "raw"}},
		"",
		0, 0, 0,
		textGenParams{includeRawChunks: true},
	)
	if err == nil {
		t.Fatal("expected raw chunk request to fail closed")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED {
		t.Fatalf("unexpected reason: %v ok=%v err=%v", reason, ok, err)
	}
}

func TestGenerateTextOpenAIToolCallsAndStructuredOutputRequireExactAdapterAdmission(t *testing.T) {
	var captured map[string]any
	requestCount := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"","tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}`))
	}))
	defer server.Close()

	backend := newBackend("cloud-openai", server.URL, "", nil, 0, server.Client().Transport, false, true)
	if backend == nil {
		t.Fatal("expected backend")
	}

	schema, err := structpb.NewStruct(map[string]any{"type": "object"})
	if err != nil {
		t.Fatalf("schema: %v", err)
	}
	params := textGenParams{
		tools: []*runtimev1.ToolSpec{{
			Name:        "get_weather",
			Description: "look up the weather",
			InputSchema: schema,
		}},
		toolChoice:     runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED,
		responseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT},
		seed:           7,
		topK:           41,
	}

	input := []*runtimev1.ChatMessage{{Role: "user", Content: "weather in Paris"}}
	if _, _, _, _, err := backend.GenerateText(
		context.Background(), "gpt-4o-mini", input, "", 0, 0, 0, params,
	); textBehaviorReasonForTest(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || requestCount != 0 {
		t.Fatalf("unadmitted tool/structured request = reason=%v requests=%d err=%v", textBehaviorReasonForTest(err), requestCount, err)
	}
	ctx := WithTextBehaviorAdmission(context.Background(), &TextBehaviorAdmission{
		AdapterID: "openai-tools-json", Version: "1", Provider: "openai", ProviderModelID: "gpt-4o-mini", ToolUse: true, StructuredOutput: true,
		Sync: true, ToolStructuredCombination: true,
	})
	text, toolCalls, _, finish, err := backend.GenerateText(
		ctx,
		"gpt-4o-mini",
		input,
		"",
		0, 0, 0,
		params,
	)
	if err != nil {
		t.Fatalf("generate text: %v", err)
	}
	if text != "" {
		t.Fatalf("expected empty text for tool-call response, got %q", text)
	}
	if len(toolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(toolCalls))
	}
	if toolCalls[0].GetName() != "get_weather" {
		t.Fatalf("unexpected tool name: %q", toolCalls[0].GetName())
	}
	if toolCalls[0].GetId() != "call_1" {
		t.Fatalf("unexpected tool id: %q", toolCalls[0].GetId())
	}
	if toolCalls[0].GetArgumentsJson() != `{"city":"Paris"}` {
		t.Fatalf("unexpected tool args: %q", toolCalls[0].GetArgumentsJson())
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		t.Fatalf("expected tool-call finish reason, got %v", finish)
	}

	tools, ok := captured["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("expected 1 request tool, got=%T len=%d", captured["tools"], len(tools))
	}
	toolObj, _ := tools[0].(map[string]any)
	if toolObj["type"] != "function" {
		t.Fatalf("expected function tool, got %v", toolObj["type"])
	}
	function, _ := toolObj["function"].(map[string]any)
	if function["name"] != "get_weather" {
		t.Fatalf("unexpected request tool name: %v", function["name"])
	}
	if captured["tool_choice"] != "required" {
		t.Fatalf("expected required tool_choice, got %v", captured["tool_choice"])
	}
	responseFormat, ok := captured["response_format"].(map[string]any)
	if !ok || responseFormat["type"] != "json_object" {
		t.Fatalf("expected json_object response_format, got %v", captured["response_format"])
	}
	if captured["seed"] == nil {
		t.Fatal("expected seed in request")
	}
	if captured["top_k"] != float64(41) {
		t.Fatalf("expected top_k pass-through, got %v", captured["top_k"])
	}
}

func TestGenerateTextAnthropicFailsClosedOnStructuredOutput(t *testing.T) {
	backend := newBackend("cloud-anthropic", "https://api.anthropic.com", "", nil, 0, nil, false, true)
	if backend == nil {
		t.Fatal("expected backend")
	}
	params := textGenParams{
		responseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT},
	}
	if _, _, _, _, err := backend.GenerateText(
		context.Background(),
		"claude-sonnet-4-6",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "weather"}},
		"",
		0, 0, 0,
		params,
	); textBehaviorReasonForTest(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("expected Anthropic path to fail typed on unadmitted structured output: %v", err)
	}
}

func TestGenerateTextAnthropicToolCallsRequireExactAdapterAdmission(t *testing.T) {
	var captured map[string]any
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{"city":"Paris"}}],"stop_reason":"tool_use","usage":{"input_tokens":4,"output_tokens":2}}`))
	}))
	defer server.Close()

	backend := newBackend("cloud-anthropic", server.URL, "", nil, 0, server.Client().Transport, false, true)
	if backend == nil {
		t.Fatal("expected backend")
	}
	schema, _ := structpb.NewStruct(map[string]any{"type": "object"})
	params := textGenParams{
		tools:      []*runtimev1.ToolSpec{{Name: "get_weather", Description: "weather", InputSchema: schema}},
		toolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO,
		topK:       27,
	}

	ctx := WithTextBehaviorAdmission(context.Background(), &TextBehaviorAdmission{
		AdapterID: "anthropic-tools", Version: "1", Provider: "anthropic", ProviderModelID: "claude-sonnet-4-6", ToolUse: true, Sync: true,
	})
	_, toolCalls, _, finish, err := backend.GenerateText(
		ctx,
		"claude-sonnet-4-6",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "weather in Paris"}},
		"",
		0, 0, 0,
		params,
	)
	if err != nil {
		t.Fatalf("generate text: %v", err)
	}
	if len(toolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(toolCalls))
	}
	if toolCalls[0].GetName() != "get_weather" || toolCalls[0].GetId() != "toolu_1" {
		t.Fatalf("unexpected tool call: %+v", toolCalls[0])
	}
	if toolCalls[0].GetArgumentsJson() != `{"city":"Paris"}` {
		t.Fatalf("unexpected tool args: %q", toolCalls[0].GetArgumentsJson())
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		t.Fatalf("expected tool-call finish, got %v", finish)
	}
	tools, ok := captured["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("expected 1 request tool, got %T", captured["tools"])
	}
	toolObj, _ := tools[0].(map[string]any)
	if toolObj["name"] != "get_weather" || toolObj["input_schema"] == nil {
		t.Fatalf("unexpected request tool: %+v", toolObj)
	}
	if captured["top_k"] != float64(27) {
		t.Fatalf("expected top_k pass-through, got %v", captured["top_k"])
	}
}

func TestStreamGenerateTextToolUseStaysClosedWithoutNativeOrderedSerializer(t *testing.T) {
	backend := newBackend("cloud-openai", "https://api.openai.test", "", nil, 0, nil, false, true)
	ctx := WithTextBehaviorAdmission(context.Background(), &TextBehaviorAdmission{
		AdapterID: "openai-tools-stream", Version: "1", Provider: "openai", ProviderModelID: "gpt-4o-mini", ToolUse: true, Stream: true,
	})
	_, _, err := backend.StreamGenerateText(
		ctx,
		"gpt-4o-mini",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "weather"}},
		"", 0, 0, 0,
		textGenParams{tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "weather"}}},
		func(string) error { return nil },
	)
	if textBehaviorReasonForTest(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("stream tool behavior error = %v", err)
	}
}

func textBehaviorReasonForTest(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}

func TestBuildOpenAIMessagesToolRoundTrip(t *testing.T) {
	input := []*runtimev1.ChatMessage{
		{Role: "user", Content: "weather in Paris?"},
		canonicalAssistantToolMessage("call-1", "weather", `{"city":"Paris"}`),
		canonicalToolResultMessage(t, "call-1", "weather", map[string]any{"temp": 18}),
	}

	messages, err := buildOpenAIMessages("", input)
	if err != nil {
		t.Fatalf("buildOpenAIMessages() error = %v", err)
	}
	if len(messages) != 3 {
		t.Fatalf("expected 3 messages (assistant tool call kept), got %d", len(messages))
	}

	assistant := messages[1]
	if assistant.Role != "assistant" {
		t.Fatalf("unexpected assistant role: %q", assistant.Role)
	}
	if len(assistant.ToolCalls) != 1 {
		t.Fatalf("expected 1 assistant tool call, got %d", len(assistant.ToolCalls))
	}
	if assistant.ToolCalls[0].ID != "call-1" || assistant.ToolCalls[0].Type != "function" {
		t.Fatalf("unexpected tool call id/type: %+v", assistant.ToolCalls[0])
	}
	if assistant.ToolCalls[0].Function.Name != "weather" || assistant.ToolCalls[0].Function.Arguments != `{"city":"Paris"}` {
		t.Fatalf("unexpected tool call function: %+v", assistant.ToolCalls[0].Function)
	}

	tool := messages[2]
	if tool.Role != "tool" || tool.ToolCallID != "call-1" || tool.Content != `{"temp":18}` {
		t.Fatalf("unexpected tool message: %+v", tool)
	}
}

func canonicalAssistantToolMessage(id, name, argumentsJSON string) *runtimev1.ChatMessage {
	return &runtimev1.ChatMessage{
		Role: "assistant",
		TurnItems: []*runtimev1.TextTurnItem{{
			Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{
				Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: &runtimev1.ToolCall{
					Id: id, Name: name, ArgumentsJson: argumentsJSON,
				}},
			}},
		}},
	}
}

func canonicalToolResultMessage(t *testing.T, id, name string, result any) *runtimev1.ChatMessage {
	t.Helper()
	value, err := structpb.NewValue(result)
	if err != nil {
		t.Fatalf("tool result value: %v", err)
	}
	return &runtimev1.ChatMessage{
		Role: "tool",
		TurnItems: []*runtimev1.TextTurnItem{{
			Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{
				ToolCallId: id,
				ToolName:   name,
				Result:     value,
			}},
		}},
	}
}
