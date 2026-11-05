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
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGeminiArgonPublicAppToolRoundTrip(t *testing.T) {
	for _, delivery := range []struct{ stream, summary bool }{{false, false}, {true, false}, {false, true}, {true, true}} {
		stream, wantSummary := delivery.stream, delivery.summary
		t.Run(fmt.Sprintf("stream=%v/summary=%v", stream, wantSummary), func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n := requests.Add(1)
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if r.URL.Path != "/v1beta/interactions" || r.Header.Get("x-goog-api-key") != "test-key" || r.Header.Get("Authorization") != "" || body["model"] != "gemini-4-argon" || body["store"] != false || body["background"] != false || body["stream"] != stream {
					t.Errorf("wrong native request %s %+v", r.URL.Path, body)
				}
				config := body["generation_config"].(map[string]any)
				summaryMode := "none"
				if wantSummary {
					summaryMode = "auto"
				}
				if config["thinking_level"] != "low" || config["thinking_summaries"] != summaryMode {
					t.Errorf("controls=%+v", config)
				}
				var steps []map[string]any
				status := "completed"
				if n == 1 {
					if config["tool_choice"] != "any" {
						t.Errorf("forced tool choice = %v", config)
					}
					steps = []map[string]any{{"type": "thought", "signature": "signed-opaque-state"}, {"type": "function_call", "id": "call-1", "name": "lookup", "arguments": map[string]any{"query": " 北京\n🌧 "}}}
					if wantSummary {
						steps[0]["summary"] = []any{map[string]any{"type": "text", "text": " Need lookup🌧 "}}
					}
					status = "requires_action"
				} else {
					input := body["input"].([]any)
					if len(input) != 4 {
						t.Errorf("replay=%+v", input)
						return
					}
					thought, call, result := input[1].(map[string]any), input[2].(map[string]any), input[3].(map[string]any)
					if thought["type"] != "thought" || thought["signature"] != "signed-opaque-state" || call["id"] != "call-1" || call["arguments"].(map[string]any)["query"] != " 北京\n🌧 " || result["call_id"] != "call-1" || result["result"] != `" complete\n🌧 "` {
						t.Errorf("replay lost native values: %+v", input)
					}
					if wantSummary && thought["summary"].([]any)[0].(map[string]any)["text"] != " Need lookup🌧 " {
						t.Error("signed thought summary was changed")
					}
					steps = []map[string]any{{"type": "model_output", "content": []any{map[string]any{"type": "text", "text": " 完成🌧\n"}}}}
				}
				terminal := map[string]any{"object": "interaction", "model": "gemini-4-argon", "status": status, "usage": map[string]any{"total_input_tokens": 7, "total_tokens": 22}}
				if !stream {
					terminal["steps"] = steps
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(terminal)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				delete(terminal, "model")
				delete(terminal, "object")
				send := func(v any) { b, _ := json.Marshal(v); _, _ = fmt.Fprintf(w, "data: %s\n\n", b) }
				creation := map[string]any{}
				if number := requests.Load(); number > 1 {
					creation["status"] = "queued"
				}
				send(map[string]any{"event_type": "interaction.created", "interaction": creation})
				for i, step := range steps {
					start := map[string]any{"type": step["type"]}
					delta := map[string]any{}
					switch step["type"] {
					case "thought":
						delta = map[string]any{"type": "thought_signature", "signature": step["signature"]}
					case "function_call":
						start["id"], start["name"], start["arguments"] = step["id"], step["name"], map[string]any{}
						args, _ := json.Marshal(step["arguments"])
						delta = map[string]any{"type": "arguments_delta", "arguments": string(args)}
					case "model_output":
						delta = map[string]any{"type": "text", "text": " 完成🌧\n"}
					}
					send(map[string]any{"event_type": "step.start", "index": i, "step": start})
					send(map[string]any{"event_type": "step.delta", "index": i, "delta": delta})
					if wantSummary && step["type"] == "thought" {
						send(map[string]any{"event_type": "step.delta", "index": i, "delta": map[string]any{"type": "thought_summary", "content": map[string]any{"type": "text", "text": " Need lookup🌧 "}}})
					}
					send(map[string]any{"event_type": "step.stop", "index": i})
				}
				send(map[string]any{"event_type": "interaction.completed", "interaction": terminal})
				_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
			}))
			t.Cleanup(server.Close)
			fixture := newManagedCloudScenarioTestFixture(t, "gemini", "gemini-4-argon", server.URL+"/v1beta/openai", Config{AllowLoopbackEndpoint: true})
			target, _ := structpb.NewStruct(map[string]any{"provider": "gemini", "providerModelId": "gemini-4-argon", "remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId()})
			config := appAIConfig("app.argon", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "gemini", DriverId: "nimillm", DriverDialect: "gemini"}, ConnectorRef: fixture.connectorID, ProviderModelTarget: target}}})
			if err := overwriteAIConfigStoreForTest(context.Background(), fixture.service.aiConfigStore, "user-001", config); err != nil {
				t.Fatal(err)
			}
			step := func(input *runtimev1.StreamLocalAppTextTurnRequest) []*runtimev1.TextOutputItem {
				t.Helper()
				operation, capability := accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute
				if stream {
					operation, capability = accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream
				}
				ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.argon", RegisteredAppSubject: "app-subject-argon", Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
				if !stream {
					r, err := fixture.service.ExecuteLocalAppScenario(ctx, &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
					if err != nil {
						t.Fatal(err)
					}
					return r.GetTextGenerate().GetItems()
				}
				events := &mockLocalAppTextTurnStream{ctx: ctx}
				if err := fixture.service.StreamLocalAppTextTurn(input, events); err != nil {
					t.Fatal(err)
				}
				var items []*runtimev1.TextOutputItem
				completed := false
				for _, event := range events.events {
					switch {
					case event.GetReasoningContinuity() != nil:
						if int(event.GetReasoningContinuity().GetItemIndex()) != len(items) {
							t.Fatal("continuity index collision")
						}
						items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: event.GetReasoningContinuity().GetCarrier()}})
					case event.GetReasoningSummary() != nil:
						if !event.GetReasoningSummary().GetItemCompleted() || int(event.GetReasoningSummary().GetItemIndex()) != len(items) {
							t.Fatal("summary not complete or unordered")
						}
						items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummary{Text: event.GetReasoningSummary().GetText()}}})
					case event.GetToolCall() != nil:
						items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: event.GetToolCall().GetToolCall()}})
					case event.GetDelta() != nil:
						if event.GetDelta().GetText() != "" {
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: event.GetDelta().GetText()}}})
						}
					case event.GetCompleted() != nil:
						completed = true
					case event.GetFailed() != nil:
						t.Fatalf("stream failed=%v", event.GetFailed())
					}
				}
				if !completed {
					t.Fatal("missing complete event")
				}
				return items
			}
			input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use lookup."}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}}}
			carrierIndex := 0
			if wantSummary {
				input.Reasoning.Presentation = runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY
				carrierIndex = 1
			}
			first := step(input)
			if len(first) != 2+carrierIndex || first[carrierIndex].GetReasoningContinuity() == nil || first[carrierIndex+1].GetToolCall().GetId() != "call-1" {
				t.Fatalf("first=%v", first)
			}
			if wantSummary && first[0].GetReasoningSummary().GetText() != " Need lookup🌧 " {
				t.Fatal("public summary lost")
			}
			turn := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
			for _, item := range first {
				turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
			}
			turn.TurnItems = append(turn.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup", Result: structpb.NewStringValue(" complete\n🌧 ")}}})
			input.Messages = append(input.Messages, turn)
			input.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
			second := step(input)
			if len(second) != 1 || second[0].GetText().GetText() != " 完成🌧\n" || requests.Load() != 2 {
				t.Fatalf("second=%v calls=%d", second, requests.Load())
			}
		})
	}
}
