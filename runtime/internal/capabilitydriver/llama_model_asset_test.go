package capabilitydriver

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

func TestLlamaDriversProjectBoundedGGUFIdentityBeforeTruncatedMetadata(t *testing.T) {
	for _, test := range []struct {
		name         string
		driver       RecipeDriver
		recipeID     string
		architecture string
		kind         runtimev1.LocalAssetKind
		artifactRole string
	}{
		{
			name:         "text generate Gemma",
			driver:       LlamaTextDriver{},
			recipeID:     LlamaGemma4E2BRecipeID,
			architecture: "gemma4",
			kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
			artifactRole: "llm",
		},
		{
			name:         "text embed Qwen",
			driver:       LlamaEmbedDriver{},
			recipeID:     LlamaEmbedGGUFRecipeID,
			architecture: "qwen3",
			kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING,
			artifactRole: "embedding",
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
			projection, reason := test.driver.ProjectModelAssetBinding(ModelAssetBindingInput{
				RecipeID:    test.recipeID,
				Requirement: requirements[0],
				Binding: &runtimev1.ModelAssetExactBinding{
					RequirementId: requirements[0].GetRequirementId(), ModelAssetId: "model/test",
					VerifiedContentId: "sha256:" + digest, EntrySha256: entryDigest,
				},
				Entry: ModelAssetFileFact{RelativePath: "model.gguf", SizeBytes: 1 << 30, FormatProbe: probe},
			})
			if reason != success {
				t.Fatalf("ProjectModelAssetBinding reason=%v", reason)
			}
			if projection.ModelContextWindowTokens != 262144 || projection.Descriptor.Kind != test.kind ||
				projection.Descriptor.Engine != "llama" || !contains(projection.Descriptor.ArtifactRoles, test.artifactRole) {
				t.Fatalf("projection=%+v", projection)
			}
		})
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
