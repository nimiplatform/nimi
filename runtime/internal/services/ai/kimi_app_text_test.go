package ai

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestKimiK3ProtectedToolsSchemaAndOwnedMedia(t *testing.T) {
	codec := os.Getenv("NIMI_TEST_FFMPEG_DIR")
	if codec == "" {
		t.Skip("exact engineering codec fixture not supplied")
	}
	encoder := filepath.Join(codec, "ffmpeg")
	if runtime.GOOS == "windows" {
		encoder += ".exe"
	}
	videoPath := filepath.Join(t.TempDir(), "owned-video.mp4")
	if output, err := exec.Command(encoder, "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=2", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath).CombinedOutput(); err != nil {
		t.Fatalf("video codec fixture %v %s", err, output)
	}
	video, err := os.ReadFile(videoPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, model := range []string{"kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k3"} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%t", model, stream), func(t *testing.T) {
				calls := 0
				image := l1CarrierPNGBytes(t)
				f, decision := nativeReasoningAppFixture(t, "kimi", model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var body map[string]any
					json.NewDecoder(r.Body).Decode(&body)
					if r.URL.Path != "/v1/chat/completions" || body["model"] != model || body["thinking"] != nil || body["reasoning_effort"] != "max" || body["max_tokens"] != nil || body["max_completion_tokens"] != float64(256) || body["stream"] != stream {
						t.Errorf("native K3 request %+v", body)
					}
					messages := body["messages"].([]any)
					if calls == 1 {
						content := messages[0].(map[string]any)["content"].([]any)
						if len(content) != 3 || content[1].(map[string]any)["image_url"].(map[string]any)["url"] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(image) || content[2].(map[string]any)["video_url"].(map[string]any)["url"] != "data:video/mp4;base64,"+base64.StdEncoding.EncodeToString(video) {
							t.Error("owned media bytes or sequence changed")
						}
					} else if len(messages) != 3 || messages[1].(map[string]any)["reasoning_content"] != "native thinking" || messages[2].(map[string]any)["tool_call_id"] != "original-call" {
						t.Error("preserved reasoning/tool replay lost")
					}
					var message map[string]any
					finish := "stop"
					if calls == 1 {
						message = map[string]any{"role": "assistant", "content": "", "reasoning_content": "native thinking", "tool_calls": []any{map[string]any{"id": "original-call", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}}}
						finish = "tool_calls"
					} else {
						message = map[string]any{"role": "assistant", "content": `{"answer":19}`, "reasoning_content": "native next thinking"}
					}
					if !stream {
						w.Header().Set("Content-Type", "application/json")
						json.NewEncoder(w).Encode(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": finish}}, "usage": map[string]any{"prompt_tokens": 3, "completion_tokens": 7, "total_tokens": 10}})
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					emit := func(value any) { data, _ := json.Marshal(value); fmt.Fprintf(w, "data: %s\n\n", data) }
					emit(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"reasoning_content": message["reasoning_content"]}, "finish_reason": nil}}})
					delta := map[string]any{"content": message["content"]}
					if calls == 1 {
						delta["tool_calls"] = []any{map[string]any{"index": 0, "id": "original-call", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}}
					}
					emit(map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}})
					emit(map[string]any{"choices": []any{}, "usage": map[string]any{"prompt_tokens": 3, "completion_tokens": 7, "total_tokens": 10}})
					fmt.Fprint(w, "data: [DONE]\n\n")
				})
				parts := []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Use lookup"}}}
				for _, item := range []struct {
					mime string
					data []byte
				}{{"image/png", image}, {"video/mp4", video}} {
					uploaded, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: item.data, MimeType: item.mime})
					if err != nil {
						t.Fatal(err)
					}
					parts = append(parts, &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: uploaded.ArtifactId, MimeType: item.mime}}})
				}
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}})
				outputSchema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
				max := int32(256)
				request := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: parts}}, MaxTokens: &max, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, JsonSchema: outputSchema}}
				step := func(input *runtimev1.StreamLocalAppTextTurnRequest) []*runtimev1.TextOutputItem {
					t.Helper()
					if !stream {
						response, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
						if err != nil {
							t.Fatal(err)
						}
						return response.GetTextGenerate().GetItems()
					}
					events := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
					if err := f.service.StreamLocalAppTextTurn(input, events); err != nil {
						t.Fatal(err)
					}
					var result []*runtimev1.TextOutputItem
					for _, event := range events.events {
						switch {
						case event.GetReasoningContinuity() != nil:
							result = append(result, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: event.GetReasoningContinuity().GetCarrier()}})
						case event.GetToolCall() != nil:
							result = append(result, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: event.GetToolCall().GetToolCall()}})
						case event.GetDelta() != nil:
							if event.GetDelta().GetText() != "" {
								result = append(result, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: event.GetDelta().GetText()}}})
							}
						case event.GetFailed() != nil:
							t.Fatal(event.GetFailed())
						case event.GetCompleted() != nil:
							return result
						}
					}
					t.Fatal("no native completion")
					return nil
				}
				first := step(request)
				if len(first) != 2 || first[0].GetReasoningContinuity().GetKind() != "kimi.chat.native-reasoning-replay."+model || first[1].GetToolCall().GetId() != "original-call" {
					t.Fatal(first)
				}
				assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "original-call", ToolName: "lookup", Result: structpb.NewNumberValue(19)}}})
				request.Messages = append(request.Messages, assistant)
				second := step(request)
				if len(second) != 2 || second[1].GetText().GetText() != `{"answer":19}` || calls != 2 {
					t.Fatal(second, calls)
				}
				first[0].GetReasoningContinuity().Kind = "kimi.chat.native-reasoning-replay.some-other-model"
				_, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: request}})
				if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID || calls != 2 {
					t.Fatal("cross-model replay accepted", err)
				}
			})
		}
	}
}
