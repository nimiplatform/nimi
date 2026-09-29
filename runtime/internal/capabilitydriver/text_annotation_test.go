package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func spacyBindingInputForTest(t *testing.T, language string, name string, tokenizerPath string) ModelAssetBindingInput {
	t.Helper()
	requirements, reason := (SpacyDriver{}).ProjectRecipe("spacy-md-"+language, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("project spacy-md-%s: %v", language, reason)
	}
	meta := []byte(`{"lang":"` + language + `","name":"` + name + `","version":"3.8.0"}`)
	entry := ModelAssetFileFact{RelativePath: "config.cfg", SizeBytes: 10}
	return ModelAssetBindingInput{
		RecipeID: "spacy-md-" + language, Requirement: requirements[0], Entry: entry,
		Binding: &runtimev1.ModelAssetExactBinding{RequirementId: SpacyModelSlot, ModelAssetId: "model-" + language, VerifiedContentId: "sha256:content", EntrySha256: "entry"},
		Files: []ModelAssetFileFact{
			entry,
			{RelativePath: "meta.json", SizeBytes: int64(len(meta)), FormatProbe: meta},
			{RelativePath: tokenizerPath, SizeBytes: 23},
			{RelativePath: "parser/model", SizeBytes: 30},
			{RelativePath: "tok2vec/model", SizeBytes: 40},
			{RelativePath: "vocab/strings.json", SizeBytes: 50},
		},
	}
}

// The official 3.8.0 Chinese and Japanese data directories serialize their
// tokenizer as tokenizer/cfg; every other admitted language ships one
// tokenizer file.
func TestSpacyBindingAcceptsEachOfficialTokenizerLayout(t *testing.T) {
	for _, testCase := range []struct {
		language, name, tokenizer string
	}{
		{"en", "core_web_md", "tokenizer"}, {"de", "core_news_md", "tokenizer"}, {"es", "core_news_md", "tokenizer"},
		{"fr", "core_news_md", "tokenizer"}, {"it", "core_news_md", "tokenizer"}, {"ru", "core_news_md", "tokenizer"},
		{"zh", "core_web_md", "tokenizer/cfg"}, {"ja", "core_news_md", "tokenizer/cfg"},
	} {
		projection, reason := (SpacyDriver{}).ProjectModelAssetBinding(spacyBindingInputForTest(t, testCase.language, testCase.name, testCase.tokenizer))
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || string(projection.Descriptor.FormatProbe) != testCase.language {
			t.Fatalf("%s official layout rejected: %v", testCase.language, reason)
		}
		other := "tokenizer/cfg"
		if testCase.tokenizer == other {
			other = "tokenizer"
		}
		if _, reason := (SpacyDriver{}).ProjectModelAssetBinding(spacyBindingInputForTest(t, testCase.language, testCase.name, other)); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
			t.Fatalf("%s accepted the other tokenizer layout: %v", testCase.language, reason)
		}
	}
}

func TestSpacyBindingRejectsWrongLanguageOrVersion(t *testing.T) {
	input := spacyBindingInputForTest(t, "de", "core_news_md", "tokenizer")
	input.RecipeID = "spacy-md-en"
	requirements, _ := (SpacyDriver{}).ProjectRecipe("spacy-md-en", nil, nil)
	input.Requirement = requirements[0]
	if _, reason := (SpacyDriver{}).ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("German pipeline bound to the English recipe: %v", reason)
	}
	input = spacyBindingInputForTest(t, "en", "core_web_md", "tokenizer")
	input.Files[1].FormatProbe = []byte(`{"lang":"en","name":"core_web_md","version":"3.7.1"}`)
	if _, reason := (SpacyDriver{}).ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("3.7.1 pipeline was admitted: %v", reason)
	}
}

func TestSpacyTransformerKeepsMediumModelOutOfItsLoadout(t *testing.T) {
	driver := SpacyTrfDriver{}
	requirements, reason := driver.ProjectRecipe(SpacyTrfRecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("project transformer recipe: %v", reason)
	}
	if requirements[0].GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT {
		t.Fatal("exact transformer model slot must be strict")
	}
	asset := ModelAssetDescriptor{
		ModelAssetID: "medium", VerifiedContentID: "sha256:medium", EntrySHA256: "medium-config",
		Kind:   runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
		Family: "spacy", ArtifactRoles: []string{"text_analysis_model"}, FormatProbe: []byte("en"),
	}
	binding := &runtimev1.ModelAssetExactBinding{RequirementId: SpacyModelSlot, ModelAssetId: asset.ModelAssetID, VerifiedContentId: asset.VerifiedContentID, EntrySha256: asset.EntrySHA256}
	if got := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{binding}, []ModelAssetDescriptor{asset}); got != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("medium model entered transformer loadout: %v", got)
	}
	asset.ModelAssetID, asset.VerifiedContentID, asset.EntrySHA256 = "transformer", spacyTrfModelContentID, spacyTrfConfigSHA256
	binding.ModelAssetId, binding.VerifiedContentId, binding.EntrySha256 = asset.ModelAssetID, asset.VerifiedContentID, asset.EntrySHA256
	if got := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{binding}, []ModelAssetDescriptor{asset}); got != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("exact transformer model rejected: %v", got)
	}
}
