package ai

import (
	"encoding/base64"
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

func TestGroqProtectedAppHiddenToolsOwnedImagesAndSeparateStrictSchema(t *testing.T) {
	for _, model := range []string{"openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "meta-models/muse-spark-open", "minimaxai/minimax-m2.7"} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%v", model, stream), func(t *testing.T) {
				calls := 0
				image := l1CarrierPNGBytes(t)
				vision := strings.HasPrefix(model, "qwen/") || strings.HasPrefix(model, "meta-models/")
				f, decision := nativeReasoningAppFixture(t, "groq", model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if r.URL.Path != "/proxy/openai/v1/chat/completions" || body["model"] != model || body["reasoning_format"] != "hidden" || body["max_completion_tokens"] != float64(256) {
						t.Errorf("native request %s %v", r.URL.Path, body)
					}
					messages := body["messages"].([]any)
					if vision {
						parts := messages[0].(map[string]any)["content"].([]any)
						if len(parts) != 2 || parts[1].(map[string]any)["image_url"].(map[string]any)["url"] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(image) {
							t.Error("owned PNG changed")
						}
					}
					if calls == 2 {
						if len(messages) != 3 || messages[2].(map[string]any)["tool_call_id"] != "original-call" || messages[1].(map[string]any)["reasoning_content"] != nil {
							t.Error("stateless hidden tool round-trip changed")
						}
					}
					if calls <= 2 && body["parallel_tool_calls"] != !strings.HasPrefix(model, "openai/") {
						t.Error("native parallel-tool control")
					}
					finish := "stop"
					message := map[string]any{"role": "assistant", "content": `{"answer":19}`, "reasoning": "PRIVATE NATIVE THOUGHT"}
					if calls == 1 {
						finish = "tool_calls"
						message["content"] = ""
						message["tool_calls"] = []any{map[string]any{"id": "original-call", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}}
					}
					if body["stream"] != true {
						w.Header().Set("Content-Type", "application/json")
						_ = json.NewEncoder(w).Encode(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finish}}, "usage": map[string]any{"prompt_tokens": 3, "completion_tokens": 7}})
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					emit := func(v any) { data, _ := json.Marshal(v); _, _ = fmt.Fprintf(w, "data: %s\n\n", data) }
					emit(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"reasoning": "PRIVATE NATIVE THOUGHT"}, "finish_reason": nil}}})
					delta := map[string]any{"content": message["content"]}
					if calls == 1 {
						delta["tool_calls"] = []any{map[string]any{"index": 0, "id": "original-call", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}}
					}
					emit(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}, "x_groq": map[string]any{"usage": map[string]any{"prompt_tokens": 3, "completion_tokens": 7}}})
					_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
				})
				parts := []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Use lookup, then return a JSON object."}}}
				if vision {
					a, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: image, MimeType: "image/png"})
					if err != nil {
						t.Fatal(err)
					}
					parts = append(parts, &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: a.ArtifactId, MimeType: "image/png"}}})
				}
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}, "additionalProperties": false})
				request := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: parts}}, MaxTokens: proto.Int32(256), Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}
				step := func(input *runtimev1.StreamLocalAppTextTurnRequest) []*runtimev1.TextOutputItem {
					t.Helper()
					if !stream {
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
					var out []*runtimev1.TextOutputItem
					for _, event := range events.events {
						switch {
						case event.GetReasoningContinuity() != nil:
							t.Fatal("hidden protocol fabricated replay")
						case event.GetToolCall() != nil:
							out = append(out, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: event.GetToolCall().GetToolCall()}})
						case event.GetDelta() != nil:
							if text := event.GetDelta().GetText(); text != "" {
								out = append(out, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: text}}})
							}
						case event.GetFailed() != nil:
							t.Fatal(event.GetFailed())
						case event.GetCompleted() != nil:
							return out
						}
					}
					t.Fatal("missing completion")
					return nil
				}
				first := step(request)
				if len(first) != 1 || first[0].GetToolCall().GetId() != "original-call" {
					t.Fatal(first)
				}
				request.Messages = append(request.Messages, &runtimev1.LocalAppTextCandidateMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: first[0]}}, {Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "original-call", ToolName: "lookup", Result: structpb.NewNumberValue(19)}}}}})
				second := step(request)
				if len(second) != 1 || second[0].GetText().GetText() != `{"answer":19}` || calls != 2 {
					t.Fatal(second, calls)
				}
				outputSchema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
				request.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, JsonSchema: outputSchema}
				if _, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: request}}); err == nil || calls != 2 {
					t.Fatal("unsupported active tools and strict schema reached provider")
				}
				// A new schema-only step does not replay tool history without its
				// required declarations or claim the unsupported combined mode.
				request.Tools = nil
				request.Messages = request.Messages[:1]
				strict, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: request}})
				if model == "minimaxai/minimax-m2.7" {
					if err == nil || calls != 2 {
						t.Fatal("unsupported MiniMax strict schema dispatched")
					}
				} else if err != nil || calls != 3 || len(strict.GetTextGenerate().GetItems()) != 1 || strict.GetTextGenerate().GetItems()[0].GetText().GetText() != `{"answer":19}` {
					t.Fatalf("separate strict step %v %v", strict, err)
				}
			})
		}
	}
}
