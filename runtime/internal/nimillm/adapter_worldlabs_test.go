package nimillm

import (
	"reflect"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestBuildWorldLabsGeneratePayloadForTextPrompt(t *testing.T) {
	spec := &runtimev1.WorldGenerateScenarioSpec{
		DisplayName: "Fixture World",
		TextPrompt:  "A walkable plaza with layered stone stairs",
		Tags:        []string{"nimi", "fixture"},
		Seed:        17,
	}

	payload, promptText, err := buildWorldLabsGeneratePayload(spec, "worldlabs/marble-1.1")
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	if promptText != spec.GetTextPrompt() {
		t.Fatalf("unexpected prompt text: %q", promptText)
	}
	if got := ValueAsString(payload["display_name"]); got != "Fixture World" {
		t.Fatalf("unexpected display_name: %q", got)
	}
	if got := ValueAsString(payload["model"]); got != "marble-1.1" {
		t.Fatalf("unexpected model: %q", got)
	}
	if got, ok := payload["seed"].(uint64); !ok || got != 17 {
		t.Fatalf("unexpected seed: %#v", payload["seed"])
	}
	if got, ok := payload["tags"].([]string); !ok || !reflect.DeepEqual(got, []string{"nimi", "fixture"}) {
		t.Fatalf("unexpected tags: %#v", payload["tags"])
	}

	worldPrompt, ok := payload["world_prompt"].(map[string]any)
	if !ok {
		t.Fatalf("expected world_prompt payload, got %#v", payload["world_prompt"])
	}
	if got := ValueAsString(worldPrompt["type"]); got != "text" {
		t.Fatalf("unexpected prompt type: %q", got)
	}
	if got := ValueAsString(worldPrompt["text_prompt"]); got != spec.GetTextPrompt() {
		t.Fatalf("unexpected text_prompt: %q", got)
	}
}

func TestBuildWorldLabsGeneratePayloadForMultiImagePrompt(t *testing.T) {
	spec := &runtimev1.WorldGenerateScenarioSpec{
		TextPrompt: "Create a dense courtyard world from multiple viewpoints",
		Conditioning: &runtimev1.WorldGenerateScenarioSpec_MultiImagePrompt{
			MultiImagePrompt: &runtimev1.WorldGenerateMultiImagePrompt{
				Images: []*runtimev1.WorldGenerateMultiImageReference{
					{
						Azimuth: 0,
						Content: &runtimev1.WorldGenerateAssetSource{
							Source: &runtimev1.WorldGenerateAssetSource_Uri{Uri: "https://example.com/front.png"},
						},
					},
					{
						Azimuth: 90,
						Content: &runtimev1.WorldGenerateAssetSource{
							Source: &runtimev1.WorldGenerateAssetSource_MediaAssetId{MediaAssetId: "media-asset-123"},
						},
					},
				},
			},
		},
	}

	payload, promptText, err := buildWorldLabsGeneratePayload(spec, "marble-1.1-plus")
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	if promptText != spec.GetTextPrompt() {
		t.Fatalf("unexpected prompt text: %q", promptText)
	}
	if got := ValueAsString(payload["model"]); got != "marble-1.1-plus" {
		t.Fatalf("unexpected model: %q", got)
	}

	worldPrompt, ok := payload["world_prompt"].(map[string]any)
	if !ok {
		t.Fatalf("expected world_prompt payload, got %#v", payload["world_prompt"])
	}
	if got := ValueAsString(worldPrompt["type"]); got != "multi-image" {
		t.Fatalf("unexpected prompt type: %q", got)
	}
	if got := ValueAsString(worldPrompt["text_prompt"]); got != spec.GetTextPrompt() {
		t.Fatalf("unexpected text_prompt: %q", got)
	}

	items, ok := worldPrompt["multi_image_prompt"].([]map[string]any)
	if !ok {
		t.Fatalf("expected multi_image_prompt items, got %#v", worldPrompt["multi_image_prompt"])
	}
	if len(items) != 2 {
		t.Fatalf("unexpected image count: %d", len(items))
	}
	if got := ValueAsInt64(items[0]["azimuth"]); got != 0 {
		t.Fatalf("unexpected first azimuth: %d", got)
	}
	if got := ValueAsString(MapField(items[0]["content"], "source")); got != "uri" {
		t.Fatalf("unexpected first source kind: %q", got)
	}
	if got := ValueAsString(MapField(items[0]["content"], "uri")); got != "https://example.com/front.png" {
		t.Fatalf("unexpected first uri: %q", got)
	}
	if got := ValueAsInt64(items[1]["azimuth"]); got != 90 {
		t.Fatalf("unexpected second azimuth: %d", got)
	}
	if got := ValueAsString(MapField(items[1]["content"], "source")); got != "media_asset" {
		t.Fatalf("unexpected second source kind: %q", got)
	}
	if got := ValueAsString(MapField(items[1]["content"], "media_asset_id")); got != "media-asset-123" {
		t.Fatalf("unexpected second media asset id: %q", got)
	}
}
