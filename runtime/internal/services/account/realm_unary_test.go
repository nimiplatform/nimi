package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestRealmBrokerOperationSetIsExactDesktopSourceReadinessVocabulary(t *testing.T) {
	expected := map[string]struct {
		method string
		path   string
	}{
		"WorldCoreController_getPersonaCharacter":            {method: http.MethodGet, path: "/api/realm/core/persona-characters/by-id/{personaCharacterId}"},
		"WorldCoreController_getWorldCharacter":              {method: http.MethodGet, path: "/api/realm/core/world-characters/by-id/{characterId}"},
		"WorldCoreController_getWorldEntity":                 {method: http.MethodGet, path: "/api/realm/core/world-entities/{entityId}"},
		"WorldCoreController_listPersonaCharacters":          {method: http.MethodGet, path: "/api/realm/core/persona-characters"},
		"WorldCoreController_discoverPersonaCharacters":      {method: http.MethodGet, path: "/api/realm/core/persona-characters/discovery"},
		"WorldCoreController_listWorldRelationships":         {method: http.MethodGet, path: "/api/realm/core/worlds/{worldId}/relationships"},
		"WorldPublicController_getWorld":                     {method: http.MethodGet, path: "/api/world/by-id/{worldId}"},
		"WorldPublicController_getWorldDetailWithCharacters": {method: http.MethodGet, path: "/api/world/by-id/{worldId}/detail-with-characters"},
		"WorldPublicController_listWorlds":                   {method: http.MethodGet, path: "/api/world"},
	}
	if len(realmBrokerOperations) != len(expected) {
		t.Fatalf("Realm broker operation count = %d, want %d", len(realmBrokerOperations), len(expected))
	}
	for operationID, operation := range realmBrokerOperations {
		want, ok := expected[operationID]
		if !ok {
			t.Fatalf("unlisted Realm broker operation generated: %s", operationID)
		}
		if operation.method != want.method || operation.path != want.path {
			t.Fatalf("%s route = %s %s, want %s %s", operationID, operation.method, operation.path, want.method, want.path)
		}
		if operationID == "WorldCoreController_listPersonaCharacters" {
			if operation.authorizationProfile != realmBrokerProtectedBundledAvatarSourceReadinessProfile ||
				len(operation.allowedCallerModes) != 2 ||
				!operation.admitsCallerMode(runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL) ||
				!operation.admitsCallerMode(runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR) {
				t.Fatalf("%s must admit the exact Desktop and protected bundled Avatar source-readiness callers: %+v", operationID, operation)
			}
			continue
		}
		if operation.authorizationProfile != realmBrokerProtectedDesktopSourceReadinessProfile ||
			len(operation.allowedCallerModes) != 1 ||
			!operation.admitsCallerMode(runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL) {
			t.Fatalf("%s must admit only Desktop shell: %+v", operationID, operation)
		}
	}
}

func TestInvokeRealmUnaryMediatesDesktopSourceReadinessWithoutReturningToken(t *testing.T) {
	var observedAuthorization string
	var observedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observedAuthorization = r.Header.Get("Authorization")
		observedPath = r.URL.Path
		if r.Method != http.MethodGet {
			t.Fatalf("method = %s, want GET", r.Method)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`[{"id":"world-1"}]`))
	}))
	defer server.Close()

	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)
	resp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:      realmDesktopShellCaller(),
		MethodId:    "WorldPublicController_listWorlds",
		RequestJson: `{}`,
	})
	if err != nil {
		t.Fatalf("InvokeRealmUnary: %v", err)
	}
	if !resp.GetAccepted() || resp.GetResponseJson() != `[{"id":"world-1"}]` {
		t.Fatalf("InvokeRealmUnary response mismatch: %+v", resp)
	}
	if observedAuthorization != "Bearer access-1" || observedPath != "/api/world" {
		t.Fatalf("mediated request mismatch: authorization=%q path=%q", observedAuthorization, observedPath)
	}
	var raw any
	if err := json.Unmarshal([]byte(resp.GetResponseJson()), &raw); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if resp.String() == "access-1" {
		t.Fatalf("InvokeRealmUnary response leaked access token: %+v", resp)
	}
}

func TestInvokeRealmUnaryAdmitsExactDesktopSourceReadinessOperationIDs(t *testing.T) {
	var wantMethod string
	var wantPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != wantMethod || r.URL.Path != wantPath {
			t.Fatalf("request = %s %s, want %s %s", r.Method, r.URL.Path, wantMethod, wantPath)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)

	cases := []struct {
		name        string
		methodID    string
		requestJSON string
		method      string
		path        string
	}{
		{name: "persona detail", methodID: "WorldCoreController_getPersonaCharacter", requestJSON: `{"path":{"personaCharacterId":"persona-1"}}`, method: http.MethodGet, path: "/api/realm/core/persona-characters/by-id/persona-1"},
		{name: "character detail", methodID: "WorldCoreController_getWorldCharacter", requestJSON: `{"path":{"characterId":"character-1"}}`, method: http.MethodGet, path: "/api/realm/core/world-characters/by-id/character-1"},
		{name: "entity detail", methodID: "WorldCoreController_getWorldEntity", requestJSON: `{"path":{"entityId":"entity-1"}}`, method: http.MethodGet, path: "/api/realm/core/world-entities/entity-1"},
		{name: "persona list", methodID: "WorldCoreController_listPersonaCharacters", requestJSON: `{}`, method: http.MethodGet, path: "/api/realm/core/persona-characters"},
		{name: "persona discovery", methodID: "WorldCoreController_discoverPersonaCharacters", requestJSON: `{}`, method: http.MethodGet, path: "/api/realm/core/persona-characters/discovery"},
		{name: "relationship list", methodID: "WorldCoreController_listWorldRelationships", requestJSON: `{"path":{"worldId":"world-1"}}`, method: http.MethodGet, path: "/api/realm/core/worlds/world-1/relationships"},
		{name: "world detail", methodID: "WorldPublicController_getWorld", requestJSON: `{"path":{"worldId":"world-1"}}`, method: http.MethodGet, path: "/api/world/by-id/world-1"},
		{name: "world sources", methodID: "WorldPublicController_getWorldDetailWithCharacters", requestJSON: `{"path":{"worldId":"world-1"}}`, method: http.MethodGet, path: "/api/world/by-id/world-1/detail-with-characters"},
		{name: "world list", methodID: "WorldPublicController_listWorlds", requestJSON: `{}`, method: http.MethodGet, path: "/api/world"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wantMethod, wantPath = tc.method, tc.path
			resp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:      realmDesktopShellCaller(),
				MethodId:    tc.methodID,
				RequestJson: tc.requestJSON,
			})
			if err != nil {
				t.Fatalf("InvokeRealmUnary: %v", err)
			}
			if !resp.GetAccepted() {
				t.Fatalf("exact source-readiness operation rejected: %+v", resp)
			}
		})
	}
}

func TestInvokeRealmUnaryRejectsEveryUnlistedOperation(t *testing.T) {
	svc := newRealmUnaryHarnessService(t, "https://realm.example.test")
	completeLogin(t, svc)
	for _, operationID := range []string{
		"WorldCoreController_createSourceMaterializationPacket",
		"WorldCoreController_listWorldCores",
		"WorldPublicController_listWorldCharacters",
		"getExploreFeed",
		"getMe",
		"createImageDirectUpload",
	} {
		t.Run(operationID, func(t *testing.T) {
			resp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:      realmDesktopShellCaller(),
				MethodId:    operationID,
				RequestJson: `{}`,
			})
			if err != nil {
				t.Fatalf("InvokeRealmUnary: %v", err)
			}
			if resp.GetAccepted() || resp.GetReasonCode() != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_OPERATION_NOT_ADMITTED {
				t.Fatalf("unlisted operation did not fail closed: %+v", resp)
			}
		})
	}
}

func TestInvokeRealmUnaryRejectsNonDesktopCaller(t *testing.T) {
	svc := newRealmUnaryHarnessService(t, "https://realm.example.test")
	completeLogin(t, svc)
	resp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:      realmWorldStudioCaller(),
		MethodId:    "WorldPublicController_listWorlds",
		RequestJson: `{}`,
	})
	if err != nil {
		t.Fatalf("InvokeRealmUnary: %v", err)
	}
	if resp.GetAccepted() || resp.GetReasonCode() != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_OPERATION_NOT_ADMITTED {
		t.Fatalf("non-Desktop caller did not fail closed: %+v", resp)
	}
}

func TestInvokeRealmUnaryRejectsSignedUploadCredentialOperations(t *testing.T) {
	svc := newRealmUnaryHarnessService(t, "https://realm.example.test")
	completeLogin(t, svc)
	response, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:      realmDesktopShellCaller(),
		MethodId:    "createImageDirectUpload",
		RequestJson: `{"body":{"filename":"image.png"}}`,
	})
	if err != nil {
		t.Fatalf("InvokeRealmUnary: %v", err)
	}
	if response.GetAccepted() || response.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_OPERATION_NOT_ADMITTED {
		t.Fatalf("signed upload credential operation must not be broker admitted: %+v", response)
	}
}

func TestInvokeRealmUnaryRejectsUnadmittedRealmBase(t *testing.T) {
	svc := newRealmUnaryHarnessService(t, "https://realm.authorized.test")
	completeLogin(t, svc)
	foreign, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:       realmDesktopShellCaller(),
		MethodId:     "WorldPublicController_listWorlds",
		RealmBaseUrl: "https://realm.foreign.test",
		RequestJson:  `{}`,
	})
	if err != nil {
		t.Fatalf("foreign InvokeRealmUnary: %v", err)
	}
	if foreign.GetAccepted() || foreign.GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID || foreign.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_BASE_DENIED {
		t.Fatalf("foreign Realm base URL must fail closed: %+v", foreign)
	}
}

func newRealmUnaryHarnessService(t *testing.T, realmBaseURL string) *Service {
	t.Helper()
	return newHarnessService(
		t,
		nil,
		WithAppRegistry(testAppRegistry(t, realmWorldStudioCaller())),
		WithRealmBaseURL(realmBaseURL),
	)
}

func realmWorldStudioCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         "nimi.realm-world-studio",
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
