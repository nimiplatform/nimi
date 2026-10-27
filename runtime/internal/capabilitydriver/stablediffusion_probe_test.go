package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func sdProbeRequirementForTest(t testing.TB, driver RecipeDriver, recipe, slot string) *runtimev1.LocalCapabilityRequirement {
	t.Helper()
	features, reason := driver.ImplementationSupportedFeatures(recipe)
	if reason != success {
		t.Fatal(reason)
	}
	requirements, reason := driver.ProjectRecipe(recipe, nil, features)
	if reason != success {
		t.Fatal(reason)
	}
	for _, requirement := range requirements {
		if requirement.GetRequirementId() == slot {
			return requirement
		}
	}
	t.Fatal("missing slot", slot)
	return nil
}

func sdProbeInputForTest(t testing.TB, driver RecipeDriver, recipe, slot, format string, size int64) ModelAssetBindingInput {
	requirement := sdProbeRequirementForTest(t, driver, recipe, slot)
	return ModelAssetBindingInput{RecipeID: recipe, Requirement: requirement,
		Binding: &runtimev1.ModelAssetExactBinding{RequirementId: slot, ModelAssetId: "asset", VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("a", 64)},
		Entry:   ModelAssetFileFact{RelativePath: "model." + format, SizeBytes: size}}
}

func TestStableDiffusionProbeReadsOnlyConsumedMetadata(t *testing.T) {
	for _, tc := range []struct {
		name, recipe, slot, format string
		driver                     RecipeDriver
		metadata                   []byte
	}{
		{"image-encoder", "z-image", StableDiffusionTextEncoderRequirementID, "gguf", StableDiffusionImageDriver{}, boundedLLMGGUFProbeWithTruncatedTokenizer(t, "qwen3", 262144)},
		{"image-vae", "qwen-image", StableDiffusionVAERequirementID, "safetensors", StableDiffusionImageDriver{}, fluxSafetensorsForTest(t, map[string][]int64{"decoder.conv1.weight": {1, 16, 1, 1, 1}, "decoder.head.2.weight": {3, 1, 1, 1, 1}})},
		{"video-vae", StableDiffusionVideoRecipeID, StableDiffusionVideoVAERequirementID, "safetensors", StableDiffusionVideoDriver{}, safetensorsProbeForTest([]byte(`{"decoder.mask_token":null}`))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := make([]byte, 8<<20)
			copy(data, tc.metadata)
			reader := &countedONNXReader{source: bytes.NewReader(data)}
			input := sdProbeInputForTest(t, tc.driver, tc.recipe, tc.slot, tc.format, int64(len(data)))
			probe, err := readDriverProbeForTest(tc.driver, ModelAssetFormatProbeInput{RecipeID: tc.recipe, RequirementID: tc.slot, RelativePath: input.Entry.RelativePath, Entry: true}, reader, int64(len(data)))
			if err != nil {
				t.Fatal(err)
			}
			input.Entry.FormatProbe = probe
			if _, reason := tc.driver.ProjectModelAssetBinding(input); reason != success {
				t.Fatal(reason)
			}
			if reader.readBytes > 128<<10 {
				t.Fatalf("read=%d ops=%d for %d metadata bytes", reader.readBytes, reader.reads, len(tc.metadata))
			}
			t.Logf("probe read=%d bytes, operations=%d, metadata=%d bytes", reader.readBytes, reader.reads, len(tc.metadata))
		})
	}
}

func TestStableDiffusionVideoProbePreservesWholeOriginalSignatureRange(t *testing.T) {
	driver := StableDiffusionVideoDriver{}
	signatures := []byte("blocks.0.adaln_proj.linear. condition_proj. audio_patch_proj.")
	for _, offset := range []int{(64 << 10) - 10, MaxAssetFormatProbeBytes - len(signatures), MaxAssetFormatProbeBytes - len(signatures) + 1, MaxAssetFormatProbeBytes + 1} {
		data := make([]byte, 8<<20)
		copy(data, "GGUF")
		copy(data[offset:], signatures)
		input := sdProbeInputForTest(t, driver, StableDiffusionVideoRecipeID, StableDiffusionVideoFL2VARequirementID, "gguf", int64(len(data)))
		reader := &countedONNXReader{source: bytes.NewReader(data)}
		probe, err := readDriverProbeForTest(driver, ModelAssetFormatProbeInput{RecipeID: input.RecipeID, RequirementID: input.Requirement.GetRequirementId(), RelativePath: input.Entry.RelativePath, Entry: true}, reader, int64(len(data)))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(probe, data[:len(probe)]) || len(probe) > MaxAssetFormatProbeBytes {
			t.Fatal("probe was fabricated or crossed its original bound")
		}
		input.Entry.FormatProbe = probe
		_, reason := driver.ProjectModelAssetBinding(input)
		if (reason == success) != (offset+len(signatures) <= MaxAssetFormatProbeBytes) {
			t.Fatalf("offset=%d reason=%v", offset, reason)
		}
		if offset < (128<<10) && reader.readBytes > 128<<10 {
			t.Fatalf("positive early signature still read %d", reader.readBytes)
		}
	}
}

func TestStableDiffusionProbeTopologyUsesExistingRecipeContract(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	for _, recipe := range []string{"z-image", "ideogram4", StableDiffusionQwenImageRecipeID, StableDiffusionQwenImageEditRecipeID, StableDiffusionFluxSchnellRecipeID} {
		features, reason := driver.ImplementationSupportedFeatures(recipe)
		if reason != success {
			t.Fatal(reason)
		}
		base, reason := driver.ProjectRecipe(recipe, nil, features)
		if reason != success {
			t.Fatal(reason)
		}
		options, _ := structpb.NewStruct(map[string]any{"executionOptions": map[string]any{"width": 512, "height": 512, "seed": 7}})
		changed, reason := driver.ProjectRecipe(recipe, options, features)
		if reason != success || len(base) != len(changed) {
			t.Fatalf("recipe=%s changed topology", recipe)
		}
		for i := range base {
			if !proto.Equal(base[i], changed[i]) {
				t.Fatalf("recipe=%s execution options changed model slot", recipe)
			}
		}
		if _, reason := driver.ProjectRecipe(recipe, nil, []string{"input.video"}); reason == success {
			t.Fatal("unsupported features admitted")
		}
	}
}

func TestStableDiffusionProbeKeepsActualRequirementAndBindingChecks(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	raw := boundedLLMGGUFProbeWithTruncatedTokenizer(t, "qwen3", 262144)
	input := sdProbeInputForTest(t, driver, "z-image", StableDiffusionTextEncoderRequirementID, "gguf", int64(len(raw)))
	probe, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RecipeID: input.RecipeID, RequirementID: input.Requirement.GetRequirementId(), RelativePath: input.Entry.RelativePath, Entry: true}, bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	input.Entry.FormatProbe = probe
	if _, reason := driver.ProjectModelAssetBinding(input); reason != success {
		t.Fatal(reason)
	}
	for name, change := range map[string]func(*ModelAssetBindingInput){
		"actual-architecture": func(value *ModelAssetBindingInput) {
			value.Requirement.CompatibilityConstraints.Fields["gguf_architecture_families"] = structpb.NewListValue(&structpb.ListValue{Values: []*structpb.Value{structpb.NewStringValue("qwen-vl")}})
		},
		"actual-full-tensor": func(value *ModelAssetBindingInput) {
			value.Requirement.CompatibilityConstraints.Fields["tensor_contract"] = structpb.NewStringValue("t5-v1_1-xxl-encoder")
		},
		"wrong-recipe":       func(value *ModelAssetBindingInput) { value.RecipeID = "qwen-image" },
		"unverified-binding": func(value *ModelAssetBindingInput) { value.Binding.EntrySha256 = "" },
	} {
		value := input
		value.Requirement = proto.Clone(input.Requirement).(*runtimev1.LocalCapabilityRequirement)
		value.Binding = proto.Clone(input.Binding).(*runtimev1.ModelAssetExactBinding)
		change(&value)
		if _, reason := driver.ProjectModelAssetBinding(value); reason == success {
			t.Fatalf("%s admitted", name)
		}
	}
	input.Entry.FormatProbe = raw
	if _, reason := driver.ProjectModelAssetBinding(input); reason == success {
		t.Fatal("raw GGUF accepted by structured image branch")
	}
}

func TestStableDiffusionProbesKeepCancellationAndShortSourceFailures(t *testing.T) {
	for _, tc := range []struct {
		driver               RecipeDriver
		recipe, slot, format string
		data                 []byte
	}{
		{StableDiffusionImageDriver{}, "z-image", StableDiffusionTextEncoderRequirementID, "gguf", boundedLLMGGUFProbeWithTruncatedTokenizer(t, "qwen3", 262144)},
		{StableDiffusionVideoDriver{}, StableDiffusionVideoRecipeID, StableDiffusionVideoFL2VARequirementID, "gguf", []byte("GGUF blocks.0.adaln_proj.linear.weight condition_proj.weight audio_patch_proj.weight")},
		{StableDiffusionVideoDriver{}, StableDiffusionVideoRecipeID, StableDiffusionVideoVAERequirementID, "safetensors", safetensorsProbeForTest([]byte(`{"decoder.mask_token":null}`))},
	} {
		input := ModelAssetFormatProbeInput{RecipeID: tc.recipe, RequirementID: tc.slot, RelativePath: "model." + tc.format, Entry: true}
		ctx, cancel := context.WithCancel(context.Background())
		reader := &countedONNXReader{source: bytes.NewReader(tc.data), ctx: ctx, afterRead: cancel}
		if _, err := tc.driver.(ModelAssetStructuredProbeDriver).ProbeModelAsset(input, reader, int64(len(tc.data))); !errors.Is(err, context.Canceled) {
			t.Fatalf("%s cancellation=%v", tc.slot, err)
		}
		cancel()
		if tc.format == "gguf" {
			if _, err := tc.driver.(ModelAssetStructuredProbeDriver).ProbeModelAsset(input, bytes.NewReader(tc.data), 8<<20); err == nil {
				t.Fatalf("%s short source admitted", tc.slot)
			}
		}
	}
	for _, header := range [][]byte{make([]byte, 8), binary.LittleEndian.AppendUint64(nil, uint64(MaxAssetFormatProbeBytes)), safetensorsProbeForTest([]byte(`{"decoder.mask_token":null}`))[:10]} {
		if _, err := readSDDeclaredSafetensorsHeader(bytes.NewReader(header), int64(len(header))); err == nil {
			t.Fatal("invalid/truncated header admitted")
		}
	}
}

func BenchmarkStableDiffusionVideoProbeReader(b *testing.B) {
	data := make([]byte, 8<<20)
	copy(data, "GGUF")
	copy(data[(64<<10)-10:], "blocks.0.adaln_proj.linear.weight condition_proj.weight audio_patch_proj.weight")
	name := filepath.Join(b.TempDir(), "video.gguf")
	if err := os.WriteFile(name, data, 0600); err != nil {
		b.Fatal(err)
	}
	file, err := os.Open(name)
	if err != nil {
		b.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	reader := &countedONNXReader{source: file}
	input := ModelAssetFormatProbeInput{RecipeID: StableDiffusionVideoRecipeID, RequirementID: StableDiffusionVideoFL2VARequirementID, RelativePath: "video.gguf", Entry: true}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		probe, err := readDriverProbeForTest(StableDiffusionVideoDriver{}, input, reader, int64(len(data)))
		if err != nil || !stableDiffusionVideoSlotFormatValid(input.RequirementID, "gguf", probe) {
			b.Fatal("probe", err)
		}
	}
	b.ReportMetric(float64(reader.reads)/float64(b.N), "read-at-ops/op")
	b.ReportMetric(float64(reader.readBytes)/float64(b.N), "read-at-bytes/op")
}
