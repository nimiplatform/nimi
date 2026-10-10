package capabilitydriver

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"google.golang.org/protobuf/types/known/structpb"
)

func qwen3EmbeddingGGUFProbe(t *testing.T, pooling uint32) []byte {
	t.Helper()
	var probe bytes.Buffer
	probe.WriteString("GGUF")
	mustWriteLlamaProbeValue(t, &probe, uint32(3))
	mustWriteLlamaProbeValue(t, &probe, uint64(0))
	mustWriteLlamaProbeValue(t, &probe, uint64(4))
	write := func(key string, valueType ggufmeta.ValueType, value any) {
		writeLlamaProbeString(t, &probe, key)
		mustWriteLlamaProbeValue(t, &probe, uint32(valueType))
		if valueType == ggufmeta.ValueTypeString {
			writeLlamaProbeString(t, &probe, value.(string))
		} else {
			mustWriteLlamaProbeValue(t, &probe, value)
		}
	}
	write("general.architecture", ggufmeta.ValueTypeString, "qwen3")
	write("qwen3.context_length", ggufmeta.ValueTypeUint32, uint32(32768))
	write("qwen3.embedding_length", ggufmeta.ValueTypeUint32, uint32(1024))
	write("qwen3.pooling_type", ggufmeta.ValueTypeUint32, pooling)
	return probe.Bytes()
}

func TestQwen3EmbeddingModelContractRequiresLastPooling(t *testing.T) {
	driver := LlamaEmbedDriver{}
	requirements, reason := driver.ProjectRecipe(LlamaQwen3EmbedRecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("Qwen recipe requirements=%+v reason=%v", requirements, reason)
	}
	digest := strings.Repeat("a", 64)
	binding := &runtimev1.ModelAssetExactBinding{RequirementId: EmbeddingGGUFRequirementID, ModelAssetId: "qwen-asset",
		VerifiedContentId: "sha256:" + digest, EntrySha256: digest}
	projection, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{RecipeID: LlamaQwen3EmbedRecipeID,
		Requirement: requirements[0], Binding: binding,
		Entry: ModelAssetFileFact{RelativePath: "qwen3.gguf", SizeBytes: 639150592, FormatProbe: qwen3EmbeddingGGUFProbe(t, 3)}})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || projection.EmbeddingDimension != 1024 || projection.ModelContextWindowTokens != 32768 {
		t.Fatalf("Qwen last-pooling projection=%+v reason=%v", projection, reason)
	}
	for _, pooling := range []uint32{0, 1, 2} {
		_, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{RecipeID: LlamaQwen3EmbedRecipeID,
			Requirement: requirements[0], Binding: binding,
			Entry: ModelAssetFileFact{RelativePath: "qwen3.gguf", SizeBytes: 639150592, FormatProbe: qwen3EmbeddingGGUFProbe(t, pooling)}})
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
			t.Fatalf("pooling=%d reason=%v", pooling, reason)
		}
	}
	generic, _ := driver.ProjectRecipe(LlamaEmbedGGUFRecipeID, nil, nil)
	if _, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{RecipeID: LlamaEmbedGGUFRecipeID,
		Requirement: generic[0], Binding: binding,
		Entry: ModelAssetFileFact{RelativePath: "qwen3.gguf", SizeBytes: 639150592, FormatProbe: qwen3EmbeddingGGUFProbe(t, 3)}}); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("generic embedding recipe still admitted Qwen3 without its versioned pooling contract")
	}
}

func TestQwen3EmbeddingPlanCapturesSingleSlotLastPooling(t *testing.T) {
	digest := strings.Repeat("b", 64)
	portable, _ := structpb.NewStruct(map[string]any{"contextSize": 8192, "gpuLayers": 99})
	plan, err := (LlamaEmbedDriver{}).PlanEmbedInvocation(EmbedInvocationInput{RecipeID: LlamaQwen3EmbedRecipeID,
		PortableConfig: portable, ModelContextWindowTokens: 32768,
		ExactBindings: []InvocationExactBinding{{EmbeddingInputProtocol: EmbeddingInputNativeV1, RequirementID: EmbeddingGGUFRequirementID, ModelAssetID: "qwen-asset",
			AbsolutePath: filepath.Join(t.TempDir(), "qwen3.gguf"), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}},
		Request: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"red fox", "winter fox"}}})
	if err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{"--pooling": "last", "--parallel": "1", "--cache-ram": "0", "--ctx-size": "8192", "--n-gpu-layers": "99"} {
		if !containsAdjacent(plan.ProcessArgs(), key, value) {
			t.Fatalf("missing %s %s in %v", key, value, plan.ProcessArgs())
		}
	}
	if _, reason := NewProductionRegistry().Resolve(TextEmbedCapabilityContract,
		Identity{ImplementationID: LlamaEmbedImplementationID, DriverID: LlamaDriverID, DriverDialect: LlamaQwen3EmbedDialect}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("Qwen3 embed dialect not registered: %v", reason)
	}
}
