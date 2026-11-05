package ai

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestMiniMaxProtectedAppNativeDefaultAndSignedReplay(t *testing.T) {
	for _, model := range []string{"MiniMax-M3.1-Flash", "MiniMax-M3"} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%v", model, stream), func(t *testing.T) {
				var calls atomic.Int32
				fixture, decision := nativeReasoningAppFixture(t, "minimax", model, func(w http.ResponseWriter, r *http.Request) {
					n := calls.Add(1)
					var body map[string]any
					if json.NewDecoder(r.Body).Decode(&body) != nil {
						t.Error("request JSON")
						return
					}
					if r.URL.Path != "/anthropic/v1/messages" || r.Header.Get("Authorization") != "Bearer test-key" || body["model"] != model || body["stream"] != stream || body["thinking"].(map[string]any)["type"] != "adaptive" || body["output_config"] != nil {
						t.Errorf("wrong native default or transport: %s %v", r.URL.Path, body)
					}
					blocks := []map[string]any{{"type": "thinking", "thinking": "  native 原文\n ", "signature": "original-sig"}}
					stop := "tool_use"
					if n == 1 {
						blocks = append(blocks, map[string]any{"type": "tool_use", "id": "native-call", "name": "lookup", "input": map[string]any{"city": "Paris"}})
					} else {
						messages := body["messages"].([]any)
						thought := messages[1].(map[string]any)["content"].([]any)[0].(map[string]any)
						result := messages[2].(map[string]any)["content"].([]any)[0].(map[string]any)
						if thought["thinking"] != "  native 原文\n " || thought["signature"] != "original-sig" || result["tool_use_id"] != "native-call" || result["content"] != "tool result" {
							t.Error("native replay or host result changed")
						}
						blocks = append(blocks, map[string]any{"type": "text", "text": "Final answer."})
						stop = "end_turn"
					}
					message := map[string]any{"type": "message", "role": "assistant", "model": model, "content": blocks, "stop_reason": stop}
					if !stream {
						_ = json.NewEncoder(w).Encode(message)
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					send := func(value any) { data, _ := json.Marshal(value); _, _ = fmt.Fprintf(w, "data: %s\n\n", data) }
					send(map[string]any{"type": "message_start", "message": map[string]any{"type": "message", "role": "assistant", "model": model, "content": []any{}}})
					for i, block := range blocks {
						send(map[string]any{"type": "content_block_start", "index": i, "content_block": block})
						send(map[string]any{"type": "content_block_stop", "index": i})
					}
					send(map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": stop}})
					send(map[string]any{"type": "message_stop"})
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
					complete := false
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
							t.Fatal("raw thinking became summary")
						case e.GetFailed() != nil:
							t.Fatalf("failed=%v", e.GetFailed())
						case e.GetCompleted() != nil:
							complete = true
						}
					}
					if !complete {
						t.Fatal("missing native terminal")
					}
					return items
				}
				schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"}, "additionalProperties": false})
				input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use lookup for Paris."}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}}}
				first := step(input)
				if len(first) != 2 || first[0].GetReasoningContinuity().GetKind() != "minimax.messages.native-reasoning-replay."+model || first[1].GetToolCall().GetId() != "native-call" {
					t.Fatalf("first=%v", first)
				}
				assistant := &runtimev1.LocalAppTextCandidateMessage{Role: "assistant"}
				for _, item := range first {
					assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: item}})
				}
				assistant.TurnItems = append(assistant.TurnItems, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "native-call", ToolName: "lookup", Result: structpb.NewStringValue("tool result")}}})
				input.Messages = append(input.Messages, assistant)
				last := step(input)
				if len(last) != 2 || last[1].GetText().GetText() != "Final answer." || calls.Load() != 2 {
					t.Fatalf("last=%v calls=%d", last, calls.Load())
				}
			})
		}
	}
}

func TestMiniMaxProtectedOwnedImageAndVideoKeepBytesAndOwner(t *testing.T) {
	image := l1CarrierPNGBytes(t)
	video := []byte("\x00\x00\x00\x10ftypisom0000\x00\x00\x00\x09moovx\x00\x00\x00\x09mdatx")
	var calls atomic.Int32
	fixture, decision := nativeReasoningAppFixture(t, "minimax", "MiniMax-M3", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		parts := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
		for i, want := range []struct {
			kind, mime string
			data       []byte
		}{{"image", "image/png", image}, {"video", "video/mp4", video}} {
			part := parts[i].(map[string]any)
			source := part["source"].(map[string]any)
			if part["type"] != want.kind || source["media_type"] != want.mime || source["data"] != base64.StdEncoding.EncodeToString(want.data) {
				t.Error("captured media changed")
			}
		}
		_, _ = fmt.Fprint(w, `{"type":"message","role":"assistant","model":"MiniMax-M3","content":[{"type":"text","text":"Media received."}],"stop_reason":"end_turn"}`)
	})
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user"}}}
	for _, media := range []struct {
		mime string
		data []byte
	}{{"image/png", image}, {"video/mp4", video}} {
		uploaded, err := fixture.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: media.data, MimeType: media.mime})
		if err != nil {
			t.Fatal(err)
		}
		input.Messages[0].Parts = append(input.Messages[0].Parts, &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: uploaded.ArtifactId, MimeType: media.mime}}})
	}
	execute := func() (*runtimev1.ExecuteLocalAppScenarioResponse, error) {
		return fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
	}
	r, err := execute()
	if err != nil || r.GetTextGenerate().GetItems()[0].GetText().GetText() != "Media received." {
		t.Fatalf("media=%v %v", r, err)
	}
	input.Messages[0].Parts[1].GetArtifactRef().ArtifactId = "missing"
	if _, err := execute(); err == nil || calls.Load() != 1 {
		t.Fatal("unknown owned video dispatched")
	}
}
