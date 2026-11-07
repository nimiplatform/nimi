package ai

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestVolcengineProtectedAppNativeTextToolsSchemaAndOwnedImage(t *testing.T) {
	for _, model := range capabilitydriver.VolcengineTextModels() {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%v", model, stream), func(t *testing.T) {
				p, _ := capabilitydriver.NewVolcengineTextBehavior(model)
				var imageBytes bytes.Buffer
				_ = png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 16, 16)))
				calls := 0
				replay := "  native state 原文\r\n😀  "
				summary := "Checked the lookup result."
				field := "reasoning_content"
				if p.EncryptedReasoning() {
					field = "encrypted_content"
				}
				f, decision := nativeReasoningAppFixture(t, "volcengine", model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					if r.URL.Path != "/proxy/api/v3/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" || body["model"] != model || body["stream"] != stream {
						t.Errorf("transport %s %v", r.URL.Path, body)
					}
					if body["max_completion_tokens"] != float64(1024) || body["max_tokens"] != nil {
						t.Error("output cap changed", body)
					}
					messages := body["messages"].([]any)
					if p.Vision() {
						parts := messages[0].(map[string]any)["content"].([]any)
						if parts[1].(map[string]any)["image_url"].(map[string]any)["url"] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(imageBytes.Bytes()) {
							t.Error("owned image changed")
						}
					}
					if calls == 2 {
						a := messages[1].(map[string]any)
						if len(messages) != 3 || messages[2].(map[string]any)["tool_call_id"] != "call-1" {
							t.Error("tool correlation lost")
						}
						if p.HasThinking() && a[field] != replay {
							t.Error("native carrier lost")
						}
						if p.EncryptedReasoning() && a["reasoning_content"] != nil {
							t.Error("summary replayed as original thinking")
						}
					}
					if calls == 3 {
						format := body["response_format"].(map[string]any)
						if format["type"] != "json_schema" || format["json_schema"].(map[string]any)["strict"] != true || body["tools"] != nil {
							t.Error("native schema altered")
						}
					}
					message := map[string]any{"role": "assistant", "content": `{"answer":19}`}
					finish := "stop"
					if p.HasThinking() {
						message[field] = replay
					}
					if p.EncryptedReasoning() {
						message["reasoning_content"] = summary
					}
					if calls == 1 {
						message["content"] = ""
						finish = "tool_calls"
						message["tool_calls"] = []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}}
					}
					usage := map[string]any{"prompt_tokens": 11, "completion_tokens": 17}
					if !stream {
						w.Header().Set("Content-Type", "application/json")
						_ = json.NewEncoder(w).Encode(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finish}}, "usage": usage})
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					emit := func(delta map[string]any, finish any, usage any) {
						raw, _ := json.Marshal(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}, "usage": usage})
						fmt.Fprintf(w, "data: %s\n\n", raw)
					}
					if p.EncryptedReasoning() {
						emit(map[string]any{"reasoning_content": summary}, nil, nil)
					}
					if p.HasThinking() {
						emit(map[string]any{field: replay}, nil, nil)
					}
					delta := map[string]any{"content": message["content"]}
					if tc, ok := message["tool_calls"].([]any); ok {
						tc[0].(map[string]any)["index"] = 0
						delta["tool_calls"] = tc
					}
					emit(delta, finish, usage)
					fmt.Fprint(w, "data: [DONE]\n\n")
				})
				parts := []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Use lookup for Beijing; answer with JSON after receiving its result."}}}
				if p.Vision() {
					a, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: imageBytes.Bytes(), MimeType: "image/png"})
					if err != nil {
						t.Fatal(err)
					}
					parts = append(parts, &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: a.ArtifactId, MimeType: "image/png"}}})
				}
				input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: parts}}, MaxTokens: proto.Int32(1024)}
				if p.EncryptedReasoning() {
					input.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}
				}
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}, "additionalProperties": false})
				input.Tools = []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}
				step := func() []*runtimev1.TextOutputItem {
					t.Helper()
					if !stream {
						result, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
						if err != nil {
							t.Fatal(err)
						}
						return result.GetTextGenerate().GetItems()
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
						case e.GetReasoningSummary() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummary{Text: e.GetReasoningSummary().GetText()}}})
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
					t.Fatal("missing completion")
					return nil
				}
				first := step()
				offset := 0
				if p.EncryptedReasoning() {
					if first[0].GetReasoningSummary().GetText() != summary {
						t.Fatal("native summary absent")
					}
					offset++
				}
				if p.HasThinking() {
					var actual string
					_ = json.Unmarshal(first[offset].GetReasoningContinuity().GetPayload(), &actual)
					if actual != replay {
						t.Fatal("native state changed")
					}
					offset++
				}
				if len(first) != offset+1 {
					t.Fatal(first)
				}
				assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup", Result: structpb.NewNumberValue(19)}}})
				input.Messages = append(input.Messages, assistant)
				second := step()
				if second[len(second)-1].GetText().GetText() != `{"answer":19}` {
					t.Fatal(second)
				}
				if p.Schema() {
					input.Messages = input.Messages[:1]
					input.Tools = nil
					schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
					input.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, SchemaName: "answer", JsonSchema: schema}
					third := step()
					if third[len(third)-1].GetText().GetText() != `{"answer":19}` || calls != 3 {
						t.Fatal(third, calls)
					}
				}
			})
		}
	}
}
