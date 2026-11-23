package capabilitydriver

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

func TestLlamaDriversRejectTruncatedMetadataAcrossTextAndEmbed(t *testing.T) {
	for _, test := range []struct {
		name         string
		driver       RecipeDriver
		recipeID     string
		architecture string
	}{
		{
			name:         "text generate generic GGUF",
			driver:       LlamaTextDriver{},
			recipeID:     LlamaGenericGGUFRecipeID,
			architecture: "gemma4",
		},
		{
			name:         "text embed Qwen",
			driver:       LlamaEmbedDriver{},
			recipeID:     LlamaQwen3EmbedRecipeID,
			architecture: "qwen3",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			requirements, reason := test.driver.ProjectRecipe(test.recipeID, nil, nil)
			if reason != success || len(requirements) != 1 {
				t.Fatalf("ProjectRecipe = requirements=%+v reason=%v", requirements, reason)
			}
			digest := strings.Repeat("a", 64)
			entryDigest := strings.Repeat("b", 64)
			probe := boundedLLMGGUFProbeWithTruncatedTokenizer(t, test.architecture, 262144)
			if _, reason := projectLlamaBindingForTest(test.driver, ModelAssetBindingInput{
				RecipeID:    test.recipeID,
				Requirement: requirements[0],
				Binding: &runtimev1.ModelAssetExactBinding{
					RequirementId: requirements[0].GetRequirementId(), ModelAssetId: "model/test",
					VerifiedContentId: "sha256:" + digest, EntrySha256: entryDigest,
				},
				Entry: ModelAssetFileFact{RelativePath: "model.gguf", SizeBytes: 1 << 30, FormatProbe: probe},
			}); reason == success {
				t.Fatal("truncated GGUF metadata was admitted")
			}
		})
	}
}

func TestInklingFamilyBindingAdmitsCommunityQuantAndGGUFFileExtension(t *testing.T) {
	driver := LlamaTextDriver{}
	requirements, reason := driver.ProjectRecipeForHost(LlamaGenericGGUFRecipeID, nil, []string{inputImageFeature}, "windows/amd64")
	if reason != success || len(requirements) != 2 || requirements[1].GetPresence() != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_OPTIONAL_CONDITIONAL {
		t.Fatalf("unified GGUF recipe requirements: %v, %v", requirements, reason)
	}
	communitySHA := strings.Repeat("e", 64)
	for _, tc := range []struct {
		name, arch, file string
		want             bool
	}{
		{"inkling2_loop community .gguf_file", "inkling2_loop", "Inkling-2-Mini-Uncensored-Q8_0.gguf_file", true},
		{"gemma4 community .gguf", "gemma4", "gemma-4-community-Q8_0.gguf", true},
		{"unsupported encoder arch", "t5encoder", "t5.gguf", false},
	} {
		raw := buildStructuralLLMGGUFForTest(t, tc.arch, "model", 1048576, 2304, 0, "{{ messages }}", "")
		projection, reason := projectLlamaBindingForTest(driver, ModelAssetBindingInput{
			RecipeID: LlamaGenericGGUFRecipeID, Requirement: requirements[0],
			Binding: &runtimev1.ModelAssetExactBinding{RequirementId: MainGGUFRequirementID, ModelAssetId: "model/test", VerifiedContentId: "sha256:" + communitySHA, EntrySha256: communitySHA},
			Entry:   ModelAssetFileFact{RelativePath: tc.file, SizeBytes: int64(len(raw)), FormatProbe: raw},
		})
		if (reason == success) != tc.want || tc.want && projection.ModelContextWindowTokens != 1048576 {
			t.Fatalf("%s: context=%d reason=%v", tc.name, projection.ModelContextWindowTokens, reason)
		}
	}
}

func boundedLLMGGUFProbeWithTruncatedTokenizer(t *testing.T, architecture string, contextLength uint32) []byte {
	t.Helper()
	var probe bytes.Buffer
	probe.WriteString("GGUF")
	mustWriteLlamaProbeValue(t, &probe, uint32(3))
	mustWriteLlamaProbeValue(t, &probe, uint64(0))
	mustWriteLlamaProbeValue(t, &probe, uint64(3))
	writeLlamaProbeString(t, &probe, "general.architecture")
	mustWriteLlamaProbeValue(t, &probe, uint32(ggufmeta.ValueTypeString))
	writeLlamaProbeString(t, &probe, architecture)
	writeLlamaProbeString(t, &probe, architecture+".context_length")
	mustWriteLlamaProbeValue(t, &probe, uint32(ggufmeta.ValueTypeUint32))
	mustWriteLlamaProbeValue(t, &probe, contextLength)
	writeLlamaProbeString(t, &probe, "tokenizer.ggml.tokens")
	mustWriteLlamaProbeValue(t, &probe, uint32(ggufmeta.ValueTypeArray))
	mustWriteLlamaProbeValue(t, &probe, uint32(ggufmeta.ValueTypeString))
	mustWriteLlamaProbeValue(t, &probe, uint64(1<<30))
	return probe.Bytes()
}

func writeLlamaProbeString(t *testing.T, writer *bytes.Buffer, value string) {
	t.Helper()
	mustWriteLlamaProbeValue(t, writer, uint64(len(value)))
	if _, err := writer.WriteString(value); err != nil {
		t.Fatalf("write GGUF test string: %v", err)
	}
}

func mustWriteLlamaProbeValue(t *testing.T, writer *bytes.Buffer, value any) {
	t.Helper()
	if err := binary.Write(writer, binary.LittleEndian, value); err != nil {
		t.Fatalf("write GGUF test value %T: %v", value, err)
	}
}
