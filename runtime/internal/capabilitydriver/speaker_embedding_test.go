package capabilitydriver

import (
	"encoding/json"
	"os"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func speakerModelFactsForTest() onnxModel {
	return onnxModel{IRVersion: 8, Inputs: []onnxTensor{{Name: "x", Type: 1, Shape: []int64{-1, -1, 80}}},
		Outputs: []onnxTensor{{Name: "embedding", Type: 1, Shape: []int64{-1, 512}}}, Opsets: map[string]uint64{"": 14},
		Metadata: map[string]string{"framework": "3d-speaker", "sample_rate": "16000", "normalize_samples": "1", "feature_normalize_type": "global-mean", "output_dim": "512"}}
}
func TestSpeakerModelContractRejectsOtherRepresentationAndContradictoryFacts(t *testing.T) {
	for _, change := range []func(*onnxModel){
		func(m *onnxModel) { m.Metadata["framework"] = "audio-semantic" },
		func(m *onnxModel) { m.Metadata["sample_rate"] = "24000" },
		func(m *onnxModel) { m.Metadata["normalize_samples"] = "0" },
		func(m *onnxModel) { m.Metadata["feature_normalize_type"] = "" },
		func(m *onnxModel) { m.Metadata["output_dim"] = "256" },
		func(m *onnxModel) { m.Inputs[0].Shape[2] = 64 },
		func(m *onnxModel) { m.NodeDomains = []string{"custom.code"} },
	} {
		model := speakerModelFactsForTest()
		change(&model)
		data, _ := json.Marshal(model)
		if _, valid := speakerEncoderDimension(data); valid {
			t.Fatal("incompatible speaker representation was admitted")
		}
	}
	model := speakerModelFactsForTest()
	model.Metadata["output_dim"] = "256"
	model.Outputs[0].Shape[1] = 256
	data, _ := json.Marshal(model)
	if dimension, valid := speakerEncoderDimension(data); !valid || dimension != 256 {
		t.Fatal("verified compatible payload dimension was replaced by a fixed width")
	}
}
func TestSpeakerEncoderExactImportedModelBinding(t *testing.T) {
	filename := os.Getenv("NIMI_TEST_SPEAKER_ONNX_PATH")
	if filename == "" {
		t.Skip("actual speaker ONNX input not supplied")
	}
	file, err := os.Open(filename)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	driver := SherpaSpeakerEmbedDriver{}
	probe, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{Entry: true, RequirementID: SpeakerEncoderSlot}, file, info.Size())
	if err != nil {
		t.Fatal(err)
	}
	requirements, reason := driver.ProjectRecipe(SherpaSpeakerEmbedRecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	binding := &runtimev1.ModelAssetExactBinding{RequirementId: SpeakerEncoderSlot, ModelAssetId: "verified-model", VerifiedContentId: "verified-content", EntrySha256: "verified-file"}
	projection, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{RecipeID: SherpaSpeakerEmbedRecipeID, Requirement: requirements[0], Binding: binding, Entry: ModelAssetFileFact{RelativePath: "renamed-encoder.onnx", SizeBytes: info.Size(), FormatProbe: probe}})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || projection.EmbeddingDimension != 512 {
		t.Fatalf("actual speaker binding: %v, %+v", reason, projection)
	}
	if reason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{binding}, []ModelAssetDescriptor{projection.Descriptor}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	binding.VerifiedContentId = "changed-content"
	if driver.ValidateBinding(requirements[0], binding, projection.Descriptor) == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("changed content was admitted")
	}
}
