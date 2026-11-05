package ai

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/proto"
)

func TestEmbeddingGemma2CapturedMRLRestorationAndSpace(t *testing.T) {
	service := newTestService(nil)
	selected := &localexecution.SelectedLocalExecution{LoadoutID: "gemma2", CapabilityContract: "text.embed", Configured: true, RecipeID: capabilitydriver.LlamaEmbeddingGemma2RecipeID, RecipeRevision: "1",
		DriverIdentity: (&capabilitydriver.Identity{ImplementationID: capabilitydriver.LlamaEmbedImplementationID, DriverID: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaEmbeddingGemma2Dialect}).Proto(), ModelContextWindowTokens: 8192, EmbeddingDimension: 768,
		Requirements:  []*runtimev1.LocalCapabilityRequirement{{RequirementId: capabilitydriver.EmbeddingGGUFRequirementID}},
		ExactBindings: []localexecution.ExactBinding{{RequirementID: capabilitydriver.EmbeddingGGUFRequirementID, ModelAssetID: "gemma2", AbsolutePath: filepath.Join(t.TempDir(), "model.gguf"), VerifiedContentID: capabilitydriver.EmbeddingGemma2Q8ContentID, EntrySHA256: strings.TrimPrefix(capabilitydriver.EmbeddingGemma2Q8ContentID, "sha256:"), EmbeddingInputProtocol: capabilitydriver.EmbeddingInputGemma2V1}}}
	var space128, space768 string
	for _, width := range []uint32{0, 128, 256, 512, 768} {
		var pairSpace string
		for _, purpose := range []runtimev1.TextEmbedPurpose{runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT, runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY} {
			request := &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"原始文本"}, Purpose: purpose}
			if width != 0 {
				request.Dimensions = proto.Uint32(width)
			}
			effective, err := service.captureSelectedLocalEmbedEffectiveInputs(request, selected, nil)
			if err != nil {
				t.Fatal(err)
			}
			want := int(width)
			if want == 0 {
				want = 768
			}
			if effective.resolvedAssembly.EmbeddingDimension != want {
				t.Fatal("wrong captured width")
			}
			request.Inputs[0] = "mutated"
			request.Dimensions = proto.Uint32(17)
			raw, err := json.Marshal(effective.resolvedAssembly)
			if err != nil {
				t.Fatal(err)
			}
			var persisted localResolvedAssembly
			if err = json.Unmarshal(raw, &persisted); err != nil {
				t.Fatal(err)
			}
			restored, err := service.localEmbedEffectiveInputsFromResolvedAssembly(&persisted)
			if err != nil {
				t.Fatal(err)
			}
			if restored.request.Inputs[0] != "原始文本" || restored.plan.OutputDimension(768) != want {
				t.Fatal("restore re-read mutable request")
			}
			native := make([]float64, 768)
			native[0] = 3
			native[1] = 4
			vectors, err := restored.plan.ProjectEmbeddingGemma2Vectors([]*runtimev1.EmbeddingVector{{Values: native}})
			if err != nil {
				t.Fatal(err)
			}
			if err = validateEmbeddingOutput(vectors, 1, persisted.EmbeddingDimension); err != nil {
				t.Fatal(err)
			}
			space, err := localEmbeddingSpaceID(restored, vectors)
			if err != nil {
				t.Fatal(err)
			}
			if pairSpace != "" && space != pairSpace {
				t.Fatal("query/document space differs")
			}
			pairSpace = space
		}
		if width == 0 {
			space768 = pairSpace
		}
		if width == 768 && space768 != pairSpace {
			t.Fatal("explicit native width differs from omission")
		}
		if width == 128 {
			space128 = pairSpace
		}
	}
	if space128 == space768 {
		t.Fatal("MRL widths reused a space")
	}
}
