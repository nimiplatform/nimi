package ai

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
)

func TestDeepseekFlashPublicAppRejectsIgnoredSamplingBeforeDispatch(t *testing.T) {
	var calls atomic.Int32
	fixture, decision := deepseekAppFixture(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(500) })
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Reply with OK."}}, TopP: proto.Float32(.5)}
	_, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
	reason, _ := grpcerr.ExtractReasonCode(err)
	if reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || calls.Load() != 0 {
		t.Fatalf("ignored sampling rejection changed: reason=%v calls=%d error=%v", reason, calls.Load(), err)
	}
}

func TestDeepseekFlashPublicAppOwnedImageUsesCapturedNativeBytes(t *testing.T) {
	payload := l1CarrierPNGBytes(t)
	expected := "data:image/png;base64," + base64.StdEncoding.EncodeToString(payload)
	var calls atomic.Int32
	fixture, decision := deepseekAppFixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if r.URL.Path != "/v1/chat/completions" || body["model"] != "deepseek-flash" || body["thinking"].(map[string]any)["type"] != "disabled" {
			t.Error("wrong captured target or native protocol")
		}
		parts := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
		if len(parts) != 2 || parts[0].(map[string]any)["text"] != "Describe the diagram" || parts[1].(map[string]any)["image_url"].(map[string]any)["url"] != expected {
			t.Error("owned image bytes/order changed")
		}
		if body["stream"] == true {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"A small diagram.\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
		} else {
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"index": 0, "message": map[string]any{"content": "A small diagram."}, "finish_reason": "stop"}}})
		}
	})
	uploaded, err := fixture.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: payload, MimeType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Describe the diagram"}},
		{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: uploaded.ArtifactId, MimeType: "image/png"}}},
	}}}}
	response, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}})
	if err != nil || response.GetTextGenerate().GetItems()[0].GetText().GetText() != "A small diagram." {
		t.Fatalf("owned image: %v %v", response, err)
	}
	stream := &mockLocalAppTextTurnStream{ctx: decision(accountservice.LocalAppOperationTextTurnStream, localappop.AppOperationIDTextTurnStream)}
	if err := fixture.service.StreamLocalAppTextTurn(input, stream); err != nil {
		t.Fatal(err)
	}
	if len(stream.events) == 0 || stream.events[len(stream.events)-1].GetCompleted() == nil || calls.Load() != 2 {
		t.Fatalf("stream terminal missing: calls=%d", calls.Load())
	}
	wrong := proto.Clone(input).(*runtimev1.StreamLocalAppTextTurnRequest)
	wrong.Messages[0].Role = "assistant"
	if _, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: wrong}}); err == nil || calls.Load() != 2 {
		t.Fatal("assistant image dispatched")
	}
}
