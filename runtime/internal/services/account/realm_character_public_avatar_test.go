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

func TestResolveRealmCharacterPublicAvatarRejectsMismatchedSourceRef(t *testing.T) {
	sourceRef := realmCharacterPublicAvatarTestSourceRef()
	returnedRef := sourceRef
	returnedRef.SourceHash = strings.Repeat("b", 64)
	server := realmCharacterPublicAvatarServer(t, returnedRef, map[string]any{
		"avatarUrl": "https://cdn.example.test/avatar.png",
	})
	defer server.Close()
	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)

	if avatarURL, err := svc.ResolveRealmCharacterPublicAvatar(context.Background(), "acct-1", sourceRef); err == nil || avatarURL != nil {
		t.Fatalf("mismatched sourceRef entered avatar projection = (%v, %v)", avatarURL, err)
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
