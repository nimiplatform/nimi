package ai

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestXAIProtectedTextUsesNativeResponsesAndOwnedImageToolRoundTrip(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(map[bool]string{false: "sync", true: "stream"}[stream], func(t *testing.T) {
			calls := 0
			source := l1CarrierPNGBytes(t)
			f, decision := nativeReasoningAppFixture(t, "xai", capabilitydriver.XAIGrok47Model, func(w http.ResponseWriter, r *http.Request) {
				calls++
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if r.URL.Path != "/v1/responses" || body["model"] != capabilitydriver.XAIGrok47Model || body["stream"] != true || body["store"] != false || body["max_output_tokens"] != nil {
					t.Errorf("wrong xAI transport: %s %+v", r.URL.Path, body)
				}
				tool := body["tools"].([]any)[0].(map[string]any)
				if tool["strict"] != true || tool["parameters"].(map[string]any)["additionalProperties"] != true {
					t.Error("native schema defaults changed")
				}
				input := body["input"].([]any)
				if calls == 1 {
					parts := input[0].(map[string]any)["content"].([]any)
					if len(parts) != 2 || parts[1].(map[string]any)["image_url"] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(source) {
						t.Error("owned source lost")
					}
				} else if len(input) != 4 || input[1].(map[string]any)["encrypted_content"] != "opaque-xai" || input[2].(map[string]any)["call_id"] != "original-call" || input[3].(map[string]any)["call_id"] != "original-call" {
					t.Error("native reasoning/tool correlation lost")
				}
				output := []map[string]any{{"type": "reasoning", "id": "reasoning", "encrypted_content": "opaque-xai", "summary": []any{}}}
				if calls == 1 {
					output = append(output, openAIResponsesCall("call-item", "original-call", `{"city":"北京"}`))
				} else {
					output = append(output, openAIResponsesText("answer", `{"answer":19}`))
				}
				writeAzureResponses(t, w, capabilitydriver.XAIGrok47Model, output)
			})
			uploaded, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: source, MimeType: "image/png"})
			if err != nil {
				t.Fatal(err)
			}
			schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}})
			responseSchema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
			request := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{
				{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Use lookup"}},
				{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: uploaded.ArtifactId, MimeType: "image/png"}}},
			}}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, JsonSchema: responseSchema}}
			step := func(input *runtimev1.StreamLocalAppTextTurnRequest) []*runtimev1.TextOutputItem {
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
				for _, event := range events.events {
					switch {
					case event.GetReasoningContinuity() != nil:
						items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: event.GetReasoningContinuity().GetCarrier()}})
					case event.GetToolCall() != nil:
						items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: event.GetToolCall().GetToolCall()}})
					case event.GetDelta() != nil:
						if event.GetDelta().GetText() != "" {
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: event.GetDelta().GetText()}}})
						}
					case event.GetFailed() != nil:
						t.Fatal(event.GetFailed())
					case event.GetCompleted() != nil:
						return items
					}
				}
				t.Fatal("native completion missing")
				return nil
			}
			first := step(request)
			if len(first) != 2 || first[0].GetReasoningContinuity().GetKind() != "xai.grok-4.7.responses.encrypted-reasoning" || first[1].GetToolCall().GetId() != "original-call" {
				t.Fatal(first)
			}
			assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
			for _, item := range first {
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
			}
			assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "original-call", ToolName: "lookup", Result: structpb.NewNumberValue(19)}}})
			request.Messages = append(request.Messages, assistant)
			second := step(request)
			if calls != 2 || len(second) != 2 || second[1].GetText().GetText() != `{"answer":19}` {
				t.Fatalf("round trip %v calls=%d", second, calls)
			}
			first[0].GetReasoningContinuity().Kind = capabilitydriver.OpenAIResponsesContinuityKind
			_, err = f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: request}})
			if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID || calls != 2 {
				t.Fatalf("foreign carrier dispatched: %v calls=%d", err, calls)
			}
		})
	}
}
