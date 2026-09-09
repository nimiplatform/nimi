package capabilitydriver

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLocateMLXModelContractRejectsCheckpointCodeSelection(t *testing.T) {
	driver := LocateAnythingDriver{}
	requirements, reason := driver.ProjectRecipeForHost(LocateAnythingRecipeID, nil, nil, "darwin/arm64")
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("Locate recipe: %v", reason)
	}
	probe := safetensorsProbeForTest([]byte(`{
		"language_model.weight":{"dtype":"F16","shape":[1],"data_offsets":[0,2]},
		"vision_tower.weight":{"dtype":"F16","shape":[1],"data_offsets":[2,4]},
		"multi_modal_projector.weight":{"dtype":"F16","shape":[1],"data_offsets":[4,6]}
	}`))
	digest := strings.Repeat("a", 64)
	entry := ModelAssetFileFact{RelativePath: "model.safetensors", SizeBytes: 6, FormatProbe: probe}
	input := ModelAssetBindingInput{
		RecipeID: LocateAnythingRecipeID, Requirement: requirements[0], Entry: entry,
		Binding: &runtimev1.ModelAssetExactBinding{RequirementId: LocateAnythingModelSlot, ModelAssetId: "imported-locate", VerifiedContentId: "sha256:" + digest, EntrySha256: digest},
		Files: []ModelAssetFileFact{
			entry,
			{RelativePath: "config.json", SizeBytes: 1},
			{RelativePath: "tokenizer.json", SizeBytes: 2, FormatProbe: []byte(`{}`)},
			{RelativePath: "tokenizer_config.json", SizeBytes: 2, FormatProbe: []byte(`{}`)},
			{RelativePath: "preprocessor_config.json", SizeBytes: 2, FormatProbe: []byte(`{}`)},
			{RelativePath: "checkpoint.py", SizeBytes: 20},
		},
	}
	config := map[string]any{
		"model_type": "locateanything", "architectures": []string{"LocateAnythingForConditionalGeneration"},
		"text_config":   map[string]int{"hidden_size": 2048, "vocab_size": 152681},
		"vision_config": map[string]int{"hidden_size": 1152, "patch_size": 14},
	}
	check := func() runtimev1.LocalCapabilityReason {
		t.Helper()
		encoded, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		input.Files[1].FormatProbe, input.Files[1].SizeBytes = encoded, int64(len(encoded))
		_, reason := driver.ProjectModelAssetBinding(input)
		return reason
	}
	if reason := check(); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("unreferenced Python content rejected: %v", reason)
	}
	for _, value := range []any{"checkpoint.py", "", nil} {
		config["model_file"] = value
		if reason := check(); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
			t.Fatalf("model_file=%v: got %v", value, reason)
		}
	}
}
