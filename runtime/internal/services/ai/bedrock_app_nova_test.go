package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func writeBedrockConverse(t *testing.T, w http.ResponseWriter, content []map[string]any, stop string, stream bool) {
	t.Helper()
	usage := map[string]int{"inputTokens": 10, "outputTokens": 20}
	if !stream {
		_ = json.NewEncoder(w).Encode(map[string]any{"output": map[string]any{"message": map[string]any{"role": "assistant", "content": content}}, "stopReason": stop, "usage": usage})
		return
	}
	w.Header().Set("Content-Type", "application/vnd.amazon.eventstream")
	write := func(kind string, value any) {
		payload, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if err := eventstream.NewEncoder().Encode(w, eventstream.Message{Headers: eventstream.Headers{{Name: ":message-type", Value: eventstream.StringValue("event")}, {Name: ":event-type", Value: eventstream.StringValue(kind)}}, Payload: payload}); err != nil {
			t.Error(err)
		}
	}
	write("messageStart", map[string]string{"role": "assistant"})
	for i, item := range content {
		var delta map[string]any
		if tool, ok := item["toolUse"].(map[string]any); ok {
			write("contentBlockStart", map[string]any{"contentBlockIndex": i, "start": map[string]any{"toolUse": map[string]any{"toolUseId": tool["toolUseId"], "name": tool["name"]}}})
			input, _ := json.Marshal(tool["input"])
			delta = map[string]any{"toolUse": map[string]string{"input": string(input)}}
		} else if item["reasoningContent"] != nil {
			delta = map[string]any{"reasoningContent": map[string]string{"text": "[REDACTED]"}}
		} else {
			delta = item
		}
		write("contentBlockDelta", map[string]any{"contentBlockIndex": i, "delta": delta})
		write("contentBlockStop", map[string]int{"contentBlockIndex": i})
	}
	write("messageStop", map[string]string{"stopReason": stop})
	write("metadata", map[string]any{"usage": usage})
}

func TestBedrockProtectedNovaConverseToolsAndOwnedImages(t *testing.T) {
	for _, model := range bedrockNovaTargets {
		for _, stream := range []bool{false, true} {
			t.Run(model+map[bool]string{false: "/sync", true: "/stream"}[stream], func(t *testing.T) {
				calls := 0
				source := l1CarrierPNGBytes(t)
				f, decision := bedrockAppFixture(t, model, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					path := "/model/us." + model + "/converse"
					if stream {
						path += "-stream"
					}
					if r.URL.Path != path || r.Header.Get("Authorization") != "Bearer test-key" || body["model"] != nil || body["stream"] != nil {
						t.Error("wrong native Converse transport", r.URL.Path, body)
					}
					messages := body["messages"].([]any)
					if model != "amazon.nova-micro-v1:0" {
						parts := messages[0].(map[string]any)["content"].([]any)
						if len(parts) != 2 || parts[1].(map[string]any)["image"].(map[string]any)["source"].(map[string]any)["bytes"] != base64.StdEncoding.EncodeToString(source) {
							t.Error("owned source changed")
						}
					}
					if calls == 1 {
						content := []map[string]any{}
						if model == "amazon.nova-2-lite-v1:0" {
							content = append(content, map[string]any{"reasoningContent": map[string]any{"reasoningText": map[string]string{"text": "[REDACTED]"}}})
						}
						content = append(content, map[string]any{"toolUse": map[string]any{"toolUseId": "original-call", "name": "lookup", "input": map[string]string{"query": "北京"}}})
						writeBedrockConverse(t, w, content, "tool_use", stream)
					} else {
						if len(messages) != 3 || messages[1].(map[string]any)["content"].([]any)[0].(map[string]any)["toolUse"].(map[string]any)["toolUseId"] != "original-call" || messages[2].(map[string]any)["content"].([]any)[0].(map[string]any)["toolResult"].(map[string]any)["toolUseId"] != "original-call" {
							t.Error("tool result correlation changed")
						}
						writeBedrockConverse(t, w, []map[string]any{{"text": "Result"}}, "end_turn", stream)
					}
				})
				parts := []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Look up Beijing"}}}
				if model != "amazon.nova-micro-v1:0" {
					uploaded, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: source, MimeType: "image/png"})
					if err != nil {
						t.Fatal(err)
					}
					parts = append(parts, &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: uploaded.ArtifactId, MimeType: "image/png"}}})
				}
				input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: parts}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}}
				if model == "amazon.nova-2-lite-v1:0" {
					input.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}}
				}
				step := func() []*runtimev1.TextOutputItem {
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
					items := []*runtimev1.TextOutputItem{}
					done := false
					for _, e := range events.events {
						switch {
						case e.GetToolCall() != nil:
							items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: e.GetToolCall().GetToolCall()}})
						case e.GetDelta() != nil:
							if e.GetDelta().GetText() != "" {
								items = append(items, &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: e.GetDelta().GetText()}}})
							}
						case e.GetReasoningContinuity() != nil:
							t.Fatal("Nova invented reasoning replay")
						case e.GetFailed() != nil:
							t.Fatal(e.GetFailed())
						case e.GetCompleted() != nil:
							done = true
						}
					}
					if !done {
						t.Fatal("missing native completion")
					}
					return items
				}
				first := step()
				if len(first) != 1 || first[0].GetToolCall().GetId() != "original-call" {
					t.Fatal(first)
				}
				input.Messages = append(input.Messages, &runtimev1.LocalAppTextCandidateMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: first[0]}}, {Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "original-call", ToolName: "lookup", Result: structpb.NewStringValue("found")}}}}})
				second := step()
				if len(second) != 1 || second[0].GetText().GetText() != "Result" || calls != 2 {
					t.Fatal(second, calls)
				}
			})
		}
	}
}

// This is a custody/wire test with a bounded container fixture, not evidence of
// model video understanding or a playable generated artifact.
func TestBedrockNovaOwnedVideoKeepsBytesAndRejectsAnotherSubject(t *testing.T) {
	video := []byte("\x00\x00\x00\x10ftypisom0000\x00\x00\x00\x09moovx\x00\x00\x00\x09mdatx")
	calls := 0
	f, decision := bedrockAppFixture(t, "amazon.nova-2-lite-v1:0", func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		part := body["messages"].([]any)[0].(map[string]any)["content"].([]any)[0].(map[string]any)["video"].(map[string]any)
		if part["format"] != "mp4" || part["source"].(map[string]any)["bytes"] != base64.StdEncoding.EncodeToString(video) {
			t.Error("owned video changed")
		}
		writeBedrockConverse(t, w, []map[string]any{{"text": "Media received."}}, "end_turn", false)
	})
	uploaded, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: video, MimeType: "video/mp4"})
	if err != nil {
		t.Fatal(err)
	}
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: uploaded.ArtifactId, MimeType: "video/mp4"}}}}}}}
	execute := func(in *runtimev1.StreamLocalAppTextTurnRequest) error {
		_, err := f.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: in}})
		return err
	}
	if err := execute(input); err != nil {
		t.Fatal(err)
	}
	foreignContext := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.bedrock", RegisteredAppSubject: "another-subject", Operation: accountservice.LocalAppOperationArtifactUpload, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDArtifactUpload})
	foreign, err := f.service.UploadLocalAppArtifact(foreignContext, &runtimev1.UploadLocalAppArtifactRequest{Bytes: video, MimeType: "video/mp4"})
	if err != nil {
		t.Fatal(err)
	}
	bad := proto.Clone(input).(*runtimev1.StreamLocalAppTextTurnRequest)
	bad.Messages[0].Parts[0].GetArtifactRef().ArtifactId = foreign.ArtifactId
	if err := execute(bad); err == nil || calls != 1 {
		t.Fatal("foreign subject media reached provider", err, calls)
	}
}
