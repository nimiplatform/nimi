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
			recipeID:     LlamaGemma4RecipeID,
			architecture: "gemma4",
			kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
			artifactRole: "llm",
		},
		{
			name:         "text embed Qwen",
			driver:       LlamaEmbedDriver{},
			recipeID:     LlamaQwen3EmbedRecipeID,
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
			projection, reason := projectLlamaBindingForTest(test.driver, ModelAssetBindingInput{
				RecipeID:    test.recipeID,
				Requirement: requirements[0],
				Binding: &runtimev1.ModelAssetExactBinding{
					RequirementId: requirements[0].GetRequirementId(), ModelAssetId: "model/test",
					VerifiedContentId: "sha256:" + digest, EntrySha256: entryDigest,
				},
				Entry: ModelAssetFileFact{RelativePath: "model.gguf", SizeBytes: 1 << 30, FormatProbe: probe},
			})
			if test.kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING {
				if reason == success {
					t.Fatal("truncated embedding contract admitted")
				}
				return
			}
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

func TestInklingMainlineBindingRequiresReviewedContent(t *testing.T) {
	driver := LlamaTextDriver{}
	if _, reason := driver.ProjectRecipeForHost(LlamaInkling2MiniRecipeID, nil, []string{inputImageFeature}, "darwin/arm64"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
		t.Fatalf("unadmitted Metal recipe: %v", reason)
	}
	requirements, reason := driver.ProjectRecipeForHost(LlamaInkling2MiniRecipeID, nil, []string{inputImageFeature}, "windows/amd64")
	if reason != success || len(requirements) != 2 || requirements[1].GetPresence() != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_OPTIONAL_CONDITIONAL {
		t.Fatalf("Inkling recipe requirements: %v, %v", requirements, reason)
	}
	const digest = "e64276656f072e9b2197a61723667cbdb71da66a716ffd966e572c21088f3cd3" // pragma: allowlist secret -- public mainline model digest
	main := ModelAssetBindingInput{
		RecipeID: LlamaInkling2MiniRecipeID, Requirement: requirements[0],
		Binding: &runtimev1.ModelAssetExactBinding{RequirementId: MainGGUFRequirementID, ModelAssetId: "model/test", VerifiedContentId: "sha256:" + digest, EntrySha256: digest},
	}
	for _, tc := range []struct {
		architecture, sha string
		want              bool
	}{
		{"inkling2_loop", digest, true}, {"inkling2_loop", strings.Repeat("a", 64), false}, {"gemma4", digest, false},
	} {
		raw := boundedLLMGGUFProbeWithTruncatedTokenizer(t, tc.architecture, 1048576)
		main.Entry = ModelAssetFileFact{RelativePath: "model.gguf", SizeBytes: int64(len(raw)), FormatProbe: raw}
		main.Binding.VerifiedContentId, main.Binding.EntrySha256 = "sha256:"+tc.sha, tc.sha
		projection, reason := projectLlamaBindingForTest(driver, main)
		if (reason == success) != tc.want || tc.want && projection.ModelContextWindowTokens != 1048576 {
			t.Fatalf("architecture %s, content %s: context=%d reason=%v", tc.architecture, tc.sha, projection.ModelContextWindowTokens, reason)
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
