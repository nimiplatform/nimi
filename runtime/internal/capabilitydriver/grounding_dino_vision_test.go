package capabilitydriver

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestGroundingDinoTinyAdmitsOnlyItsBoxModelContract(t *testing.T) {
	driver := GroundingDinoDriver{}
	requirements, reason := driver.ProjectRecipeForHost(GroundingDinoRecipeID, nil, nil, "windows/amd64")
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("Grounding DINO recipe: %v", reason)
	}
	if driver.SupportsGeometry(runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_POINT) || !driver.SupportsGeometry(runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_BOX) {
		t.Fatal("Grounding DINO must admit only actual box output")
	}
	if _, reason := driver.ProjectRecipeForHost(GroundingDinoRecipeID, nil, nil, "darwin/arm64"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
		t.Fatalf("unverified host admitted: %v", reason)
	}
	probe := safetensorsProbeForTest([]byte(`{
		"model.backbone.conv_encoder.model.embeddings.patch_embeddings.projection.weight":{"dtype":"F32","shape":[96,3,4,4],"data_offsets":[0,16]},
		"model.text_backbone.embeddings.word_embeddings.weight":{"dtype":"F32","shape":[30522,768],"data_offsets":[16,32]},
		"model.decoder.layers.0.fc1.weight":{"dtype":"F32","shape":[2048,256],"data_offsets":[32,48]},
		"bbox_embed.0.layers.0.weight":{"dtype":"F32","shape":[256,256],"data_offsets":[48,64]}
	}`))
	digest := strings.Repeat("a", 64)
	entry := ModelAssetFileFact{RelativePath: "model.safetensors", SizeBytes: 64, FormatProbe: probe}
	config := map[string]any{
		"model_type": "grounding-dino", "architectures": []string{"GroundingDinoForObjectDetection"},
		"d_model": 256, "backbone_config": map[string]string{"model_type": "swin"},
		"text_config": map[string]string{"model_type": "bert"},
	}
	input := ModelAssetBindingInput{
		RecipeID: GroundingDinoRecipeID, Requirement: requirements[0], Entry: entry,
		Binding: &runtimev1.ModelAssetExactBinding{RequirementId: GroundingDinoModelSlot, ModelAssetId: "grounding-dino-tiny", VerifiedContentId: "sha256:" + digest, EntrySha256: digest},
		Files: []ModelAssetFileFact{
			entry,
			{RelativePath: "config.json", SizeBytes: 1},
			{RelativePath: "preprocessor_config.json", SizeBytes: 1},
			{RelativePath: "tokenizer_config.json", SizeBytes: 1},
			{RelativePath: "tokenizer.json", SizeBytes: 1},
			{RelativePath: "vocab.txt", SizeBytes: 1},
			{RelativePath: "special_tokens_map.json", SizeBytes: 1},
			{RelativePath: "added_tokens.json", SizeBytes: 1},
		},
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
		t.Fatalf("exact tiny checkpoint rejected: %v", reason)
	}
	config["auto_map"] = map[string]string{"AutoModel": "checkpoint.py"}
	if reason := check(); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("checkpoint-selected code admitted: %v", reason)
	}
	delete(config, "auto_map")
	config["d_model"] = 512
	if reason := check(); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("different model shape admitted: %v", reason)
	}
}
