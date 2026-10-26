package realmmedia

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestImageSelectsSuppliedRenditionAndNeverFallsBackToOriginal(t *testing.T) {
	payload := map[string]any{"resourceId": "image1", "contentVersion": strings.Repeat("a", 64), "publicationGeneration": 1, "policyVersion": "v1", "originalUrl": "https://origin.example/large.png",
		"images": []any{map[string]any{"purpose": "avatar", "families": []any{map[string]any{"mimeType": "image/webp", "sources": []any{
			map[string]any{"url": "https://media.example/80.webp", "width": 80, "height": 80, "mimeType": "image/webp"},
			map[string]any{"url": "https://media.example/160.webp", "width": 160, "height": 160, "mimeType": "image/webp"},
			map[string]any{"url": "https://media.example/256.webp", "width": 256, "height": 256, "mimeType": "image/webp"},
		}}}}}}
	raw, _ := json.Marshal(payload)
	delivery, err := Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	selected := Image(delivery, "avatar", 160)
	if selected == nil || *selected != "https://media.example/160.webp" {
		t.Fatal("wrong bounded image selection")
	}
	if Image(delivery, "hero", 960) != nil {
		t.Fatal("original used for missing display purpose")
	}
	payload["contentVersion"] = "invalid"
	raw, _ = json.Marshal(payload)
	if _, err := Decode(raw); err == nil {
		t.Fatal("unversioned media accepted")
	}
}
