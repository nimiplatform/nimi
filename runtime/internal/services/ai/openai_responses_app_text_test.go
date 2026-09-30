package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/structpb"
)

func openAIResponsesAppFixture(t *testing.T, modelID string, handler http.HandlerFunc) (managedCloudScenarioTestFixture, func(accountservice.LocalAppOperation, string) context.Context) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	fixture := newManagedCloudScenarioTestFixture(t, "openai", modelID, server.URL, Config{AllowLoopbackEndpoint: true})
	target, _ := structpb.NewStruct(map[string]any{"provider": "openai", "providerModelId": modelID, "remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId()})
	config := appAIConfig("app.openai", &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "openai", DriverId: "nimillm", DriverDialect: "openai"},
			ConnectorRef:   fixture.connectorID, ProviderModelTarget: target,
		}},
	})
	if err := overwriteAIConfigStoreForTest(context.Background(), fixture.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	return fixture, func(operation accountservice.LocalAppOperation, capability string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.openai", RegisteredAppSubject: "app-subject-openai", Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
	}
}

// decodeOpenAIResponsesRequest checks the stateless standard Responses shape:
// the API key, store false, SSE delivery and encrypted reasoning continuity.
func decodeOpenAIResponsesRequest(t *testing.T, r *http.Request, modelID string) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		t.Error(err)
		return nil
	}
	include, _ := body["include"].([]any)
	if r.Method != http.MethodPost || r.URL.Path != "/v1/responses" || r.Header.Get("Authorization") != "Bearer test-key" ||
		r.Header.Get("Accept") != "text/event-stream" || body["model"] != modelID || body["stream"] != true || body["store"] != false ||
		len(include) != 1 || include[0] != "reasoning.encrypted_content" {
		t.Errorf("wrong standard Responses protocol: %s %s %v", r.Method, r.URL.Path, body)
	}
	for _, stateful := range []string{"previous_response_id", "background", "conversation"} {
		if _, present := body[stateful]; present {
			t.Errorf("stateful field %q was sent", stateful)
		}
	}
	return body
}

func openAIResponsesCall(id, callID, arguments string) map[string]any {
	return map[string]any{"type": "function_call", "id": id, "call_id": callID, "name": "lookup", "arguments": arguments}
}

func openAIResponsesText(id, text string) map[string]any {
	return map[string]any{"type": "message", "id": id, "content": []any{map[string]any{"type": "output_text", "text": text}}}
}

// Tool round trips replay the returned encrypted reasoning with top-level
// function tools in both modes; nothing from the ChatGPT-plan route applies.
func TestOpenAIResponsesAppToolRoundTripReplaysContinuityInBothModes(t *testing.T) {
	for _, stream := range []bool{false, true} {
		name := "sync"
		if stream {
			name = "stream"
		}
		t.Run(name, func(t *testing.T) {
			var requests atomic.Int32
			fixture, decision := openAIResponsesAppFixture(t, "gpt-6-luna", func(w http.ResponseWriter, r *http.Request) {
				number := requests.Add(1)
				body := decodeOpenAIResponsesRequest(t, r, "gpt-6-luna")
				tools, _ := body["tools"].([]any)
				if len(tools) != 1 || tools[0].(map[string]any)["type"] != "function" || tools[0].(map[string]any)["name"] != "lookup" || body["parallel_tool_calls"] != true {
					t.Errorf("function tools were not sent top-level: %v", body["tools"])
				}
				if number == 1 {
					if body["tool_choice"] != "required" {
						t.Errorf("tool choice = %v", body["tool_choice"])
					}
					output := []map[string]any{
						{"type": "reasoning", "id": "rs_1", "encrypted_content": "opaque-continuity", "summary": []any{}},
						openAIResponsesCall("fc_1", "call_1", `{"query":"one"}`),
					}
					writeChatGPTPlanResponse(t, w, output, chatGPTPlanCompleted(output))
					return
				}
				input := body["input"].([]any)
				if len(input) != 4 {
					t.Errorf("replayed transcript = %v", input)
					return
				}
				reasoning, call, result := input[1].(map[string]any), input[2].(map[string]any), input[3].(map[string]any)
				_, namespaced := call["namespace"]
				if reasoning["type"] != "reasoning" || reasoning["encrypted_content"] != "opaque-continuity" ||
					call["type"] != "function_call" || call["call_id"] != "call_1" || namespaced ||
					result["type"] != "function_call_output" || result["call_id"] != "call_1" {
					t.Errorf("continuity order or call association lost: %v", input)
				}
				output := []map[string]any{openAIResponsesText("msg_1", "Lookup completed.")}
				writeChatGPTPlanResponse(t, w, output, chatGPTPlanCompleted(output))
			})
			ctxFor := func() context.Context {
				if stream {
					return decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)
				}
				return decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute)
			}
			step := func(input *runtimev1.StreamLocalAppTextTurnRequest) []*runtimev1.TextOutputItem {
				t.Helper()
				if !stream {
					response, err := fixture.service.ExecuteLocalAppScenario(ctxFor(), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
					if err != nil {
						t.Fatal(err)
					}
					return response.GetTextGenerate().GetItems()
				}
				events := &mockLocalAppTextTurnStream{ctx: ctxFor()}
				if err := fixture.service.StreamLocalAppTextTurn(input, events); err != nil {
					t.Fatal(err)
				}
				var items []*runtimev1.TextOutputItem
				completed := false
				for _, event := range events.events {
					switch {
					case event.GetReasoningContinuity() != nil:
						items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: event.GetReasoningContinuity().GetCarrier()}})
					case event.GetToolCall() != nil:
						items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: event.GetToolCall().GetToolCall()}})
					case event.GetDelta() != nil:
						items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: event.GetDelta().GetText()}}})
					case event.GetCompleted() != nil:
						completed = true
					case event.GetFailed() != nil:
						t.Fatalf("stream failed: %v", event.GetFailed())
					}
				}
				if !completed {
					t.Fatalf("stream never completed: %v", events.events)
				}
				return items
			}
			input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use the lookup"}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED}
			items := step(input)
			if len(items) != 2 || items[0].GetReasoningContinuity().GetKind() != "openai.responses.encrypted-reasoning" || items[1].GetToolCall().GetId() != "call_1" {
				t.Fatalf("ordered outputs: %v", items)
			}
			turn := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
			for _, item := range items {
				turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
			}
			turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call_1", ToolName: "lookup", Result: structpb.NewStringValue("complete")}}})
			input.Messages = append(input.Messages, turn)
			input.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
			final := step(input)
			if len(final) != 1 || final[0].GetText().GetText() != "Lookup completed." || requests.Load() != 2 {
				t.Fatalf("round trip = %v requests=%d", final, requests.Load())
			}
		})
	}
}

// Named tool choice, the output limit and strict JSON Schema reach the
// provider; sampling controls and another route's carrier fail before dispatch.
func TestOpenAIResponsesAppAdmitsStandardControlsOnly(t *testing.T) {
	var requests atomic.Int32
	fixture, decision := openAIResponsesAppFixture(t, "gpt-6-astra", func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		body := decodeOpenAIResponsesRequest(t, r, "gpt-6-astra")
		if format, ok := body["text"].(map[string]any); ok {
			spec := format["format"].(map[string]any)
			if spec["type"] != "json_schema" || spec["strict"] != true || body["max_output_tokens"] != float64(256) {
				t.Errorf("structured request = %v", body)
			}
			output := []map[string]any{openAIResponsesText("msg_s", `{"query":"ok"}`)}
			writeChatGPTPlanResponse(t, w, output, chatGPTPlanCompleted(output))
			return
		}
		choice, _ := body["tool_choice"].(map[string]any)
		if choice["type"] != "function" || choice["name"] != "lookup" {
			t.Errorf("named tool choice = %v", body["tool_choice"])
		}
		output := []map[string]any{openAIResponsesCall("fc_n", "call_n", `{"query":"named"}`)}
		writeChatGPTPlanResponse(t, w, output, chatGPTPlanCompleted(output))
	})
	execute := func(input *runtimev1.StreamLocalAppTextTurnRequest) (*runtimev1.ExecuteLocalAppScenarioResponse, error) {
		return fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
			&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
	}
	named, err := execute(&runtimev1.StreamLocalAppTextTurnRequest{
		Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Call lookup"}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)},
		ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL, ToolChoiceName: "lookup",
	})
	if err != nil || named.GetTextGenerate().GetItems()[0].GetToolCall().GetId() != "call_n" {
		t.Fatalf("named tool choice = %v err=%v", named, err)
	}
	limit := int32(256)
	structured, err := execute(&runtimev1.StreamLocalAppTextTurnRequest{
		Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Return structured data"}}, MaxTokens: &limit,
		ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: localAppLookupTool(t).InputSchema, Strict: true},
	})
	if err != nil || structured.GetTextGenerate().GetItems()[0].GetText().GetText() != `{"query":"ok"}` || requests.Load() != 2 {
		t.Fatalf("structured output = %v err=%v requests=%d", structured, err, requests.Load())
	}

	temperature := float32(0.2)
	carrier := &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{
		Kind: "openai_chatgpt_plan.responses.encrypted-reasoning", Version: 1, Payload: []byte(`{"type":"reasoning","id":"rs_x","encrypted_content":"plan","summary":[]}`),
	}}}
	for name, input := range map[string]*runtimev1.StreamLocalAppTextTurnRequest{
		"sampling": {Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Hi"}}, Temperature: &temperature},
		"plan carrier": {Messages: []*runtimev1.LocalAppTextCandidateMessage{
			{Role: "user", Text: "Hi"},
			{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: carrier}}, {Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "Hello"}}}}}}},
			{Role: "user", Text: "Again"},
		}},
	} {
		if _, err := execute(input); err == nil {
			t.Fatalf("%s was admitted", name)
		} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED && reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
			t.Fatalf("%s = %v", name, err)
		}
	}
	if requests.Load() != 2 {
		t.Fatalf("rejected requests were dispatched: %d", requests.Load())
	}
}

// A failure reported inside the accepted stream stays typed, and a stream
// without response.completed never succeeds.
func TestOpenAIResponsesAppStreamFailuresStayTyped(t *testing.T) {
	var terminal atomic.Value
	fixture, decision := openAIResponsesAppFixture(t, "gpt-6.1-sol", func(w http.ResponseWriter, r *http.Request) {
		decodeOpenAIResponsesRequest(t, r, "gpt-6.1-sol")
		output := []map[string]any{openAIResponsesText("msg_f", "partial")}
		value, _ := terminal.Load().(map[string]any)
		writeChatGPTPlanResponse(t, w, output, value)
	})
	for name, test := range map[string]struct {
		terminal map[string]any
		reason   runtimev1.ReasonCode
	}{
		"rate limited": {map[string]any{"type": "response.failed", "response": map[string]any{"status": "failed", "error": map[string]any{"code": "rate_limit_exceeded"}}}, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED},
		"server error": {map[string]any{"type": "error", "code": "server_error"}, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
		"incomplete":   {map[string]any{"type": "response.incomplete", "response": map[string]any{"status": "incomplete", "incomplete_details": map[string]any{"reason": "max_output_tokens"}}}, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE},
		"unterminated": {nil, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE},
	} {
		terminal.Store(test.terminal)
		_, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
			&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: &runtimev1.StreamLocalAppTextTurnRequest{
				Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Hi"}},
			}}})
		if reason, _ := grpcerr.ExtractReasonCode(err); err == nil || reason != test.reason {
			t.Fatalf("%s = %v", name, err)
		}
	}
}
