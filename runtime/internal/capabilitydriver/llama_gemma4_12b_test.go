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
	for i, want := range []string{Gemma412BQ4ContentID, Gemma412BProjectorContentID} {
		facts := llamaGGUFProbe{Schema: llamaGGUFProbeSchema, RecipeID: LlamaGemma412BRecipeID, RequirementID: requirements[i].RequirementId, Architecture: "clip", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY}
		if i == 0 {
			facts.Architecture = "gemma4"
			facts.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
			facts.ContextWindow = 262144
			facts.TemplateIdentity = Gemma412BTemplateIdentity
		}
		probe, err := encodeLlamaGGUFProbe(facts)
		if err != nil {
			t.Fatal(err)
		}
		input := ModelAssetBindingInput{RecipeID: LlamaGemma412BRecipeID, Requirement: requirements[i], Binding: &runtimev1.ModelAssetExactBinding{RequirementId: requirements[i].RequirementId, ModelAssetId: "selected", VerifiedContentId: want, EntrySha256: strings.TrimPrefix(want, "sha256:")}, Entry: ModelAssetFileFact{RelativePath: "selected.gguf", SizeBytes: 100, FormatProbe: probe}}
		if _, reason := driver.ProjectModelAssetBinding(input); reason != success {
			t.Fatal(reason)
		}
		input.Binding.VerifiedContentId = Gemma426BProjectorContentID
		input.Binding.EntrySha256 = strings.TrimPrefix(Gemma426BProjectorContentID, "sha256:")
		if _, reason := driver.ProjectModelAssetBinding(input); reason == success {
			t.Fatal("older content inherited unified support")
		}
	}
	if _, reason := driver.ProjectRecipe(LlamaGemma4RecipeID, nil, []string{"input.audio"}); reason == success {
		t.Fatal("older Gemma acquired audio")
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
