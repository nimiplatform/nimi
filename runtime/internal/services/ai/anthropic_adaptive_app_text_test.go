package ai

import (
	"context"
	"encoding/json"
	"fmt"
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

func anthropicAdaptiveAppFixture(t *testing.T, modelID string, handler http.HandlerFunc) (managedCloudScenarioTestFixture, func(accountservice.LocalAppOperation, string) context.Context) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	fixture := newManagedCloudScenarioTestFixture(t, "anthropic", modelID, server.URL, Config{AllowLoopbackEndpoint: true})
	target, _ := structpb.NewStruct(map[string]any{"provider": "anthropic", "providerModelId": modelID, "remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId()})
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

// An always-thinking Claude target returns its signed thinking as opaque
// carriers; the App replays them unchanged with the ToolResult, and plain
// text uses the same hooks with thinking omitted.
func TestAnthropicAdaptiveAppReplaysSignedThinkingAcrossToolRoundTrip(t *testing.T) {
	for _, modelID := range anthropicAdaptiveReviewedTextTargets {
		t.Run(modelID, func(t *testing.T) {
			var calls atomic.Int32
			fixture, decision := anthropicAdaptiveAppFixture(t, modelID, func(w http.ResponseWriter, r *http.Request) {
				number := calls.Add(1)
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				thinking, _ := body["thinking"].(map[string]any)
				if r.URL.Path != "/v1/messages" || body["model"] != modelID || thinking["type"] != "adaptive" || thinking["display"] != "omitted" {
					t.Errorf("adaptive Messages request = %s %v", r.URL.Path, body)
				}
				for _, sampling := range []string{"temperature", "top_p", "top_k"} {
					if _, present := body[sampling]; present {
						t.Errorf("sampling control %q was sent", sampling)
					}
				}
				w.Header().Set("Content-Type", "application/json")
				switch number {
				case 1:
					_, _ = fmt.Fprint(w, `{"content":[{"type":"thinking","thinking":"","signature":"sig-1"},{"type":"tool_use","id":"call-1","name":"lookup","input":{"query":"one"}}],"stop_reason":"tool_use","usage":{"input_tokens":4,"output_tokens":8}}`)
				case 2:
					messages := body["messages"].([]any)
					assistant := messages[1].(map[string]any)["content"].([]any)
					if len(assistant) != 2 || assistant[0].(map[string]any)["type"] != "thinking" || assistant[0].(map[string]any)["signature"] != "sig-1" || assistant[1].(map[string]any)["id"] != "call-1" {
						t.Errorf("signed thinking was not replayed with its call: %v", assistant)
					}
					_, _ = fmt.Fprint(w, `{"content":[{"type":"text","text":"Lookup completed."}],"stop_reason":"end_turn","usage":{"input_tokens":8,"output_tokens":5}}`)
				default:
					_, _ = fmt.Fprint(w, `{"content":[{"type":"thinking","thinking":"","signature":"sig-2"},{"type":"text","text":"Plain answer."}],"stop_reason":"end_turn","usage":{"input_tokens":2,"output_tokens":3}}`)
				}
			})
			execute := func(input *runtimev1.StreamLocalAppTextTurnRequest) (*runtimev1.ExecuteLocalAppScenarioResponse, error) {
				return fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
					&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
			}
			input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use the lookup"}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO}
			first, err := execute(input)
			if err != nil {
				t.Fatal(err)
			}
			items := first.GetTextGenerate().GetItems()
			if len(items) != 2 || items[0].GetReasoningContinuity().GetKind() != "anthropic.messages.thinking" || items[1].GetToolCall().GetId() != "call-1" {
				t.Fatalf("ordered outputs = %v", items)
			}
			turn := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
			for _, item := range items {
				turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
			}
			turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup", Result: structpb.NewStringValue("complete")}}})
			input.Messages = append(input.Messages, turn)
			second, err := execute(input)
			if err != nil || second.GetTextGenerate().GetItems()[0].GetText().GetText() != "Lookup completed." {
				t.Fatalf("round trip = %v err=%v", second, err)
			}
			plain, err := execute(&runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Hello"}}})
			if err != nil || len(plain.GetTextGenerate().GetItems()) != 2 || plain.GetTextGenerate().GetItems()[1].GetText().GetText() != "Plain answer." || calls.Load() != 3 {
				t.Fatalf("plain adaptive step = %v err=%v calls=%d", plain, err, calls.Load())
			}

			// Forced tool use and sampling fail before any dispatch.
			temperature := float32(0.4)
			for name, rejected := range map[string]*runtimev1.StreamLocalAppTextTurnRequest{
				"forced tool choice": {Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use it"}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED},
				"sampling":           {Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Hi"}}, Temperature: &temperature},
			} {
				if _, err := execute(rejected); err == nil {
					t.Fatalf("%s was admitted", name)
				} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
					t.Fatalf("%s = %v", name, err)
				}
			}
			if calls.Load() != 3 {
				t.Fatalf("rejected requests were dispatched: %d", calls.Load())
			}
		})
	}
}
