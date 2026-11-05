package capabilitydriver

import (
	"encoding/json"
	"math"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func gemma2EmbedInput(t *testing.T) EmbedInvocationInput {
	t.Helper()
	return EmbedInvocationInput{RecipeID: LlamaEmbeddingGemma2RecipeID, ModelContextWindowTokens: 8192,
		ExactBindings: []InvocationExactBinding{{RequirementID: EmbeddingGGUFRequirementID, ModelAssetID: "gemma2", AbsolutePath: filepath.Join(t.TempDir(), "model.gguf"), VerifiedContentID: EmbeddingGemma2Q8ContentID, EntrySHA256: strings.TrimPrefix(EmbeddingGemma2Q8ContentID, "sha256:"), EmbeddingInputProtocol: EmbeddingInputGemma2V1}},
		Request:       &runtimev1.TextEmbedScenarioSpec{Inputs: []string{" 文档\n "}, Purpose: runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT}}
}

func TestEmbeddingGemma2RetrievalPlanAndMRL(t *testing.T) {
	for _, width := range []uint32{128, 256, 512, 768} {
		input := gemma2EmbedInput(t)
		input.Request.Dimensions = proto.Uint32(width)
		plan, err := (LlamaEmbedDriver{}).PlanEmbedInvocation(input)
		if err != nil {
			t.Fatal(err)
		}
		var body struct {
			Input      []string `json:"input"`
			Dimensions *uint32  `json:"dimensions"`
		}
		if err := json.Unmarshal(plan.RequestBody(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Input[0] != "title: none | text:  文档\n " || body.Dimensions != nil || input.Request.GetDimensions() != width || plan.OutputDimension(768) != int(width) {
			t.Fatalf("plan lost exact prefix/dimensions: %+v", body)
		}
		if !containsAdjacent(plan.ProcessArgs(), "--pooling", "mean") || !containsAdjacent(plan.ProcessArgs(), "--batch-size", "8192") {
			t.Fatal(plan.ProcessArgs())
		}
		values := make([]float64, 768)
		values[0] = 3
		values[1] = 4
		values[767] = 12
		result, err := plan.ProjectEmbeddingGemma2Vectors([]*runtimev1.EmbeddingVector{{Values: values}})
		if err != nil || len(result[0].Values) != int(width) {
			t.Fatalf("projection: %v %v", result, err)
		}
		expected := 0.6
		if width == 768 {
			expected = 3.0 / 13
		}
		if math.Abs(result[0].Values[0]-expected) > 1e-12 || values[0] != 3 {
			t.Fatal("MRL normalization or input mutation")
		}
		for _, invalid := range [][]float64{values[:512], make([]float64, 768), append(append([]float64{}, values[:767]...), math.NaN())} {
			if _, err := plan.ProjectEmbeddingGemma2Vectors([]*runtimev1.EmbeddingVector{{Values: invalid}}); err == nil {
				t.Fatal("repaired invalid native vector")
			}
		}
	}
	input := gemma2EmbedInput(t)
	input.Request.Purpose = runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY
	plan, err := (LlamaEmbedDriver{}).PlanEmbedInvocation(input)
	if err != nil || !strings.Contains(string(plan.RequestBody()), "task: search result | query: ") {
		t.Fatalf("query mapping: %v", err)
	}
}

func TestEmbeddingGemma2RejectsUnreviewedInputs(t *testing.T) {
	for _, mutate := range []func(*EmbedInvocationInput){
		func(i *EmbedInvocationInput) {
			i.Request.Purpose = runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_UNSPECIFIED
		},
		func(i *EmbedInvocationInput) { i.Request.Dimensions = proto.Uint32(0) },
		func(i *EmbedInvocationInput) { i.Request.Dimensions = proto.Uint32(384) },
		func(i *EmbedInvocationInput) {
			i.ExactBindings[0].VerifiedContentID = "sha256:" + strings.Repeat("a", 64)
			i.ExactBindings[0].EntrySHA256 = strings.Repeat("a", 64)
		},
		func(i *EmbedInvocationInput) {
			i.ModelContextWindowTokens = 262144
			i.PortableConfig, _ = structpb.NewStruct(map[string]any{"contextSize": 16384})
		},
	} {
		input := gemma2EmbedInput(t)
		mutate(&input)
		if _, err := (LlamaEmbedDriver{}).PlanEmbedInvocation(input); err == nil {
			t.Fatal("admitted unsupported input")
		}
	}
}
