package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func TestImportedEmbeddingModelContractRequiresVerifiedDimension(t *testing.T) {
	for _, tc := range []struct {
		name  string
		extra []ggufTestMetadataEntry
		valid bool
	}{
		{"custom-768", []ggufTestMetadataEntry{{Key: "bert.embedding_length", Type: 4, Uint32Value: 768}}, true},
		{"custom-384", []ggufTestMetadataEntry{{Key: "bert.embedding_length", Type: 4, Uint32Value: 384}}, true},
		{"missing", nil, false},
		{"zero", []ggufTestMetadataEntry{{Key: "bert.embedding_length", Type: 4}}, false},
		{"string", []ggufTestMetadataEntry{{Key: "bert.embedding_length", Type: 8, StringValue: "768"}}, false},
		{"duplicate", []ggufTestMetadataEntry{{Key: "bert.embedding_length", Type: 4, Uint32Value: 768}, {Key: "bert.embedding_length", Type: 4, Uint32Value: 384}}, false},
		{"unadmitted-output-head", []ggufTestMetadataEntry{{Key: "bert.embedding_length", Type: 4, Uint32Value: 768}, {Key: "bert.embedding_length_out", Type: 4, Uint32Value: 384}}, false},
		{"rank-pooling", []ggufTestMetadataEntry{{Key: "bert.embedding_length", Type: 4, Uint32Value: 768}, {Key: "bert.pooling_type", Type: 4, Uint32Value: 4}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newLoadoutTestService(t, t.TempDir())
			entries := append([]ggufTestMetadataEntry{{Key: "general.architecture", Type: 8, StringValue: "bert"}, {Key: "bert.context_length", Type: 4, Uint32Value: 8192}}, tc.extra...)
			asset := importModelAssetBytesForLoadoutTest(t, svc, "custom.gguf", buildImageTestGGUF(entries, []string{"token_embd.weight"}))
			prepared, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{CapabilityContract: capabilitydriver.TextEmbedCapabilityContract, RecipeId: capabilitydriver.LlamaEmbedGGUFRecipeID, DisplayName: tc.name, ModelAxes: []*runtimev1.LoadoutModelAxisInput{{SlotId: capabilitydriver.EmbeddingGGUFRequirementID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}}})
			if tc.valid {
				if err != nil || prepared.GetProposedLoadout().GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
					t.Fatalf("custom imported content rejected: %+v %v", prepared, err)
				}
			} else if err == nil {
				t.Fatal("unverifiable output contract admitted")
			}
		})
	}
}
