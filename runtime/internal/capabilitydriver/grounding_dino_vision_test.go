package capabilitydriver

import (
	"encoding/json"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"strings"
	"testing"
)

func groundingDinoTestProbe(t *testing.T, width int) []byte {
	t.Helper()
	facts := map[string]map[string]any{}
	boxHead := "bbox_embed.0.layers.0.weight"
	if width == 128 {
		boxHead = "model.decoder.bbox_embed.0.layers.0.weight"
	}
	for name, shape := range map[string][]int{
		"model.backbone.conv_encoder.model.embeddings.patch_embeddings.projection.weight": {width, 3, 4, 4},
		"model.text_backbone.embeddings.word_embeddings.weight":                           {30522, 768},
		"model.decoder.layers.0.fc1.weight":                                               {2048, 256},
		boxHead:                                                                           {256, 256},
	} {
		facts[name] = map[string]any{"dtype": "F32", "shape": shape, "data_offsets": []int{0, 16}}
	}
	raw, err := json.Marshal(facts)
	if err != nil {
		t.Fatal(err)
	}
	return safetensorsProbeForTest(raw)
}

func groundingDinoBindingFixture(t *testing.T, base bool) (ModelAssetBindingInput, map[string]any) {
	t.Helper()
	requirements, reason := (GroundingDinoDriver{}).ProjectRecipeForHost(GroundingDinoRecipeID, nil, nil, "windows/amd64")
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	embed := 96
	backbone := map[string]any{"model_type": "swin", "depths": []int{2, 2, 6, 2}, "num_heads": []int{3, 6, 12, 24}}
	if base {
		embed = 128
		backbone = map[string]any{"model_type": "swin", "embed_dim": 128, "window_size": 12, "depths": []int{2, 2, 18, 2}, "num_heads": []int{4, 8, 16, 32}}
	}
	config := map[string]any{"model_type": "grounding-dino", "architectures": []string{"GroundingDinoForObjectDetection"}, "d_model": 256, "backbone_config": backbone, "text_config": map[string]any{"model_type": "bert"}, "decoder_bbox_embed_share": true}
	entry := ModelAssetFileFact{RelativePath: "model.safetensors", SizeBytes: 64, FormatProbe: groundingDinoTestProbe(t, embed)}
	digest := strings.Repeat("a", 64)
	input := ModelAssetBindingInput{RecipeID: GroundingDinoRecipeID, Requirement: requirements[0], Entry: entry, Binding: &runtimev1.ModelAssetExactBinding{RequirementId: GroundingDinoModelSlot, ModelAssetId: "model", VerifiedContentId: "sha256:" + digest, EntrySha256: digest}, Files: []ModelAssetFileFact{entry}}
	vocab := make(map[string]int, 30522)
	lines := make([]string, 30522)
	specialIDs := map[int]string{0: "[PAD]", 100: "[UNK]", 101: "[CLS]", 102: "[SEP]", 103: "[MASK]"}
	for id := range lines {
		token := fmt.Sprintf("word-%d", id)
		if specialIDs[id] != "" {
			token = specialIDs[id]
		}
		lines[id], vocab[token] = token, id
	}
	added := make([]map[string]any, 0, 5)
	decoder := make(map[string]any)
	addedMap := make(map[string]int)
	for id, content := range specialIDs {
		added = append(added, map[string]any{"id": id, "content": content, "special": true})
		decoder[fmt.Sprint(id)] = map[string]any{"content": content, "special": true}
		addedMap[content] = id
	}
	tokens := map[string]any{"tokenizer_class": "BertTokenizer", "processor_class": "GroundingDinoProcessor", "added_tokens_decoder": decoder, "pad_token": "[PAD]", "unk_token": "[UNK]", "cls_token": "[CLS]", "sep_token": "[SEP]", "mask_token": "[MASK]"}
	groundingDinoSetJSONFact(t, &input, "config.json", config)
	groundingDinoSetJSONFact(t, &input, "preprocessor_config.json", map[string]any{"image_processor_type": "GroundingDinoImageProcessor"})
	groundingDinoSetJSONFact(t, &input, "tokenizer_config.json", tokens)
	groundingDinoSetJSONFact(t, &input, "tokenizer.json", map[string]any{"model": map[string]any{"type": "WordPiece", "vocab": vocab}, "added_tokens": added})
	groundingDinoSetJSONFact(t, &input, "special_tokens_map.json", map[string]string{"pad_token": "[PAD]", "unk_token": "[UNK]", "cls_token": "[CLS]", "sep_token": "[SEP]", "mask_token": "[MASK]"})
	bytes := []byte(strings.Join(lines, "\n") + "\n")
	input.Files = append(input.Files, ModelAssetFileFact{RelativePath: "vocab.txt", SizeBytes: int64(len(bytes)), FormatProbe: bytes})
	if !base {
		groundingDinoSetJSONFact(t, &input, "added_tokens.json", addedMap)
	}
	return input, config
}

func groundingDinoSetJSONFact(t *testing.T, input *ModelAssetBindingInput, name string, value any) {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	fact := ModelAssetFileFact{RelativePath: name, SizeBytes: int64(len(encoded)), FormatProbe: encoded}
	for index := range input.Files {
		if input.Files[index].RelativePath == name {
			input.Files[index] = fact
			return
		}
	}
	input.Files = append(input.Files, fact)
}

func TestGroundingDinoV2AdmitsTinyDefaultsAndBaseStructureWithCompleteTokenizer(t *testing.T) {
	driver := GroundingDinoDriver{}
	for _, base := range []bool{false, true} {
		input, _ := groundingDinoBindingFixture(t, base)
		projection, reason := driver.ProjectModelAssetBinding(input)
		want := "grounding-dino-tiny"
		if base {
			want = "grounding-dino-base"
		}
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || projection.Descriptor.Family != want {
			t.Fatalf("base=%t projection=%+v reason=%v", base, projection, reason)
		}
	}
	if driver.SupportsGeometry(runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_POINT) || !driver.SupportsGeometry(runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_BOX) {
		t.Fatal("BOX only")
	}
	if _, reason := driver.ProjectRecipeForHost(GroundingDinoRecipeID, nil, nil, "darwin/arm64"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
		t.Fatal(reason)
	}
	if _, reason := driver.ProjectRecipe("grounding-dino-tiny.vision-locate.box-v1", nil, nil); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("retired v1 recipe admitted")
	}
}

func TestGroundingDinoV2RejectsConflictingConfigAndTensorFacts(t *testing.T) {
	for _, name := range []string{"remote-code", "dimension", "depth", "heads", "window", "null-default", "tensor-width", "bert-vocabulary", "timm", "pretrained", "backbone-override", "backbone-kwargs", "preprocessor-invalid", "processor-conflict", "image-processor-conflict", "unshared-box-alias"} {
		t.Run(name, func(t *testing.T) {
			input, config := groundingDinoBindingFixture(t, true)
			backbone := config["backbone_config"].(map[string]any)
			switch name {
			case "remote-code":
				config["auto_map"] = map[string]string{"AutoModel": "checkpoint.py"}
			case "dimension":
				config["d_model"] = 512
			case "depth":
				backbone["depths"] = []int{2, 2, 6, 2}
			case "heads":
				backbone["num_heads"] = []int{3, 6, 12, 24}
			case "window":
				backbone["window_size"] = 7
			case "null-default":
				backbone["embed_dim"] = nil
			case "bert-vocabulary":
				config["text_config"].(map[string]any)["vocab_size"] = 32000
			case "tensor-width":
				input.Entry.FormatProbe = groundingDinoTestProbe(t, 96)
			case "timm":
				config["use_timm_backbone"] = true
			case "pretrained":
				config["use_pretrained_backbone"] = true
			case "backbone-override":
				config["backbone"] = "another-backbone"
			case "backbone-kwargs":
				config["backbone_kwargs"] = map[string]any{"out_indices": []int{1, 2}}
			case "preprocessor-invalid":
				for index := range input.Files {
					if input.Files[index].RelativePath == "preprocessor_config.json" {
						input.Files[index].FormatProbe = []byte("{")
						input.Files[index].SizeBytes = 1
					}
				}
			case "processor-conflict":
				groundingDinoSetJSONFact(t, &input, "preprocessor_config.json", map[string]any{"processor_class": "OtherProcessor"})
			case "image-processor-conflict":
				groundingDinoSetJSONFact(t, &input, "preprocessor_config.json", map[string]any{"image_processor_type": "OtherImageProcessor"})
			case "unshared-box-alias":
				config["decoder_bbox_embed_share"] = false
			}
			groundingDinoSetJSONFact(t, &input, "config.json", config)
			if _, reason := (GroundingDinoDriver{}).ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
				t.Fatalf("%s admitted: %v", name, reason)
			}
		})
	}
}

func TestGroundingDinoV2RetainsBuiltinBackboneNullAndEmptyKwargs(t *testing.T) {
	for _, base := range []bool{false, true} {
		for _, kwargs := range []any{nil, map[string]any{}} {
			input, config := groundingDinoBindingFixture(t, base)
			config["backbone"], config["backbone_kwargs"] = nil, kwargs
			config["use_timm_backbone"], config["use_pretrained_backbone"] = false, false
			groundingDinoSetJSONFact(t, &input, "config.json", config)
			groundingDinoSetJSONFact(t, &input, "preprocessor_config.json", map[string]any{"processor_class": "GroundingDinoProcessor", "image_processor_type": "GroundingDinoImageProcessor"})
			if _, reason := (GroundingDinoDriver{}).ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
				t.Fatalf("base=%t kwargs=%v reason=%v", base, kwargs, reason)
			}
		}
	}
}

func TestGroundingDinoV2OptionalAddedTokensCannotChangeEmbeddingIdentity(t *testing.T) {
	input, _ := groundingDinoBindingFixture(t, true)
	groundingDinoSetJSONFact(t, &input, "added_tokens.json", map[string]int{"[CLS]": 101})
	if _, reason := (GroundingDinoDriver{}).ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	groundingDinoSetJSONFact(t, &input, "added_tokens.json", map[string]int{"[CLS]": 30522})
	if _, reason := (GroundingDinoDriver{}).ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatal("out-of-range extra token admitted", reason)
	}
	input, _ = groundingDinoBindingFixture(t, true)
	for index := range input.Files {
		if input.Files[index].RelativePath == "vocab.txt" {
			input.Files[index].FormatProbe = []byte(strings.Replace(string(input.Files[index].FormatProbe), "[CLS]", "different-cls", 1))
			input.Files[index].SizeBytes = int64(len(input.Files[index].FormatProbe))
		}
	}
	if _, reason := (GroundingDinoDriver{}).ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatal("vocabulary/embedding mismatch admitted", reason)
	}
}
