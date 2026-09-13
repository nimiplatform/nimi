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
	"google.golang.org/protobuf/types/known/structpb"
)

func anthropicAppFixture(t *testing.T, handler http.HandlerFunc) (managedCloudScenarioTestFixture, func(accountservice.LocalAppOperation, string) context.Context) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	fixture := newManagedCloudScenarioTestFixture(t, "anthropic", "claude-sonnet-4-6", server.URL, Config{AllowLoopbackEndpoint: true})
	target, _ := structpb.NewStruct(map[string]any{"provider": "anthropic", "providerModelId": "claude-sonnet-4-6", "remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId()})
	config := appAIConfig("app.anthropic", &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "anthropic", DriverId: "nimillm", DriverDialect: "anthropic"},
			ConnectorRef:   fixture.connectorID, ProviderModelTarget: target,
		}},
	})
	if err := overwriteAIConfigStoreForTest(context.Background(), fixture.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	return fixture, func(operation accountservice.LocalAppOperation, capability string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.anthropic", RegisteredAppSubject: "app-subject-anthropic", Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
	}
}

func TestAnthropicAppTextRoundTripUsesProductionHooksAndOrderedResults(t *testing.T) {
	var calls atomic.Int32
	fixture, decision := anthropicAppFixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "test-key" || r.Header.Get("anthropic-version") == "" {
			t.Errorf("incorrect protocol or credential projection")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body["model"] != "claude-sonnet-4-6" {
			t.Errorf("model = %v", body["model"])
		}
		w.Header().Set("Content-Type", "application/json")
		if calls.Load() == 1 {
			fmt.Fprint(w, `{"content":[{"type":"text","text":"Checking "},{"type":"tool_use","id":"call-1","name":"lookup","input":{"query":"one"}},{"type":"text","text":" then "},{"type":"tool_use","id":"call-2","name":"lookup","input":{"query":"two"}}],"stop_reason":"tool_use","usage":{"input_tokens":4,"output_tokens":8}}`)
			return
		}
		messages := body["messages"].([]any)
		last := messages[len(messages)-1].(map[string]any)
		results := last["content"].([]any)
		if last["role"] != "user" || len(results) != 2 || results[0].(map[string]any)["tool_use_id"] != "call-2" || results[1].(map[string]any)["tool_use_id"] != "call-1" {
			t.Errorf("tool results reordered or mispaired: %v", results)
		}
		fmt.Fprint(w, `{"content":[{"type":"text","text":"Both lookups completed."}],"stop_reason":"end_turn","usage":{"input_tokens":8,"output_tokens":5}}`)
	})
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use both lookups"}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO}
	execute := func() (*runtimev1.ExecuteLocalAppScenarioResponse, error) {
		return fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
	}
	first, err := execute()
	if err != nil {
		t.Fatal(err)
	}
	items := first.GetTextGenerate().GetItems()
	if len(items) != 4 || items[2].GetText().GetText() != " then " || items[3].GetToolCall().GetId() != "call-2" {
		t.Fatalf("ordered output = %v", items)
	}
	turn := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
	for _, item := range items {
		turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
	}
	for _, index := range []int{3, 1} {
		call := items[index].GetToolCall()
		var arguments map[string]string
		if err := json.Unmarshal([]byte(call.GetArgumentsJson()), &arguments); err != nil {
			t.Fatal(err)
		}
		// The consumer executes this deterministic handler; Runtime never does.
		value := structpb.NewStringValue(strings.ToUpper(arguments["query"]))
		turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: call.GetId(), ToolName: call.GetName(), Result: value}}})
	}
	input.Messages = append(input.Messages, turn)
	input.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE
	last, err := execute()
	if err != nil || last.GetTextGenerate().GetItems()[0].GetText().GetText() != "Both lookups completed." || calls.Load() != 2 {
		t.Fatalf("round trip result = %v %v calls=%d", last, err, calls.Load())
	}
}

func TestAnthropicAppStreamPublishesCompleteToolsAndRejectsMissingTerminal(t *testing.T) {
	var omitStop atomic.Bool
	fixture, decision := anthropicAppFixture(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body["stream"] != true || body["tool_choice"].(map[string]any)["type"] != "any" {
			t.Errorf("stream tool choice was lost: %v", body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []string{
			`{"type":"message_start","message":{"content":[],"usage":{"input_tokens":4,"output_tokens":1}}}`,
			`{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-1","name":"lookup","input":{}}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"one\"}"}}`,
			`{"type":"content_block_stop","index":0}`,
			`{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":8}}`,
		} {
			fmt.Fprintf(w, "data: %s\n\n", event)
		}
		if !omitStop.Load() {
			fmt.Fprint(w, "data: {\"type\":\"message_stop\"}\n\n")
		}
	})
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Lookup"}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED}
	for _, missing := range []bool{false, true} {
		omitStop.Store(missing)
		stream := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
		err := fixture.service.StreamLocalAppTextTurn(input, stream)
		completed, failed, ready := 0, 0, 0
		for _, event := range stream.events {
			if event.GetCompleted() != nil {
				completed++
			}
			if event.GetFailed() != nil {
				failed++
			}
			if event.GetToolCall() != nil {
				ready++
			}
		}
		if !missing && (err != nil || completed != 1 || ready != 1) {
			t.Fatalf("stream did not complete: %v %+v", err, stream.events)
		}
		if missing && (completed != 0 || failed != 1 && err == nil) {
			t.Fatalf("unterminated stream succeeded: %v %+v", err, stream.events)
		}
	}
}

func TestAnthropicAppStructuredOutputUsesTheNativeSchemaAndRejectsUnsupportedConstraints(t *testing.T) {
	var calls atomic.Int32
	fixture, decision := anthropicAppFixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		format, ok := body["output_config"].(map[string]any)
		if !ok || format["format"].(map[string]any)["type"] != "json_schema" {
			t.Errorf("native schema was omitted: %v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"content":[{"type":"text","text":"{\"query\":\"ok\"}"}],"stop_reason":"end_turn","usage":{"input_tokens":2,"output_tokens":3}}`)
	})
	input := &runtimev1.StreamLocalAppTextTurnRequest{
		Messages:       []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Return structured data"}},
		ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: localAppLookupTool(t).InputSchema, Strict: true},
	}
	execute := func() (*runtimev1.ExecuteLocalAppScenarioResponse, error) {
		return fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
	}
	result, err := execute()
	if err != nil || result.GetTextGenerate().GetItems()[0].GetText().GetText() != `{"query":"ok"}` {
		t.Fatalf("structured result = %v %v", result, err)
	}
	input.ResponseFormat.JsonSchema.Fields["minProperties"] = structpb.NewNumberValue(1)
	_, err = execute()
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || calls.Load() != 1 {
		t.Fatalf("unsupported schema reached provider: %v calls=%d", err, calls.Load())
	}
}

func TestAnthropicAppCancellationClosesProviderTransportWithoutCompletingTools(t *testing.T) {
	started, closed := make(chan struct{}), make(chan struct{})
	fixture, decision := anthropicAppFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"message_start\",\"message\":{\"content\":[],\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n")
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(closed)
	})
	ctx, cancel := context.WithCancel(decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream))
	defer cancel()
	stream := &mockLocalAppTextTurnStream{ctx: ctx}
	finished := make(chan error, 1)
	go func() {
		finished <- fixture.service.StreamLocalAppTextTurn(&runtimev1.StreamLocalAppTextTurnRequest{
			Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Lookup"}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED,
		}, stream)
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider was not reached")
	}
	cancel()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("canceled consumer kept waiting")
	}
	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("provider transport remained open")
	}
	for _, event := range stream.events {
		if event.GetCompleted() != nil || event.GetToolCall() != nil {
			t.Fatalf("cancellation published success or an incomplete call: %v", event)
		}
	}
}
