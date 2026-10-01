package runtimeagent

import (
	"strings"
	"testing"
)

func sourceWorldTimeModelTestSnapshotWith(t *testing.T, timeModel map[string]any) localAgentSourceSnapshotV2 {
	t.Helper()
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	core, ok := snapshot.Semantic.OwningWorld.Core.interfaceValue().(map[string]any)
	if !ok {
		t.Fatal("owning world core is not an object")
	}
	core["timeModel"] = timeModel
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
	return snapshot
}

func sourceWorldTimeModelUnitText(t *testing.T, snapshot localAgentSourceSnapshotV2) string {
	t.Helper()
	partition, err := projectLocalAgentSourcePartitionV1(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, unit := range partition.CognitionUnits {
		if unit.StableID == "source.world.time-model" {
			return unit.Text
		}
	}
	t.Fatal("world time model unit is absent")
	return ""
}

func TestStaticWorldTimeModelReachesContextWithoutAnyWorldDate(t *testing.T) {
	for _, label := range []any{"第三次退潮", nil} {
		text := sourceWorldTimeModelUnitText(t, sourceWorldTimeModelTestSnapshotWith(t, map[string]any{"mode": "static", "label": label}))
		if !strings.Contains(text, "static") || !strings.Contains(text, "world_clock") {
			t.Fatalf("static time model unit = %q", text)
		}
		for _, forbidden := range []string{"real_started_at", "world_started_at", "flow_ratio", "is_paused", "2026-"} {
			if strings.Contains(text, forbidden) {
				t.Fatalf("static time model unit leaked %q: %q", forbidden, text)
			}
		}
		if label != nil && !strings.Contains(text, label.(string)) {
			t.Fatalf("static time label is absent: %q", text)
		}
	}
}

func TestWallClockWorldTimeModelKeepsItsAnchor(t *testing.T) {
	text := sourceWorldTimeModelUnitText(t, sourceWorldTimeModelTestSnapshotWith(t, map[string]any{
		"mode": "wallClockAnchored", "flowRatio": 1, "isPaused": true,
		"anchor":          map[string]any{"realStartedAt": "2026-09-30T00:00:00.000Z", "worldStartedAt": "2193-04-17T22:00:00.000Z", "worldStartedAtDisplay": "站历 2193-04-17"},
		"pausedWorldTime": "2193-04-18T02:00:00.000Z", "calendar": nil, "displayFormat": nil,
	}))
	for _, want := range []string{"wallClockAnchored", "2193-04-17T22:00:00.000Z", "2193-04-18T02:00:00.000Z"} {
		if !strings.Contains(text, want) {
			t.Fatalf("wall-clock time model unit lacks %q: %q", want, text)
		}
	}
}

func TestWorldTimeModelRejectsMixedOrIncompleteShapes(t *testing.T) {
	anchor := map[string]any{"realStartedAt": "2026-09-30T00:00:00.000Z", "worldStartedAt": "2026-09-30T00:00:00.000Z", "worldStartedAtDisplay": "now"}
	for name, timeModel := range map[string]map[string]any{
		"static with anchor":   {"mode": "static", "label": nil, "anchor": anchor},
		"static without label": {"mode": "static"},
		"static blank label":   {"mode": "static", "label": " 雨夜"},
		"paused without time": {"mode": "wallClockAnchored", "flowRatio": 1, "isPaused": true, "anchor": anchor,
			"pausedWorldTime": nil, "calendar": nil, "displayFormat": nil},
		"running with paused time": {"mode": "wallClockAnchored", "flowRatio": 1, "isPaused": false, "anchor": anchor,
			"pausedWorldTime": "2026-09-30T00:00:00.000Z", "calendar": nil, "displayFormat": nil},
		"unknown mode": {"mode": "parallel", "label": nil},
	} {
		snapshot := sourceWorldTimeModelTestSnapshotWith(t, timeModel)
		if _, err := decodeRealmSourceCompilerWorldCoreV3(snapshot.Semantic.OwningWorld.Core); err == nil {
			t.Fatalf("%s: decode accepted %#v", name, timeModel)
		}
	}
}
