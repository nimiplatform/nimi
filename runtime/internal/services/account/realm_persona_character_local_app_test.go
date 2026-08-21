package account

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLocalAppPersonaCharacterProjectionStripsOnlyTopLevelOwner(t *testing.T) {
	response := projectLocalAppPersonaCharacterResponse(personaSuccessResponse(
		validLocalAppPersonaCharacterJSON("persona-1", "acct-1", 1),
	), "acct-1")
	if !response.GetAccepted() || strings.Contains(response.GetResponseJson(), `"ownerAccountId":"acct-1"`) ||
		!strings.Contains(response.GetResponseJson(), `"token":"product-token"`) ||
		!strings.Contains(response.GetResponseJson(), `"jwt":"opaque.product.content"`) {
		t.Fatalf("owner PersonaCharacter projection = %+v", response)
	}

	foreign := projectLocalAppPersonaCharacterResponse(personaSuccessResponse(
		validLocalAppPersonaCharacterJSON("persona-foreign", "acct-foreign", 1),
	), "acct-1")
	if foreign.GetAccepted() || foreign.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED ||
		foreign.GetResponseJson() != "" || foreign.GetErrorMessage() != "" {
		t.Fatalf("foreign owner projection = %+v", foreign)
	}
}

func TestLocalAppPersonaCharacterOwnerFailureClassification(t *testing.T) {
	missingOwner := strings.Replace(validLocalAppPersonaCharacterJSON("persona-1", "acct-1", 1),
		`,"ownerAccountId":"acct-1"`, "", 1)
	contract := projectLocalAppPersonaCharacterResponse(personaSuccessResponse(missingOwner), "acct-1")
	if contract.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID {
		t.Fatalf("missing upstream owner = %+v", contract)
	}

	missingSessionOwner := projectLocalAppPersonaCharacterResponse(personaSuccessResponse(
		validLocalAppPersonaCharacterJSON("persona-1", "acct-1", 1),
	), "")
	if missingSessionOwner.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE {
		t.Fatalf("missing session owner = %+v", missingSessionOwner)
	}
}

func TestLocalAppPersonaCharacterListFailsWholeProjectionOnForeignOwner(t *testing.T) {
	response := projectLocalAppPersonaCharacterListResponse(personaSuccessResponse(
		"["+validLocalAppPersonaCharacterJSON("persona-owned", "acct-1", 1)+","+
			validLocalAppPersonaCharacterJSON("persona-foreign", "acct-foreign", 1)+"]",
	), "acct-1")
	if response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED ||
		response.GetResponseJson() != "" || response.GetErrorMessage() != "" {
		t.Fatalf("mixed-owner list projection = %+v", response)
	}
}

func TestLocalAppPersonaCharacterRequestAdmitsPaginationAndOpaqueRealmContent(t *testing.T) {
	list, err := parseRealmUnaryRequest(`{"path":{},"query":{"scope":"owned","worldId":"world-1","visibility":"private","afterId":"persona-050","take":500}}`)
	if err != nil || validateLocalAppPersonaCharacterRequest(LocalAppOperationPersonaListOwned, list) != nil {
		t.Fatalf("valid owner pagination rejected: parse=%v validate=%v", err, validateLocalAppPersonaCharacterRequest(LocalAppOperationPersonaListOwned, list))
	}

	create, err := parseRealmUnaryRequest(`{"path":{},"query":{},"body":` + validLocalAppPersonaCharacterInputJSON(false) + `}`)
	if err != nil || validateLocalAppPersonaCharacterRequest(LocalAppOperationPersonaCreate, create) != nil {
		t.Fatalf("opaque Realm-owned profile rejected: parse=%v validate=%v", err, validateLocalAppPersonaCharacterRequest(LocalAppOperationPersonaCreate, create))
	}

	for name, raw := range map[string]string{
		"public scope":    `{"path":{},"query":{"scope":"public"}}`,
		"zero take":       `{"path":{},"query":{"scope":"owned","take":0}}`,
		"large take":      `{"path":{},"query":{"scope":"owned","take":501}}`,
		"fractional take": `{"path":{},"query":{"scope":"owned","take":1.5}}`,
		"system filter":   `{"path":{},"query":{"scope":"owned","visibility":"system"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			request, parseErr := parseRealmUnaryRequest(raw)
			if parseErr != nil {
				t.Fatal(parseErr)
			}
			if validateLocalAppPersonaCharacterRequest(LocalAppOperationPersonaListOwned, request) == nil {
				t.Fatal("invalid owner PersonaCharacter pagination was admitted")
			}
		})
	}
}

func TestLocalAppPersonaCharacterRequestKeepsKnownDisplayAndOutputOnlyBoundaries(t *testing.T) {
	unsafeExternal := strings.Replace(validLocalAppPersonaCharacterInputJSON(false),
		`https://cdn.example.test/avatar.png`, `http://local.test/avatar.png`, 1)
	outputOnly := strings.Replace(validLocalAppPersonaCharacterInputJSON(false),
		`"profileSchemaVersion":"realm.character-profile-core/v1"`,
		`"profileSchemaVersion":"realm.character-profile-core/v1","profileHash":"`+strings.Repeat("a", 64)+`"`, 1)
	for name, body := range map[string]string{
		"unsafe external ref":      unsafeExternal,
		"output-only profile hash": outputOnly,
		"system write": strings.Replace(validLocalAppPersonaCharacterInputJSON(false),
			`"visibility":"private"`, `"visibility":"system"`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			request, err := parseRealmUnaryRequest(`{"path":{},"query":{},"body":` + body + `}`)
			if err != nil {
				t.Fatal(err)
			}
			if validateLocalAppPersonaCharacterRequest(LocalAppOperationPersonaCreate, request) == nil {
				t.Fatal("unsafe known boundary was admitted")
			}
		})
	}
}

func TestPersonaExternalReferenceUsesForgeSafetyWithoutPrivateLengthCap(t *testing.T) {
	uri := "https://cdn.example.test/avatar.png?description=" + strings.Repeat("a", 2_100)
	if !safeWorldCoreExternalURI(uri) {
		t.Fatal("Forge-safe external reference was rejected by a Nimi-only length cap")
	}
	credentialURI := "https://cdn.example.test/avatar.png?access_token=" + strings.Repeat("a", 2_100)
	if safeWorldCoreExternalURI(credentialURI) {
		t.Fatal("credential-bearing external reference was admitted")
	}
}

func TestLocalAppPersonaCharacterReplaceUsesSingleRealmPutAndPreservesConflict(t *testing.T) {
	var requests []string
	conflict := false
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests = append(requests, request.Method+" "+request.URL.RequestURI())
		response.Header().Set("content-type", "application/json")
		if conflict {
			response.WriteHeader(http.StatusConflict)
			_, _ = response.Write([]byte(`{"token":"opaque error detail"}`))
			return
		}
		_, _ = response.Write([]byte(validLocalAppPersonaCharacterJSON("persona-1", "acct-1", 2)))
	}))
	defer server.Close()

	svc := newRealmUnaryHarnessService(t, server.URL)
	completeLogin(t, svc)
	invoke := func() *runtimev1.InvokeRealmUnaryResponse {
		requestJSON := fmt.Sprintf(`{"path":{"personaCharacterId":"persona-1"},"query":{},"body":%s}`,
			validLocalAppPersonaCharacterInputJSON(true))
		parsed, parseErr := parseRealmUnaryRequest(requestJSON)
		if parseErr != nil {
			t.Fatalf("parse replace request: %v", parseErr)
		}
		if validateErr := validateLocalAppPersonaCharacterRequest(LocalAppOperationPersonaReplace, parsed); validateErr != nil {
			t.Fatalf("validate replace request: %v", validateErr)
		}
		operation := realmBrokerOperations["WorldCoreController_replacePersonaCharacter"]
		if shapeErr := validateRealmUnaryRequestShapeForOpaqueProductContent(operation, parsed); shapeErr != nil {
			t.Fatalf("validate replace Realm envelope: %v", shapeErr)
		}
		ctx := ContextWithAuthorizedLocalAppDecision(context.Background(), LocalAppCallerDecision{
			RegisteredAppSubject: "lap-persona-studio", AccountID: "acct-1", Operation: LocalAppOperationPersonaReplace,
		})
		response, err := svc.InvokeRealmUnary(ctx, &runtimev1.InvokeRealmUnaryRequest{
			MethodId:    "WorldCoreController_replacePersonaCharacter",
			RequestJson: requestJSON,
		})
		if err != nil {
			t.Fatal(err)
		}
		return response
	}

	response := invoke()
	if !response.GetAccepted() || len(requests) != 1 || requests[0] != "PUT /api/realm/core/persona-characters/by-id/persona-1" {
		t.Fatalf("owner replace = response:%+v requests:%v", response, requests)
	}

	requests = nil
	conflict = true
	response = invoke()
	if response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_REALM_CONFLICT ||
		response.GetResponseJson() != "" || response.GetErrorMessage() != "" || len(requests) != 1 {
		t.Fatalf("stale replace = response:%+v requests:%v", response, requests)
	}
}

func TestLocalAppPersonaCharacterOpaqueBodyScannerKeepsHeaderBoundary(t *testing.T) {
	accepted := projectRealmUnaryHTTPResultForOpaquePersona(realmUnaryHTTPResult{
		status: http.StatusOK,
		header: http.Header{"Content-Type": []string{"application/json"}},
		body:   []byte(`{"profile":{"narrative":{"token":"product-token","quote":"opaque.jwt.value"}}}`),
	})
	if !accepted.GetAccepted() {
		t.Fatalf("opaque product content rejected: %+v", accepted)
	}

	rejected := projectRealmUnaryHTTPResultForOpaquePersona(realmUnaryHTTPResult{
		status: http.StatusOK,
		header: http.Header{"Content-Type": []string{"application/json"}, "Set-Cookie": []string{"secret=1"}},
		body:   []byte(`{}`),
	})
	if rejected.GetAccepted() || rejected.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID {
		t.Fatalf("credential response header admitted: %+v", rejected)
	}
}

func TestDesktopPersonaSuccessKeepsOpaqueProfileAndTopLevelCredentialBoundary(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(validLocalAppPersonaCharacterJSON("persona-1", "acct-1", 1)))
	}))
	defer server.Close()

	caller := realmDesktopShellCaller()
	svc := newHarnessService(t, nil,
		WithAppRegistry(testAppRegistry(t, caller)),
		WithRealmBaseURL(server.URL),
	)
	completeLoginAs(t, svc, caller)
	response, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller: caller, MethodId: "WorldCoreController_getPersonaCharacter",
		RequestJson: `{"path":{"personaCharacterId":"persona-1"},"query":{}}`,
	})
	if err != nil || !response.GetAccepted() || !strings.Contains(response.GetResponseJson(), `"token":"product-token"`) {
		t.Fatalf("Desktop Persona opaque projection = (%+v, %v)", response, err)
	}

	topLevelCredential := projectRealmUnaryHTTPResultForOpaquePersonaSuccess(realmUnaryHTTPResult{
		status: http.StatusOK,
		header: http.Header{"Content-Type": []string{"application/json"}},
		body:   []byte(`{"id":"persona-1","token":"forbidden"}`),
	})
	if topLevelCredential.GetAccepted() || topLevelCredential.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID {
		t.Fatalf("top-level Persona credential field admitted: %+v", topLevelCredential)
	}
}

func TestLocalAppPersonaCharacterOversizedRequestIsTyped(t *testing.T) {
	svc := newRealmUnaryHarnessService(t, "http://127.0.0.1:1")
	completeLogin(t, svc)
	ctx := ContextWithAuthorizedLocalAppDecision(context.Background(), LocalAppCallerDecision{
		RegisteredAppSubject: "lap-persona-studio", AccountID: "acct-1", Operation: LocalAppOperationPersonaCreate,
	})
	response, err := svc.InvokeRealmUnary(ctx, &runtimev1.InvokeRealmUnaryRequest{
		MethodId:    "WorldCoreController_createPersonaCharacter",
		RequestJson: strings.Repeat("x", realmUnaryRequestJSONMaxSize+1),
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.GetReasonCode() != runtimev1.ReasonCode_APP_MESSAGE_PAYLOAD_TOO_LARGE || response.GetResponseJson() != "" || response.GetErrorMessage() != "" {
		t.Fatalf("oversized request = %+v", response)
	}
}

func personaSuccessResponse(body string) *runtimev1.InvokeRealmUnaryResponse {
	return &runtimev1.InvokeRealmUnaryResponse{
		Accepted: true, ResponseJson: body,
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
		HttpStatus:        http.StatusOK,
	}
}

func validLocalAppPersonaCharacterInputJSON(replace bool) string {
	body := `{"worldId":"world-1","visibility":"private","origin":{"kind":"forge"},"profile":{
		"profileSchemaVersion":"realm.character-profile-core/v1",
		"identity":{"name":"Nimi Lab Persona","summary":"Owner PersonaCharacter acceptance"},
		"presentation":{"displayName":"Nimi Lab Persona"},
		"narrative":{"summary":"Bearer abcdefgh.abcdefgh.abcdefgh","token":"product-token"},
		"interactionProfile":{"interactionModes":[]},
		"assets":{"resourceRefs":[],"intents":[],"externalRefs":[{"refId":"avatar","kind":"image","uri":"https://cdn.example.test/avatar.png"}]},
		"authoring":{"source":"nimi.lab.realm-app-access","extensions":{"future.product":{"extensionSchemaVersion":"future/v1","namespace":"future.product","productSemantic":true,"fields":{"token":"product-token","jwt":"opaque.product.content","classification":"story"}}}}
	}}`
	if !replace {
		return body
	}
	return strings.TrimSuffix(body, "}") + `,"baseContentHash":"` + strings.Repeat("a", 64) + `"}`
}

func validLocalAppPersonaCharacterJSON(id, owner string, revision int) string {
	return fmt.Sprintf(`{"id":%q,"schemaVersion":"realm.persona-character-core/v1","contentRevision":%d,
		"contentHash":"%s","origin":{"kind":"forge"},"ownerAccountId":%q,"worldId":"world-1","visibility":"private",
		"profile":{"profileSchemaVersion":"realm.character-profile-core/v1","identity":{"name":"Persona","summary":"Summary"},
		"presentation":{"displayName":"Persona"},"narrative":{"summary":"Summary","token":"product-token","jwt":"opaque.product.content"},
		"interactionProfile":{"interactionModes":[]},"assets":{"resourceRefs":[],"intents":[],"externalRefs":[{"refId":"avatar","kind":"image","uri":"https://cdn.example.test/avatar.png"}]},
		"authoring":{"source":"test"},"profileHash":"%s","profileCoverage":{"profileCoverageHash":"%s","opaque":"Realm-owned"}},
		"validity":{"status":"valid","issues":[]},"materializationReadiness":{"status":"ready","blockers":[]},
		"sourceHash":"%s","createdAt":"2026-08-21T00:00:00.000Z","updatedAt":"2026-08-21T00:00:00.000Z"}`,
		id, revision, strings.Repeat("d", 64), owner, strings.Repeat("c", 64), strings.Repeat("e", 64), strings.Repeat("b", 64))
}
