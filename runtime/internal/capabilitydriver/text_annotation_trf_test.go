package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	runtimecatalog "github.com/nimiplatform/nimi/runtime/catalog"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"gopkg.in/yaml.v3"
)

func transformerBindingFixture(t *testing.T, language, name string) ModelAssetBindingInput {
	t.Helper()
	raw, err := runtimecatalog.DefaultProvidersFS.ReadFile("providers/local.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Models []struct {
			ModelID  string `yaml:"model_id"`
			Variants []struct {
				Files  []string          `yaml:"files"`
				Hashes map[string]string `yaml:"hashes"`
			} `yaml:"variants"`
		} `yaml:"models"`
	}
	if err := yaml.Unmarshal(raw, &catalog); err != nil {
		t.Fatal(err)
	}
	modelID := "asset-nlp-spacy-" + language + "-" + strings.ReplaceAll(name, "_", "-") + "-3.8.0"
	for _, row := range catalog.Models {
		if row.ModelID != modelID {
			continue
		}
		variant := row.Variants[0]
		ordered := append([]string(nil), variant.Files...)
		sort.Strings(ordered)
		hasher := sha256.New()
		for _, file := range ordered {
			digest, err := hex.DecodeString(strings.TrimPrefix(variant.Hashes[file], "sha256:"))
			if err != nil || len(digest) != 32 {
				t.Fatalf("catalog hash %q: %v", file, err)
			}
			hasher.Write(digest)
		}
		config, err := os.ReadFile(filepath.Join("testdata", "spacy-curated-trf", language, "config.cfg"))
		if err != nil {
			t.Fatal(err)
		}
		metadata, _ := json.Marshal(map[string]string{"lang": language, "name": name, "version": "3.8.0"})
		recipe := "spacy-trf-" + language
		requirements, reason := (SpacyTrfDriver{}).ProjectRecipe(recipe, nil, nil)
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
			t.Fatalf("recipe projection: %v", reason)
		}
		entry := ModelAssetFileFact{RelativePath: "config.cfg", SizeBytes: int64(len(config)), FormatProbe: config}
		files := make([]ModelAssetFileFact, 0, len(variant.Files))
		for _, file := range variant.Files {
			fact := ModelAssetFileFact{RelativePath: file, SizeBytes: 1}
			if file == "config.cfg" {
				fact = entry
			}
			if file == "meta.json" {
				fact.SizeBytes, fact.FormatProbe = int64(len(metadata)), metadata
			}
			files = append(files, fact)
		}
		return ModelAssetBindingInput{RecipeID: recipe, Requirement: requirements[0], Entry: entry, Files: files,
			Binding: &runtimev1.ModelAssetExactBinding{RequirementId: SpacyModelSlot, ModelAssetId: modelID, VerifiedContentId: "sha256:" + hex.EncodeToString(hasher.Sum(nil)), EntrySha256: strings.TrimPrefix(variant.Hashes["config.cfg"], "sha256:")}}
	}
	t.Fatalf("catalog model %q missing", modelID)
	return ModelAssetBindingInput{}
}

func TestCuratedTransformerModelContractsMatchExactCatalogAndLanguageLayouts(t *testing.T) {
	for _, tc := range []struct{ language, name, required string }{
		{"en", "core_web_trf", "ner/model"},
		{"de", "dep_news_trf", "morphologizer/model"},
		{"zh", "core_web_trf", "tokenizer/pkuseg_model/weights.npz"},
	} {
		t.Run(tc.language, func(t *testing.T) {
			input := transformerBindingFixture(t, tc.language, tc.name)
			driver := SpacyTrfDriver{}
			projection, reason := driver.ProjectModelAssetBinding(input)
			if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || string(projection.Descriptor.FormatProbe) != tc.language {
				t.Fatalf("official catalog contract rejected: %v", reason)
			}
			if tc.language == "de" {
				for _, file := range input.Files {
					if file.RelativePath == "ner/model" {
						t.Fatal("German fixture invented NER")
					}
				}
			}
			missing := input
			missing.Files = nil
			for _, file := range input.Files {
				if file.RelativePath != tc.required {
					missing.Files = append(missing.Files, file)
				}
			}
			if _, reason := driver.ProjectModelAssetBinding(missing); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
				t.Fatalf("missing required component accepted: %v", reason)
			}
			old := input
			old.Files = append([]ModelAssetFileFact(nil), input.Files...)
			for index := range old.Files {
				if old.Files[index].RelativePath == "meta.json" {
					old.Files[index].FormatProbe = []byte(`{"lang":"` + tc.language + `","name":"` + tc.name + `","version":"3.7.2"}`)
				}
			}
			if _, reason := driver.ProjectModelAssetBinding(old); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
				t.Fatalf("3.7 metadata accepted with the same config: %v", reason)
			}
			changed := input
			changed.Files = append([]ModelAssetFileFact(nil), input.Files...)
			for index := range changed.Files {
				if changed.Files[index].RelativePath == "config.cfg" {
					changed.Files[index].FormatProbe = []byte(strings.Repeat("x", len(changed.Files[index].FormatProbe)))
				}
			}
			if _, reason := driver.ProjectModelAssetBinding(changed); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
				t.Fatalf("modified config accepted: %v", reason)
			}
		})
	}
}

func TestCuratedTransformerDoesNotSelectAnotherLanguageOrMediumModel(t *testing.T) {
	driver := SpacyTrfDriver{}
	for _, recipe := range []string{"spacy-trf-fr", "spacy-trf-ja", "spacy-md-de"} {
		if _, reason := driver.ProjectRecipe(recipe, nil, nil); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
			t.Fatalf("unadmitted recipe %q: %v", recipe, reason)
		}
	}
	input := transformerBindingFixture(t, "de", "dep_news_trf")
	requirements, _ := driver.ProjectRecipe(SpacyTrfChineseRecipeID, nil, nil)
	input.RecipeID, input.Requirement = SpacyTrfChineseRecipeID, requirements[0]
	if _, reason := driver.ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("German model entered Chinese recipe: %v", reason)
	}
}

func TestCuratedTransformerPlansRetainTheCapturedLanguageAndCPUProfile(t *testing.T) {
	for _, language := range []string{"en", "de", "zh"} {
		request := &runtimev1.TextAnnotateScenarioSpec{Language: language, Texts: []string{"one document"}}
		input := TextAnnotationInvocationInput{RecipeID: "spacy-trf-" + language, Request: request,
			Bindings: []InvocationExactBinding{{RequirementID: SpacyModelSlot}},
			DependencySources: []InvocationExactDependencySource{{DependencyFamily: "python.package-set", ConsumerScope: SpacyTrfConsumerID,
				CanonicalRoot: t.TempDir(), SelectedSourceRecordID: "exact-profile", Version: "profile-digest",
				Hashes: map[string]string{"profile_digest": "profile-digest", "driver_bundle_sha256": "driver-digest"}}}}
		plan, err := (SpacyTrfDriver{}).PlanTextAnnotationInvocation(input)
		if err != nil || plan.Request.GetLanguage() != language || plan.ProfileConsumerID != SpacyTrfConsumerID {
			t.Fatalf("language/profile plan = %+v %v", plan, err)
		}
		request.Language = "unsupported"
		if plan.Request.GetLanguage() != language {
			t.Fatal("captured request changed with caller state")
		}
		if _, err := (SpacyTrfDriver{}).PlanTextAnnotationInvocation(input); err == nil {
			t.Fatal("request language selected another pipeline")
		}
	}
}
