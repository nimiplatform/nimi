package capabilitydriver

import (
	"bytes"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestDemucsProbeReadsOnlyItsFourByteFormatContract(t *testing.T) {
	driver := DemucsDriver{}
	data := make([]byte, 8<<20)
	copy(data, []byte{'P', 'K', 3, 4})
	source := &countedONNXReader{source: bytes.NewReader(data)}
	probe, err := readDriverProbeForTest(driver, ModelAssetFormatProbeInput{RecipeID: DemucsRecipeID, RequirementID: DemucsModelRequirementID, RelativePath: "model.th", Entry: true}, source, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	input := ModelAssetBindingInput{RecipeID: DemucsRecipeID,
		Requirement: &runtimev1.LocalCapabilityRequirement{RequirementId: DemucsModelRequirementID},
		Binding:     &runtimev1.ModelAssetExactBinding{RequirementId: DemucsModelRequirementID, ModelAssetId: "fixture", VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("b", 64)},
		Entry:       ModelAssetFileFact{RelativePath: "model.th", SizeBytes: int64(len(data)), FormatProbe: probe},
	}
	if _, reason := driver.ProjectModelAssetBinding(input); reason != success {
		t.Fatal(reason)
	}
	if source.readBytes != 4 || len(probe) != 4 {
		t.Fatalf("four-byte contract read=%d probe=%d", source.readBytes, len(probe))
	}
	for _, invalid := range [][]byte{nil, {'P'}, {'P', 'K', 3}, {'P', 'K', 5, 6}, []byte("GGUF")} {
		input.Entry.FormatProbe = invalid
		if _, reason := driver.ProjectModelAssetBinding(input); reason == success {
			t.Fatalf("invalid prefix accepted: %x", invalid)
		}
	}
	input.Entry.FormatProbe = probe
	input.Entry.RelativePath = "model.zip"
	if _, reason := driver.ProjectModelAssetBinding(input); reason == success {
		t.Fatal("wrong format extension accepted")
	}
	input.Entry.RelativePath = "model.th"
	input.Binding.EntrySha256 = ""
	if _, reason := driver.ProjectModelAssetBinding(input); reason == success {
		t.Fatal("prefix replaced exact binding")
	}
}

func TestGemmaProjectorProbeDoesNotPrefetchUnusedMetadata(t *testing.T) {
	data := make([]byte, 8<<20)
	copy(data, "GGUF")
	source := &countedONNXReader{source: bytes.NewReader(data)}
	_, err := (LlamaTextDriver{}).ProbeModelAsset(ModelAssetFormatProbeInput{RecipeID: LlamaGemma4RecipeID, RequirementID: CompanionMMProjRequirementID, RelativePath: "mmproj.gguf", Entry: true}, source, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if source.readBytes != 4 {
		t.Fatalf("magic-only projector read %d bytes", source.readBytes)
	}
}
