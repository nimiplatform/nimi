package ai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestStepFunProtectedAppNativeStopToolRoundTrip(t *testing.T) {
	for _, model := range []string{"step-5-preview", "step-3.7-flash", "step-3.5-flash-2603"} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%v", model, stream), func(t *testing.T) {
				calls := 0
				fixture, decision := nativeReasoningAppFixture(t, "stepfun", model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" || body["model"] != model || body["stream"] != stream || body["reasoning_effort"] != "high" || body["reasoning_format"] != "general" || body["tool_choice"] != nil {
						t.Errorf("wrong exact request: %s %v", r.URL.Path, body)
					}
					message := map[string]any{"reasoning": "private native reasoning", "content": "Checking."}
					if calls == 1 {
						message["tool_calls"] = []any{map[string]any{"index": 0, "id": "original", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}}
					} else {
						messages := body["messages"].([]any)
						assistant := messages[1].(map[string]any)
						if len(messages) != 3 || assistant["content"] != "Checking." || assistant["reasoning"] != nil || assistant["reasoning_content"] != nil || messages[2].(map[string]any)["tool_call_id"] != "original" || messages[2].(map[string]any)["content"] != "tool result" {
							t.Error("native transcript changed")
						}
						message["content"] = "Final answer."
					}
					key := "message"
					if stream {
						key = "delta"
					}
					response := map[string]any{"choices": []any{map[string]any{"index": 0, key: message, "finish_reason": "stop"}}, "usage": map[string]any{"prompt_tokens": 13, "completion_tokens": 21}}
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						b, _ := json.Marshal(response)
						_, _ = fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", b)
					} else {
						_ = json.NewEncoder(w).Encode(response)
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
					items := []*runtimev1.TextOutputItem{}
					completed := false
					for _, e := range events.events {
						switch {
						case e.GetReasoningContinuity() != nil || e.GetReasoningSummary() != nil:
							t.Fatal("invented reasoning replay or summary")
						case e.GetDelta() != nil:
							if e.GetDelta().GetText() != "" {
								items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: e.GetDelta().GetText()}}})
							}
						case e.GetToolCall() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: e.GetToolCall().GetToolCall()}})
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
				input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use lookup for Beijing."}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}}}
				first := step(input)
				if len(first) != 2 || first[0].GetText().GetText() != "Checking." || first[1].GetToolCall().GetId() != "original" {
					t.Fatal(first)
				}
				assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "original", ToolName: "lookup", Result: structpb.NewStringValue("tool result")}}})
				input.Messages = append(input.Messages, assistant)
				last := step(input)
				if len(last) != 1 || last[0].GetText().GetText() != "Final answer." || calls != 2 {
					t.Fatal(last)
				}
			})
		}
	}
}
