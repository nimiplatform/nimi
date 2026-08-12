package nimillm

import (
	"encoding/json"
	"testing"
)

func TestBuildWorldLabsManifestKeepsExecutionProvenanceOutOfStableOutput(t *testing.T) {
	raw, metadata, err := buildWorldLabsManifest(map[string]any{
		"world_id": "world-1",
		"model":    "provider-private-model",
		"assets": map[string]any{
			"thumbnail_url": "https://example.invalid/thumb.png",
		},
	}, "provider-operation-1")
	if err != nil {
		t.Fatal(err)
	}
	manifest := map[string]any{}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"provider", "provider_operation", "model"} {
		if _, ok := manifest[key]; ok {
			t.Fatalf("stable world manifest exposed %s", key)
		}
		if _, ok := metadata[key]; ok {
			t.Fatalf("world artifact metadata exposed %s", key)
		}
	}
	if manifest["world_id"] != "world-1" || metadata["world_id"] != "world-1" {
		t.Fatalf("world identity was not preserved: manifest=%v metadata=%v", manifest, metadata)
	}
}
