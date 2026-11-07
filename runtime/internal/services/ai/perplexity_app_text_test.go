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

func writePerplexityResponse(t *testing.T, w http.ResponseWriter, model string, output []map[string]any) {
	t.Helper()
	w.Header().Set("Content-Type", "text/event-stream")
	sequence := 0
	emit := func(e map[string]any) {
		e["sequence_number"] = sequence
		sequence++
		data, err := json.Marshal(e)
		if err != nil {
			t.Error(err)
			return
		}
		_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
	}
	emit(map[string]any{"type": "response.created", "response": map[string]any{"id": "response-native", "model": model, "status": "in_progress"}})
	emit(map[string]any{"type": "response.reasoning.started", "thought": "PRIVATE THOUGHT NEVER ANSWER"})
	emit(map[string]any{"type": "response.reasoning.stopped", "thought": "PRIVATE THOUGHT NEVER SUMMARY"})
	for i, item := range output {
		emit(map[string]any{"type": "response.output_item.added", "output_index": i, "item": item})
		if item["type"] == "message" {
			text := item["content"].([]any)[0].(map[string]any)["text"].(string)
			emit(map[string]any{"type": "response.output_text.delta", "output_index": i, "content_index": 0, "item_id": item["id"], "delta": text})
		}
		emit(map[string]any{"type": "response.output_item.done", "output_index": i, "item": item})
	}
	emit(map[string]any{"type": "response.completed", "response": map[string]any{"id": "response-native", "model": model, "status": "completed", "output": output, "usage": map[string]any{"input_tokens": 11, "output_tokens": 17, "total_tokens": 28}}})
}

func TestPerplexityProtectedAppAgentToolsSchemaAndOwnedImages(t *testing.T) {
	for _, model := range capabilitydriver.PerplexityTextModels() {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%v", model, stream), func(t *testing.T) {
				p, _ := capabilitydriver.NewPerplexityTextBehavior(model)
				image := l1CarrierPNGBytes(t)
				calls := 0
				f, decision := nativeReasoningAppFixture(t, "perplexity", model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					if r.URL.Path != "/v1/agent" || r.Header.Get("Authorization") != "Bearer test-key" || body["model"] != model || body["stream"] != true || body["store"] != false || body["max_steps"] != float64(1) || body["max_output_tokens"] != float64(256) {
						t.Errorf("native Agent request %s %v", r.URL.Path, body)
					}
					for _, key := range []string{"previous_response_id", "include", "parallel_tool_calls", "background", "effort", "models", "skills", "text"} {
						if body[key] != nil {
							t.Error("unrequested option", key)
						}
					}
					input := body["input"].([]any)
					if p.Vision() {
						parts := input[0].(map[string]any)["content"].([]any)
						if parts[1].(map[string]any)["image_url"] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(image) {
							t.Error("owned image changed")
						}
					}
					if calls == 1 {
						item := map[string]any{"type": "function_call", "id": "item-original", "call_id": "call-original", "name": "lookup", "arguments": `{"city":"北京"}`, "status": "completed"}
						if strings.HasPrefix(model, "google/") {
							item["thought_signature"] = "c2lnbmF0dXJl"
						}
						writePerplexityResponse(t, w, model, []map[string]any{item})
						return
					}
					if calls == 2 {
						if len(input) != 3 || input[1].(map[string]any)["call_id"] != "call-original" || input[2].(map[string]any)["call_id"] != "call-original" {
							t.Error("function correlation lost")
						}
						if strings.HasPrefix(model, "google/") && input[1].(map[string]any)["thought_signature"] != "c2lnbmF0dXJl" {
							t.Error("native signature lost")
						}
					}
					if calls == 3 {
						if body["response_format"].(map[string]any)["json_schema"].(map[string]any)["strict"] != true || len(body["tools"].([]any)) != 0 || body["tool_choice"] != "none" {
							t.Error("schema or disabled provider tools missing")
						}
					}
					writePerplexityResponse(t, w, model, []map[string]any{{"type": "message", "id": "answer", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": `{"answer":19}`}}}})
				})
				parts := []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Use lookup."}}}
				if p.Vision() {
					a, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: image, MimeType: "image/png"})
					if err != nil {
						t.Fatal(err)
					}
					parts = append(parts, &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: a.ArtifactId, MimeType: "image/png"}}})
				}
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}, "additionalProperties": false})
				request := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: parts}}, MaxTokens: proto.Int32(256), Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}}
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
					for _, event := range events.events {
						switch {
						case event.GetReasoningContinuity() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: event.GetReasoningContinuity().GetCarrier()}})
						case event.GetToolCall() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: event.GetToolCall().GetToolCall()}})
						case event.GetDelta() != nil:
							if text := event.GetDelta().GetText(); text != "" {
								items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: text}}})
							}
						case event.GetReasoningSummary() != nil:
							t.Fatal("raw thought leaked")
						case event.GetFailed() != nil:
							t.Fatal(event.GetFailed())
						case event.GetCompleted() != nil:
							return items
						}
					}
					t.Fatal("missing completion")
					return nil
				}
				first := step(request)
				want := 1
				if strings.HasPrefix(model, "google/") {
					want = 2
				}
				if len(first) != want || first[len(first)-1].GetToolCall().GetId() != "call-original" {
					t.Fatal(first)
				}
				assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-original", ToolName: "lookup", Result: structpb.NewNumberValue(19)}}})
				request.Messages = append(request.Messages, assistant)
				second := step(request)
				if len(second) != 1 || second[0].GetText().GetText() != `{"answer":19}` {
					t.Fatal(second)
				}
				request.Messages = request.Messages[:1]
				request.Tools = nil
				outSchema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
				request.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, SchemaName: "Result19", JsonSchema: outSchema}
				third := step(request)
				if calls != 3 || len(third) != 1 || third[0].GetText().GetText() != `{"answer":19}` {
					t.Fatal(third, calls)
				}
			})
		}
	}
}
