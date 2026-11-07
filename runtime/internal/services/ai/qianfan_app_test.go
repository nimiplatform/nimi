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

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestQianfanProtectedTextToolsAndJSON(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			calls := 0
			f, decision := nativeReasoningAppFixture(t, "qianfan", "ernie-5.1", func(w http.ResponseWriter, r *http.Request) {
				calls++
				var b map[string]any
				if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
					t.Error(err)
					return
				}
				if r.URL.Path != "/proxy/openai/v2/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" || b["model"] != "ernie-5.1" || b["max_tokens"] != float64(4096) || b["stream"] != stream || b["max_completion_tokens"] != nil || b["web_search"] != nil || b["thinking"] != nil || b["enable_thinking"] != nil {
					t.Errorf("native request %s %v", r.URL.Path, b)
				}
				messages := b["messages"].([]any)
				if messages[0].(map[string]any)["role"] != "system" || messages[1].(map[string]any)["content"] != "Use lookup." {
					t.Fatal("ordered messages lost")
				}
				if calls == 2 {
					if len(messages) != 5 || messages[3].(map[string]any)["tool_call_id"] != "call-1" || messages[4].(map[string]any)["tool_call_id"] != "call-2" || messages[2].(map[string]any)["reasoning_content"] != nil {
						t.Error("tool result round trip changed")
					}
				}
				if calls == 3 && (b["response_format"].(map[string]any)["type"] != "json_object" || b["tools"] != nil) {
					t.Error("JSON request changed")
				}
				message := map[string]any{"role": "assistant", "reasoning_content": "private raw thought", "content": `{"answer":19}`}
				finish := "stop"
				if calls == 1 {
					if b["tool_choice"].(map[string]any)["function"].(map[string]any)["name"] != "lookup" {
						t.Error("named tool projection")
					}
					message["content"] = nil
					finish = "tool_calls"
					message["tool_calls"] = []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}, map[string]any{"id": "call-2", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"上海"}`}}}
				}
				usage := map[string]any{"prompt_tokens": 11, "completion_tokens": 17}
				if !stream {
					_ = json.NewEncoder(w).Encode(map[string]any{"model": "ernie-5.1", "choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finish}}, "usage": usage})
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				emit := func(v any) { data, _ := json.Marshal(v); fmt.Fprintf(w, "data: %s\n\n", data) }
				emit(map[string]any{"model": "ernie-5.1", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"reasoning_content": "private raw thought"}}}})
				delete(message, "reasoning_content")
				if tc, ok := message["tool_calls"].([]any); ok {
					for i, call := range tc {
						call.(map[string]any)["index"] = i
					}
				}
				emit(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": message, "finish_reason": finish}}})
				emit(map[string]any{"choices": []any{}, "usage": usage})
				fmt.Fprint(w, "data: [DONE]\n\n")
			})
			schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}, "additionalProperties": false})
			req := &runtimev1.StreamLocalAppTextTurnRequest{MaxTokens: proto.Int32(4096), Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "system", Text: "Keep source order."}, {Role: "user", Parts: []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Use lookup."}}}}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL, ToolChoiceName: "lookup"}
			step := func() []*runtimev1.TextOutputItem {
				t.Helper()
				if !stream {
					out, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: req}})
					if err != nil {
						t.Fatal(err)
					}
					return out.GetTextGenerate().GetItems()
				}
				events := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
				if err := f.service.StreamLocalAppTextTurn(req, events); err != nil {
					t.Fatal(err)
				}
				var items []*runtimev1.TextOutputItem
				for _, e := range events.events {
					switch {
					case e.GetReasoningContinuity() != nil, e.GetReasoningSummary() != nil:
						t.Fatal("unreviewed raw thought carrier/summary")
					case e.GetToolCall() != nil:
						items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: e.GetToolCall().GetToolCall()}})
					case e.GetDelta() != nil:
						if text := e.GetDelta().GetText(); text != "" {
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: text}}})
						}
					case e.GetFailed() != nil:
						t.Fatal(e.GetFailed())
					case e.GetCompleted() != nil:
						return items
					}
				}
				t.Fatal("missing terminal")
				return nil
			}
			first := step()
			if len(first) != 2 || first[0].GetToolCall() == nil {
				t.Fatal(first)
			}
			assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
			for _, item := range first {
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
			}
			for _, id := range []string{"call-1", "call-2"} {
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: id, ToolName: "lookup", Result: structpb.NewNumberValue(19)}}})
			}
			req.Messages = append(req.Messages, assistant)
			req.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
			req.ToolChoiceName = ""
			second := step()
			if len(second) != 1 || second[0].GetText().GetText() != `{"answer":19}` {
				t.Fatal(second)
			}
			req.Messages = req.Messages[:2]
			req.Tools = nil
			req.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED
			req.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
			third := step()
			if len(third) != 1 || third[0].GetText().GetText() != `{"answer":19}` || calls != 3 {
				t.Fatal(third, calls)
			}
		})
	}
}

func TestQianfanProtectedEmbeddingFixedWidthAndInputIntegrity(t *testing.T) {
	var calls atomic.Int32
	var bad atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var b map[string]any
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			t.Error(err)
			return
		}
		if r.URL.Path != "/proxy/anthropic/v2/embeddings" || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("x-api-key") != "" || b["model"] != "embedding-v1" || len(b) != 2 || b["input"].([]any)[0] != "原文  中\n😀" {
			t.Errorf("wrong request %s %v", r.URL.Path, b)
		}
		width := 384
		if bad.Load() == 1 {
			width = 383
		}
		one, two := make([]float64, width), make([]float64, width)
		one[0] = 1
		two[0] = 2
		index := 0
		if bad.Load() == 2 {
			index = 1
		}
		model := "embedding-v1"
		if bad.Load() == 3 {
			model = "another"
		}
		var first any = one
		if bad.Load() == 4 {
			values := make([]any, width)
			for i, n := range one {
				values[i] = n
			}
			values[2] = nil
			first = values
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": model, "data": []any{map[string]any{"index": 1, "embedding": two}, map[string]any{"index": index, "embedding": first}}, "usage": map[string]any{"prompt_tokens": 8, "total_tokens": 8}})
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "qianfan", "embedding-v1", server.URL+"/proxy/anthropic/v2", Config{AllowLoopbackEndpoint: true})
	target, _ := structpb.NewStruct(map[string]any{"provider": "qianfan", "providerModelId": "embedding-v1", "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
	config := appAIConfig("app.embed", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.embed", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, ProviderModelTarget: target, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "qianfan", DriverId: "nimillm", DriverDialect: "qianfan"}}}})
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.embed", RegisteredAppSubject: "embed-subject", Operation: accountservice.LocalAppOperationScenarioExecute, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDScenarioExecute})
	spec := &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{"原文  中\n😀", "cloud"}, Purpose: runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT}
	req := &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{TextEmbed: spec}}
	out, err := f.service.ExecuteLocalAppScenario(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	result := out.GetTextEmbed()
	if len(result.GetVectors()) != 2 || len(result.Vectors[0].Values) != 384 || result.Vectors[0].Values[0] != 1 || result.Vectors[1].Values[0] != 2 || result.GetUsage().GetInputTokens() != 8 {
		t.Fatal(result)
	}
	spec.Purpose = runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY
	query, err := f.service.ExecuteLocalAppScenario(ctx, req)
	if err != nil || query.GetTextEmbed().GetSpaceId() != result.GetSpaceId() {
		t.Fatal("query space", err)
	}
	before := calls.Load()
	spec.Dimensions = proto.Uint32(384)
	if _, err = f.service.ExecuteLocalAppScenario(ctx, req); err == nil || calls.Load() != before {
		t.Fatal("dimension override dispatched")
	}
	spec.Dimensions = nil
	spec.Inputs[0] = strings.Repeat("中", 1001)
	if _, err = f.service.ExecuteLocalAppScenario(ctx, req); err == nil || calls.Load() != before {
		t.Fatal("oversized native text dispatched")
	}
	spec.Inputs[0] = "原文  中\n😀"
	for _, failure := range []int32{1, 2, 3, 4} {
		bad.Store(failure)
		if _, err = f.service.ExecuteLocalAppScenario(ctx, req); err == nil {
			t.Fatal("invalid native output accepted", failure)
		}
	}
}
