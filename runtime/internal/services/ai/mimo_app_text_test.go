package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
)

func TestMimoProtectedOwnedImageAudioAndSubjectFence(t *testing.T) {
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 32, 32))); err != nil {
		t.Fatal(err)
	}
	pngBytes, wav := imageBytes.Bytes(), mediaBudgetTestWAV()
	var calls atomic.Int32
	fixture, decision := nativeReasoningAppFixture(t, "mimo", "mimo-v2.6-pro", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		parts := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
		if len(parts) != 3 || parts[1].(map[string]any)["image_url"].(map[string]any)["url"] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(pngBytes) || parts[2].(map[string]any)["input_audio"].(map[string]any)["data"] != "data:audio/wav;base64,"+base64.StdEncoding.EncodeToString(wav) {
			t.Error("owned media bytes or ordering changed")
		}
		_, _ = fmt.Fprint(w, `{"choices":[{"index":0,"message":{"content":"Observed content."},"finish_reason":"stop"}]}`)
	})
	parts := []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT, Content: &runtimev1.ChatContentPart_Text{Text: "Describe both inputs"}}}
	for _, asset := range []struct {
		mime  string
		bytes []byte
	}{{"image/png", pngBytes}, {"audio/wav", wav}} {
		uploaded, err := fixture.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: asset.bytes, MimeType: asset.mime})
		if err != nil {
			t.Fatal(err)
		}
		parts = append(parts, &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: uploaded.ArtifactId, MimeType: asset.mime}}})
	}
	input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: parts}}}
	execute := func(s *runtimev1.StreamLocalAppTextTurnRequest) (*runtimev1.ExecuteLocalAppScenarioResponse, error) {
		return fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: s}})
	}
	result, err := execute(input)
	if err != nil || len(result.GetTextGenerate().GetItems()) != 1 || result.GetTextGenerate().GetItems()[0].GetText().GetText() != "Observed content." {
		t.Fatalf("owned media: %v %v", result, err)
	}
	foreignCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.glm53", RegisteredAppSubject: "other-subject", Operation: accountservice.LocalAppOperationArtifactUpload, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDArtifactUpload})
	foreign, err := fixture.service.UploadLocalAppArtifact(foreignCtx, &runtimev1.UploadLocalAppArtifactRequest{Bytes: wav, MimeType: "audio/wav"})
	if err != nil {
		t.Fatal(err)
	}
	bad := proto.Clone(input).(*runtimev1.StreamLocalAppTextTurnRequest)
	bad.Messages[0].Parts[2].GetArtifactRef().ArtifactId = foreign.ArtifactId
	if _, err = execute(bad); err == nil || calls.Load() != 1 {
		t.Fatalf("foreign media dispatched: %v", err)
	}
}
