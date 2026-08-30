package storage

import (
	"strings"
	"testing"
	"time"
)

func TestInspectRuntimeSourceStateRejectsCorruptCurrentScopeUnits(t *testing.T) {
	backend, err := NewRuntimeSourceBackend(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer backend.Close()
	scopeID := "scope-inspection"
	_, err = backend.ReplaceRuntimeSourceCorpus(
		scopeID,
		strings.Repeat("a", 64),
		strings.Repeat("b", 64),
		[]RuntimeSourceUnit{{
			UnitID: "unit-inspection", Category: "biography_event", SourcePath: "profile.biography",
			SourceRef: RuntimeSourceRef{Kind: "worldCharacter", WorldID: "world-1", RefID: "character-1", SchemaVersion: "realm.world-character-core/v1", ContentHash: strings.Repeat("c", 64)},
			Text:      "Owner source", ProvenanceRefs: []string{"realm:source"}, Priority: 1,
		}},
		[]RuntimeSourceOmission{},
		"building", "", 0, 0, time.Now().UTC(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := backend.db.Exec(`UPDATE runtime_source_unit SET provenance_refs_json = 'not-json' WHERE scope_id = ?`, scopeID); err != nil {
		t.Fatal(err)
	}
	if _, err := backend.InspectRuntimeSourceState(scopeID); err == nil {
		t.Fatal("corrupt current owner source unit passed structural inspection")
	}
}
