package account

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestIntroductionUsesDetailRenditionForAvailableCharacterImage(t *testing.T) {
	image := func(id string) map[string]any {
		family := func(purpose string, widths ...int) map[string]any {
			sources := make([]any, 0, len(widths))
			for _, width := range widths {
				sources = append(sources, map[string]any{
					"url":   fmt.Sprintf("https://assets.example/%s/%s-%d.webp", id, purpose, width),
					"width": width, "height": width, "mimeType": "image/webp",
				})
			}
			return map[string]any{"purpose": purpose, "families": []any{map[string]any{"mimeType": "image/webp", "sources": sources}}}
		}
		return map[string]any{"id": id, "delivery": map[string]any{
			"resourceId": id, "contentVersion": strings.Repeat("a", 64), "publicationGeneration": 2, "policyVersion": "v2",
			"images": []any{family("avatar", 40, 80, 160, 256), family("detail", 320, 640, 960, 1024)},
		}}
	}
	for _, tc := range []struct {
		name  string
		media map[string]any
		want  string
	}{
		{"avatar-only official character", map[string]any{"assets": map[string]any{"avatar": image("avatar")}}, "https://assets.example/avatar/detail-960.webp"},
		{"portrait before avatar", map[string]any{"assets": map[string]any{"avatar": image("avatar"), "portrait": image("portrait")}}, "https://assets.example/portrait/detail-960.webp"},
		{"reference before portrait", map[string]any{"assets": map[string]any{"avatar": image("avatar"), "portrait": image("portrait"), "referenceImage": image("reference")}}, "https://assets.example/reference/detail-960.webp"},
		{"external reference", map[string]any{"referenceImageUrl": "https://assets.example/reference.png", "assets": map[string]any{"avatar": image("avatar")}}, "https://assets.example/reference.png"},
		{"external portrait", map[string]any{"portraitUrl": "https://assets.example/portrait.png", "avatarUrl": "https://assets.example/avatar.png"}, "https://assets.example/portrait.png"},
		{"external avatar", map[string]any{"avatarUrl": "https://assets.example/avatar.png"}, "https://assets.example/avatar.png"},
		{"no image", map[string]any{}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := realmCharacterPublicAvatarTestSourceRef()
			server := realmCharacterPublicAvatarServer(t, source, tc.media)
			defer server.Close()
			svc := newRealmUnaryHarnessService(t, server.URL)
			completeLogin(t, svc)
			value, err := svc.ResolveRealmCharacterPublicIntroduction(context.Background(), "acct-1", source)
			if err != nil {
				t.Fatal(err)
			}
			if tc.want == "" {
				if value.ReferenceImageURL != nil {
					t.Fatalf("absent image was fabricated: %q", *value.ReferenceImageURL)
				}
			} else if value.ReferenceImageURL == nil || *value.ReferenceImageURL != tc.want {
				t.Fatalf("introduction image = %v, want %q", value.ReferenceImageURL, tc.want)
			}
			if tc.name == "avatar-only official character" {
				avatar, err := svc.ResolveRealmCharacterPublicAvatar(context.Background(), "acct-1", source)
				if err != nil || avatar == nil || *avatar != "https://assets.example/avatar/avatar-160.webp" {
					t.Fatalf("small inventory avatar changed: %v, %v", avatar, err)
				}
			}
		})
	}
}

func TestIntroductionRejectsInvalidPortraitDelivery(t *testing.T) {
	source := realmCharacterPublicAvatarTestSourceRef()
	server := realmCharacterPublicAvatarServer(t, source, map[string]any{"assets": map[string]any{
		"portrait": map[string]any{"id": "portrait", "delivery": map[string]any{
			"resourceId": "other-resource", "contentVersion": strings.Repeat("a", 64), "publicationGeneration": 1, "policyVersion": "v2",
		}},
		"avatar": realmCharacterPublicAvatarAsset("avatar", "https://assets.example/avatar.png"),
	}})
	defer server.Close()
	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)
	if value, err := svc.ResolveRealmCharacterPublicIntroduction(context.Background(), "acct-1", source); err == nil || value != nil {
		t.Fatal("invalid portrait delivery was hidden by an avatar fallback")
	}
}
