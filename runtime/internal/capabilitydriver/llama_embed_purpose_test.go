package capabilitydriver

import (
	"encoding/json"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"path/filepath"
	"strings"
	"testing"
)

func TestNomicEmbeddingPurposeMapsExactInputAndRejectsMissing(t *testing.T) {
	digest := strings.Repeat("a", 64)
	binding := InvocationExactBinding{RequirementID: EmbeddingGGUFRequirementID, ModelAssetID: "nomic-fixture", AbsolutePath: filepath.Join(t.TempDir(), "model.gguf"), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest, EmbeddingInputProtocol: EmbeddingInputNomicV1}
	var family, process string
	for _, item := range []struct {
		purpose runtimev1.TextEmbedPurpose
		prefix  string
	}{
		{runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT, "search_document: "},
		{runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY, "search_query: "},
	} {
		spec := &runtimev1.TextEmbedScenarioSpec{Inputs: []string{" 原始文字 "}, Purpose: item.purpose}
		plan, err := (LlamaEmbedDriver{}).PlanEmbedInvocation(EmbedInvocationInput{RecipeID: LlamaEmbedGGUFRecipeID, ModelContextWindowTokens: 8192, ExactBindings: []InvocationExactBinding{binding}, Request: spec})
		if err != nil {
			t.Fatal(err)
		}
		var body struct {
			Input []string `json:"input"`
		}
		if err := json.Unmarshal(plan.RequestBody(), &body); err != nil {
			t.Fatal(err)
		}
		if len(body.Input) != 1 || body.Input[0] != item.prefix+" 原始文字 " || spec.Inputs[0] != " 原始文字 " {
			t.Fatalf("mapping changed original text: %+v %+v", body, spec)
		}
		if family != "" && (family != plan.RepresentationFamily() || process != plan.ProcessKey()) {
			t.Fatal("compatible roles split representation/process")
		}
		family, process = plan.RepresentationFamily(), plan.ProcessKey()
	}
	for _, purpose := range []runtimev1.TextEmbedPurpose{0, 99} {
		if _, _, err := EmbeddingRepresentation(EmbeddingInputNomicV1, purpose); err == nil {
			t.Fatalf("accepted missing/unknown purpose %v", purpose)
		}
	}
	if _, _, err := EmbeddingRepresentation("unreviewed/v1", runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY); err == nil {
		t.Fatal("unreviewed protocol pretended retrieval support")
	}
}

func TestReviewedNativeEmbeddingRetainsIdentityForBothRetrievalRoles(t *testing.T) {
	for _, purpose := range []runtimev1.TextEmbedPurpose{runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_UNSPECIFIED, runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT, runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY} {
		family, prefix, err := EmbeddingRepresentation(EmbeddingInputNativeV1, purpose)
		if err != nil || family != EmbeddingRepresentationNativeV1 || prefix != "" {
			t.Fatalf("native role changed operation: %v %q %q %v", purpose, family, prefix, err)
		}
	}
}
