package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
		MethodId:     "listMyCreatorWorlds",
		RealmBaseUrl: server.URL,
		RequestJson:  `{"path":{},"query":{"limit":1}}`,
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
	if observedPath != "/api/me/creator/worlds" || observedQuery != "limit=1" {
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
		name        string
		caller      *runtimev1.AccountCaller
		methodID    string
		requestJSON string
		method      string
		path        string
		query       string
	}{
		{
			name:        "agent handle check",
			caller:      realmAgentStudioCaller(),
			methodID:    "AgentController_checkHandle",
			requestJSON: `{"path":{},"query":{"handle":"demo"}}`,
			method:      http.MethodGet,
			path:        "/api/agent/handles/check",
			query:       "handle=demo",
		},
		{
			name:        "agent create",
			caller:      realmAgentStudioCaller(),
			methodID:    "AgentController_create",
			requestJSON: `{"path":{},"body":{"handle":"demo"}}`,
			method:      http.MethodPost,
			path:        "/api/agent",
		},
		{
			name:        "agent avatar select",
			caller:      realmAgentStudioCaller(),
			methodID:    "AgentController_selectAvatar",
			requestJSON: `{"path":{"id":"agent-1"},"body":{"avatarUrl":"https://example.test/a.png"}}`,
			method:      http.MethodPost,
			path:        "/api/agent/accounts/agent-1/avatar",
		},
		{
			name:        "agent visibility read",
			caller:      realmAgentStudioCaller(),
			methodID:    "AgentController_getVisibility",
			requestJSON: `{"path":{"id":"agent-1"}}`,
			method:      http.MethodGet,
			path:        "/api/agent/accounts/agent-1/visibility",
		},
		{
			name:        "agent visibility update",
			caller:      realmAgentStudioCaller(),
			methodID:    "AgentController_updateVisibility",
			requestJSON: `{"path":{"id":"agent-1"},"body":{"isPublic":true}}`,
			method:      http.MethodPatch,
			path:        "/api/agent/accounts/agent-1/visibility",
		},
		{
			name:        "world list",
			caller:      realmAgentStudioCaller(),
			methodID:    "WorldController_listWorlds",
			requestJSON: `{"path":{}}`,
			method:      http.MethodGet,
			path:        "/api/world",
		},
		{
			name:        "world detail with agents",
			caller:      realmAgentStudioCaller(),
			methodID:    "WorldController_getWorldDetailWithAgents",
			requestJSON: `{"path":{"id":"world-1"}}`,
			method:      http.MethodGet,
			path:        "/api/world/by-id/world-1/detail-with-agents",
		},
		{
			name:        "post create",
			caller:      realmAgentStudioCaller(),
			methodID:    "createPost",
			requestJSON: `{"path":{},"body":{"body":"hello"}}`,
			method:      http.MethodPost,
			path:        "/api/world/posts",
		},
		{
			name:        "resource list",
			caller:      realmAgentStudioCaller(),
			methodID:    "listResources",
			requestJSON: `{"path":{}}`,
			method:      http.MethodGet,
			path:        "/api/resources",
		},
		{
			name:        "creator world list",
			caller:      realmWorldStudioCaller(),
			methodID:    "listMyCreatorWorlds",
			requestJSON: `{"path":{}}`,
			method:      http.MethodGet,
			path:        "/api/me/creator/worlds",
		},
		{
			name:        "creator world agent list",
			caller:      realmWorldStudioCaller(),
			methodID:    "listCreatorWorldAgents",
			requestJSON: `{"path":{"worldId":"world-1"}}`,
			method:      http.MethodGet,
			path:        "/api/me/creator/worlds/world-1/agents",
		},
		{
			name:        "creator world agent detail",
			caller:      realmWorldStudioCaller(),
			methodID:    "getCreatorWorldAgent",
			requestJSON: `{"path":{"worldId":"world-1","agentId":"agent-1"}}`,
			method:      http.MethodGet,
			path:        "/api/me/creator/worlds/world-1/agents/agent-1",
		},
		{
			name:        "creator world agent settings read",
			caller:      realmWorldStudioCaller(),
			methodID:    "getCreatorWorldAgentSettings",
			requestJSON: `{"path":{"worldId":"world-1","agentId":"agent-1"}}`,
			method:      http.MethodGet,
			path:        "/api/me/creator/worlds/world-1/agents/agent-1/settings",
		},
		{
			name:        "creator world agent source skeleton read",
			caller:      realmWorldStudioCaller(),
			methodID:    "getCreatorWorldAgentSourceSkeleton",
			requestJSON: `{"path":{"worldId":"world-1","agentId":"agent-1"}}`,
			method:      http.MethodGet,
			path:        "/api/me/creator/worlds/world-1/agents/agent-1/source-skeleton",
		},
		{
			name:        "creator world agent authoring generation context read",
			caller:      realmWorldStudioCaller(),
			methodID:    "getCreatorWorldAgentAuthoringGenerationContext",
			requestJSON: `{"path":{"worldId":"world-1","agentId":"agent-1"}}`,
			method:      http.MethodGet,
			path:        "/api/me/creator/worlds/world-1/agents/agent-1/authoring-generation-context",
		},
		{
			name:        "creator world agent authoring draft batch list",
			caller:      realmWorldStudioCaller(),
			methodID:    "listCreatorWorldAgentAuthoringDraftBatches",
			requestJSON: `{"path":{"worldId":"world-1","agentId":"agent-1"}}`,
			method:      http.MethodGet,
			path:        "/api/me/creator/worlds/world-1/agents/agent-1/authoring-draft-batches",
		},
		{
			name:        "creator world agent authoring draft batch create",
			caller:      realmWorldStudioCaller(),
			methodID:    "createCreatorWorldAgentAuthoringDraftBatch",
			requestJSON: `{"path":{"worldId":"world-1","agentId":"agent-1"},"body":{"skeletonId":"skeleton-1","candidates":[{"targetKey":"greeting"}]}}`,
			method:      http.MethodPost,
			path:        "/api/me/creator/worlds/world-1/agents/agent-1/authoring-draft-batches",
		},
		{
			name:        "creator world agent authoring draft candidate review",
			caller:      realmWorldStudioCaller(),
			methodID:    "reviewCreatorWorldAgentAuthoringDraftCandidate",
			requestJSON: `{"path":{"worldId":"world-1","agentId":"agent-1","batchId":"batch-1","candidateId":"candidate-1"},"body":{"reviewStatus":"accepted"}}`,
			method:      http.MethodPatch,
			path:        "/api/me/creator/worlds/world-1/agents/agent-1/authoring-draft-batches/batch-1/candidates/candidate-1/review",
		},
		{
			name:        "creator world agent authoring draft batch apply",
			caller:      realmWorldStudioCaller(),
			methodID:    "applyCreatorWorldAgentAuthoringDraftBatch",
			requestJSON: `{"path":{"worldId":"world-1","agentId":"agent-1","batchId":"batch-1"}}`,
			method:      http.MethodPost,
			path:        "/api/me/creator/worlds/world-1/agents/agent-1/authoring-draft-batches/batch-1/apply",
		},
		{
			name:        "creator world agent chat readiness read",
			caller:      realmWorldStudioCaller(),
			methodID:    "getCreatorWorldAgentChatReadiness",
			requestJSON: `{"path":{"worldId":"world-1","agentId":"agent-1"}}`,
			method:      http.MethodGet,
			path:        "/api/me/creator/worlds/world-1/agents/agent-1/chat-readiness",
		},
		{
			name:        "creator world agent settings update",
			caller:      realmWorldStudioCaller(),
			methodID:    "updateCreatorWorldAgentSettings",
			requestJSON: `{"path":{"worldId":"world-1","agentId":"agent-1"},"body":{"displayName":"Agent"}}`,
			method:      http.MethodPatch,
			path:        "/api/me/creator/worlds/world-1/agents/agent-1/settings",
		},
		{
			name:        "shared resource upload",
			caller:      realmWorldStudioCaller(),
			methodID:    "createImageDirectUpload",
			requestJSON: `{"path":{},"body":{"filename":"image.png"}}`,
			method:      http.MethodPost,
			path:        "/api/resources/images/direct-upload",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wantMethod = tc.method
			wantPath = tc.path
			wantQuery = tc.query
			resp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:       tc.caller,
				MethodId:     tc.methodID,
				RealmBaseUrl: server.URL,
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
			name:     "world studio cannot read owner portfolio",
			caller:   realmWorldStudioCaller(),
			methodID: "listMyRealmAgents",
		},
		{
			name:     "world studio cannot use owner create",
			caller:   realmWorldStudioCaller(),
			methodID: "AgentController_create",
		},
		{
			name:     "agent studio cannot read creator worlds",
			caller:   realmAgentStudioCaller(),
			methodID: "listMyCreatorWorlds",
		},
		{
			name:     "agent studio cannot update creator world agents",
			caller:   realmAgentStudioCaller(),
			methodID: "updateCreatorWorldAgentSettings",
		},
		{
			name:     "agent studio cannot read creator world agent source skeleton",
			caller:   realmAgentStudioCaller(),
			methodID: "getCreatorWorldAgentSourceSkeleton",
		},
		{
			name:     "agent studio cannot read creator world agent authoring context",
			caller:   realmAgentStudioCaller(),
			methodID: "getCreatorWorldAgentAuthoringGenerationContext",
		},
		{
			name:     "agent studio cannot create creator world authoring draft batch",
			caller:   realmAgentStudioCaller(),
			methodID: "createCreatorWorldAgentAuthoringDraftBatch",
		},
		{
			name:     "agent studio cannot apply creator world authoring draft batch",
			caller:   realmAgentStudioCaller(),
			methodID: "applyCreatorWorldAgentAuthoringDraftBatch",
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
			if resp.GetAccepted() || resp.GetReasonCode() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
				t.Fatalf("cross-lane request must fail closed: %+v", resp)
			}
		})
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
	}, nil); err != nil {
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
		MethodId:     "listMyCreatorWorlds",
		RealmBaseUrl: "https://realm.foreign.test",
		RequestJson:  `{"path":{}}`,
	})
	if err != nil {
		t.Fatalf("foreign InvokeRealmUnary: %v", err)
	}
	if foreign.GetAccepted() || foreign.GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("foreign Realm base URL must fail closed: %+v", foreign)
	}

	dev, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:       developer,
		MethodId:     "listMyCreatorWorlds",
		RealmBaseUrl: "https://realm.authorized.test",
		RequestJson:  `{"path":{}}`,
	})
	if err != nil {
		t.Fatalf("developer InvokeRealmUnary: %v", err)
	}
	if dev.GetAccepted() || dev.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
		t.Fatalf("developer caller must not use Runtime Realm mediation: %+v", dev)
	}
}

func newRealmUnaryHarnessService(t *testing.T, realmBaseURL string) *Service {
	t.Helper()
	return newHarnessService(
		t,
		nil,
		WithAppRegistry(testAppRegistry(t, firstPartyCaller(), realmAgentStudioCaller(), realmWorldStudioCaller())),
		WithRealmBaseURL(realmBaseURL),
	)
}

func realmAgentStudioCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         realmAgentStudioAppID,
		AppInstanceId: "nimi.realm-agent-studio.local-first-party",
		DeviceId:      "device-1",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
}

func realmWorldStudioCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         realmWorldStudioAppID,
		AppInstanceId: "nimi.realm-world-studio.local-first-party",
		DeviceId:      "device-1",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
}
