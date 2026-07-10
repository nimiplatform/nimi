package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
)

const (
	realmPersonaStudioTestAppID = "nimi.realm-persona-studio"
	realmWorldStudioTestAppID   = "nimi.realm-world-studio"
)

func TestInvokeRealmUnaryMediatesRealmRequestWithoutReturningToken(t *testing.T) {
	var observedAuthorization string
	var observedPath string
	var observedQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observedAuthorization = r.Header.Get("Authorization")
		observedPath = r.URL.Path
		observedQuery = r.URL.RawQuery
		if r.Method != http.MethodGet {
			t.Fatalf("method = %s, want GET", r.Method)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"world-1"}]}`))
	}))
	defer server.Close()

	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)

	resp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:       realmWorldStudioCaller(),
		MethodId:     "WorldCoreController_listWorldCores",
		RealmBaseUrl: server.URL,
		RequestJson:  `{"path":{}}`,
	})
	if err != nil {
		t.Fatalf("InvokeRealmUnary: %v", err)
	}
	if !resp.GetAccepted() {
		t.Fatalf("InvokeRealmUnary not accepted: %+v", resp)
	}
	if resp.GetResponseJson() != `{"items":[{"id":"world-1"}]}` {
		t.Fatalf("response JSON mismatch: %q", resp.GetResponseJson())
	}
	if observedAuthorization != "Bearer access-1" {
		t.Fatalf("Authorization header mismatch: %q", observedAuthorization)
	}
	if observedPath != "/api/realm/core/worlds" || observedQuery != "" {
		t.Fatalf("request target mismatch: path=%q query=%q", observedPath, observedQuery)
	}
	raw := map[string]any{}
	if err := json.Unmarshal([]byte(resp.GetResponseJson()), &raw); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if _, leaked := raw["accessToken"]; leaked || resp.String() == "access-1" {
		t.Fatalf("InvokeRealmUnary response leaked access token: %+v", resp)
	}
}

func TestInvokeRealmUnaryAdmitsStudioOperationIDs(t *testing.T) {
	var wantMethod string
	var wantPath string
	var wantQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != wantMethod {
			t.Fatalf("method = %s, want %s", r.Method, wantMethod)
		}
		if r.URL.Path != wantPath {
			t.Fatalf("path = %s, want %s", r.URL.Path, wantPath)
		}
		if r.URL.RawQuery != wantQuery {
			t.Fatalf("query = %s, want %s", r.URL.RawQuery, wantQuery)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)

	cases := []struct {
		name             string
		caller           *runtimev1.AccountCaller
		methodID         string
		requestJSON      string
		method           string
		path             string
		query            string
		omitRealmBaseURL bool
	}{
		{
			name:        "realm persona list",
			caller:      realmPersonaStudioCaller(),
			methodID:    "WorldCoreController_listRealmPersonas",
			requestJSON: `{"path":{}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/personas",
		},
		{
			name:        "realm persona create",
			caller:      realmPersonaStudioCaller(),
			methodID:    "WorldCoreController_createRealmPersona",
			requestJSON: `{"path":{},"body":{"worldId":"oasis","displayName":"Persona"}}`,
			method:      http.MethodPost,
			path:        "/api/realm/core/personas",
		},
		{
			name:        "realm persona detail",
			caller:      realmPersonaStudioCaller(),
			methodID:    "WorldCoreController_getRealmPersona",
			requestJSON: `{"path":{"personaId":"persona-1"}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/personas/persona-1",
		},
		{
			name:        "realm persona replace",
			caller:      realmPersonaStudioCaller(),
			methodID:    "WorldCoreController_replaceRealmPersona",
			requestJSON: `{"path":{"personaId":"persona-1"},"body":{"baseContentHash":"hash-1","core":{"displayName":"Persona"}}}`,
			method:      http.MethodPut,
			path:        "/api/realm/core/personas/persona-1",
		},
		{
			name:        "source materialization packet create",
			caller:      realmPersonaStudioCaller(),
			methodID:    "WorldCoreController_createSourceMaterializationPacket",
			requestJSON: `{"path":{},"body":{"sourceRef":{"kind":"realmPersona","worldId":"oasis","sourceId":"persona-1","sourceContentHash":"hash-1"},"intendedRuntimeAudience":"runtime.test"}}`,
			method:      http.MethodPost,
			path:        "/api/realm/core/source-materialization-packets",
		},
		{
			name:        "world core list for persona binding",
			caller:      realmPersonaStudioCaller(),
			methodID:    "WorldCoreController_listWorldCores",
			requestJSON: `{"path":{}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/worlds",
		},
		{
			name:        "world core detail for persona binding",
			caller:      realmPersonaStudioCaller(),
			methodID:    "WorldCoreController_getWorldCore",
			requestJSON: `{"path":{"worldId":"world-1"}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/worlds/world-1",
		},
		{
			name:        "post create",
			caller:      realmPersonaStudioCaller(),
			methodID:    "createPost",
			requestJSON: `{"path":{},"body":{"body":"hello"}}`,
			method:      http.MethodPost,
			path:        "/api/world/posts",
		},
		{
			name:        "resource list",
			caller:      realmPersonaStudioCaller(),
			methodID:    "listResources",
			requestJSON: `{"path":{}}`,
			method:      http.MethodGet,
			path:        "/api/resources",
		},
		{
			name:        "world core list",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_listWorldCores",
			requestJSON: `{"path":{}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/worlds",
		},
		{
			name:        "world core create",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_createWorldCore",
			requestJSON: `{"path":{},"body":{"displayName":"World"}}`,
			method:      http.MethodPost,
			path:        "/api/realm/core/worlds",
		},
		{
			name:        "world core detail",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_getWorldCore",
			requestJSON: `{"path":{"worldId":"world-1"}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/worlds/world-1",
		},
		{
			name:        "world core replace",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_replaceWorldCore",
			requestJSON: `{"path":{"worldId":"world-1"},"body":{"baseContentHash":"hash-1","core":{"displayName":"World"}}}`,
			method:      http.MethodPut,
			path:        "/api/realm/core/worlds/world-1",
		},
		{
			name:        "world entity create",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_createWorldEntity",
			requestJSON: `{"path":{"worldId":"world-1"},"body":{"kind":"place","displayName":"Place"}}`,
			method:      http.MethodPost,
			path:        "/api/realm/core/worlds/world-1/entities",
		},
		{
			name:        "world entity list",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_listWorldEntities",
			requestJSON: `{"path":{"worldId":"world-1"},"query":{"take":10}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/worlds/world-1/entities",
			query:       "take=10",
		},
		{
			name:        "world entity detail",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_getWorldEntity",
			requestJSON: `{"path":{"entityId":"entity-1"}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/world-entities/entity-1",
		},
		{
			name:        "world entity replace",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_replaceWorldEntity",
			requestJSON: `{"path":{"entityId":"entity-1"},"body":{"baseContentHash":"hash-1","core":{"displayName":"Place"}}}`,
			method:      http.MethodPut,
			path:        "/api/realm/core/world-entities/entity-1",
		},
		{
			name:        "world relationship create",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_createWorldRelationship",
			requestJSON: `{"path":{"worldId":"world-1"},"body":{"sourceEntityId":"entity-1","targetEntityId":"entity-2","type":"knows"}}`,
			method:      http.MethodPost,
			path:        "/api/realm/core/worlds/world-1/relationships",
		},
		{
			name:        "world relationship list",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_listWorldRelationships",
			requestJSON: `{"path":{"worldId":"world-1"},"query":{"entityId":"entity-1","take":10}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/worlds/world-1/relationships",
			query:       "entityId=entity-1&take=10",
		},
		{
			name:        "world relationship detail",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_getWorldRelationship",
			requestJSON: `{"path":{"relationshipId":"relationship-1"}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/world-relationships/relationship-1",
		},
		{
			name:        "world relationship replace",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_replaceWorldRelationship",
			requestJSON: `{"path":{"relationshipId":"relationship-1"},"body":{"baseContentHash":"hash-1","core":{"type":"knows"}}}`,
			method:      http.MethodPut,
			path:        "/api/realm/core/world-relationships/relationship-1",
		},
		{
			name:        "world character list",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_listWorldCharacters",
			requestJSON: `{"path":{"worldId":"world-1"}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/worlds/world-1/characters",
		},
		{
			name:        "world character create",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_createWorldCharacter",
			requestJSON: `{"path":{"worldId":"world-1"},"body":{"displayName":"Character"}}`,
			method:      http.MethodPost,
			path:        "/api/realm/core/worlds/world-1/characters",
		},
		{
			name:        "world character detail",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_getWorldCharacter",
			requestJSON: `{"path":{"characterId":"character-1"}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/world-characters/character-1",
		},
		{
			name:        "world character replace",
			caller:      realmWorldStudioCaller(),
			methodID:    "WorldCoreController_replaceWorldCharacter",
			requestJSON: `{"path":{"characterId":"character-1"},"body":{"baseContentHash":"hash-1","core":{"displayName":"Character"}}}`,
			method:      http.MethodPut,
			path:        "/api/realm/core/world-characters/character-1",
		},
		{
			name:        "desktop public world list",
			caller:      realmDesktopShellCaller(),
			methodID:    "WorldPublicController_listWorlds",
			requestJSON: `{"path":{}}`,
			method:      http.MethodGet,
			path:        "/api/world",
		},
		{
			name:        "desktop public world detail",
			caller:      realmDesktopShellCaller(),
			methodID:    "WorldPublicController_getWorld",
			requestJSON: `{"path":{"worldId":"world-1"}}`,
			method:      http.MethodGet,
			path:        "/api/world/by-id/world-1",
		},
		{
			name:             "zhiyu public world detail defaults runtime realm base url",
			caller:           zhiyuLocalFirstPartyCaller(),
			methodID:         "WorldPublicController_getWorld",
			requestJSON:      `{"path":{"worldId":"world-1"}}`,
			method:           http.MethodGet,
			path:             "/api/world/by-id/world-1",
			omitRealmBaseURL: true,
		},
		{
			name:        "desktop public world characters",
			caller:      realmDesktopShellCaller(),
			methodID:    "WorldPublicController_listWorldCharacters",
			requestJSON: `{"path":{"worldId":"world-1"}}`,
			method:      http.MethodGet,
			path:        "/api/world/by-id/world-1/characters",
		},
		{
			name:        "desktop public world detail with characters",
			caller:      realmDesktopShellCaller(),
			methodID:    "WorldPublicController_getWorldDetailWithCharacters",
			requestJSON: `{"path":{"worldId":"world-1"}}`,
			method:      http.MethodGet,
			path:        "/api/world/by-id/world-1/detail-with-characters",
		},
		{
			name:        "desktop first-party world character detail",
			caller:      realmDesktopShellCaller(),
			methodID:    "WorldCoreController_getWorldCharacter",
			requestJSON: `{"path":{"characterId":"character-1"}}`,
			method:      http.MethodGet,
			path:        "/api/realm/core/world-characters/character-1",
		},
		{
			name:        "desktop private account projection",
			caller:      realmDesktopShellCaller(),
			methodID:    "getMe",
			requestJSON: `{"path":{}}`,
			method:      http.MethodGet,
			path:        "/api/human/me",
		},
		{
			name:        "desktop private group list",
			caller:      realmDesktopShellCaller(),
			methodID:    "listGroups",
			requestJSON: `{"path":{},"query":{"limit":20}}`,
			method:      http.MethodGet,
			path:        "/api/human/group-chats",
			query:       "limit=20",
		},
		{
			name:        "desktop private pending friend requests",
			caller:      realmDesktopShellCaller(),
			methodID:    "getMyPendingFriendRequests",
			requestJSON: `{"path":{}}`,
			method:      http.MethodGet,
			path:        "/api/human/me/friends/pending",
		},
		{
			name:        "desktop private friend list",
			caller:      realmDesktopShellCaller(),
			methodID:    "listMyFriendsWithDetails",
			requestJSON: `{"path":{},"query":{"limit":20}}`,
			method:      http.MethodGet,
			path:        "/api/human/me/friends/list",
			query:       "limit=20",
		},
		{
			name:        "desktop private blocked list",
			caller:      realmDesktopShellCaller(),
			methodID:    "getMyBlockedUsers",
			requestJSON: `{"path":{},"query":{"limit":20}}`,
			method:      http.MethodGet,
			path:        "/api/human/me/blocks",
			query:       "limit=20",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wantMethod = tc.method
			wantPath = tc.path
			wantQuery = tc.query
			realmBaseURL := server.URL
			if tc.omitRealmBaseURL {
				realmBaseURL = ""
			}
			resp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:       tc.caller,
				MethodId:     tc.methodID,
				RealmBaseUrl: realmBaseURL,
				RequestJson:  tc.requestJSON,
			})
			if err != nil {
				t.Fatalf("InvokeRealmUnary: %v", err)
			}
			if !resp.GetAccepted() {
				t.Fatalf("InvokeRealmUnary not accepted: %+v", resp)
			}
		})
	}
}

func TestInvokeRealmUnaryRejectsCrossStudioLaneRequests(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)

	cases := []struct {
		name     string
		caller   *runtimev1.AccountCaller
		methodID string
	}{
		{
			name:     "world studio cannot list user-owned personas",
			caller:   realmWorldStudioCaller(),
			methodID: "WorldCoreController_listRealmPersonas",
		},
		{
			name:     "world studio cannot create user-owned personas",
			caller:   realmWorldStudioCaller(),
			methodID: "WorldCoreController_createRealmPersona",
		},
		{
			name:     "persona studio cannot create world cores",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_createWorldCore",
		},
		{
			name:     "persona studio cannot replace world cores",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_replaceWorldCore",
		},
		{
			name:     "persona studio cannot create world entities",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_createWorldEntity",
		},
		{
			name:     "persona studio cannot list world entities",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_listWorldEntities",
		},
		{
			name:     "persona studio cannot get world entity detail",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_getWorldEntity",
		},
		{
			name:     "persona studio cannot replace world entity detail",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_replaceWorldEntity",
		},
		{
			name:     "persona studio cannot create world relationships",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_createWorldRelationship",
		},
		{
			name:     "persona studio cannot list world relationships",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_listWorldRelationships",
		},
		{
			name:     "persona studio cannot get world relationship detail",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_getWorldRelationship",
		},
		{
			name:     "persona studio cannot replace world relationship detail",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_replaceWorldRelationship",
		},
		{
			name:     "persona studio cannot list world-owned characters",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_listWorldCharacters",
		},
		{
			name:     "persona studio cannot create world-owned characters",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_createWorldCharacter",
		},
		{
			name:     "persona studio cannot get world-owned character detail",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_getWorldCharacter",
		},
		{
			name:     "persona studio cannot replace world-owned characters",
			caller:   realmPersonaStudioCaller(),
			methodID: "WorldCoreController_replaceWorldCharacter",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:       tc.caller,
				MethodId:     tc.methodID,
				RealmBaseUrl: server.URL,
				RequestJson:  `{"path":{}}`,
			})
			if err != nil {
				t.Fatalf("InvokeRealmUnary: %v", err)
			}
			if resp.GetAccepted() || resp.GetReasonCode() != runtimev1.ReasonCode_APP_AUTHORIZATION_DENIED || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CAPABILITY_MISSING {
				t.Fatalf("cross-lane request must fail closed: %+v", resp)
			}
		})
	}
}

func TestInvokeRealmUnaryRejectsSignedUploadCredentialOperations(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"uploadUrl":"https://uploads.example.test"}`))
	}))
	defer server.Close()

	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)
	response, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:       realmWorldStudioCaller(),
		MethodId:     "createImageDirectUpload",
		RealmBaseUrl: server.URL,
		RequestJson:  `{"body":{"filename":"image.png"}}`,
	})
	if err != nil {
		t.Fatalf("InvokeRealmUnary: %v", err)
	}
	if response.GetAccepted() {
		t.Fatalf("signed upload credential operation must not be broker admitted: %+v", response)
	}
}

func TestInvokeRealmUnaryRejectsUnadmittedRealmBaseAndDeveloperCaller(t *testing.T) {
	developer := localDeveloperCaller()
	registry := testDeveloperAppRegistry(t, developer)
	worldCaller := realmWorldStudioCaller()
	if err := registry.UpsertInstance(worldCaller.GetAppId(), worldCaller.GetAppInstanceId(), worldCaller.GetDeviceId(), &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}, []string{"account.session.read", "data.scope.read#realm.core.worlds"}); err != nil {
		t.Fatalf("register world studio caller: %v", err)
	}
	svc := newHarnessService(
		t,
		nil,
		WithAppRegistry(registry),
		WithRealmBaseURL("https://realm.authorized.test"),
	)
	completeLogin(t, svc)

	foreign, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:       realmWorldStudioCaller(),
		MethodId:     "WorldCoreController_listWorldCores",
		RealmBaseUrl: "https://realm.foreign.test",
		RequestJson:  `{"path":{}}`,
	})
	if err != nil {
		t.Fatalf("foreign InvokeRealmUnary: %v", err)
	}
	if foreign.GetAccepted() || foreign.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN || foreign.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_BASE_DENIED {
		t.Fatalf("foreign Realm base URL must fail closed: %+v", foreign)
	}

	dev, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:       developer,
		MethodId:     "WorldCoreController_listWorldCores",
		RealmBaseUrl: "https://realm.authorized.test",
		RequestJson:  `{"path":{}}`,
	})
	if err != nil {
		t.Fatalf("developer InvokeRealmUnary: %v", err)
	}
	if dev.GetAccepted() || dev.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_OPERATION_NOT_ADMITTED {
		t.Fatalf("developer caller must not use Runtime Realm mediation: %+v", dev)
	}
}

func newRealmUnaryHarnessService(t *testing.T, realmBaseURL string) *Service {
	t.Helper()
	registry := testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmPersonaStudioCaller(), realmWorldStudioCaller(), realmDesktopShellCaller(), zhiyuLocalFirstPartyCaller())
	setRealmTestCapabilities(t, registry, realmPersonaStudioCaller().GetAppId(), []string{
		"account.session.read",
		"data.scope.read#realm.core.personas",
		"data.scope.write#realm.core.personas",
		"realm_source.snapshot.bind",
		"data.scope.read#realm.core.worlds",
		"data.scope.write#realm.world.posts",
		"data.scope.read#realm.resources",
	})
	setRealmTestCapabilities(t, registry, realmWorldStudioCaller().GetAppId(), []string{
		"account.session.read",
		"realm_source.snapshot.bind",
		"data.scope.read#realm.core.worlds",
		"data.scope.write#realm.core.worlds",
		"data.scope.read#realm.core.world-entities",
		"data.scope.write#realm.core.world-entities",
		"data.scope.read#realm.core.world-relationships",
		"data.scope.write#realm.core.world-relationships",
		"data.scope.read#realm.core.world-characters",
		"data.scope.write#realm.core.world-characters",
	})
	setRealmTestCapabilities(t, registry, realmDesktopShellCaller().GetAppId(), []string{
		"account.session.read",
		"data.scope.read#realm.worlds.read-probe",
		"data.scope.read#realm.core.world-characters",
		"data.scope.read#realm.account.private",
		"data.scope.read#realm.social.private",
		"data.scope.read#realm.group-chats.private",
	})
	setRealmTestCapabilities(t, registry, zhiyuLocalFirstPartyCaller().GetAppId(), []string{
		"account.session.read",
		"data.scope.read#realm.worlds.read-probe",
	})
	return newHarnessService(
		t,
		nil,
		WithAppRegistry(registry),
		WithRealmBaseURL(realmBaseURL),
	)
}

func setRealmTestCapabilities(t *testing.T, registry *appregistry.Registry, appID string, capabilities []string) {
	t.Helper()
	record, ok := registry.Get(appID)
	if !ok {
		t.Fatalf("realm test registry missing app %q", appID)
	}
	if err := registry.Upsert(record.AppID, record.Manifest, capabilities); err != nil {
		t.Fatalf("set Realm test capabilities for %q: %v", appID, err)
	}
}

func realmPersonaStudioCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         realmPersonaStudioTestAppID,
		AppInstanceId: "nimi.realm-persona-studio.local-first-party",
		DeviceId:      "device-1",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
}

func realmWorldStudioCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         realmWorldStudioTestAppID,
		AppInstanceId: "nimi.realm-world-studio.local-first-party",
		DeviceId:      "device-1",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
}

func realmDesktopShellCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         "nimi.desktop",
		AppInstanceId: "nimi.desktop.local-first-party",
		DeviceId:      "desktop-shell",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL,
	}
}

func zhiyuLocalFirstPartyCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         "nimi.zhiyu",
		AppInstanceId: "nimi.zhiyu.local-first-party",
		DeviceId:      "nimi-zhiyu-local-first-party-device",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
}
