package ai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestMistralProtectedAppThinkingToolsSyncAndStream(t *testing.T) {
	for _, model := range []string{"mistral-large-4-0", "mistral-large-4", "mistral-small-2603"} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%v", model, stream), func(t *testing.T) {
				calls := 0
				fixture, decision := nativeReasoningAppFixture(t, "mistral", model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" || body["model"] != model || body["stream"] != stream || body["reasoning_effort"] != "high" {
						t.Errorf("wrong exact request %s %v", r.URL.Path, body)
					}
					thinking := map[string]any{"type": "thinking", "thinking": []any{map[string]any{"type": "text", "text": " private 原文\n "}}, "signature": "original-signature", "closed": true}
					message := map[string]any{"content": []any{thinking}}
					finish := "tool_calls"
					if calls == 1 {
						message["tool_calls"] = []any{map[string]any{"index": 0, "id": "call12345", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}}
					} else {
						messages := body["messages"].([]any)
						assistant := messages[1].(map[string]any)
						parts, ok := assistant["content"].([]any)
						if !ok || len(parts) != 1 || assistant["reasoning_content"] != nil || parts[0].(map[string]any)["signature"] != "original-signature" || messages[2].(map[string]any)["content"] != "tool result" {
							t.Error("thinking structure or tool result lost")
						}
						message["content"] = []any{thinking, map[string]any{"type": "text", "text": "Final answer."}}
						finish = "stop"
					}
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": message, "finish_reason": finish}}, "usage": map[string]any{"prompt_tokens": 13, "completion_tokens": 21}})
						_, _ = fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", b)
					} else {
						_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finish}}, "usage": map[string]any{"prompt_tokens": 13, "completion_tokens": 21}})
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
						case e.GetReasoningContinuity() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: e.GetReasoningContinuity().GetCarrier()}})
						case e.GetToolCall() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: e.GetToolCall().GetToolCall()}})
						case e.GetDelta() != nil:
							if e.GetDelta().GetText() != "" {
								items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: e.GetDelta().GetText()}}})
							}
						case e.GetReasoningSummary() != nil:
							t.Fatal("raw thinking exposed as summary")
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
				if len(first) != 2 || first[0].GetReasoningContinuity() == nil || first[1].GetToolCall().GetId() != "call12345" {
					t.Fatal(first)
				}
				assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call12345", ToolName: "lookup", Result: structpb.NewStringValue("tool result")}}})
				input.Messages = append(input.Messages, assistant)
				last := step(input)
				if len(last) != 2 || last[1].GetText().GetText() != "Final answer." || calls != 2 {
					t.Fatal(last)
				}
				for _, item := range last {
					if strings.Contains(item.GetText().GetText(), "private") || item.GetReasoningSummary() != nil {
						t.Fatal("private thinking became visible")
					}
				}
				bad := proto.Clone(input).(*runtimev1.StreamLocalAppTextTurnRequest)
				bad.Messages[1].TurnItems[0].GetOutput().GetReasoningContinuity().Kind = "another-model"
				if _, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: bad}}); err == nil || calls != 2 {
					t.Fatal("cross-model replay dispatched")
				}
			})
		}
	}
}
