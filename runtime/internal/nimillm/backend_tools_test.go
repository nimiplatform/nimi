package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestBuildTextGenParamsCarriesTopK(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{
		TopK:             testInt32(19),
		IncludeRawChunks: true,
	}
	params := BuildTextGenParams(spec)
	if params.topK != 19 {
		t.Fatalf("expected topK 19, got %d", params.topK)
	}
	if !params.includeRawChunks {
		t.Fatal("expected includeRawChunks to be preserved")
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

func TestPrimitiveTextGenerationRejectsOptionalBehaviors(t *testing.T) {
	schema, err := structpb.NewStruct(map[string]any{"type": "object"})
	if err != nil {
		t.Fatal(err)
	}
	userInput := []*runtimev1.ChatMessage{{Role: "user", Content: "weather in Paris"}}
	cases := []struct {
		name   string
		params textGenParams
		input  []*runtimev1.ChatMessage
	}{
		{name: "function tools", params: textGenParams{tools: []*runtimev1.ToolSpec{{Name: "weather", Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, InputSchema: schema}}}},
		{name: "tool choice", params: textGenParams{toolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE}},
		{name: "structured output", params: textGenParams{responseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}},
		{name: "tool transcript", input: []*runtimev1.ChatMessage{userInput[0], canonicalAssistantToolMessage("call-1", "weather", `{}`), canonicalToolResultMessage(t, "call-1", "weather", "sunny")}},
		{
			name: "reasoning summary",
			input: []*runtimev1.ChatMessage{{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{
				Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{
					Item: &runtimev1.TextOutputItem_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummary{Text: "summary"}},
				}},
			}}}},
		},
		{
			name: "reasoning continuity",
			input: []*runtimev1.ChatMessage{{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{
				Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{
					Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{
						Kind: "test.continuity", Version: 1, Payload: []byte("opaque"),
					}},
				}},
			}}}},
		},
	}
	for _, provider := range []struct{ name, model string }{{"openai", "gpt-4o-mini"}, {"anthropic", "claude-sonnet-4-6"}, {"openai_codex", "gpt-5.6-sol"}} {
		t.Run(provider.name, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				requests.Add(1)
				http.Error(w, "unexpected primitive behavior dispatch", http.StatusBadRequest)
			}))
			defer server.Close()
			backend := newBackend("cloud-"+provider.name, server.URL, "", nil, 0, server.Client().Transport, false, true)
			if backend == nil {
				t.Fatal("expected backend")
			}
			for _, test := range cases {
				for _, mode := range []string{"sync", "stream"} {
					t.Run(test.name+"/"+mode, func(t *testing.T) {
						input := test.input
						if input == nil {
							input = userInput
						}
						var err error
						if mode == "sync" {
							_, _, _, _, err = backend.GenerateText(context.Background(), provider.model, input, "", 0, 0, 0, test.params)
						} else {
							_, _, err = backend.StreamGenerateText(context.Background(), provider.model, input, "", 0, 0, 0, test.params, func(string) error { return nil })
						}
						if textBehaviorReasonForTest(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || requests.Load() != 0 {
							t.Fatalf("primitive optional behavior = %v, provider requests = %d", err, requests.Load())
						}
					})
				}
			}
		})
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
