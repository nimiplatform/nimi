package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func realmCharacterDiscoveryTestAvatarMedia(url string) map[string]any {
	return map[string]any{
		"resourceId":            "res-avatar-1",
		"contentVersion":        strings.Repeat("a", 64),
		"publicationGeneration": 1,
		"policyVersion":         "v1",
		"expiresAt":             nil,
		"originalUrl":           "https://origin.example.test/original.png",
		"previewUrl":            nil,
		"video":                 nil,
		"images": []any{
			map[string]any{
				"purpose": "avatar",
				"families": []any{
					map[string]any{
						"mimeType": "image/webp",
						"sources": []any{
							map[string]any{"url": "https://cdn.example.test/avatar-80.webp", "width": 80, "height": 80, "mimeType": "image/webp"},
							map[string]any{"url": url, "width": 160, "height": 160, "mimeType": "image/webp"},
							map[string]any{"url": "https://cdn.example.test/avatar-256.webp", "width": 256, "height": 256, "mimeType": "image/webp"},
						},
					},
				},
			},
		},
	}
}

func realmCharacterDiscoveryCanonicalItem(t *testing.T, source RealmSourceMaterializationSourceRefV3) map[string]any {
	t.Helper()
	ref, err := realmSourceMaterializationSourceRefJSON(source)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{
		"id":             source.ID,
		"sourceRef":      ref,
		"displayName":    "Partner",
		"summary":        "A public introduction",
		"worldName":      "World",
		"role":           "Chronicler",
		"avatarMedia":    realmCharacterDiscoveryTestAvatarMedia("https://cdn.example.test/avatar-160.webp"),
		"avatarUrl":      "https://cdn.example.test/fallback-avatar.png",
		"portraitMedia":  nil,
		"portraitUrl":    "https://cdn.example.test/portrait.png",
		"voiceSampleUrl": "https://cdn.example.test/voice.mp3",
		"relation": map[string]any{
			"state":            "connectable",
			"connectionId":     nil,
			"runtimeSourceRef": "must-not-cross-boundary",
		},
	}
}

func TestCharacterCatalogDecodesCanonicalWorldAndPersonaItems(t *testing.T) {
	worldSource := realmCharacterPublicAvatarTestSourceRef()
	personaSource := RealmSourceMaterializationSourceRefV3{
		Kind:           "personaCharacter",
		ID:             "persona-lin",
		WorldID:        "world-ming",
		OwnerAccountID: "acct-owner-1",
		SourceHash:     strings.Repeat("b", 64),
	}

	worldItem := realmCharacterDiscoveryCanonicalItem(t, worldSource)
	personaItem := realmCharacterDiscoveryCanonicalItem(t, personaSource)
	personaItem["displayName"] = "Lin"
	personaItem["avatarMedia"] = nil
	personaItem["avatarUrl"] = "https://cdn.example.test/persona-avatar.png"
	personaItem["relation"] = map[string]any{"state": "connected"}

	noAvatarSource := realmCharacterPublicAvatarTestSourceRef()
	noAvatarSource.ID = "character-no-avatar"
	noAvatarItem := realmCharacterDiscoveryCanonicalItem(t, noAvatarSource)
	noAvatarItem["avatarMedia"] = nil
	noAvatarItem["avatarUrl"] = nil
	noAvatarItem["relation"] = map[string]any{"state": "unavailable"}

	page := map[string]any{
		"items":      []any{worldItem, personaItem, noAvatarItem},
		"hasMore":    true,
		"nextCursor": "next-page",
		"totalCount": 523,
	}
	raw, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}

	result, err := decodeRealmCharacterDiscovery(string(raw), 20)
	if err != nil {
		t.Fatalf("decode canonical page failed: %v", err)
	}
	if result.NextCursor != "next-page" || len(result.Items) != 3 {
		t.Fatalf("unexpected page shape: %+v", result)
	}
	if result.Items[0].SourceRef.ID != worldSource.ID ||
		result.Items[0].SourceRef.WorldID != worldSource.WorldID ||
		result.Items[0].SourceRef.Kind != "worldCharacter" ||
		result.Items[0].DisplayName != "Partner" ||
		result.Items[0].WorldName != "World" ||
		result.Items[0].Summary != "A public introduction" ||
		!result.Items[0].Connectable ||
		result.Items[0].AvatarURL == nil ||
		*result.Items[0].AvatarURL != "https://cdn.example.test/avatar-160.webp" {
		t.Fatalf("unexpected managed-media item: %+v", result.Items[0])
	}
	if result.Items[1].SourceRef.ID != personaSource.ID ||
		result.Items[1].SourceRef.Kind != "personaCharacter" ||
		result.Items[1].SourceRef.OwnerAccountID != "acct-owner-1" ||
		result.Items[1].Connectable ||
		result.Items[1].AvatarURL == nil ||
		*result.Items[1].AvatarURL != "https://cdn.example.test/persona-avatar.png" {
		t.Fatalf("unexpected fallback-avatar item: %+v", result.Items[1])
	}
	if result.Items[2].Connectable || result.Items[2].AvatarURL != nil {
		t.Fatalf("unexpected no-avatar item: %+v", result.Items[2])
	}
}

func TestCharacterCatalogManagedAvatarNeverFallsBackToOriginalOrExternalURL(t *testing.T) {
	source := realmCharacterPublicAvatarTestSourceRef()
	item := realmCharacterDiscoveryCanonicalItem(t, source)
	item["avatarMedia"] = map[string]any{
		"resourceId":            "res-avatar-empty",
		"contentVersion":        strings.Repeat("c", 64),
		"publicationGeneration": 1,
		"policyVersion":         "v1",
		"expiresAt":             nil,
		"originalUrl":           "https://origin.example.test/original.png",
		"previewUrl":            nil,
		"video":                 nil,
		"images":                []any{},
	}
	item["avatarUrl"] = "https://cdn.example.test/external.png"

	raw, err := json.Marshal(map[string]any{
		"items":      []any{item},
		"hasMore":    false,
		"nextCursor": nil,
		"totalCount": 1,
	})
	if err != nil {
		t.Fatal(err)
	}

	result, err := decodeRealmCharacterDiscovery(string(raw), 20)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if len(result.Items) != 1 || result.Items[0].AvatarURL != nil {
		t.Fatalf("expected nil avatar when managed delivery omits avatar rendition, got %+v", result.Items)
	}
}

func TestCharacterCatalogRejectsContractViolationsFailClosed(t *testing.T) {
	source := realmCharacterPublicAvatarTestSourceRef()

	cases := []struct {
		name   string
		mutate func(page map[string]any, item map[string]any)
	}{
		{
			name: "partial pagination hasMore true with nil cursor",
			mutate: func(page, _ map[string]any) {
				page["hasMore"] = true
				page["nextCursor"] = nil
			},
		},
		{
			name: "partial pagination hasMore false with non-nil cursor",
			mutate: func(page, _ map[string]any) {
				page["hasMore"] = false
				page["nextCursor"] = "stale-cursor"
			},
		},
		{
			name: "page exceeds requested pageSize",
			mutate: func(page, item map[string]any) {
				page["items"] = []any{item, item, item}
			},
		},
		{
			name: "item id mismatches sourceRef id",
			mutate: func(_, item map[string]any) {
				item["id"] = "other-character"
			},
		},
		{
			name: "missing sourceRef",
			mutate: func(_, item map[string]any) {
				delete(item, "sourceRef")
			},
		},
		{
			name: "non-canonical extra field in sourceRef",
			mutate: func(_, item map[string]any) {
				raw, _ := json.Marshal(item["sourceRef"])
				var ref map[string]any
				_ = json.Unmarshal(raw, &ref)
				ref["unexpected"] = true
				item["sourceRef"] = ref
			},
		},
		{
			name: "worldEntityRef worldId mismatch in sourceRef",
			mutate: func(_, item map[string]any) {
				raw, _ := json.Marshal(item["sourceRef"])
				var ref map[string]any
				_ = json.Unmarshal(raw, &ref)
				ref["worldEntityRef"].(map[string]any)["worldId"] = "wrong-world"
				item["sourceRef"] = ref
			},
		},
		{
			name: "invalid sourceHash in sourceRef",
			mutate: func(_, item map[string]any) {
				raw, _ := json.Marshal(item["sourceRef"])
				var ref map[string]any
				_ = json.Unmarshal(raw, &ref)
				ref["sourceHash"] = "not-sha256"
				item["sourceRef"] = ref
			},
		},
		{
			name: "invalid relation state",
			mutate: func(_, item map[string]any) {
				item["relation"] = map[string]any{"state": "unknown"}
			},
		},
		{
			name: "malformed avatarMedia delivery",
			mutate: func(_, item map[string]any) {
				item["avatarMedia"] = map[string]any{
					"resourceId":            "res-1",
					"contentVersion":        "short",
					"publicationGeneration": 1,
					"policyVersion":         "v1",
				}
			},
		},
		{
			name: "non-HTTPS avatarMedia rendition URL",
			mutate: func(_, item map[string]any) {
				item["avatarMedia"] = realmCharacterDiscoveryTestAvatarMedia("http://cdn.example.test/avatar-160.webp")
			},
		},
		{
			name: "non-HTTPS fallback avatarUrl when avatarMedia is null",
			mutate: func(_, item map[string]any) {
				item["avatarMedia"] = nil
				item["avatarUrl"] = "http://cdn.example.test/avatar.png"
			},
		},
		{
			name: "fragment in fallback avatarUrl when avatarMedia is null",
			mutate: func(_, item map[string]any) {
				item["avatarMedia"] = nil
				item["avatarUrl"] = "https://cdn.example.test/avatar.png#frag"
			},
		},
		{
			name: "empty displayName",
			mutate: func(_, item map[string]any) {
				item["displayName"] = ""
			},
		},
		{
			name: "empty worldName",
			mutate: func(_, item map[string]any) {
				item["worldName"] = ""
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			item := realmCharacterDiscoveryCanonicalItem(t, source)
			page := map[string]any{
				"items":      []any{item},
				"hasMore":    false,
				"nextCursor": nil,
				"totalCount": 1,
			}
			tc.mutate(page, item)
			raw, err := json.Marshal(page)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := decodeRealmCharacterDiscovery(string(raw), 2); err == nil {
				t.Fatalf("expected contract violation %q to fail closed", tc.name)
			}
		})
	}
}

func TestListRealmCharacterSourcesReadsCanonicalRealmCatalog(t *testing.T) {
	source := realmCharacterPublicAvatarTestSourceRef()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/world/character-sources/catalog" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		if r.Header.Get("Authorization") != "Bearer access-1" {
			t.Errorf("missing bearer auth")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.URL.Query().Get("limit") != "20" || r.URL.Query().Get("q") != "Partner" || r.URL.Query().Get("cursor") != "cursor-1" {
			t.Errorf("unexpected query params: %s", r.URL.RawQuery)
			http.Error(w, "bad query", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items":      []any{realmCharacterDiscoveryCanonicalItem(t, source)},
			"hasMore":    false,
			"nextCursor": nil,
			"totalCount": 1,
		})
	}))
	defer server.Close()

	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)

	page, err := svc.ListRealmCharacterSources(context.Background(), "acct-1", "Partner", "cursor-1", 20)
	if err != nil {
		t.Fatalf("ListRealmCharacterSources failed: %v", err)
	}
	if len(page.Items) != 1 || page.NextCursor != "" || page.Items[0].SourceRef.ID != source.ID || page.Items[0].AvatarURL == nil || *page.Items[0].AvatarURL != "https://cdn.example.test/avatar-160.webp" {
		t.Fatalf("unexpected catalog page: %+v", page)
	}
}
