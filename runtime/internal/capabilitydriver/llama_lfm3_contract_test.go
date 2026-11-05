package capabilitydriver

import (
	"bytes"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLFM3ExactContentGateProtectsPinnedEngine(t *testing.T) {
	driver := LlamaTextDriver{}
	requirements, reason := driver.ProjectRecipe(LlamaLFM3RecipeID, nil, nil)
	if reason != success || len(requirements) != 1 {
		t.Fatalf("recipe %v %v", requirements, reason)
	}
	// These interpreted facts represent the preceding bounded GGUF probe. This
	// unit tests the independent content boundary, not a real model execution.
	probe, err := encodeLlamaGGUFProbe(llamaGGUFProbe{Schema: llamaGGUFProbeSchema, RecipeID: LlamaLFM3RecipeID, RequirementID: MainGGUFRequirementID, Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Architecture: "lfm3", ContextWindow: 262144, TemplateIdentity: LFM3Q4TemplateIdentity})
	if err != nil {
		t.Fatal(err)
	}
	input := ModelAssetBindingInput{RecipeID: LlamaLFM3RecipeID, Requirement: requirements[0], Binding: &runtimev1.ModelAssetExactBinding{RequirementId: MainGGUFRequirementID, ModelAssetId: "lfm3", VerifiedContentId: LFM3Q4ContentID, EntrySha256: strings.TrimPrefix(LFM3Q4ContentID, "sha256:")}, Entry: ModelAssetFileFact{RelativePath: "model.gguf", SizeBytes: 1099627808, FormatProbe: probe}}
	projected, reason := driver.ProjectModelAssetBinding(input)
	if reason != success || projected.ModelContextWindowTokens != 262144 || projected.TemplateIdentity != LFM3Q4TemplateIdentity {
		t.Fatalf("projection %v %v", projected, reason)
	}
	// A structurally identical, separately quantized file cannot inherit this
	// reviewed base path merely because llama.cpp recognizes its architecture.
	input.Binding.VerifiedContentId = "sha256:" + strings.Repeat("a", 64)
	input.Binding.EntrySha256 = strings.Repeat("a", 64)
	if _, reason := driver.ProjectModelAssetBinding(input); reason == success {
		t.Fatal("unreviewed quantization inherited LFM3 support")
	}
	if _, reason := driver.ProjectRecipe(LlamaLFM3RecipeID, nil, []string{"input.image"}); reason == success {
		t.Fatal("text-only LFM3 acquired vision")
	}
	if _, reason := driver.ProjectRecipeForHost(LlamaLFM3RecipeID, nil, nil, "darwin/arm64"); reason == success {
		t.Fatal("unverified host admitted")
	}
	truncated := boundedLLMGGUFProbeWithTruncatedTokenizer(t, "lfm3", 262144)
	if _, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RecipeID: LlamaLFM3RecipeID, RequirementID: MainGGUFRequirementID, RelativePath: "model.gguf", Entry: true}, bytes.NewReader(truncated), int64(len(truncated))); err == nil {
		t.Fatal("truncated LFM3 contract admitted")
	}
}
