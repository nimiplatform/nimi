package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func azureResponsesAppFixture(t *testing.T, model string, handler http.HandlerFunc) (managedCloudScenarioTestFixture, func(accountservice.LocalAppOperation, string) context.Context) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	f := newManagedCloudScenarioTestFixture(t, "azure", model, server.URL, Config{AllowLoopbackEndpoint: true})
	f.connectorService = connector.New(f.service.logger, f.service.connStore, auditlog.New(128, 128))
	if _, err := f.connectorService.UpdateConnector(f.context, &runtimev1.UpdateConnectorRequest{ConnectorId: f.connectorID, Endpoint: proto.String(server.URL), AzureDeployments: &runtimev1.ConnectorAzureDeployments{Deployments: []*runtimev1.ConnectorAzureDeployment{{ProviderModelId: model, DeploymentName: "tenant-writing"}}}}); err != nil {
		t.Fatal(err)
	}
	f.descriptor = connectorModelDescriptorForAITest(t, f.connectorService, f.context, f.connectorID, model)
	target, _ := structpb.NewStruct(map[string]any{"provider": "azure", "providerModelId": model, "remoteModelCatalogId": f.descriptor.RemoteModelCatalogId})
	config := appAIConfig("app.azure", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "azure", DriverId: "nimillm", DriverDialect: "azure"}, ConnectorRef: f.connectorID, ProviderModelTarget: target}}})
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	return f, func(operation accountservice.LocalAppOperation, capability string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.azure", RegisteredAppSubject: "azure-subject", Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
	}
}

func writeAzureResponses(t *testing.T, w http.ResponseWriter, model string, output []map[string]any) {
	t.Helper()
	w.Header().Set("Content-Type", "text/event-stream")
	write := func(event map[string]any) {
		b, err := json.Marshal(event)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
	}
	write(map[string]any{"type": "response.created", "response": map[string]any{"model": model, "status": "in_progress"}})
	for i, item := range output {
		write(map[string]any{"type": "response.output_item.added", "output_index": i, "item": map[string]any{"type": item["type"], "id": item["id"], "call_id": item["call_id"], "name": item["name"]}})
		write(map[string]any{"type": "response.output_item.done", "output_index": i, "item": item})
	}
	write(map[string]any{"type": "response.completed", "response": map[string]any{"model": model, "status": "completed", "output": output, "usage": map[string]any{"input_tokens": 13, "output_tokens": 21}}})
}

func TestAzureResponsesProtectedAppUsesDeploymentAndOpaqueRoundTrip(t *testing.T) {
	for _, model := range azureResponsesReviewedTextTargets {
		for _, streaming := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%v", model, streaming), func(t *testing.T) {
				calls := 0
				f, decision := azureResponsesAppFixture(t, model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if r.URL.Path != "/openai/v1/responses" || r.Header.Get("api-key") != "test-key" || r.Header.Get("Authorization") != "" || body["model"] != "tenant-writing" || body["stream"] != true || body["store"] != false {
						t.Error("wrong Azure dispatch", r.URL.Path, body)
					}
					output := []map[string]any{{"type": "reasoning", "id": "original-reasoning", "encrypted_content": "original-opaque", "summary": []any{}}}
					if calls == 1 {
						output = append(output, openAIResponsesCall("call-item", "original-call", `{"city":"北京"}`))
					} else {
						input := body["input"].([]any)
						if len(input) != 4 || input[1].(map[string]any)["encrypted_content"] != "original-opaque" || input[2].(map[string]any)["call_id"] != "original-call" || input[3].(map[string]any)["call_id"] != "original-call" {
							t.Error("native continuity or call correlation changed")
						}
						output = append(output, openAIResponsesText("answer", "Final answer."))
					}
					writeAzureResponses(t, w, model, output)
				})
				step := func(input *runtimev1.StreamLocalAppTextTurnRequest) []*runtimev1.TextOutputItem {
					t.Helper()
					if !streaming {
						r, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
						if err != nil {
							t.Fatal(err)
						}
						return r.GetTextGenerate().GetItems()
					}
					events := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
					if err := f.service.StreamLocalAppTextTurn(input, events); err != nil {
						t.Fatal(err)
					}
					items := []*runtimev1.TextOutputItem{}
					completed := false
					for _, e := range events.events {
						switch {
						case e.GetReasoningContinuity() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: e.GetReasoningContinuity().GetCarrier()}})
						case e.GetToolCall() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: e.GetToolCall().GetToolCall()}})
						case e.GetDelta() != nil:
							if e.GetDelta().GetText() != "" {
								items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: e.GetDelta().GetText()}}})
							}
						case e.GetFailed() != nil:
							t.Fatal(e.GetFailed())
						case e.GetCompleted() != nil:
							completed = true
						}
					}
					if !completed {
						t.Fatal("missing terminal")
					}
					return items
				}
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}})
				input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use lookup for Beijing."}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}}
				first := step(input)
				if len(first) != 2 || first[0].GetReasoningContinuity().GetKind() != "azure.responses.encrypted-reasoning."+model || first[1].GetToolCall().GetId() != "original-call" {
					t.Fatal(first)
				}
				assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "original-call", ToolName: "lookup", Result: structpb.NewStringValue("tool result")}}})
				input.Messages = append(input.Messages, assistant)
				last := step(input)
				if len(last) != 2 || last[1].GetText().GetText() != "Final answer." || calls != 2 {
					t.Fatal(last)
				}
			})
		}
	}
}

func TestAzureRebindingDoesNotRetargetInflightAndRequiresNewSelection(t *testing.T) {
	var fixture managedCloudScenarioTestFixture
	calls := 0
	f, decision := azureResponsesAppFixture(t, "gpt-6.1-sol", func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "tenant-writing" {
			t.Error("inflight target changed")
		}
		if _, err := fixture.connectorService.UpdateConnector(fixture.context, &runtimev1.UpdateConnectorRequest{ConnectorId: fixture.connectorID, AzureDeployments: &runtimev1.ConnectorAzureDeployments{Deployments: []*runtimev1.ConnectorAzureDeployment{{ProviderModelId: "gpt-6.1-sol", DeploymentName: "replacement"}}}}); err != nil {
			t.Error(err)
		}
		writeAzureResponses(t, w, "gpt-6.1-sol", []map[string]any{openAIResponsesText("answer", "Original deployment result.")})
	})
	fixture = f
	input := &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Reply."}}}}}
	ctx := decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute)
	r, err := f.service.ExecuteLocalAppScenario(ctx, input)
	if err != nil || r.GetTextGenerate().GetItems()[0].GetText().GetText() != "Original deployment result." {
		t.Fatal(r, err)
	}
	if _, err := f.service.ExecuteLocalAppScenario(ctx, input); err == nil || calls != 1 {
		t.Fatal("stale selection was automatically retargeted", err, calls)
	}
}
