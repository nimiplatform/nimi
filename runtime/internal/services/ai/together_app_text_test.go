package ai

import (
	"encoding/base64"
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

func TestTogetherProtectedAppNativeReplayImagesAndStrictSchema(t *testing.T) {
	for _, model := range capabilitydriver.TogetherTextModels() {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%v", model, stream), func(t *testing.T) {
				p, _ := capabilitydriver.NewTogetherTextBehavior(model)
				image := l1CarrierPNGBytes(t)
				calls := 0
				reasoningKey := "reasoning_content"
				if strings.HasPrefix(model, "deepseek-ai/") {
					reasoningKey = "reasoning"
				}
				reasoning := "  native reasoning 原文\r\n😀  "
				f, decision := nativeReasoningAppFixture(t, "together", model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					if r.URL.Path != "/proxy/openai/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" || body["model"] != model || body["stream"] != stream || body["max_tokens"] != float64(4096) || body["context_length_exceeded_behavior"] != "error" || body["reasoning_effort"] != nil || body["reasoning_history"] != nil {
						t.Errorf("wrong native transport %s %v", r.URL.Path, body)
					}
					messages := body["messages"].([]any)
					if p.Vision() {
						parts := messages[0].(map[string]any)["content"].([]any)
						if parts[1].(map[string]any)["image_url"].(map[string]any)["url"] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(image) {
							t.Error("owned image altered")
						}
					}
					if calls == 2 {
						if len(messages) != 4 || messages[1].(map[string]any)[reasoningKey] != reasoning || messages[2].(map[string]any)["tool_call_id"] != "call-1" || messages[3].(map[string]any)["tool_call_id"] != "call-2" {
							t.Error("native replay or function correlation lost")
						}
					}
					if calls == 3 {
						format := body["response_format"].(map[string]any)
						if format["type"] != "json_schema" || format["json_schema"].(map[string]any)["name"] != "answer" || body["tools"] != nil {
							t.Error("independent native structured request changed")
						}
					}
					message := map[string]any{"role": "assistant", reasoningKey: reasoning, "content": `{"answer":19}`}
					finish := "stop"
					if calls == 1 {
						message["content"] = ""
						finish = "tool_calls"
						message["tool_calls"] = []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}, map[string]any{"id": "call-2", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"上海"}`}}}
					}
					usage := map[string]any{"prompt_tokens": 11, "completion_tokens": 17}
					if !stream {
						w.Header().Set("Content-Type", "application/json")
						_ = json.NewEncoder(w).Encode(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finish}}, "usage": usage})
						return
					}
					if body["stream_options"].(map[string]any)["include_usage"] != true {
						t.Error("final native usage not requested")
					}
					w.Header().Set("Content-Type", "text/event-stream")
					emit := func(v any) { data, _ := json.Marshal(v); _, _ = fmt.Fprintf(w, "data: %s\n\n", data) }
					emit(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{reasoningKey: "  native reasoning "}}}})
					emit(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{reasoningKey: "原文\r\n😀  "}}}})
					delta := map[string]any{"content": message["content"]}
					if calls == 1 {
						tc := message["tool_calls"].([]any)
						for i, call := range tc {
							call.(map[string]any)["index"] = i
						}
						delta["tool_calls"] = tc
					}
					emit(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}})
					emit(map[string]any{"choices": []any{}, "usage": usage})
					_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
				})
				parts := []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Use lookup for Beijing and Shanghai. Return JSON after the tool results."}}}
				if p.Vision() {
					a, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: image, MimeType: "image/png"})
					if err != nil {
						t.Fatal(err)
					}
					parts = append(parts, &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: a.ArtifactId, MimeType: "image/png"}}})
				}
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}, "additionalProperties": false})
				request := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: parts}}, MaxTokens: proto.Int32(4096), Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}}
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
					var items []*runtimev1.TextOutputItem
					for _, e := range events.events {
						switch {
						case e.GetReasoningContinuity() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: e.GetReasoningContinuity().GetCarrier()}})
						case e.GetToolCall() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: e.GetToolCall().GetToolCall()}})
						case e.GetDelta() != nil:
							if text := e.GetDelta().GetText(); text != "" {
								items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: text}}})
							}
						case e.GetReasoningSummary() != nil:
							t.Fatal("raw thought projected as summary")
						case e.GetFailed() != nil:
							t.Fatal(e.GetFailed())
						case e.GetCompleted() != nil:
							return items
						}
					}
					t.Fatal("missing completion")
					return nil
				}
				first := step(request)
				if len(first) != 3 {
					t.Fatal(first)
				}
				var native struct {
					Field string `json:"field"`
					Text  string `json:"text"`
				}
				if err := json.Unmarshal(first[0].GetReasoningContinuity().GetPayload(), &native); err != nil || native.Text != reasoning || native.Field != reasoningKey {
					t.Fatal("replay bytes changed", err)
				}
				assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				for _, id := range []string{"call-1", "call-2"} {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: id, ToolName: "lookup", Result: structpb.NewNumberValue(19)}}})
				}
				request.Messages = append(request.Messages, assistant)
				second := step(request)
				if len(second) != 2 || second[1].GetText().GetText() != `{"answer":19}` {
					t.Fatal(second)
				}
				request.Messages = request.Messages[:1]
				request.Tools = nil
				out, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
				request.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, SchemaName: "answer", JsonSchema: out}
				third := step(request)
				if calls != 3 || len(third) != 2 || third[1].GetText().GetText() != `{"answer":19}` {
					t.Fatal(third, calls)
				}
			})
		}
	}
}
