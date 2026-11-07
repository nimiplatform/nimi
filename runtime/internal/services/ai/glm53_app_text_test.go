package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func nativeReasoningAppFixture(t *testing.T, provider, model string, handler http.HandlerFunc) (managedCloudScenarioTestFixture, func(accountservice.LocalAppOperation, string) context.Context) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	endpoint := server.URL + "/v1"
	if provider == "glm" {
		endpoint = server.URL + "/proxy/api/paas/v4"
	}
	if provider == "groq" {
		endpoint = server.URL + "/proxy/openai/v1"
	}
	if provider == "qianfan" {
		endpoint = server.URL + "/proxy/openai/v2"
	}
	if provider == "volcengine" {
		endpoint = server.URL + "/proxy/api/v3"
	}
	if provider == "spark_maas" {
		endpoint = server.URL + "/proxy/anthropic/v2"
	}
	if provider == "spark" {
		endpoint = server.URL + "/proxy/anthropic/v1"
	}
	if provider == "spark_reasoning" {
		endpoint = server.URL + "/proxy/x2"
	}
	if provider == "fireworks" {
		endpoint = server.URL + "/proxy/inference/v1"
	}
	if provider == "together" || provider == "openrouter" || provider == "siliconflow" {
		endpoint = server.URL + "/proxy/openai/v1"
	}
	fixture := newManagedCloudScenarioTestFixture(t, provider, model, endpoint, Config{AllowLoopbackEndpoint: true})
	target, _ := structpb.NewStruct(map[string]any{"provider": provider, "providerModelId": model, "remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId()})
	config := appAIConfig("app.glm53", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: provider, DriverId: "nimillm", DriverDialect: provider}, ConnectorRef: fixture.connectorID, ProviderModelTarget: target}}})
	if err := overwriteAIConfigStoreForTest(context.Background(), fixture.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	return fixture, func(operation accountservice.LocalAppOperation, capability string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.glm53", RegisteredAppSubject: "app-subject-glm53", Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
	}
}

func TestNativeReasoningProtectedAppRoundTrip(t *testing.T) {
	for _, model := range []string{"glm-5.3", "glm-5.3-flash", "glm-5.3-flashx", "glm-5.3-flashx-legal", "deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro", "qwen3.8-omni-flash", "mimo-v2.6-pro", "mimo-v2.6-flash"} {
		provider, path := "glm", "/proxy/api/paas/v4/chat/completions"
		if strings.HasPrefix(model, "deepseek") {
			provider, path = "deepseek", "/v1/chat/completions"
		}
		if model == "qwen3.8-omni-flash" {
			provider, path = "dashscope", "/v1/chat/completions"
		}
		if strings.HasPrefix(model, "mimo-") {
			provider, path = "mimo", "/v1/chat/completions"
		}
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%v", model, stream), func(t *testing.T) {
				var calls atomic.Int32
				raw := "  replay 原文\r\n😀 "
				wantCarrier, _ := json.Marshal(raw)
				fixture, decision := nativeReasoningAppFixture(t, provider, model, func(w http.ResponseWriter, r *http.Request) {
					n := calls.Add(1)
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					thinkingEnabled := false
					if provider == "dashscope" {
						thinkingEnabled = body["preserve_thinking"] == true && body["enable_search"] == false && body["thinking"] == nil
					} else if thinking, ok := body["thinking"].(map[string]any); ok {
						thinkingEnabled = thinking["type"] == "enabled" && (provider != "glm" || thinking["clear_thinking"] == false)
					}
					if r.URL.Path != path || body["model"] != model || body["stream"] != stream || r.Header.Get("Authorization") != "Bearer test-key" || !thinkingEnabled || (provider != "mimo" && body["reasoning_effort"] != "low") || (provider == "mimo" && body["reasoning_effort"] != nil) {
						t.Errorf("wrong exact native request: %s %v", r.URL.Path, body)
					}
					message := map[string]any{"reasoning_content": raw, "content": ""}
					finish := "tool_calls"
					if n == 1 {
						message["tool_calls"] = []any{map[string]any{"id": "call-original", "type": "function", "index": 0, "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}}
					} else {
						messages := body["messages"].([]any)
						if len(messages) != 3 || messages[1].(map[string]any)["reasoning_content"] != raw || messages[2].(map[string]any)["tool_call_id"] != "call-original" || messages[2].(map[string]any)["content"] != "tool result" {
							t.Errorf("lost native replay: %v", messages)
						}
						message["content"] = "Final answer."
						finish = "stop"
					}
					if stream {
						if provider == "glm" && body["tool_stream"] != true {
							t.Error("tool streaming not enabled")
						}
						w.Header().Set("Content-Type", "text/event-stream")
						b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"reasoning_content": raw}, "finish_reason": nil}}})
						_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
						delete(message, "reasoning_content")
						b, _ = json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": message, "finish_reason": finish}}})
						_, _ = fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", b)
					} else {
						_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finish}}})
					}
				})
				step := func(input *runtimev1.StreamLocalAppTextTurnRequest) []*runtimev1.TextOutputItem {
					t.Helper()
					if !stream {
						r, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
						if err != nil {
							t.Fatal(err)
						}
						return r.GetTextGenerate().GetItems()
					}
					events := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
					if err := fixture.service.StreamLocalAppTextTurn(input, events); err != nil {
						t.Fatal(err)
					}
					var items []*runtimev1.TextOutputItem
					complete := false
					for _, e := range events.events {
						switch {
						case e.GetReasoningContinuity() != nil:
							if int(e.GetReasoningContinuity().GetItemIndex()) != len(items) {
								t.Fatal("bad continuity order")
							}
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: e.GetReasoningContinuity().GetCarrier()}})
						case e.GetToolCall() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: e.GetToolCall().GetToolCall()}})
						case e.GetDelta() != nil:
							if e.GetDelta().GetText() != "" {
								items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: e.GetDelta().GetText()}}})
							}
						case e.GetReasoningSummary() != nil:
							t.Fatal("raw reasoning became summary")
						case e.GetCompleted() != nil:
							complete = true
						case e.GetFailed() != nil:
							t.Fatalf("stream failure: %v", e.GetFailed())
						}
					}
					if !complete {
						t.Fatal("missing terminal")
					}
					return items
				}
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}, "additionalProperties": false})
				input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use lookup for Beijing."}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}}
				input.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}}
				if provider == "mimo" {
					input.Reasoning.Intensity = &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}
				}
				first := step(input)
				if len(first) != 2 || string(first[0].GetReasoningContinuity().GetPayload()) != string(wantCarrier) || first[1].GetToolCall().GetId() != "call-original" {
					t.Fatalf("first=%v", first)
				}
				assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-original", ToolName: "lookup", Result: structpb.NewStringValue("tool result")}}})
				input.Messages = append(input.Messages, assistant)
				last := step(input)
				if len(last) != 2 || last[1].GetText().GetText() != "Final answer." || calls.Load() != 2 {
					t.Fatalf("last=%v calls=%d", last, calls.Load())
				}
				bad := proto.Clone(input).(*runtimev1.StreamLocalAppTextTurnRequest)
				bad.Messages[1].TurnItems[0].GetOutput().GetReasoningContinuity().Kind = "glm.chat.native-reasoning-replay.other"
				_, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: bad}})
				if code, _ := grpcerr.ExtractReasonCode(err); code != runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID || calls.Load() != 2 {
					t.Fatalf("cross-target dispatched: %v calls=%d", err, calls.Load())
				}
			})
		}
	}
}

func TestGLM53ProtectedOwnedImageAndUnsupportedOff(t *testing.T) {
	payload := l1CarrierPNGBytes(t)
	expected := "data:image/png;base64," + base64.StdEncoding.EncodeToString(payload)
	var calls atomic.Int32
	fixture, decision := nativeReasoningAppFixture(t, "glm", "glm-5.3-flash", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		parts := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
		if len(parts) != 2 || parts[1].(map[string]any)["image_url"].(map[string]any)["url"] != expected {
			t.Error("owned bytes/order changed")
		}
		_, _ = fmt.Fprint(w, `{"choices":[{"index":0,"message":{"reasoning_content":"private","content":"Diagram"},"finish_reason":"stop"}]}`)
	})
	uploaded, err := fixture.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: payload, MimeType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Describe"}}, {Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: uploaded.ArtifactId, MimeType: "image/png"}}}}}}}
	execute := func(s *runtimev1.StreamLocalAppTextTurnRequest) (*runtimev1.ExecuteLocalAppScenarioResponse, error) {
		return fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: s}})
	}
	r, err := execute(input)
	if err != nil || len(r.GetTextGenerate().GetItems()) != 2 || r.GetTextGenerate().GetItems()[1].GetText().GetText() != "Diagram" {
		t.Fatalf("owned result %v %v", r, err)
	}
	for _, mutate := range []func(*runtimev1.StreamLocalAppTextTurnRequest){func(s *runtimev1.StreamLocalAppTextTurnRequest) {
		s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
	}, func(s *runtimev1.StreamLocalAppTextTurnRequest) {
		s.Messages[0].Parts[1].GetArtifactRef().ArtifactId = "artifact_missing"
	}} {
		bad := proto.Clone(input).(*runtimev1.StreamLocalAppTextTurnRequest)
		mutate(bad)
		if _, err = execute(bad); err == nil || calls.Load() != 1 {
			t.Fatal("invalid owned request dispatched")
		}
	}
	for _, item := range r.GetTextGenerate().GetItems() {
		if strings.Contains(item.GetText().GetText(), "private") || item.GetReasoningSummary() != nil {
			t.Fatal("plain hidden reasoning became visible content")
		}
	}
}
