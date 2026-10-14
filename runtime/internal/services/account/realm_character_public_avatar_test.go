package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResolveRealmCharacterPublicAvatarUsesWorldPublicMediaPriority(t *testing.T) {
	sourceRef := realmCharacterPublicAvatarTestSourceRef()
	for _, test := range []struct {
		name    string
		media   map[string]any
		wantURL string
	}{
		{
			name: "avatar",
			media: map[string]any{
				"avatarUrl":         "https://cdn.example.test/avatar.png",
				"portraitUrl":       "https://cdn.example.test/portrait.png",
				"referenceImageUrl": "https://cdn.example.test/reference.png",
			},
			wantURL: "https://cdn.example.test/avatar.png",
		},
		{
			name: "portrait",
			media: map[string]any{
				"portraitUrl":       "https://cdn.example.test/portrait.png",
				"referenceImageUrl": "https://cdn.example.test/reference.png",
			},
			wantURL: "https://cdn.example.test/portrait.png",
		},
		{
			name: "reference image",
			media: map[string]any{
				"referenceImageUrl": "https://cdn.example.test/reference.png",
			},
			wantURL: "https://cdn.example.test/reference.png",
		},
		{
			name: "nested avatar asset",
			media: map[string]any{
				"assets": map[string]any{
					"avatar":   realmCharacterPublicAvatarAsset("avatar", "https://cdn.example.test/avatar-asset.png"),
					"portrait": realmCharacterPublicAvatarAsset("portrait", "https://cdn.example.test/portrait-asset.png"),
				},
			},
			wantURL: "https://cdn.example.test/avatar-asset.png",
		},
		{
			name: "nested portrait asset",
			media: map[string]any{
				"assets": map[string]any{
					"portrait":       realmCharacterPublicAvatarAsset("portrait", "https://cdn.example.test/portrait-asset.png"),
					"referenceImage": realmCharacterPublicAvatarAsset("referenceImage", "https://cdn.example.test/reference-asset.png"),
				},
			},
			wantURL: "https://cdn.example.test/portrait-asset.png",
		},
		{
			name: "nested reference image asset",
			media: map[string]any{
				"assets": map[string]any{
					"referenceImage": realmCharacterPublicAvatarAsset("referenceImage", "https://cdn.example.test/reference-asset.png"),
				},
			},
			wantURL: "https://cdn.example.test/reference-asset.png",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := realmCharacterPublicAvatarServer(t, sourceRef, test.media)
			defer server.Close()
			svc := newRealmUnaryHarnessService(t, server.URL)
			completeLogin(t, svc)

			avatarURL, err := svc.ResolveRealmCharacterPublicAvatar(context.Background(), "acct-1", sourceRef)
			if err != nil || avatarURL == nil || *avatarURL != test.wantURL {
				t.Fatalf("public avatar = (%v, %v), want %q", avatarURL, err, test.wantURL)
			}
		})
	}
}

func TestResolveRealmCharacterPublicAvatarTracksPublicationWithoutRewritingSnapshotBinding(t *testing.T) {
	sourceRef := realmCharacterPublicAvatarTestSourceRef()
	returnedRef := sourceRef
	returnedRef.SourceHash = strings.Repeat("b", 64)
	server := realmCharacterPublicAvatarServer(t, returnedRef, map[string]any{
		"avatarUrl": "https://cdn.example.test/avatar.png",
	})
	defer server.Close()
	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)

	if avatarURL, err := svc.ResolveRealmCharacterPublicAvatar(context.Background(), "acct-1", sourceRef); err != nil || avatarURL == nil || *avatarURL != "https://cdn.example.test/avatar.png" {
		t.Fatalf("updated publication not available to pinned source = (%v, %v)", avatarURL, err)
	}
}

func TestResolveRealmCharacterPublicAvatarRejectsNonHTTPSMedia(t *testing.T) {
	sourceRef := realmCharacterPublicAvatarTestSourceRef()
	server := realmCharacterPublicAvatarServer(t, sourceRef, map[string]any{
		"avatarUrl": "http://cdn.example.test/avatar.png",
	})
	defer server.Close()
	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)

	if avatarURL, err := svc.ResolveRealmCharacterPublicAvatar(context.Background(), "acct-1", sourceRef); err == nil || avatarURL != nil {
		t.Fatalf("non-HTTPS media entered avatar projection = (%v, %v)", avatarURL, err)
	}
}

func TestResolveRealmCharacterPublicAvatarRejectsNonHTTPSNestedAsset(t *testing.T) {
	sourceRef := realmCharacterPublicAvatarTestSourceRef()
	server := realmCharacterPublicAvatarServer(t, sourceRef, map[string]any{
		"assets": map[string]any{
			"avatar": realmCharacterPublicAvatarAsset("avatar", "http://cdn.example.test/avatar.png"),
		},
	})
	defer server.Close()
	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)

	if avatarURL, err := svc.ResolveRealmCharacterPublicAvatar(context.Background(), "acct-1", sourceRef); err == nil || avatarURL != nil {
		t.Fatalf("non-HTTPS nested media asset entered avatar projection = (%v, %v)", avatarURL, err)
	}
}

func realmCharacterPublicAvatarAsset(kind, url string) map[string]any {
	return map[string]any{
		"id":         "asset-" + kind,
		"kind":       kind,
		"url":        url,
		"provider":   "test",
		"provenance": map[string]any{},
	}
}

func realmCharacterPublicAvatarServer(
	t *testing.T,
	sourceRef RealmSourceMaterializationSourceRefV3,
	media map[string]any,
) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet && (request.URL.Path == "/api/realm/core/world-characters/by-id/"+sourceRef.ID || request.URL.Path == "/api/realm/core/persona-characters/by-id/"+sourceRef.ID) {
			if request.Header.Get("Authorization") != "Bearer access-1" {
				t.Fatal("missing account authorization")
			}
			current, err := realmSourceMaterializationSourceRefJSON(sourceRef)
			if err != nil {
				t.Fatal(err)
			}
			response.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(response).Encode(current)
			return
		}
		if request.Method != http.MethodPost ||
			request.URL.Path != "/api/world/character-sources/public-projection" ||
			request.Header.Get("Authorization") != "Bearer access-1" {
			t.Errorf("unexpected Realm public source request: %s %s auth=%q", request.Method, request.URL.Path, request.Header.Get("Authorization"))
			http.Error(response, "unexpected request", http.StatusBadRequest)
			return
		}
		var body struct {
			SourceRef json.RawMessage `json:"sourceRef"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil || len(body.SourceRef) == 0 {
			t.Errorf("decode Realm public source request: %v", err)
			http.Error(response, "invalid request", http.StatusBadRequest)
			return
		}
		projectedSourceRef, err := realmSourceMaterializationSourceRefJSON(sourceRef)
		if err != nil {
			t.Errorf("project returned sourceRef: %v", err)
			http.Error(response, "invalid fixture", http.StatusInternalServerError)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(response).Encode(map[string]any{
			"sourceRef": projectedSourceRef,
			"media":     media,
		}); err != nil {
			t.Errorf("encode Realm public source response: %v", err)
		}
	}))
}

func realmCharacterPublicAvatarTestSourceRef() RealmSourceMaterializationSourceRefV3 {
	return RealmSourceMaterializationSourceRefV3{
		Kind:       "worldCharacter",
		ID:         "character-song-lian",
		WorldID:    "world-ming",
		SourceHash: strings.Repeat("a", 64),
		WorldEntityRef: &RealmSourceMaterializationWorldEntityRefV3{
			WorldID:  "world-ming",
			EntityID: "entity-song-lian",
		},
	}
}

func TestPublicSourceRevisionResolutionKeepsIdentityAndPublicationGuards(t *testing.T) {
	for _, kind := range []string{"worldCharacter", "personaCharacter"} {
		for _, invalid := range []string{"", "world", "binding", "hash", "withdrawn", "race"} {
			t.Run(kind+"/"+invalid, func(t *testing.T) {
				pinned := realmCharacterPublicAvatarTestSourceRef()
				pinned.Kind = kind
				if kind == "personaCharacter" {
					pinned.WorldEntityRef = nil
					pinned.OwnerAccountID = "owner-1"
				}
				current := pinned
				current.SourceHash = strings.Repeat("b", 64)
				calls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls++
					w.Header().Set("Content-Type", "application/json")
					if r.Method == http.MethodGet {
						value, err := realmSourceMaterializationSourceRefJSON(current)
						if err != nil {
							t.Fatal(err)
						}
						raw, _ := json.Marshal(value)
						var record map[string]any
						_ = json.Unmarshal(raw, &record)
						switch invalid {
						case "world":
							record["worldId"] = "another-world"
						case "binding":
							if kind == "worldCharacter" {
								record["worldEntityRef"].(map[string]any)["entityId"] = "another-entity"
							} else {
								record["ownerAccountId"] = "another-owner"
							}
						case "hash":
							record["sourceHash"] = "invalid"
						}
						_ = json.NewEncoder(w).Encode(record)
						return
					}
					if invalid == "withdrawn" {
						w.WriteHeader(http.StatusForbidden)
						_, _ = w.Write([]byte(`{"message":"not public"}`))
						return
					}
					expected, _ := realmSourceMaterializationSourceRefJSON(current)
					var body struct {
						SourceRef json.RawMessage `json:"sourceRef"`
					}
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Fatal(err)
					}
					if _, err := decodeRealmCharacterPublicSource(`{"sourceRef":`+string(body.SourceRef)+`}`, expected); err != nil {
						t.Fatal("did not request exact current publication", err)
					}
					if invalid == "race" {
						current.SourceHash = strings.Repeat("c", 64)
						expected, _ = realmSourceMaterializationSourceRefJSON(current)
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"sourceRef": expected, "media": map[string]any{"avatarUrl": "https://cdn.example.test/avatar.png"}})
				}))
				defer server.Close()
				svc := newRealmUnaryHarnessService(t, server.URL)
				completeLogin(t, svc)
				avatar, err := svc.ResolveRealmCharacterPublicAvatar(context.Background(), "acct-1", pinned)
				if invalid == "" && (err != nil || avatar == nil) {
					t.Fatalf("current publication failed: %v", err)
				}
				if invalid != "" && (err == nil || avatar != nil) {
					t.Fatalf("invalid publication accepted: %s", invalid)
				}
				if pinned.SourceHash != strings.Repeat("a", 64) {
					t.Fatal("pinned source changed")
				}
				if (invalid == "world" || invalid == "binding" || invalid == "hash") && calls != 1 {
					t.Fatal("invalid identity reached public card")
				}
			})
		}
	}
}
