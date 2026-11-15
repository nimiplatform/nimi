package account

import (
	"encoding/json"
	"testing"
)

func TestCharacterCatalogKeepsPublicSourceAndCursorWithoutRelationAuthority(t *testing.T) {
	ref, err := realmSourceMaterializationSourceRefJSON(realmCharacterPublicAvatarTestSourceRef())
	if err != nil {
		t.Fatal(err)
	}
	source := realmCharacterPublicAvatarTestSourceRef()
	item := map[string]any{"sourceRef": ref, "id": source.ID, "worldId": source.WorldID, "sourceKind": source.Kind, "displayName": "Partner", "worldName": "World", "summary": "A public introduction", "traits": []string{}, "topics": []string{}, "relation": map[string]any{"state": "connectable", "runtimeSourceRef": "must-not-cross-boundary"}}
	page := map[string]any{"items": []any{item}, "hasMore": true, "nextCursor": "next-page"}
	raw, _ := json.Marshal(page)
	result, err := decodeRealmCharacterDiscovery(string(raw), 20)
	if err != nil || len(result.Items) != 1 || result.NextCursor != "next-page" || result.Items[0].SourceRef.ID != source.ID || !result.Items[0].Connectable {
		t.Fatalf("page: %+v %v", result, err)
	}
	page["nextCursor"] = nil
	raw, _ = json.Marshal(page)
	if _, err := decodeRealmCharacterDiscovery(string(raw), 20); err == nil {
		t.Fatal("partial pagination accepted")
	}
	page["nextCursor"] = "next-page"
	item["worldId"] = "wrong-world"
	raw, _ = json.Marshal(page)
	if _, err := decodeRealmCharacterDiscovery(string(raw), 20); err == nil {
		t.Fatal("source mismatch accepted")
	}
}
