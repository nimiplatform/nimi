package runtimeagent

import (
	"strings"
	"testing"
)

func TestWorldHeroResourceSurvivesTypedSnapshotAndPartition(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	core := snapshot.Semantic.OwningWorld.Core.interfaceValue().(map[string]any)
	const hero = "resource-world-hero"
	core["presentation"] = map[string]any{"heroResourceRef": hero}
	raw, err := canonicalizeSourceMaterializationRealmV3(core)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeSourceMaterializationJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	snapshot.Semantic.OwningWorld.Core, err = normalizeSourceMaterializationJSONValue(decoded)
	if err != nil {
		t.Fatal(err)
	}
	world, err := decodeRealmSourceCompilerWorldCoreV3(snapshot.Semantic.OwningWorld.Core)
	if err != nil {
		t.Fatal(err)
	}
	if world.Presentation.HeroResourceRef == nil || *world.Presentation.HeroResourceRef != hero {
		t.Fatal("typed snapshot lost world hero reference")
	}
	partition, err := projectLocalAgentSourcePartitionV1(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, unit := range partition.CognitionUnits {
		if unit.StableID == "source.world.presentation" {
			if !strings.Contains(unit.Text, "hero_resource_ref") || !strings.Contains(unit.Text, hero) {
				t.Fatalf("source partition lost hero: %q", unit.Text)
			}
			return
		}
	}
	t.Fatal("hero-only world presentation was omitted")
}
