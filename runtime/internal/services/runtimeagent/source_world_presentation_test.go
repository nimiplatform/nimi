package runtimeagent

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestWorldSceneSpatialAndVisualIdentitySurvivePacketAndPartition(t *testing.T) {
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	value, err := decodeSourceMaterializationJSON(vector.Packet)
	if err != nil {
		t.Fatal(err)
	}
	payload := value.(map[string]any)["semanticPayload"].(map[string]any)
	context := payload["materializationContext"].(map[string]any)
	core := context["owningWorld"].(map[string]any)["core"].(map[string]any)
	visual := map[string]any{
		"artMedium": "watercolor", "materialArchitecture": "brick", "lightingAtmosphere": "moonlight",
		"styleBoundaries": []any{"muted colors"}, "sonicMood": "distant bells",
	}
	core["presentation"] = map[string]any{"visualIdentity": visual}
	spatial := map[string]any{"settingType": "interior", "connectedSceneIds": []any{"courtyard"}}
	core["scenes"] = []any{
		map[string]any{"sceneId": "hall", "name": "Hall", "summary": "Entrance hall", "spatial": spatial},
		map[string]any{"sceneId": "courtyard", "name": "Courtyard", "summary": "Open courtyard"},
	}
	readWorld := func() (sourceMaterializationWorldRecordV3, error) {
		t.Helper()
		wire, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		packet, err := decodeSourceMaterializationPacketStreamV3(bytes.NewReader(wire), int64(len(wire)), vector.Expectation.PublishedLimits)
		if err != nil {
			return sourceMaterializationWorldRecordV3{}, err
		}
		world := packet.SemanticPayload.MaterializationContext.OwningWorld
		return world, validateSourceMaterializationWorldRecordV3(world)
	}
	world, err := readWorld()
	if err != nil {
		t.Fatal(err)
	}
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	snapshot.Semantic.OwningWorld = world
	partition, err := projectLocalAgentSourcePartitionV1(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	units := map[string]string{}
	for _, unit := range partition.CognitionUnits {
		units[unit.StableID] = unit.Text
	}
	for id, values := range map[string][]string{
		"source.world.presentation": {"watercolor", "brick", "moonlight", "muted colors", "distant bells"},
		"source.world.scene.hall":   {"interior", "courtyard"},
	} {
		for _, want := range values {
			if !strings.Contains(units[id], want) {
				t.Errorf("%s omitted %q", id, want)
			}
		}
	}
	for _, tc := range []struct {
		field string
		obj   map[string]any
		bad   any
	}{
		{"settingType", spatial, "unsupported"}, {"connectedSceneIds", spatial, nil},
		{"styleBoundaries", visual, []any{}}, {"sonicMood", visual, nil},
		{"unknownField", spatial, "extra"},
	} {
		t.Run(tc.field, func(t *testing.T) {
			original, present := tc.obj[tc.field]
			tc.obj[tc.field] = tc.bad
			_, err := readWorld()
			if present {
				tc.obj[tc.field] = original
			} else {
				delete(tc.obj, tc.field)
			}
			if err == nil || sourceMaterializationV3FailureCode(err) != sourceMaterializationFailurePacketContractV3 {
				t.Fatalf("invalid world field %s: got %v, want packet contract failure", tc.field, err)
			}
		})
	}
}

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
