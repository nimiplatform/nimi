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

func TestSparkProtectedNativeTextToolsJSONAndThinking(t *testing.T) {
	for _, target := range [][2]string{{"spark", "4.0Ultra"}, {"spark", "lite"}, {"spark_reasoning", "spark-x"}} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%s/%v", target[0], target[1], stream), func(t *testing.T) {
				p, _ := capabilitydriver.NewSparkTextBehavior(target[0], target[1])
				calls := 0
				f, decision := nativeReasoningAppFixture(t, target[0], target[1], func(w http.ResponseWriter, r *http.Request) {
					calls++
					var b map[string]any
					if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
						t.Error(err)
						return
					}
					path := "/proxy/anthropic/v1/chat/completions"
					if p.Reasoning() {
						path = "/proxy/x2/chat/completions"
					}
					if r.URL.Path != path || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("x-api-key") != "" || b["model"] != target[1] || b["stream"] != stream || b["stream_options"] != nil {
						t.Errorf("native request %s %v", r.URL.Path, b)
					}
					if p.Reasoning() && calls < 3 && b["max_tokens"] != nil {
						t.Error("unreviewed total cap sent")
					}
					if !p.Reasoning() && b["max_tokens"] != float64(4096) {
						t.Error("native cap missing")
					}
					messages := b["messages"].([]any)
					prefix := 1
					if p.OrderedSystem() {
						prefix = 2
						if messages[0].(map[string]any)["role"] != "system" {
							t.Error("system order")
						}
					}
					if p.Tools() && calls == 1 {
						choice := b["tool_choice"].(map[string]any)
						if p.Reasoning() {
							if choice["name"] != "lookup" || choice["function"] != nil {
								t.Error("native force shape")
							}
						} else {
							if choice["function"].(map[string]any)["name"] != "lookup" || b["tool_calls_switch"] != true {
								t.Error("Ultra function shape")
							}
						}
					}
					if p.Tools() && calls == 2 {
						if len(messages) != prefix+3 || messages[prefix+1].(map[string]any)["tool_call_id"] != "call-1" || messages[prefix+2].(map[string]any)["tool_call_id"] != "call-2" || messages[prefix].(map[string]any)["reasoning_content"] != nil {
							t.Error("tool result correlation or unreviewed thought replay")
						}
					}
					final := calls == 3 || !p.Tools() && calls == 2
					if p.Reasoning() && final {
						if b["thinking"].(map[string]any)["type"] != "disabled" || b["max_tokens"] != float64(4096) {
							t.Error("native thinking-off cap")
						}
					}
					if !p.Reasoning() && final && b["response_format"].(map[string]any)["type"] != "json_object" {
						t.Error("JSON format")
					}
					message := map[string]any{"role": "assistant", "content": `{"answer":19}`}
					if p.Reasoning() && !final {
						message["reasoning_content"] = "native hidden thought"
					}
					if p.Tools() && calls == 1 {
						message["content"] = ""
						message["tool_calls"] = []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}, map[string]any{"id": "call-2", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"上海"}`}}}
					}
					usage := map[string]any{"prompt_tokens": 11, "completion_tokens": 17, "total_tokens": 28}
					sid := fmt.Sprintf("original-%d", calls)
					if !stream {
						out := map[string]any{"code": 0, "sid": sid, "choices": []any{map[string]any{"index": 0, "message": message}}, "usage": usage}
						if p.Reasoning() {
							out["status"] = "complete"
						}
						_ = json.NewEncoder(w).Encode(out)
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					emit := func(delta any, usage any) {
						v := map[string]any{"code": 0, "sid": sid, "id": sid, "choices": []any{map[string]any{"index": 0, "delta": delta}}}
						if usage != nil {
							v["usage"] = usage
						}
						data, _ := json.Marshal(v)
						fmt.Fprintf(w, "data: %s\n\n", data)
					}
					if raw, ok := message["reasoning_content"]; ok {
						emit(map[string]any{"role": "assistant", "reasoning_content": raw}, nil)
						delete(message, "reasoning_content")
					}
					if tc, ok := message["tool_calls"].([]any); ok {
						for i, call := range tc {
							call.(map[string]any)["index"] = i
						}
					}
					emit(message, nil)
					emit(map[string]any{"role": "assistant", "content": ""}, usage)
					fmt.Fprint(w, "data: [DONE]\n\n")
				})
				req := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use lookup for Beijing and Shanghai and return JSON."}}}
				if p.OrderedSystem() {
					req.Messages = append([]*runtimev1.LocalAppTextCandidateMessage{{Role: "system", Text: "Keep source order."}}, req.Messages...)
				}
				if !p.Reasoning() {
					req.MaxTokens = proto.Int32(4096)
				} else {
					req.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}}
				}
				if p.Tools() {
					schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}, "additionalProperties": false})
					req.Tools = []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", Description: "Look up the city", InputSchema: schema}}
					req.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL
					req.ToolChoiceName = "lookup"
				}
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
							t.Fatal("raw thought leaked or became a replay carrier")
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
					t.Fatal("no terminal")
					return nil
				}
				first := step()
				if p.Tools() {
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
					req.ToolChoiceName = ""
					answer := step()
					if len(answer) != 1 || answer[0].GetText().GetText() != `{"answer":19}` {
						t.Fatal(answer)
					}
				} else if len(first) != 1 || first[0].GetText().GetText() != `{"answer":19}` {
					t.Fatal(first)
				}
				req.Messages = []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Return JSON with answer19."}}
				if p.OrderedSystem() {
					req.Messages = append([]*runtimev1.LocalAppTextCandidateMessage{{Role: "system", Text: "Keep source order."}}, req.Messages...)
				}
				req.Tools = nil
				req.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED
				req.ToolChoiceName = ""
				if p.Reasoning() {
					req.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
					req.MaxTokens = proto.Int32(4096)
				} else {
					req.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
				}
				last := step()
				if len(last) != 1 || last[0].GetText().GetText() != `{"answer":19}` {
					t.Fatal(last)
				}
			})
		}
	}
}
