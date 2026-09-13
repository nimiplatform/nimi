package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func codexAppFixture(t *testing.T, modelID string, handler http.HandlerFunc) (managedCloudScenarioTestFixture, func(accountservice.LocalAppOperation, string) context.Context) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	fixture := newManagedCloudScenarioTestFixture(t, "openai_codex", modelID, server.URL, Config{AllowLoopbackEndpoint: true})
	target, _ := structpb.NewStruct(map[string]any{"provider": "openai_codex", "providerModelId": modelID, "remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId()})
	config := appAIConfig("app.codex", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "openai_codex", DriverId: "nimillm", DriverDialect: "openai_codex"}, ConnectorRef: fixture.connectorID, ProviderModelTarget: target}}})
	if err := overwriteAIConfigStoreForTest(context.Background(), fixture.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	return fixture, func(operation accountservice.LocalAppOperation, capability string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.codex", RegisteredAppSubject: "app-subject-codex", Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
	}
}

func writeCodexAppResponse(t *testing.T, w http.ResponseWriter, output []map[string]any, completed bool) {
	t.Helper()
	w.Header().Set("Content-Type", "text/event-stream")
	write := func(value any) {
		bytes, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = fmt.Fprintf(w, "data: %s\n\n", bytes)
	}
	write(map[string]any{"type": "response.created", "response": map[string]any{"status": "in_progress"}})
	for index, item := range output {
		start := map[string]any{"type": item["type"], "id": item["id"], "call_id": item["call_id"], "name": item["name"]}
		write(map[string]any{"type": "response.output_item.added", "output_index": index, "item": start})
		write(map[string]any{"type": "response.output_item.done", "output_index": index, "item": item})
	}
	if completed {
		write(map[string]any{"type": "response.completed", "response": map[string]any{"status": "completed", "output": output, "usage": map[string]int{"input_tokens": 3, "output_tokens": 4}}})
	}
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

func TestCodexAppTextSSESyncAndStreamPreserveContinuityRoundTrip(t *testing.T) {
	for _, modelID := range []string{"gpt-5.6-sol", "gpt-6-astra"} {
		t.Run(modelID, func(t *testing.T) {
			var requests atomic.Int32
			fixture, decision := codexAppFixture(t, modelID, func(w http.ResponseWriter, r *http.Request) {
				number := requests.Add(1)
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if r.URL.Path != "/responses" || r.Header.Get("Authorization") != "Bearer test-key" || body["stream"] != true || body["store"] != false || body["model"] != modelID {
					t.Error("wrong captured Codex protocol")
				}
				if number == 1 {
					writeCodexAppResponse(t, w, []map[string]any{
						{"type": "reasoning", "id": "rs_1", "encrypted_content": "opaque-test-value"},
						{"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "lookup", "arguments": `{"query":"one"}`},
						{"type": "function_call", "id": "fc_2", "call_id": "call_2", "name": "lookup", "arguments": `{"query":"two"}`},
					}, true)
					return
				}
				input := body["input"].([]any)
				if input[1].(map[string]any)["encrypted_content"] != "opaque-test-value" || input[4].(map[string]any)["call_id"] != "call_2" || input[5].(map[string]any)["call_id"] != "call_1" {
					t.Error("continuity or result association lost")
				}
				writeCodexAppResponse(t, w, []map[string]any{{"type": "message", "id": "msg_1", "content": []any{map[string]any{"type": "output_text", "text": "Both lookups completed."}}}}, true)
			})
			input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use both lookups"}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED}
			first, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
			if err != nil {
				t.Fatal(err)
			}
			items := first.GetTextGenerate().GetItems()
			if len(items) != 3 || items[0].GetReasoningContinuity() == nil || items[1].GetToolCall().GetId() != "call_1" {
				t.Fatalf("ordered outputs: %v", items)
			}
			turn := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
			for _, item := range items {
				turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
			}
			for _, index := range []int{2, 1} {
				call := items[index].GetToolCall()
				turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: call.Id, ToolName: call.Name, Result: structpb.NewStringValue("complete")}}})
			}
			input.Messages = append(input.Messages, turn)
			input.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE
			stream := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
			if err := fixture.service.StreamLocalAppTextTurn(input, stream); err != nil {
				t.Fatal(err)
			}
			if len(stream.events) != 2 || stream.events[0].GetDelta().GetText() != "Both lookups completed." || stream.events[1].GetCompleted() == nil || requests.Load() != 2 {
				t.Fatalf("round trip stream=%v", stream.events)
			}
		})
	}
}

func TestCodexAstraAppTextAndStructuredOutputUseSSE(t *testing.T) {
	schema := localAppLookupTool(t).GetInputSchema()
	for _, test := range []struct {
		name   string
		format *runtimev1.ResponseFormat
		text   string
	}{
		{name: "plain", text: "Astra completed the request."},
		{
			name: "json schema", text: `{"query":"complete"}`,
			format: &runtimev1.ResponseFormat{
				Kind:       runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA,
				JsonSchema: schema, SchemaName: "lookup_result", Strict: true,
			},
		},
	} {
		for _, mode := range []string{"sync", "stream"} {
			t.Run(test.name+"/"+mode, func(t *testing.T) {
				var requests atomic.Int32
				fixture, decision := codexAppFixture(t, "gpt-6-astra", func(w http.ResponseWriter, r *http.Request) {
					requests.Add(1)
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					if r.URL.Path != "/responses" || body["model"] != "gpt-6-astra" || body["stream"] != true || body["store"] != false {
						t.Errorf("wrong Astra protocol: %v", body)
					}
					if test.format != nil {
						textConfig, _ := body["text"].(map[string]any)
						format, _ := textConfig["format"].(map[string]any)
						encodedSchema, _ := json.Marshal(format["schema"])
						requestedSchema, _ := json.Marshal(schema.AsMap())
						if format["type"] != "json_schema" || format["name"] != "lookup_result" || format["strict"] != true || string(encodedSchema) != string(requestedSchema) {
							t.Errorf("native JSON Schema was not preserved: %v", format)
						}
					}
					writeCodexAppResponse(t, w, []map[string]any{
						{"type": "reasoning", "id": "rs_astra", "encrypted_content": "astra-continuity"},
						{"type": "message", "id": "msg_astra", "content": []any{map[string]any{"type": "output_text", "text": test.text}}},
					}, true)
				})
				input := &runtimev1.StreamLocalAppTextTurnRequest{
					Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Complete the request"}}, ResponseFormat: test.format,
				}
				if mode == "sync" {
					response, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
						&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
					if err != nil {
						t.Fatal(err)
					}
					output := response.GetTextGenerate()
					if len(output.GetItems()) != 2 || output.GetItems()[0].GetReasoningContinuity() == nil || output.GetItems()[1].GetText().GetText() != test.text || output.GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP {
						t.Fatalf("Astra output = %v", output)
					}
				} else {
					stream := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
					if err := fixture.service.StreamLocalAppTextTurn(input, stream); err != nil {
						t.Fatal(err)
					}
					if len(stream.events) != 3 || stream.events[0].GetReasoningContinuity() == nil || stream.events[1].GetDelta().GetText() != test.text || stream.events[2].GetCompleted().GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP {
						t.Fatalf("Astra stream = %v", stream.events)
					}
				}
				if requests.Load() != 1 {
					t.Fatalf("provider requests = %d, want 1", requests.Load())
				}
			})
		}
	}
}

func TestCodexAstraPlainTextRejectsUnsupportedParametersBeforeDispatch(t *testing.T) {
	var calls atomic.Int32
	fixture, _ := codexAppFixture(t, "gpt-6-astra", func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		http.Error(w, "unexpected unsupported request", http.StatusBadRequest)
	})
	for _, test := range []struct {
		name  string
		apply func(*runtimev1.TextGenerateScenarioSpec)
	}{
		{name: "temperature", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.Temperature = proto.Float32(0) }},
		{name: "top p", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.TopP = proto.Float32(1) }},
		{name: "top k", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.TopK = proto.Int32(3) }},
		{name: "max tokens", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.MaxTokens = proto.Int32(32) }},
		{name: "seed", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.Seed = proto.Int64(0) }},
		{name: "presence penalty", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.PresencePenalty = proto.Float32(0) }},
		{name: "frequency penalty", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.FrequencyPenalty = proto.Float32(0) }},
		{name: "stop", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.Stop = []string{"stop"} }},
		{name: "raw chunks", apply: func(spec *runtimev1.TextGenerateScenarioSpec) { spec.IncludeRawChunks = true }},
	} {
		for _, mode := range []string{"sync", "stream"} {
			t.Run(test.name+"/"+mode, func(t *testing.T) {
				textSpec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "respond"}}}
				test.apply(textSpec)
				spec := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: textSpec}}
				head := &runtimev1.ScenarioRequestHead{AppId: "app.codex", SubjectUserId: "user-001", TimeoutMs: 10_000}
				ctx := scenarioJobUserContext("app.codex", "user-001")
				var err error
				if mode == "sync" {
					_, err = fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
						Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
						ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, Spec: spec,
					})
				} else {
					err = fixture.service.StreamScenario(&runtimev1.StreamScenarioRequest{
						Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, Spec: spec,
					}, &mockScenarioEventStream{ctx: ctx})
				}
				if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || calls.Load() != 0 {
					t.Fatalf("unsupported Astra parameter = %v, provider calls = %d", err, calls.Load())
				}
			})
		}
	}
}

func TestCodexAppTextCandidateProjectsTextWithoutContinuity(t *testing.T) {
	for _, modelID := range []string{"gpt-5.6-sol", "gpt-6-astra"} {
		t.Run(modelID, func(t *testing.T) {
			var requests atomic.Int32
			fixture, decision := codexAppFixture(t, modelID, func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if body["model"] != modelID || body["stream"] != true || body["store"] != false {
					t.Errorf("wrong candidate protocol: %v", body)
				}
				writeCodexAppResponse(t, w, []map[string]any{
					{"type": "reasoning", "id": "rs_candidate", "encrypted_content": "private-candidate-continuity"},
					{"type": "message", "id": "msg_candidate", "content": []any{map[string]any{"type": "output_text", "text": "Candidate text."}}},
				}, true)
			})
			ctx := decision(accountservice.LocalAppOperationTextCandidateGenerate, localappop.AppOperationIDTextCandidateGenerate)
			messages := []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Draft candidate text"}}
			response, err := fixture.service.GenerateLocalAppTextCandidate(ctx, &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: messages})
			if err != nil {
				t.Fatal(err)
			}
			if response.GetText() != "Candidate text." || response.GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP || strings.TrimSpace(response.GetTraceId()) == "" || requests.Load() != 1 {
				t.Fatalf("candidate response = %v, provider requests = %d", response, requests.Load())
			}
			for _, request := range []*runtimev1.GenerateLocalAppTextCandidateRequest{
				{Messages: messages, Temperature: proto.Float32(0)},
				{Messages: messages, TopP: proto.Float32(1)},
				{Messages: messages, MaxTokens: proto.Int32(32)},
			} {
				response, err := fixture.service.GenerateLocalAppTextCandidate(ctx, request)
				if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || response != nil || requests.Load() != 1 {
					t.Fatalf("unsupported candidate sampling = %v, response = %v, provider requests = %d", err, response, requests.Load())
				}
			}
		})
	}
}

func TestCodexAppTextCandidateProjectionRejectsInvalidItems(t *testing.T) {
	textItem := &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "Candidate text."}}}
	carrier := &runtimev1.ReasoningContinuityCarrier{Kind: "openai_codex.responses.encrypted-reasoning", Version: 1, Payload: []byte("opaque")}
	for _, test := range []struct {
		name   string
		output *runtimev1.TextGenerateOutput
	}{
		{
			name: "invalid continuity",
			output: &runtimev1.TextGenerateOutput{Text: "Candidate text.", Items: []*runtimev1.TextOutputItem{
				textItem, {Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{Kind: carrier.Kind, Version: 1}}},
			}},
		},
		{
			name: "tool call",
			output: &runtimev1.TextGenerateOutput{Text: "Candidate text.", Items: []*runtimev1.TextOutputItem{
				textItem, {Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: `{}`}}},
			}},
		},
		{
			name: "continuity only",
			output: &runtimev1.TextGenerateOutput{Items: []*runtimev1.TextOutputItem{
				{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: carrier}},
			}},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, valid := canonicalPlainText(test.output); valid {
				t.Fatalf("non-candidate output accepted: %v", test.output)
			}
		})
	}
}

func TestCodexAppTextContentBudgetUsesOriginalToolJSON(t *testing.T) {
	arguments := `{"values":[` + strings.TrimSuffix(strings.Repeat("1e20,", 16*1024), ",") + `]}`
	var textBytes atomic.Int32
	textBytes.Store(100 * 1024)
	fixture, decision := codexAppFixture(t, "gpt-5.6-sol", func(w http.ResponseWriter, r *http.Request) {
		writeCodexAppResponse(t, w, []map[string]any{
			{"type": "reasoning", "id": "rs_budget", "encrypted_content": strings.Repeat("A", 60*1024)},
			{"type": "function_call", "id": "fc_budget", "call_id": "call-budget", "name": "numbers", "arguments": arguments},
			{"type": "message", "id": "msg_budget", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("x", int(textBytes.Load()))}}},
		}, true)
	})
	schema, err := structpb.NewStruct(map[string]any{
		"type": "object", "properties": map[string]any{"values": map[string]any{"type": "array", "items": map[string]any{"type": "number"}}},
		"required": []any{"values"},
	})
	if err != nil {
		t.Fatal(err)
	}
	input := &runtimev1.StreamLocalAppTextTurnRequest{
		Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Return the numbers"}},
		Tools:    []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "numbers", InputSchema: schema}},
	}
	execute := func() (*runtimev1.ExecuteLocalAppScenarioResponse, error) {
		return fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
			&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
	}
	first, err := execute()
	if err != nil {
		t.Fatal(err)
	}
	items := first.GetTextGenerate().GetItems()
	if len(items) != 3 || items[1].GetToolCall().GetArgumentsJson() != arguments {
		t.Fatal("the original tool JSON did not survive the adapter")
	}
	remaining := maxLocalAppTextTurnTotalBytes - proto.Size(items[0].GetReasoningContinuity()) - proto.Size(items[1].GetToolCall())
	textBytes.Store(int32(remaining))
	if _, err := execute(); err != nil {
		t.Fatalf("exact content budget rejected: %v", err)
	}
	textBytes.Store(int32(remaining + 1))
	_, err = execute()
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("excess content budget accepted: %v", err)
	}
}

func TestCodexAppTextMissingTerminalAndCancelNeverComplete(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		t.Run(fmt.Sprint(cancel), func(t *testing.T) {
			started, closed := make(chan struct{}), make(chan struct{})
			fixture, decision := codexAppFixture(t, "gpt-5.6-sol", func(w http.ResponseWriter, r *http.Request) {
				writeCodexAppResponse(t, w, []map[string]any{{"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "lookup", "arguments": `{"query":"one"}`}}, false)
				close(started)
				if cancel {
					<-r.Context().Done()
					close(closed)
				}
			})
			ctx, stop := context.WithCancel(decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream))
			defer stop()
			stream := &mockLocalAppTextTurnStream{ctx: ctx}
			done := make(chan error, 1)
			go func() {
				done <- fixture.service.StreamLocalAppTextTurn(&runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "look up"}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}}, stream)
			}()
			select {
			case <-started:
			case err := <-done:
				t.Fatalf("request did not dispatch: %v", err)
			case <-time.After(5 * time.Second):
				t.Fatal("request did not start")
			}
			if cancel {
				stop()
				select {
				case <-closed:
				case <-time.After(5 * time.Second):
					t.Fatal("HTTP did not cancel")
				}
			}
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("request did not settle")
			}
			for _, event := range stream.events {
				if event.GetCompleted() != nil {
					t.Fatal("unfinished step completed")
				}
			}
		})
	}
}
