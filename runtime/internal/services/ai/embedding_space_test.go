package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
	effective := &localEmbedEffectiveInputs{effectiveInputIdentity: identity, request: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"first"}}}
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

func TestCloudEmbeddingSpaceTracksTargetDefaultsAndConnector(t *testing.T) {
	target, _ := structpb.NewStruct(map[string]any{"providerModelId": "embedding-a"})
	effective := &cloudEmbedEffectiveInputs{
		implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud-embed", DriverId: "driver", DriverDialect: "embed/v1"},
		rawTarget:      target, connector: connector.ConnectorRecord{ConnectorID: "connector-a"},
	}
	vectors := []*runtimev1.EmbeddingVector{{Values: []float64{0.1, 0.2}}}
	first, err := cloudEmbeddingSpaceID(effective, vectors)
	if err != nil {
		t.Fatal(err)
	}
	effective.defaults = &structpb.Struct{}
	unchanged, err := cloudEmbeddingSpaceID(effective, vectors)
	if err != nil || unchanged != first {
		t.Fatalf("empty defaults changed the embedding space: %q %v", unchanged, err)
	}
	for _, change := range []func(){
		func() { effective.connector.ConnectorID = "connector-b" },
		func() { effective.rawTarget, _ = structpb.NewStruct(map[string]any{"providerModelId": "embedding-b"}) },
		func() { effective.defaults, _ = structpb.NewStruct(map[string]any{"dimensions": 2}) },
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
