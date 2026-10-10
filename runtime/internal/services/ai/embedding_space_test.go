package ai

import (
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestLocalEmbeddingSpaceTracksContentNotLoadoutOrRequestIdentity(t *testing.T) {
	identity := &runtimev1.LoadoutEffectiveInputIdentity{
		LoadoutId: "loadout-a", CapabilityContract: "text.embed", RecipeId: "embedding-recipe", RecipeRevision: "1",
		Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "embedding", DriverId: "driver", DriverDialect: "embed/v1"},
		ModelAxes:      []*runtimev1.LoadoutEffectiveModelAxisIdentity{{SlotId: "model", ModelAssetId: "asset-a", ContentId: "content-a"}},
	}
	vectors := []*runtimev1.EmbeddingVector{{Values: []float64{0.1, 0.2}}}
	digest := strings.Repeat("a", 64)
	plan, planErr := (capabilitydriver.LlamaEmbedDriver{}).PlanEmbedInvocation(capabilitydriver.EmbedInvocationInput{RecipeID: capabilitydriver.LlamaEmbedGGUFRecipeID, ModelContextWindowTokens: 8192, ExactBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: capabilitydriver.EmbeddingGGUFRequirementID, EmbeddingInputProtocol: capabilitydriver.EmbeddingInputNativeV1, ModelAssetID: "asset", AbsolutePath: filepath.Join(t.TempDir(), "embed.gguf"), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest}}, Request: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"first"}}})
	if planErr != nil {
		t.Fatal(planErr)
	}
	effective := &localEmbedEffectiveInputs{effectiveInputIdentity: identity, plan: plan, request: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"first"}}}
	first, err := localEmbeddingSpaceID(effective, vectors)
	if err != nil || first == "" {
		t.Fatalf("space identity: %q %v", first, err)
	}
	copy := proto.Clone(identity).(*runtimev1.LoadoutEffectiveInputIdentity)
	copy.LoadoutId = "new-loadout"
	copy.ModelAxes[0].ModelAssetId = "reimported-asset"
	effective.effectiveInputIdentity = copy
	effective.displayName = "Renamed"
	effective.request.Inputs = []string{"second", "third"}
	same, err := localEmbeddingSpaceID(effective, append(vectors, vectors[0]))
	if err != nil || first != same {
		t.Fatalf("non-semantic changes invalidated vector space: %q %q %v", first, same, err)
	}
	copy.ModelAxes[0].ContentId = "content-b"
	changed, err := localEmbeddingSpaceID(effective, vectors)
	if err != nil || changed == first {
		t.Fatalf("same-dimension model replacement reused vector space: %q %v", changed, err)
	}
	if identity.GetLoadoutId() != "loadout-a" || identity.ModelAxes[0].ModelAssetId != "asset-a" {
		t.Fatal("space projection mutated captured attribution")
	}
}

func TestNomicQueryDocumentShareCapturedSpaceAndSeparateOldRaw(t *testing.T) {
	identity := &runtimev1.LoadoutEffectiveInputIdentity{CapabilityContract: "text.embed", RecipeId: capabilitydriver.LlamaEmbedGGUFRecipeID, RecipeRevision: "1", Implementation: (&capabilitydriver.Identity{ImplementationID: capabilitydriver.LlamaEmbedImplementationID, DriverID: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaEmbedDriverDialect}).Proto(), ModelAxes: []*runtimev1.LoadoutEffectiveModelAxisIdentity{{SlotId: capabilitydriver.EmbeddingGGUFRequirementID, ContentId: "sha256:fixture"}}}
	vectors := []*runtimev1.EmbeddingVector{{Values: []float64{0.1, 0.2}}}
	raw, err := localEmbeddingIdentitySpaceID(identity, vectors)
	if err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("a", 64)
	var first string
	for _, purpose := range []runtimev1.TextEmbedPurpose{runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT, runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY} {
		plan, err := (capabilitydriver.LlamaEmbedDriver{}).PlanEmbedInvocation(capabilitydriver.EmbedInvocationInput{RecipeID: capabilitydriver.LlamaEmbedGGUFRecipeID, ModelContextWindowTokens: 8192, ExactBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: capabilitydriver.EmbeddingGGUFRequirementID, ModelAssetID: "fixture", AbsolutePath: filepath.Join(t.TempDir(), "model.gguf"), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest, EmbeddingInputProtocol: capabilitydriver.EmbeddingInputNomicV1}}, Request: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{purpose.String()}, Purpose: purpose}})
		if err != nil {
			t.Fatal(err)
		}
		actual, err := localEmbeddingSpaceID(&localEmbedEffectiveInputs{effectiveInputIdentity: identity, plan: plan}, vectors)
		if err != nil {
			t.Fatal(err)
		}
		if actual == raw || (first != "" && actual != first) {
			t.Fatalf("incompatible space: raw=%q first=%q actual=%q", raw, first, actual)
		}
		first = actual
	}
}

func TestQwen3EmbeddingDialectAndOptionsSeparateVectorSpace(t *testing.T) {
	identity := &runtimev1.LoadoutEffectiveInputIdentity{
		CapabilityContract: "text.embed", RecipeId: capabilitydriver.LlamaEmbedGGUFRecipeID, RecipeRevision: "1",
		Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: capabilitydriver.LlamaEmbedImplementationID,
			DriverId: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaEmbedDriverDialect},
		ModelAxes: []*runtimev1.LoadoutEffectiveModelAxisIdentity{{SlotId: capabilitydriver.EmbeddingGGUFRequirementID, ContentId: "sha256:same-model-content"}},
	}
	vectors := []*runtimev1.EmbeddingVector{{Values: []float64{1, 0}}}
	generic, err := localEmbeddingIdentitySpaceID(identity, vectors)
	if err != nil {
		t.Fatal(err)
	}
	qwen := proto.Clone(identity).(*runtimev1.LoadoutEffectiveInputIdentity)
	qwen.RecipeId = capabilitydriver.LlamaQwen3EmbedRecipeID
	qwen.Implementation.DriverDialect = capabilitydriver.LlamaQwen3EmbedDialect
	qwenSpace, err := localEmbeddingIdentitySpaceID(qwen, vectors)
	if err != nil || qwenSpace == generic {
		t.Fatalf("last-pooling Qwen dialect reused generic space: generic=%q qwen=%q err=%v", generic, qwenSpace, err)
	}
	qwen.Options, _ = structpb.NewStruct(map[string]any{"contextSize": 8192, "gpuLayers": 99})
	withOptions, err := localEmbeddingIdentitySpaceID(qwen, vectors)
	if err != nil || withOptions == qwenSpace {
		t.Fatalf("changed Qwen execution options reused space: before=%q after=%q err=%v", qwenSpace, withOptions, err)
	}
}

func TestCloudEmbeddingSpaceTracksExecutionTargetNotCatalogRevision(t *testing.T) {
	target, _ := structpb.NewStruct(map[string]any{"provider": "openai", "providerModelId": "embedding-a", "remoteModelCatalogId": "catalog-a"})
	effective := &cloudEmbedEffectiveInputs{
		implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud-embed", DriverId: "driver", DriverDialect: "embed/v1"},
		rawTarget:      target, connector: connector.ConnectorRecord{
			ConnectorID: "connector-a", Provider: "openai", Endpoint: "https://embeddings.example.test",
			AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY,
		},
	}
	vectors := []*runtimev1.EmbeddingVector{{Values: []float64{0.1, 0.2}}}
	first, err := cloudEmbeddingSpaceID(effective, vectors)
	if err != nil {
		t.Fatal(err)
	}
	effective.defaults = &structpb.Struct{}
	effective.connector.Label = "Renamed"
	effective.connector.UpdatedAt++
	effective.connector.CredentialCustodyRef = "new-custody"
	effective.rawTarget.Fields["remoteModelCatalogId"] = structpb.NewStringValue("catalog-b")
	unchanged, err := cloudEmbeddingSpaceID(effective, vectors)
	if err != nil || unchanged != first {
		t.Fatalf("non-semantic changes invalidated the embedding space: %q %v", unchanged, err)
	}
	if effective.rawTarget.Fields["remoteModelCatalogId"].GetStringValue() != "catalog-b" {
		t.Fatal("space projection mutated captured catalog admission")
	}
	for _, change := range []func(){
		func() { effective.connector.ConnectorID = "connector-b" },
		func() { effective.connector.Endpoint = "https://other-embeddings.example.test" },
		func() { effective.rawTarget.Fields["providerModelId"] = structpb.NewStringValue("embedding-b") },
		func() { effective.implementation.DriverDialect = "embed/v2" },
	} {
		change()
		next, err := cloudEmbeddingSpaceID(effective, vectors)
		if err != nil || next == first {
			t.Fatalf("changed composition reused space: %q %v", next, err)
		}
		first = next
	}
}

func TestEmbeddingSpaceRequiresConsistentDimensions(t *testing.T) {
	for _, vectors := range [][]*runtimev1.EmbeddingVector{
		nil, {nil}, {{Values: []float64{1}}, {Values: []float64{1, 2}}},
	} {
		if _, err := embeddingSpaceID("local", "", vectors); err == nil {
			t.Fatal("invalid embedding dimensions accepted")
		}
	}
	one, _ := embeddingSpaceID("local", "", []*runtimev1.EmbeddingVector{{Values: []float64{1}}})
	two, _ := embeddingSpaceID("local", "", []*runtimev1.EmbeddingVector{{Values: []float64{1, 2}}})
	if one == two {
		t.Fatal("different dimensions share a vector space")
	}
}
