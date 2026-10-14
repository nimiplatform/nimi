package runtimeagent

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestWorldDiscoveryWireContractIsExtensibleAndCanonical(t *testing.T) {
	tooMany := make([]any, 33)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("topic-%02d", i)
	}
	for _, tc := range []struct {
		name  string
		ids   []any
		valid bool
	}{
		{"empty", []any{}, true},
		{"future-dictionary-id", []any{"space-opera"}, true},
		{"known", []any{"ecology", "history"}, true},
		{"empty-id", []any{""}, false},
		{"invalid-slug", []any{"History"}, false},
		{"non-ascii", []any{"历史"}, false},
		{"unsorted", []any{"history", "ecology"}, false},
		{"duplicate", []any{"history", "history"}, false},
		{"too-long", []any{strings.Repeat("a", 65)}, false},
		{"too-many", tooMany, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
			world := snapshot.Semantic.OwningWorld.Core.interfaceValue().(map[string]any)
			world["discovery"] = map[string]any{"topicIds": tc.ids}
			value, err := normalizeSourceMaterializationJSONValue(world)
			if err != nil {
				t.Fatal(err)
			}
			_, err = decodeRealmSourceCompilerWorldCoreV3(value)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
}

func TestReleaseContentFieldsReachTypedCorpusWithoutChangingLorebook(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	before, err := projectLocalAgentSourcePartitionV1(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	profile := snapshot.Semantic.Source.Profile.interfaceValue().(map[string]any)
	identity := profile["identity"].(map[string]any)
	identity["ageDescription"] = "120潮年"
	identity["speciesDescription"] = "腕足族"
	identity["bodyDescription"] = "八腕软体身体"
	identity["lifeStageDescription"] = "成熟期"
	profile["psychology"].(map[string]any)["disposition"] = "沉静而好奇"
	snapshot.Semantic.Source.Profile, err = normalizeSourceMaterializationJSONValue(profile)
	if err != nil {
		t.Fatal(err)
	}
	world := snapshot.Semantic.OwningWorld.Core.interfaceValue().(map[string]any)
	world["narrative"] = map[string]any{"setting": "完整的海庭生活设定"}
	world["discovery"] = map[string]any{"topicIds": []any{"ecology"}}
	snapshot.Semantic.OwningWorld.Core, err = normalizeSourceMaterializationJSONValue(world)
	if err != nil {
		t.Fatal(err)
	}
	after, err := projectLocalAgentSourcePartitionV1(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	foundSetting, foundDisposition, foundIdentity := false, false, false
	for _, unit := range after.CognitionUnits {
		if unit.StableID == "source.world.setting" {
			foundSetting = strings.Contains(unit.Text, "完整的海庭生活设定")
		}
		if unit.StableID == "source.psychology.disposition" {
			foundDisposition = strings.Contains(unit.Text, "沉静而好奇")
		}
		if unit.StableID == "source.identity" {
			foundIdentity = strings.Contains(unit.Text, "120潮年") && strings.Contains(unit.Text, "成熟期")
		}
		if strings.Contains(unit.SourcePath, ".discovery") {
			t.Fatal("discovery metadata entered cognition")
		}
	}
	if !foundSetting || !foundDisposition || !foundIdentity {
		t.Fatal("explicit source content was dropped")
	}
	// Declaration ownership is independent of the added source descriptions.
	if !reflect.DeepEqual(before.Lorebook, after.Lorebook) {
		t.Fatal("source descriptions changed lorebook declarations")
	}
}

func TestReleaseCharacterDescriptionsRejectBlankNullAndWrongTypes(t *testing.T) {
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	profile := sourceMaterializationStrictSchemaProfileV3(t, vector.Packet)
	for _, bad := range []any{"", "   ", nil, []any{"Adult"}} {
		candidate := sourceMaterializationStrictSchemaCloneV3(t, profile)
		candidate["identity"].(map[string]any)["ageDescription"] = bad
		if err := validateSourceMaterializationProfileShapeJSONV3(candidate, "$.profile"); err == nil {
			t.Fatalf("accepted invalid age description %#v", bad)
		}
	}
}
