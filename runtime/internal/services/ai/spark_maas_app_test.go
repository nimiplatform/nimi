package ai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestSparkMaaSProtectedChatAndStructuredProtocols(t *testing.T) {
	for _, model := range capabilitydriver.SparkMaaSTextModels() {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%v", model, stream), func(t *testing.T) {
				calls := 0
				f, decision := nativeReasoningAppFixture(t, "spark_maas", model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var b map[string]any
					if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
						t.Error(err)
						return
					}
					if r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("x-api-key") != "" || b["model"] != model || b["stream"] != stream || b["max_tokens"] != nil || b["store"] != nil || b["include"] != nil || b["stream_options"] != nil {
						t.Errorf("wrong MaaS envelope %v", b)
					}
					emit := func(v any) { data, _ := json.Marshal(v); fmt.Fprintf(w, "data: %s\n\n", data) }
					if calls == 3 || calls == 4 {
						if r.URL.Path != "/proxy/anthropic/v1/responses" || b["max_output_tokens"] != float64(4096) || b["messages"] != nil || b["tools"] != nil || b["thinking"] != nil || b["reasoning"] != nil {
							t.Errorf("wrong Responses request %s %v", r.URL.Path, b)
						}
						format := b["text"].(map[string]any)["format"].(map[string]any)
						if calls == 3 && (format["type"] != "json_schema" || format["strict"] != true || format["name"] != "answer") || calls == 4 && format["type"] != "json_object" {
							t.Error("structured format", format)
						}
						response := map[string]any{"id": "response-original", "model": model, "status": "completed", "output": []any{map[string]any{"id": "thought", "type": "reasoning", "summary": []any{map[string]any{"type": "summary_text", "text": "hidden native summary"}}}, map[string]any{"id": "answer", "type": "message", "status": "completed", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": `{"answer":19}`}}}}, "usage": map[string]any{"input_tokens": 11, "output_tokens": 17}}
						if !stream {
							_ = json.NewEncoder(w).Encode(response)
							return
						}
						w.Header().Set("Content-Type", "text/event-stream")
						emit(map[string]any{"type": "response.created", "response": map[string]any{"id": "response-original", "model": model, "status": "in_progress"}})
						emit(map[string]any{"type": "response.output_text.delta", "response_id": "response-original", "delta": `{"answer":19}`})
						emit(map[string]any{"type": "response.completed", "response": response})
						return
					}
					if r.URL.Path != "/proxy/anthropic/v2/chat/completions" || b["max_completion_tokens"] != float64(4096) || b["input"] != nil || b["text"] != nil {
						t.Errorf("wrong Chat request %s %v", r.URL.Path, b)
					}
					thinking := b["thinking"].(map[string]any)["type"]
					if calls < 3 && thinking != "enabled" || calls == 5 && thinking != "disabled" {
						t.Error("thinking mapping", thinking)
					}
					messages := b["messages"].([]any)
					if messages[0].(map[string]any)["role"] != "system" {
						t.Error("ordered system input")
					}
					if calls == 2 && (len(messages) != 5 || messages[3].(map[string]any)["tool_call_id"] != "call-1" || messages[4].(map[string]any)["tool_call_id"] != "call-2" || messages[2].(map[string]any)["reasoning_content"] != nil) {
						t.Error("native tool result correlation")
					}
					message := map[string]any{"role": "assistant", "content": `{"answer":19}`}
					finish := "stop"
					if calls != 5 {
						message["reasoning_content"] = "raw thought stays hidden"
					}
					if calls == 1 {
						if b["tool_choice"] != "required" || b["tool_calls_switch"] != nil {
							t.Error("MaaS function controls")
						}
						message["content"] = nil
						finish = "tool_calls"
						message["tool_calls"] = []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}, map[string]any{"id": "call-2", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"上海"}`}}}
					}
					usage := map[string]any{"prompt_tokens": 11, "completion_tokens": 17, "total_tokens": 28}
					if !stream {
						_ = json.NewEncoder(w).Encode(map[string]any{"id": "chat-original", "model": model, "choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finish}}, "usage": usage})
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					if raw, ok := message["reasoning_content"]; ok {
						emit(map[string]any{"id": "chat-original", "model": model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"reasoning_content": raw}}}})
						delete(message, "reasoning_content")
					}
					if tc, ok := message["tool_calls"].([]any); ok {
						for i, call := range tc {
							call.(map[string]any)["index"] = i
						}
					}
					emit(map[string]any{"id": "chat-original", "model": model, "choices": []any{map[string]any{"index": 0, "delta": message, "finish_reason": finish}}})
					emit(map[string]any{"choices": []any{}, "usage": usage})
					fmt.Fprint(w, "data: [DONE]\n\n")
				})
				toolSchema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}, "additionalProperties": false})
				req := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "system", Text: "Keep source order."}, {Role: "user", Text: "Look up Beijing and Shanghai. Return JSON."}}, MaxTokens: proto.Int32(4096), Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", Description: "Look up a city", InputSchema: toolSchema}}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}}}
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
							t.Fatal("hidden reasoning or unreviewed replay published")
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
				a := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					a.TurnItems = append(a.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				for _, id := range []string{"call-1", "call-2"} {
					a.TurnItems = append(a.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: id, ToolName: "lookup", Result: structpb.NewNumberValue(19)}}})
				}
				req.Messages = append(req.Messages, a)
				req.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
				second := step()
				if len(second) != 1 || second[0].GetText().GetText() != `{"answer":19}` {
					t.Fatal(second)
				}
				req.Messages = req.Messages[:2]
				req.Tools = nil
				req.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED
				req.Reasoning = nil
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
				req.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, SchemaName: "answer", JsonSchema: schema}
				third := step()
				if len(third) != 1 || third[0].GetText().GetText() != `{"answer":19}` {
					t.Fatal(third)
				}
				req.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
				fourth := step()
				if len(fourth) != 1 || fourth[0].GetText().GetText() != `{"answer":19}` {
					t.Fatal(fourth)
				}
				req.ResponseFormat = nil
				req.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
				fifth := step()
				if len(fifth) != 1 || fifth[0].GetText().GetText() != `{"answer":19}` || calls != 5 {
					t.Fatal(fifth, calls)
				}
			})
		}
	}
}
