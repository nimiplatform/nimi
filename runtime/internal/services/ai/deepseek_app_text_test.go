package ai

import (
	"context"
	"encoding/json"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/structpb"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
)

func TestDeepseekAppPositionedSystemMessagesReachTheSameSyncAndStreamDriver(t *testing.T) {
	want := []map[string]any{
		{"role": "system", "content": "Character rules"},
		{"role": "system", "content": "World information"},
		{"role": "user", "content": "Open the door"},
		{"role": "assistant", "content": "The door opened."},
		{"role": "system", "content": "  作者注：保持场景。\n"},
	}
	var calls atomic.Int32
	fixture, decision := deepseekAppFixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body struct {
			Messages []map[string]any `json:"messages"`
			Stream   bool             `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if !reflect.DeepEqual(body.Messages, want) {
			t.Errorf("message role/order/content changed: %#v", body.Messages)
		}
		if body.Stream {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"The scene continues.\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
		} else {
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `{"choices":[{"index":0,"message":{"content":"The scene continues."},"finish_reason":"stop"}]}`)
		}
	})
	input := &runtimev1.StreamLocalAppTextTurnRequest{}
	for _, message := range want {
		input.Messages = append(input.Messages, &runtimev1.LocalAppTextCandidateMessage{Role: message["role"].(string), Text: message["content"].(string)})
	}
	result, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
	if err != nil || result.GetTextGenerate().GetItems()[0].GetText().GetText() != "The scene continues." {
		t.Fatalf("sync %v: %v", result, err)
	}
	stream := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
	if err := fixture.service.StreamLocalAppTextTurn(input, stream); err != nil {
		t.Fatal(err)
	}
	if len(stream.events) == 0 || stream.events[len(stream.events)-1].GetCompleted() == nil || calls.Load() != 2 {
		t.Fatalf("stream %v calls=%d", stream.events, calls.Load())
	}
}

func deepseekAppFixture(t *testing.T, handler http.HandlerFunc) (managedCloudScenarioTestFixture, func(accountservice.LocalAppOperation, string) context.Context) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	fixture := newManagedCloudScenarioTestFixture(t, "deepseek", "deepseek-flash", server.URL, Config{AllowLoopbackEndpoint: true})
	target, _ := structpb.NewStruct(map[string]any{"provider": "deepseek", "providerModelId": "deepseek-flash", "remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId()})
	config := appAIConfig("app.deepseek", &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "deepseek", DriverId: "nimillm", DriverDialect: "deepseek"},
			ConnectorRef:   fixture.connectorID, ProviderModelTarget: target,
		}},
	})
	if err := overwriteAIConfigStoreForTest(context.Background(), fixture.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	return fixture, func(operation accountservice.LocalAppOperation, capability string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.deepseek", RegisteredAppSubject: "app-subject-deepseek", Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
	}
}

func TestDeepseekAppInitiationReachesSyncAndStreamWithoutUserPadding(t *testing.T) {
	for _, roles := range [][]string{{"system"}, {"assistant"}, {"system", "assistant"}} {
		t.Run(fmt.Sprint(roles), func(t *testing.T) {
			var calls atomic.Int32
			fixture, decision := deepseekAppFixture(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var body struct {
					Messages []map[string]any `json:"messages"`
					Stream   bool             `json:"stream"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if len(body.Messages) != len(roles) {
					t.Errorf("invented or lost context: %v", body.Messages)
				}
				for i, message := range body.Messages {
					if i >= len(roles) || message["role"] != roles[i] || message["content"] != "实际角色上下文" {
						t.Errorf("changed context: %v", message)
					}
				}
				if body.Stream {
					w.Header().Set("Content-Type", "text/event-stream")
					if _, err := fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Opening scene.\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"); err != nil {
						t.Error(err)
					}
				} else {
					w.Header().Set("Content-Type", "application/json")
					if _, err := fmt.Fprint(w, `{"choices":[{"index":0,"message":{"content":"Opening scene."},"finish_reason":"stop"}]}`); err != nil {
						t.Error(err)
					}
				}
			})
			input := &runtimev1.StreamLocalAppTextTurnRequest{}
			for _, role := range roles {
				input.Messages = append(input.Messages, &runtimev1.LocalAppTextCandidateMessage{Role: role, Text: "实际角色上下文"})
			}
			result, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
			if err != nil || len(result.GetTextGenerate().GetItems()) != 1 {
				t.Fatalf("sync: %v %v", result, err)
			}
			stream := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
			if err := fixture.service.StreamLocalAppTextTurn(input, stream); err != nil {
				t.Fatal(err)
			}
			if len(stream.events) == 0 || stream.events[len(stream.events)-1].GetCompleted() == nil || calls.Load() != 2 {
				t.Fatalf("stream: %v; calls=%d", stream.events, calls.Load())
			}
		})
	}
}

func TestDeepseekAppNativeToolsRoundTripThroughCommittedCloudConfig(t *testing.T) {
	var calls atomic.Int32
	fixture, decision := deepseekAppFixture(t, func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" || body["model"] != "deepseek-flash" || body["thinking"].(map[string]any)["type"] != "disabled" {
			t.Errorf("cloud projection: path=%q authMatches=%t model=%v thinking=%v", r.URL.Path, r.Header.Get("Authorization") == "Bearer test-key", body["model"], body["thinking"])
		}
		w.Header().Set("Content-Type", "application/json")
		if n == 1 {
			if body["tool_choice"].(map[string]any)["function"].(map[string]any)["name"] != "lookup" {
				t.Error("named tool choice lost")
			}
			if _, err := fmt.Fprint(w, `{"choices":[{"index":0,"message":{"content":"Checking.\n","tool_calls":[{"id":"first","type":"function","function":{"name":"lookup","arguments":"{\"query\":\"first\"}"}},{"id":"second","type":"function","function":{"name":"lookup","arguments":"{\"query\":\"second\"}"}}]},"finish_reason":"tool_calls"}]}`); err != nil {
				t.Errorf("write provider response: %v", err)
			}
			return
		}
		msgs := body["messages"].([]any)
		if body["tool_choice"] != "none" || len(msgs) != 4 || msgs[2].(map[string]any)["tool_call_id"] != "second" || msgs[3].(map[string]any)["tool_call_id"] != "first" || msgs[3].(map[string]any)["content"] != `{"error":"unavailable"}` {
			t.Errorf("result chronology/failure lost: %v", msgs)
		}
		if _, err := fmt.Fprint(w, `{"choices":[{"index":0,"message":{"content":"One source succeeded; the other failed."},"finish_reason":"stop"}]}`); err != nil {
			t.Errorf("write provider response: %v", err)
		}
	})
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Research both sources."}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL, ToolChoiceName: "lookup"}
	execute := func() (*runtimev1.ExecuteLocalAppScenarioResponse, error) {
		return fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
	}
	first, err := execute()
	if err != nil {
		t.Fatal(err)
	}
	items := first.GetTextGenerate().GetItems()
	if len(items) != 3 || items[0].GetText().GetText() != "Checking.\n" || items[1].GetToolCall().GetId() != "first" || items[2].GetToolCall().GetId() != "second" {
		t.Fatalf("output chronology: %v", items)
	}
	turn := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
	for _, item := range items {
		turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
	}
	for _, index := range []int{2, 1} {
		call := items[index].GetToolCall()
		value := "source page 9"
		failed := index == 1
		if failed {
			value = "unavailable"
		}
		turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: call.GetId(), ToolName: call.GetName(), Result: structpb.NewStringValue(value), IsError: failed}}})
	}
	input.Messages = append(input.Messages, turn)
	input.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE
	input.ToolChoiceName = ""
	last, err := execute()
	if err != nil || last.GetTextGenerate().GetItems()[0].GetText().GetText() != "One source succeeded; the other failed." || calls.Load() != 2 {
		t.Fatalf("roundtrip=%v err=%v calls=%d", last, err, calls.Load())
	}
}
func TestDeepseekAppStreamRequiresProviderDoneBeforeCompleted(t *testing.T) {
	var omitDone atomic.Bool
	fixture, decision := deepseekAppFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		if _, err := fmt.Fprintf(w, "data: %s\n\n", `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{\"query\":\"source\"}"}}]},"finish_reason":"tool_calls"}]}`); err != nil {
			t.Errorf("write provider tool call: %v", err)
			return
		}
		if !omitDone.Load() {
			if _, err := fmt.Fprint(w, "data: [DONE]\n\n"); err != nil {
				t.Errorf("write provider response: %v", err)
			}
		}
	})
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Lookup"}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED}
	for _, missing := range []bool{false, true} {
		omitDone.Store(missing)
		stream := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
		err := fixture.service.StreamLocalAppTextTurn(input, stream)
		complete, failed, tools := 0, 0, 0
		for _, event := range stream.events {
			if event.GetCompleted() != nil {
				complete++
			}
			if event.GetFailed() != nil {
				failed++
			}
			if event.GetToolCall() != nil {
				tools++
			}
		}
		if !missing && (err != nil || complete != 1 || tools != 1 || failed != 0) {
			t.Fatalf("stream=%v err=%v", stream.events, err)
		}
		if missing && (complete != 0 || failed != 1 && err == nil) {
			t.Fatalf("missing DONE succeeded: %v err=%v", stream.events, err)
		}
	}
}
