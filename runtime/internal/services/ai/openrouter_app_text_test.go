package ai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestOpenRouterProtectedTextNativeReplayAndSchema(t *testing.T) {
	for _, model := range capabilitydriver.OpenRouterTextModels() {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%v", model, stream), func(t *testing.T) {
				calls := 0
				p, _ := capabilitydriver.NewOpenRouterTextBehavior(model)
				f, decision := nativeReasoningAppFixture(t, "openrouter", model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var b map[string]any
					if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
						t.Error(err)
						return
					}
					if r.URL.Path != "/proxy/openai/v1/responses" || b["model"] != model || b["store"] != false || b["stream"] != true || b["provider"].(map[string]any)["require_parameters"] != true || b["provider"].(map[string]any)["allow_fallbacks"] != false {
						t.Errorf("native request %s %v", r.URL.Path, b)
					}
					if calls == 2 {
						input := b["input"].([]any)
						if len(input) != 4 || input[1].(map[string]any)["signature"] != "native-signature" || input[1].(map[string]any)["content"].([]any)[0].(map[string]any)["text"] != " PRIVATE 原文\r\n " || input[3].(map[string]any)["call_id"] != "original-call" {
							t.Error("native replay altered")
						}
					}
					out := []map[string]any{{"type": "reasoning", "id": "reasoning", "status": "completed", "summary": []any{}, "content": []any{map[string]any{"type": "reasoning_text", "text": " PRIVATE 原文\r\n "}}, "format": "anthropic-claude-v1", "signature": "native-signature"}}
					if calls == 1 {
						out = append(out, openAIResponsesCall("call", "original-call", `{"city":"北京"}`))
					} else {
						out = append(out, map[string]any{"type": "message", "id": "message", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": `{"answer":19}`}}})
					}
					writeAzureResponses(t, w, model, out)
				})
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}, "additionalProperties": false})
				request := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Use lookup, then return JSON."}}}}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, MaxTokens: proto.Int32(512)}
				if model == "x-ai/grok-4.7" {
					request.MaxTokens = nil
				}
				step := func() []*runtimev1.TextOutputItem {
					t.Helper()
					if !stream {
						r, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: request}})
						if err != nil {
							t.Fatal(err)
						}
						return r.GetTextGenerate().GetItems()
					}
					events := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
					if err := f.service.StreamLocalAppTextTurn(request, events); err != nil {
						t.Fatal(err)
					}
					var out []*runtimev1.TextOutputItem
					for _, e := range events.events {
						switch {
						case e.GetReasoningContinuity() != nil:
							out = append(out, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: e.GetReasoningContinuity().GetCarrier()}})
						case e.GetToolCall() != nil:
							out = append(out, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: e.GetToolCall().GetToolCall()}})
						case e.GetDelta() != nil:
							if text := e.GetDelta().GetText(); text != "" {
								if strings.Contains(text, "PRIVATE") {
									t.Fatal("raw thought leaked")
								}
								out = append(out, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: text}}})
							}
						case e.GetFailed() != nil:
							t.Fatal(e.GetFailed())
						case e.GetCompleted() != nil:
							return out
						}
					}
					t.Fatal("missing terminal")
					return nil
				}
				first := step()
				if len(first) != 2 || first[0].GetReasoningContinuity().GetKind() != p.ContinuityKind() || first[1].GetToolCall().GetId() != "original-call" {
					t.Fatal(first)
				}
				assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "original-call", ToolName: "lookup", Result: structpb.NewNumberValue(19)}}})
				request.Messages = append(request.Messages, assistant)
				second := step()
				if len(second) != 2 || second[1].GetText().GetText() != `{"answer":19}` {
					t.Fatal(second)
				}
				if p.StrictSchema() {
					request.Messages = request.Messages[:1]
					request.Tools = nil
					outSchema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
					request.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, SchemaName: "Result", JsonSchema: outSchema}
					third := step()
					if len(third) != 2 || third[1].GetText().GetText() != `{"answer":19}` {
						t.Fatal(third)
					}
				}
			})
		}
	}
}
