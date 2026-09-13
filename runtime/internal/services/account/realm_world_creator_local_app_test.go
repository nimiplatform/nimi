package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func worldCreatorTestJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func worldCreatorTestRecord(t *testing.T, source string) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal([]byte(source), &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func worldCreatorCreateRequestJSON(t *testing.T) string {
	world := worldCreatorTestRecord(t, validLocalAppWorldCoreJSON("world-created"))
	return worldCreatorTestJSON(t, map[string]any{"path": map[string]any{}, "query": map[string]any{}, "body": map[string]any{
		"id": "world-created", "core": world["core"], "origin": world["origin"], "lorebookDeclaration": world["lorebookDeclaration"], "visibility": world["visibility"],
	}})
}

func TestWorldCreatorBrokerRoutesAndCanonicalProjection(t *testing.T) {
	world := worldCreatorTestRecord(t, validLocalAppWorldCoreJSON("world-1"))
	world["creatorId"] = "account-1"
	world["lorebookDeclaration"].(map[string]any)["identityBaseSetting"] = "Bearer of the northern seal guards the city."
	character := worldCreatorTestCharacter(t)
	entity := worldCreatorTestEntity()
	relationship := worldCreatorTestRelationship()
	characterInput := worldCreatorTestRecord(t, validLocalAppPersonaCharacterInputJSON(false))
	delete(characterInput, "worldId")
	characterInput["origin"] = map[string]any{"kind": "manual"}
	characterInput["worldEntityRef"] = character["worldEntityRef"]
	worldInput := map[string]any{"core": world["core"], "origin": world["origin"], "lorebookDeclaration": world["lorebookDeclaration"], "baseContentHash": strings.Repeat("a", 64)}
	worldCreate := map[string]any{"id": "world-1", "core": world["core"], "origin": world["origin"], "lorebookDeclaration": world["lorebookDeclaration"]}
	characterReplace := worldCreatorTestRecord(t, worldCreatorTestJSON(t, characterInput))
	characterReplace["baseContentHash"] = strings.Repeat("a", 64)
	for _, tc := range []struct {
		name   string
		op     LocalAppOperation
		method string
		path   map[string]any
		query  map[string]any
		body   any
		result any
		want   string
	}{
		{"eligibility", LocalAppOperationRealmWorldCreationEligibilityGet, "getWorldCreationEligibility", nil, nil, nil, map[string]any{"canCreateWorld": false}, "GET /api/realm/core/world-creation-eligibility"},
		{"world list", LocalAppOperationRealmWorldCoreList, "listWorldCores", nil, map[string]any{"take": 20}, nil, []any{world}, "GET /api/realm/core/worlds?take=20"},
		{"world create", LocalAppOperationRealmWorldCoreCreate, "createWorldCore", nil, nil, worldCreate, world, "POST /api/realm/core/worlds"},
		{"world get", LocalAppOperationRealmWorldCoreGet, "getWorldCore", map[string]any{"worldId": "world-1"}, nil, nil, world, "GET /api/realm/core/worlds/world-1"},
		{"world replace", LocalAppOperationRealmWorldCoreReplace, "replaceWorldCore", map[string]any{"worldId": "world-1"}, nil, worldInput, world, "PUT /api/realm/core/worlds/world-1"},
		{"character list", LocalAppOperationRealmWorldCharacterList, "listWorldCharacters", map[string]any{"worldId": "world-1"}, map[string]any{"take": 30, "afterId": "previous"}, nil, []any{character}, "GET /api/realm/core/worlds/world-1/characters?afterId=previous&take=30"},
		{"character get", LocalAppOperationRealmWorldCharacterGet, "getWorldCharacter", map[string]any{"characterId": "character-1"}, nil, nil, character, "GET /api/realm/core/world-characters/by-id/character-1"},
		{"character create", LocalAppOperationRealmWorldCharacterCreate, "createWorldCharacter", map[string]any{"worldId": "world-1"}, nil, characterInput, character, "POST /api/realm/core/worlds/world-1/characters"},
		{"character replace", LocalAppOperationRealmWorldCharacterReplace, "replaceWorldCharacter", map[string]any{"characterId": "character-1"}, nil, characterReplace, character, "PUT /api/realm/core/world-characters/by-id/character-1"},
		{"entity list", LocalAppOperationRealmWorldEntityList, "listWorldEntities", map[string]any{"worldId": "world-1"}, map[string]any{"kind": "person"}, nil, []any{entity}, "GET /api/realm/core/worlds/world-1/entities?kind=person"},
		{"entity get", LocalAppOperationRealmWorldEntityGet, "getWorldEntity", map[string]any{"entityId": "entity-1"}, nil, nil, entity, "GET /api/realm/core/world-entities/entity-1"},
		{"entity create", LocalAppOperationRealmWorldEntityCreate, "createWorldEntity", map[string]any{"worldId": "world-1"}, nil, map[string]any{"core": entity["core"], "kind": "person", "origin": entity["origin"]}, entity, "POST /api/realm/core/worlds/world-1/entities"},
		{"relationship list", LocalAppOperationRealmWorldRelationshipList, "listWorldRelationships", map[string]any{"worldId": "world-1"}, map[string]any{"type": "knows"}, nil, []any{relationship}, "GET /api/realm/core/worlds/world-1/relationships?type=knows"},
		{"relationship get", LocalAppOperationRealmWorldRelationshipGet, "getWorldRelationship", map[string]any{"relationshipId": "relationship-1"}, nil, nil, relationship, "GET /api/realm/core/world-relationships/relationship-1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var observed string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				observed = r.Method + " " + r.URL.RequestURI()
				w.Header().Set("content-type", "application/json")
				_, _ = w.Write([]byte(worldCreatorTestJSON(t, tc.result)))
			}))
			defer server.Close()
			svc := newRealmUnaryHarnessService(t, server.URL)
			completeLogin(t, svc)
			ctx := ContextWithAuthorizedLocalAppDecision(context.Background(), LocalAppCallerDecision{RegisteredAppSubject: "lap_world_studio", AccountID: "account-1", Operation: tc.op})
			request := map[string]any{}
			if tc.path != nil {
				request["path"] = tc.path
			}
			if tc.query != nil {
				request["query"] = tc.query
			}
			if tc.body != nil {
				request["body"] = tc.body
			}
			response, err := svc.InvokeRealmUnary(ctx, &runtimev1.InvokeRealmUnaryRequest{MethodId: "WorldCoreController_" + tc.method, RequestJson: worldCreatorTestJSON(t, request)})
			if err != nil || !response.GetAccepted() {
				t.Fatalf("response=%+v error=%v", response, err)
			}
			if observed != tc.want {
				t.Fatalf("route %q; want %q", observed, tc.want)
			}
			var actual any
			if err := json.Unmarshal([]byte(response.GetResponseJson()), &actual); err != nil {
				t.Fatal(err)
			}
			if worldCreatorTestJSON(t, actual) != worldCreatorTestJSON(t, tc.result) {
				t.Fatal("canonical source content was changed")
			}
		})
	}
}

func worldCreatorTestCharacter(t *testing.T) map[string]any {
	character := worldCreatorTestRecord(t, validLocalAppPersonaCharacterJSON("character-1", "account-1", 1))
	delete(character, "ownerAccountId")
	character["schemaVersion"] = "realm.world-character-core/v1"
	character["creatorId"] = "account-1"
	character["origin"] = map[string]any{"kind": "manual"}
	character["worldEntityRef"] = map[string]any{"kind": "worldEntity", "worldId": "world-1", "entityId": "entity-1"}
	return character
}

func worldCreatorTestEntity() map[string]any {
	return map[string]any{
		"id": "entity-1", "worldId": "world-1", "schemaVersion": "1", "contentRevision": 1,
		"contentHash": strings.Repeat("a", 64), "origin": map[string]any{"kind": "manual"}, "kind": "person",
		"core": map[string]any{
			"identity":       map[string]any{"name": "Keeper", "summary": "A harbor keeper.", "kind": "person"},
			"classification": map[string]any{"tags": []any{}},
			"facts":          []any{map[string]any{"factId": "age", "type": "number", "label": "Age", "value": 30, "confidence": "recorded", "attributes": map[string]any{"token": "story item"}}},
			"assets":         map[string]any{"resourceRefs": []any{}, "intents": []any{}},
			"evidence":       map[string]any{"sourceRefs": []any{}, "completeness": "complete"},
			"authoring":      map[string]any{"source": "manual"},
		},
		"createdAt": "2026-09-12T00:00:00Z", "updatedAt": "2026-09-12T00:00:00Z",
	}
}

func worldCreatorTestRelationship() map[string]any {
	value := worldCreatorTestEntity()
	delete(value, "kind")
	value["id"] = "relationship-1"
	value["sourceEntityId"], value["targetEntityId"], value["type"] = "entity-1", "entity-2", "knows"
	value["core"] = map[string]any{
		"endpoints":    map[string]any{"sourceEntityId": "entity-1", "targetEntityId": "entity-2", "type": "knows"},
		"evidence":     map[string]any{"sourceRefs": []any{}, "confidence": "recorded"},
		"presentation": map[string]any{}, "authoring": map[string]any{"source": "manual"},
		"attributes": map[string]any{"generation": 3, "token": "story item"},
	}
	return value
}

func TestWorldCreatorNestedDTOsFailClosed(t *testing.T) {
	for _, tc := range []struct {
		family string
		path   []string
		value  any
		remove bool
	}{
		{"entity", []string{"core", "identity", "summary"}, nil, true},
		{"entity", []string{"core", "identity", "extra"}, "undeclared", false},
		{"entity", []string{"core", "classification", "tags"}, nil, true},
		{"entity", []string{"core", "classification", "tags"}, []any{12}, false},
		{"entity", []string{"core", "assets", "resourceRefs"}, nil, true},
		{"entity", []string{"core", "assets", "intents"}, nil, true},
		{"entity", []string{"core", "assets", "externalRefs"}, []any{map[string]any{"refId": "asset", "kind": "image", "uri": "https://cdn.example/a.png?token=secret"}}, false},
		{"entity", []string{"core", "evidence", "sourceRefs"}, nil, true},
		{"entity", []string{"core", "evidence", "completeness"}, "unknown", false},
		{"entity", []string{"core", "authoring", "source"}, nil, true},
		{"entity", []string{"core", "authoring", "extensions"}, map[string]any{}, false},
		{"entity", []string{"core", "facts"}, []any{map[string]any{}}, false},
		{"entity", []string{"core", "facts"}, []any{map[string]any{"factId": "age", "type": "number", "label": "Age", "value": []any{[]any{1}}, "confidence": "recorded"}}, false},
		{"relationship", []string{"core", "evidence", "sourceRefs"}, nil, true},
		{"relationship", []string{"core", "evidence", "confidence"}, "unknown", false},
		{"relationship", []string{"core", "authoring", "source"}, nil, true},
		{"relationship", []string{"core", "presentation", "summary"}, 12, false},
		{"relationship", []string{"core", "endpoints", "sourceEntityId"}, "another-entity", false},
		{"relationship", []string{"core", "endpoints", "extra"}, "undeclared", false},
	} {
		t.Run(tc.family+"/"+strings.Join(tc.path, "/"), func(t *testing.T) {
			value := worldCreatorTestEntity()
			op, pathKey := LocalAppOperationRealmWorldEntityGet, "entityId"
			if tc.family == "relationship" {
				value = worldCreatorTestRelationship()
				op, pathKey = LocalAppOperationRealmWorldRelationshipGet, "relationshipId"
			}
			parent := value
			for _, key := range tc.path[:len(tc.path)-1] {
				parent = parent[key].(map[string]any)
			}
			key := tc.path[len(tc.path)-1]
			if tc.remove {
				delete(parent, key)
			} else {
				parent[key] = tc.value
			}
			response := projectLocalAppWorldCreatorResponse(op, realmUnaryRequestJSON{Path: map[string]any{pathKey: value["id"]}}, "account-1", &runtimev1.InvokeRealmUnaryResponse{
				Accepted: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
				HttpStatus: 200, ResponseJson: worldCreatorTestJSON(t, value),
			})
			if response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID || response.GetResponseJson() != "" {
				t.Fatalf("malformed nested DTO was projected: %v", response)
			}
			if tc.family == "entity" {
				body := []byte(worldCreatorTestJSON(t, map[string]any{"kind": value["kind"], "origin": value["origin"], "core": value["core"]}))
				if err := validateLocalAppWorldCreatorRequest(LocalAppOperationRealmWorldEntityCreate, realmUnaryRequestJSON{Path: map[string]any{"worldId": "world-1"}, Body: body}); err == nil {
					t.Fatal("malformed entity create was admitted")
				}
			}
		})
	}
}

func TestDesktopWorldSourceReadsPreserveContentAndRejectUnsafeDTOs(t *testing.T) {
	for _, source := range []string{"entity", "character", "relationship"} {
		for _, variant := range []string{"story", "top-level credential", "response header", "identity mismatch", "missing field", "signed asset", "error credential"} {
			if source == "relationship" && variant == "signed asset" {
				continue
			}
			t.Run(source+"/"+variant, func(t *testing.T) {
				value := worldCreatorTestEntity()
				method, pathKey, id := "WorldCoreController_getWorldEntity", "entityId", "entity-1"
				if source == "character" {
					value = worldCreatorTestCharacter(t)
					method, pathKey, id = "WorldCoreController_getWorldCharacter", "characterId", "character-1"
				}
				if source == "relationship" {
					value = worldCreatorTestRelationship()
					method, pathKey, id = "WorldCoreController_listWorldRelationships", "worldId", "world-1"
				}
				const story = "Bearer of the northern seal guards the harbor."
				content := value["core"]
				if source == "character" {
					content = value["profile"]
				}
				fields := content.(map[string]any)
				switch source {
				case "entity":
					fields["identity"].(map[string]any)["summary"] = story
				case "character":
					fields["narrative"].(map[string]any)["summary"] = story
				case "relationship":
					fields["presentation"].(map[string]any)["summary"] = story
				}
				switch variant {
				case "top-level credential":
					value["accessToken"] = "unexpected"
				case "identity mismatch":
					if source == "relationship" {
						value["worldId"] = "another-world"
					} else {
						value["id"] = "another-id"
					}
				case "missing field":
					delete(value, "schemaVersion")
				case "signed asset":
					fields["assets"].(map[string]any)["externalRefs"] = []any{map[string]any{"refId": "image", "kind": "image", "uri": "https://cdn.example/image.png?token=secret"}}
				}
				var result any = value
				if source == "relationship" {
					result = []any{value}
				}
				body := worldCreatorTestJSON(t, result)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					if variant == "response header" {
						w.Header().Set("Authorization", "Bearer unexpected")
					}
					if variant == "error credential" {
						w.WriteHeader(http.StatusForbidden)
						_, _ = w.Write([]byte(`{"authorization":"Bearer unexpected"}`))
						return
					}
					_, _ = w.Write([]byte(body))
				}))
				defer server.Close()
				svc := newRealmUnaryHarnessService(t, server.URL)
				completeLogin(t, svc)
				response, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
					Caller: realmDesktopShellCaller(), MethodId: method,
					RequestJson: worldCreatorTestJSON(t, map[string]any{"path": map[string]any{pathKey: id}}),
				})
				if err != nil {
					t.Fatal(err)
				}
				if variant == "story" {
					if !response.GetAccepted() || !strings.Contains(response.GetResponseJson(), story) {
						t.Fatalf("story was rejected or changed: %v", response)
					}
				} else if response.GetAccepted() || response.GetResponseJson() != "" || response.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID {
					t.Fatalf("unsafe response was not rejected: %v", response)
				}
			})
		}
	}
}

func TestWorldCreatorCharacterStatusResultsAreClosed(t *testing.T) {
	for _, tc := range []struct {
		field string
		value any
	}{
		{"validity", map[string]any{}},
		{"validity", map[string]any{"status": "ready", "issues": []any{}}},
		{"validity", map[string]any{"status": "valid", "issues": []any{map[string]any{"code": "missing"}}}},
		{"materializationReadiness", map[string]any{"status": "ready"}},
		{"materializationReadiness", map[string]any{"status": "ready", "blockers": []any{map[string]any{"path": "profile", "code": "missing", "message": 1}}}},
	} {
		t.Run(tc.field, func(t *testing.T) {
			value := worldCreatorTestRecord(t, validLocalAppPersonaCharacterJSON("character-1", "account-1", 1))
			delete(value, "ownerAccountId")
			value["schemaVersion"], value["creatorId"] = "realm.world-character-core/v1", "account-1"
			value["worldEntityRef"] = map[string]any{"kind": "worldEntity", "worldId": "world-1", "entityId": "entity-1"}
			value[tc.field] = tc.value
			response := projectLocalAppWorldCreatorResponse(LocalAppOperationRealmWorldCharacterGet, realmUnaryRequestJSON{Path: map[string]any{"characterId": "character-1"}}, "account-1", &runtimev1.InvokeRealmUnaryResponse{
				Accepted: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
				HttpStatus: 200, ResponseJson: worldCreatorTestJSON(t, value),
			})
			if response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID {
				t.Fatalf("invalid status projected: %v", response)
			}
		})
	}
}

func TestWorldCreatorRejectsAuthoritySelectorsBeforeHTTP(t *testing.T) {
	for _, tc := range []struct {
		op      LocalAppOperation
		request string
	}{
		{LocalAppOperationRealmWorldCreationEligibilityGet, `{"query":{"accountId":"another"}}`},
		{LocalAppOperationRealmWorldCreationEligibilityGet, `{"body":{"canCreateWorld":true}}`},
		{LocalAppOperationRealmWorldCoreGet, `{"path":{"worldId":"world-1","accountId":"other"}}`},
		{LocalAppOperationRealmWorldCharacterList, `{"path":{"worldId":"world-1"},"query":{"take":501}}`},
		{LocalAppOperationRealmWorldCoreReplace, `{"path":{"worldId":"world-1"},"body":{"id":"world-2","baseContentHash":"bad"}}`},
	} {
		var request realmUnaryRequestJSON
		if err := json.Unmarshal([]byte(tc.request), &request); err != nil {
			t.Fatal(err)
		}
		if err := validateLocalAppWorldCreatorRequest(tc.op, request); err == nil {
			t.Fatalf("accepted %s", tc.request)
		}
	}
}

func TestWorldCreatorProjectionRejectsMalformedEligibilityAndIdentity(t *testing.T) {
	accepted := func(body string) *runtimev1.InvokeRealmUnaryResponse {
		return &runtimev1.InvokeRealmUnaryResponse{Accepted: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, HttpStatus: http.StatusOK, ResponseJson: body}
	}
	if result := projectLocalAppWorldCreatorResponse(LocalAppOperationRealmWorldCreationEligibilityGet, realmUnaryRequestJSON{}, "account-1", accepted(`{"canCreateWorld":false}`)); !result.GetAccepted() {
		t.Fatal("valid eligibility envelope must pass before testing malformed values")
	}
	if result := projectLocalAppWorldCreatorResponse(LocalAppOperationRealmWorldCoreGet, realmUnaryRequestJSON{Path: map[string]any{"worldId": "world-1"}}, "account-1", accepted(validLocalAppWorldCoreJSON("world-1"))); !result.GetAccepted() {
		t.Fatal("valid matching world envelope must pass before testing identity mismatch")
	}
	for _, tc := range []struct {
		op      LocalAppOperation
		request realmUnaryRequestJSON
		result  string
	}{
		{LocalAppOperationRealmWorldCreationEligibilityGet, realmUnaryRequestJSON{}, `{"canCreateWorld":true,"role":"ADMIN"}`},
		{LocalAppOperationRealmWorldCreationEligibilityGet, realmUnaryRequestJSON{}, `{"canCreateWorld":"true"}`},
		{LocalAppOperationRealmWorldCoreGet, realmUnaryRequestJSON{Path: map[string]any{"worldId": "world-1"}}, validLocalAppWorldCoreJSON("world-2")},
	} {
		response := projectLocalAppWorldCreatorResponse(tc.op, tc.request, "account-1", accepted(tc.result))
		if response.GetAccepted() {
			t.Fatalf("accepted invalid response %s", tc.result)
		}
	}
}

func TestWorldCreatorCreateProjectionRequiresMatchingCallerIdentityAndSafeDTO(t *testing.T) {
	valid := worldCreatorTestRecord(t, validLocalAppWorldCoreJSON("world-created"))
	request := realmUnaryRequestJSON{Body: []byte(`{"id":"world-created"}`)}
	project := func(value map[string]any) *runtimev1.InvokeRealmUnaryResponse {
		return projectLocalAppWorldCreatorResponse(LocalAppOperationRealmWorldCoreCreate, request, "account-1", &runtimev1.InvokeRealmUnaryResponse{
			Accepted: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
			HttpStatus: http.StatusCreated, ResponseJson: worldCreatorTestJSON(t, value),
		})
	}
	if !project(valid).GetAccepted() {
		t.Fatal("positive control failed")
	}
	for _, field := range []string{"id", "creatorId", "accessToken"} {
		invalid := worldCreatorTestRecord(t, worldCreatorTestJSON(t, valid))
		invalid[field] = "not-the-requested-identity"
		if result := project(invalid); result.GetAccepted() || result.GetResponseJson() != "" {
			t.Fatalf("unsafe or mismatched %s was projected: %+v", field, result)
		}
	}
}
