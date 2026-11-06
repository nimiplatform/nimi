package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func bedrockAppFixture(t *testing.T, model string, handler http.HandlerFunc) (managedCloudScenarioTestFixture, func(accountservice.LocalAppOperation, string) context.Context) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	f := newManagedCloudScenarioTestFixture(t, "bedrock", model, server.URL, Config{AllowLoopbackEndpoint: true})
	f.connectorService = connector.New(f.service.logger, f.service.connStore, auditlog.New(128, 128))
	if _, err := f.connectorService.UpdateConnector(f.context, &runtimev1.UpdateConnectorRequest{ConnectorId: f.connectorID, Endpoint: proto.String(server.URL), BedrockInvocations: &runtimev1.ConnectorBedrockInvocations{Invocations: []*runtimev1.ConnectorBedrockInvocation{{ProviderModelId: model, InvocationModelId: "us." + model}}}}); err != nil {
		t.Fatal(err)
	}
	f.descriptor = connectorModelDescriptorForAITest(t, f.connectorService, f.context, f.connectorID, model)
	target, _ := structpb.NewStruct(map[string]any{"provider": "bedrock", "providerModelId": model, "remoteModelCatalogId": f.descriptor.RemoteModelCatalogId})
	config := appAIConfig("app.bedrock", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "bedrock", DriverId: "nimillm", DriverDialect: "bedrock"}, ConnectorRef: f.connectorID, ProviderModelTarget: target}}})
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	return f, func(op accountservice.LocalAppOperation, capability string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.bedrock", RegisteredAppSubject: "bedrock-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
	}
}

func TestBedrockProtectedAppCurrentClaudeSyncStreamAndOwnedImage(t *testing.T) {
	for _, model := range bedrockClaudeTargets {
		for _, stream := range []bool{false, true} {
			t.Run(model+map[bool]string{false: "/sync", true: "/stream"}[stream], func(t *testing.T) {
				source := l1CarrierPNGBytes(t)
				f, decision := bedrockAppFixture(t, model, func(w http.ResponseWriter, r *http.Request) {
					path := "/model/us." + model + "/invoke"
					if stream {
						path += "-with-response-stream"
					}
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if r.URL.Path != path || r.Header.Get("Authorization") != "Bearer test-key" || body["model"] != nil || body["anthropic_version"] != "bedrock-2023-05-31" {
						t.Error("wrong captured invocation", r.URL.Path, body)
					}
					content := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
					if content[1].(map[string]any)["source"].(map[string]any)["data"] != base64.StdEncoding.EncodeToString(source) {
						t.Error("owned image bytes changed")
					}
					if !stream {
						_, _ = w.Write([]byte(`{"content":[{"type":"thinking","thinking":"","signature":"original"},{"type":"text","text":"Hello"}],"stop_reason":"end_turn","usage":{"input_tokens":9,"output_tokens":11,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}`))
						return
					}
					w.Header().Set("Content-Type", "application/vnd.amazon.eventstream")
					for _, raw := range []string{`{"type":"message_start","message":{"content":[],"usage":{"input_tokens":9,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}`, `{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":"original"}}`, `{"type":"content_block_stop","index":0}`, `{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`, `{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello"}}`, `{"type":"content_block_stop","index":1}`, `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":11}}`, `{"type":"message_stop"}`} {
						payload, _ := json.Marshal(map[string]string{"bytes": base64.StdEncoding.EncodeToString([]byte(raw))})
						if err := eventstream.NewEncoder().Encode(w, eventstream.Message{Headers: eventstream.Headers{{Name: ":message-type", Value: eventstream.StringValue("event")}, {Name: ":event-type", Value: eventstream.StringValue("chunk")}}, Payload: payload}); err != nil {
							t.Error(err)
						}
					}
				})
				uploaded, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: source, MimeType: "image/png"})
				if err != nil {
					t.Fatal(err)
				}
				parts := []*runtimev1.ChatContentPart{
					{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Describe"}},
					{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: uploaded.ArtifactId, MimeType: "image/png"}}},
				}
				input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: parts}}}
				if stream {
					events := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
					if err := f.service.StreamLocalAppTextTurn(input, events); err != nil {
						t.Fatal(err)
					}
					complete := false
					for _, e := range events.events {
						if e.GetCompleted() != nil {
							complete = true
						}
					}
					if !complete {
						t.Fatal("native completion missing")
					}
				} else {
					response, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
					if err != nil || len(response.GetTextGenerate().GetItems()) != 2 || response.GetTextGenerate().GetItems()[1].GetText().GetText() != "Hello" {
						t.Fatal(response, err)
					}
				}
			})
		}
	}
}

func TestBedrockProtectedResponsesToolsKeepNativeContinuityInBothModes(t *testing.T) {
	for _, model := range bedrockResponsesTargets {
		for _, stream := range []bool{false, true} {
			t.Run(model+map[bool]string{false: "/sync", true: "/stream"}[stream], func(t *testing.T) {
				calls := 0
				f, decision := bedrockAppFixture(t, model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if r.URL.Path != "/openai/v1/responses" || r.Header.Get("Authorization") != "Bearer test-key" || body["model"] != "us."+model || body["stream"] != stream || body["store"] != false {
						t.Error("wrong native Responses request", r.URL.Path, body)
					}
					output := []map[string]any{{"type": "reasoning", "id": "native-reasoning", "encrypted_content": "opaque-original", "summary": []any{}}}
					if calls == 1 {
						output = append(output, openAIResponsesCall("call-item", "original-call", `{"city":"北京"}`))
					} else {
						input := body["input"].([]any)
						if len(input) != 4 || input[1].(map[string]any)["encrypted_content"] != "opaque-original" || input[2].(map[string]any)["call_id"] != "original-call" || input[3].(map[string]any)["call_id"] != "original-call" {
							t.Error("native continuity or tool correlation changed")
						}
						output = append(output, openAIResponsesText("answer", "Result"))
					}
					if stream {
						writeAzureResponses(t, w, model, output)
					} else {
						_ = json.NewEncoder(w).Encode(chatGPTPlanCompleted(output)["response"])
					}
				})
				step := func(input *runtimev1.StreamLocalAppTextTurnRequest) []*runtimev1.TextOutputItem {
					t.Helper()
					if !stream {
						result, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
						if err != nil {
							t.Fatal(err)
						}
						return result.GetTextGenerate().GetItems()
					}
					events := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
					if err := f.service.StreamLocalAppTextTurn(input, events); err != nil {
						t.Fatal(err)
					}
					items := []*runtimev1.TextOutputItem{}
					complete := false
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
							complete = true
						}
					}
					if !complete {
						t.Fatal("native completion missing")
					}
					return items
				}
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}})
				input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use lookup for Beijing."}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}}
				first := step(input)
				if len(first) != 2 || first[0].GetReasoningContinuity().GetKind() != "bedrock.responses.encrypted-reasoning."+model || first[1].GetToolCall().GetId() != "original-call" {
					t.Fatal(first)
				}
				assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "original-call", ToolName: "lookup", Result: structpb.NewStringValue("tool result")}}})
				input.Messages = append(input.Messages, assistant)
				second := step(input)
				if calls != 2 || len(second) != 2 || second[1].GetText().GetText() != "Result" {
					t.Fatal(calls, second)
				}
			})
		}
	}
}

func TestBedrockProtectedNativeRefusalKeepsTypedReason(t *testing.T) {
	for _, stream := range []bool{false, true} {
		f, decision := bedrockAppFixture(t, "anthropic.claude-fable-5-1", func(w http.ResponseWriter, r *http.Request) {
			if !stream {
				_, _ = w.Write([]byte(`{"content":[],"stop_reason":"refusal","usage":{"input_tokens":5,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}`))
				return
			}
			w.Header().Set("Content-Type", "application/vnd.amazon.eventstream")
			for _, raw := range []string{`{"type":"message_start","message":{"content":[],"usage":{"input_tokens":5,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}`, `{"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":0}}`, `{"type":"message_stop"}`} {
				payload, _ := json.Marshal(map[string]string{"bytes": base64.StdEncoding.EncodeToString([]byte(raw))})
				if err := eventstream.NewEncoder().Encode(w, eventstream.Message{Headers: eventstream.Headers{{Name: ":message-type", Value: eventstream.StringValue("event")}, {Name: ":event-type", Value: eventstream.StringValue("chunk")}}, Payload: payload}); err != nil {
					t.Error(err)
				}
			}
		})
		input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Exercise the native refusal fixture."}}}
		if !stream {
			_, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
			if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
				t.Fatal(err)
			}
		} else {
			events := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
			if err := f.service.StreamLocalAppTextTurn(input, events); err != nil {
				t.Fatal(err)
			}
			blocked := false
			for _, event := range events.events {
				if event.GetCompleted() != nil {
					t.Fatal("refusal became success")
				}
				if event.GetFailed().GetReasonCode() == runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED {
					blocked = true
				}
			}
			if !blocked {
				t.Fatal("native refusal cause lost")
			}
		}
	}
}
