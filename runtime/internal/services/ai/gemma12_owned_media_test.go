package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/proto"
)

func TestGemma412BPublicOwnedAudioAndVideoCapture(t *testing.T) {
	for _, tc := range []struct {
		mime, kind string
		payload    []byte
	}{
		{"audio/wav", "input_audio", mediaBudgetTestWAV()},
		// Minimal container envelopes test custody and byte projection only;
		// they are not a codec or real model acceptance fixture.
		{"video/mp4", "input_video", []byte("\x00\x00\x00\x10ftypisom0000\x00\x00\x00\x09moovx\x00\x00\x00\x09mdatx")},
	} {
		t.Run(tc.mime, func(t *testing.T) {
			svc := newTestService(nil)
			if err := overwriteAIConfigStoreForTest(context.Background(), svc.aiConfigStore, "account-1", appAIConfig("nimi.realm-persona-studio", localAppAIConfigIntent("text.generate"))); err != nil {
				t.Fatal(err)
			}
			selected := selectedTextExecutionForTest(t, "gemma12", "model.gguf")
			selected.RecipeID = capabilitydriver.LlamaGemma412BRecipeID
			selected.ModelContextWindowTokens = 262144
			selected.ExactBindings[0].VerifiedContentID = capabilitydriver.Gemma412BQ4ContentID
			selected.ExactBindings[0].EntrySHA256 = strings.TrimPrefix(capabilitydriver.Gemma412BQ4ContentID, "sha256:")
			selected.ExactBindings[0].TemplateIdentity = capabilitydriver.Gemma412BTemplateIdentity
			selected.ExactBindings = append(selected.ExactBindings, localexecution.ExactBinding{RequirementID: capabilitydriver.CompanionMMProjRequirementID, ModelAssetID: "projector", AbsolutePath: filepath.Join(t.TempDir(), "mmproj.gguf"), VerifiedContentID: capabilitydriver.Gemma412BProjectorContentID, EntrySHA256: strings.TrimPrefix(capabilitydriver.Gemma412BProjectorContentID, "sha256:")})
			selected.Requirements = append(selected.Requirements, &runtimev1.LocalCapabilityRequirement{RequirementId: capabilitydriver.CompanionMMProjRequirementID})
			selected.ImplementationSupportedFeatures = []string{"input.image", "input.audio", "input.video"}
			selected.ConfiguredFeatures = selected.ImplementationSupportedFeatures
			codecRoot := t.TempDir()
			selected.ExactDependencySources = []localexecution.ExactDependencySource{{DependencyFamily: "native-tool.media-codec", DependencyID: "ffmpeg.codec", ConsumerScope: "media-codec", CanonicalRoot: codecRoot, Version: "test", SelectedSourceRecordID: "test-codec"}}
			resolver := &mutableLocalExecutionResolver{projection: selected}
			svc.SetLocalExecutionResolver(resolver)
			host := &localTextHostStub{result: localexecution.TextResult{Text: "test transport result", FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}}
			svc.SetLocalTextExecutionHost(host)
			uploaded, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{Bytes: tc.payload, MimeType: tc.mime})
			if err != nil {
				t.Fatal(err)
			}
			input := &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{artifactRefPart(&runtimev1.ChatContentArtifactRef{ArtifactId: uploaded.ArtifactId, MimeType: tc.mime})}}}}
			request := &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: input}}
			if _, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), request); err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			if err := json.Unmarshal(host.capturedBody, &body); err != nil {
				t.Fatal(err)
			}
			parts := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
			if got := parts[0].(map[string]any)[tc.kind].(map[string]any)["data"]; got != base64.StdEncoding.EncodeToString(tc.payload) {
				t.Fatal("owned media bytes changed")
			}
			if !strings.Contains(strings.Join(host.capturedArgs, "|"), "--video-ffmpeg-dir|"+filepath.Join(codecRoot, "bin")) {
				t.Fatal("managed codec was not captured")
			}
			wrong := proto.Clone(request).(*runtimev1.ExecuteLocalAppScenarioRequest)
			wrong.GetTextGenerate().Messages[0].Role = "assistant"
			if _, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), wrong); err == nil {
				t.Fatal("assistant media admitted")
			}
			selected.ExactBindings = selected.ExactBindings[:1]
			selected.ConfiguredFeatures = nil
			resolver.set(selected)
			if _, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), request); err == nil {
				t.Fatal("media without projector admitted")
			}
		})
	}
}
