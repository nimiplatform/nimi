package capabilitydriver

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestGemma412BExactMainAndUnifiedProjectorRemainSeparateFromOlderGemma(t *testing.T) {
	driver := LlamaTextDriver{}
	requirements, reason := driver.ProjectRecipe(LlamaGemma412BRecipeID, nil, []string{"input.image", "input.audio", "input.video"})
	if reason != success || len(requirements) != 2 || len(requirements[1].ConditionalFeatures) != 3 {
		t.Fatalf("unified slots: %v %v", requirements, reason)
	}
	mainSHA := strings.Repeat("a", 64)
	projSHA := strings.Repeat("b", 64)
	for i, sha := range []string{mainSHA, projSHA} {
		facts := llamaGGUFProbe{
			Schema: llamaGGUFProbeSchema, RecipeID: LlamaGemma412BRecipeID, RequirementID: requirements[i].RequirementId,
			Architecture: "clip", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
			ProjectorType: "gemma4uv", AudioProjectorType: "gemma4ua", VisionProjectionDim: 3840, AudioProjectionDim: 3840,
		}
		if i == 0 {
			facts = llamaGGUFProbe{
				Schema: llamaGGUFProbeSchema, RecipeID: LlamaGemma412BRecipeID, RequirementID: requirements[i].RequirementId,
				Architecture: "gemma4", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
				ContextWindow: 262144, EmbeddingLength: 3840, TemplateIdentity: Gemma412BTemplateIdentity,
			}
		}
		probe, err := encodeLlamaGGUFProbe(facts)
		if err != nil {
			t.Fatal(err)
		}
		input := ModelAssetBindingInput{RecipeID: LlamaGemma412BRecipeID, Requirement: requirements[i], Binding: &runtimev1.ModelAssetExactBinding{RequirementId: requirements[i].RequirementId, ModelAssetId: "selected", VerifiedContentId: "sha256:" + sha, EntrySha256: sha}, Entry: ModelAssetFileFact{RelativePath: "selected.gguf", SizeBytes: 100, FormatProbe: probe}}
		if _, reason := driver.ProjectModelAssetBinding(input); reason != success {
			t.Fatal(reason)
		}
		if i == 1 {
			nonUnified := facts
			nonUnified.ProjectorType = "gemma4v"
			nonUnified.AudioProjectorType = ""
			nonUnifiedProbe, _ := encodeLlamaGGUFProbe(nonUnified)
			input.Entry.FormatProbe = nonUnifiedProbe
			if _, reason := driver.ProjectModelAssetBinding(input); reason == success {
				t.Fatal("non-unified projector inherited unified support")
			}
		}
	}
	if _, reason := driver.ProjectRecipe(LlamaGenericGGUFRecipeID, nil, []string{"input.audio"}); reason == success {
		t.Fatal("standard GGUF recipe acquired audio")
	}
	if _, reason := driver.ProjectRecipeForHost(LlamaGemma412BRecipeID, nil, nil, "darwin/arm64"); reason == success {
		t.Fatal("unverified platform admitted")
	}
	for _, url := range []string{"https://example.com/audio.wav", "file:///etc/passwd", "data:audio/wav;base64,???"} {
		p := &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL, Content: &runtimev1.ChatContentPart_AudioUrl{AudioUrl: url}}
		if _, err := llamaInlineAVPart(p); err == nil {
			t.Fatal("unowned or invalid AV source admitted")
		}
	}
	if _, err := llamaCapturedVideoCodecDirectory(nil); err == nil {
		t.Fatal("missing codec fell back to PATH")
	}
}
