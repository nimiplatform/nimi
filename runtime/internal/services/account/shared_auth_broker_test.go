package account

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/metadata"
)

func TestAccountRPCPermissionMatrixKeepsAccountControlDesktopOwned(t *testing.T) {
	desktop := realmDesktopShellCaller()
	localApp := firstPartyCaller()

	for _, tc := range []struct {
		name   string
		caller *runtimev1.AccountCaller
	}{
		{name: "local_first_party", caller: localApp},
	} {
		t.Run("begin_login_denies_"+tc.name, func(t *testing.T) {
			svc := newHarnessService(t, &memoryCustody{err: ErrNoStoredAccount}, WithAppRegistry(testAppRegistry(t, desktop, localApp)))
			response, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: tc.caller})
			if err != nil {
				t.Fatalf("BeginLogin: %v", err)
			}
			if response.GetAccepted() || response.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
				t.Fatalf("%s must not own BeginLogin: %+v", tc.name, response)
			}
		})
	}

	svc := newHarnessService(t, nil, WithAppRegistry(testAppRegistry(t, desktop, localApp)), WithRefresher(staticRefresher{material: testMaterial("acct-1", "access-2", "refresh-2")}))
	completeLoginAs(t, svc, desktop)
}

func TestInvokeRealmUnaryTypedNegativeMatrix(t *testing.T) {
	for _, tc := range []struct {
		name        string
		methodID    string
		requestJSON string
		status      int
		body        string
		want        runtimev1.AccountReasonCode
	}{
		{name: "request_shape", methodID: "WorldPublicController_listWorlds", requestJSON: `{"query":{"notAdmitted":"value"}}`, status: http.StatusOK, body: `{"ok":true}`, want: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_INVALID},
		{name: "credential_request", methodID: "WorldPublicController_listWorlds", requestJSON: `{"body":{"accessToken":"caller-secret"}}`, status: http.StatusOK, body: `{"ok":true}`, want: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_INVALID},
		{name: "upstream_non_2xx", methodID: "WorldPublicController_listWorlds", requestJSON: `{}`, status: http.StatusServiceUnavailable, body: `{"error":"down"}`, want: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REALM_UNAVAILABLE},
		{name: "response_too_large", methodID: "WorldPublicController_listWorlds", requestJSON: `{}`, status: http.StatusOK, body: `{"value":"` + strings.Repeat("x", (1<<20)+1) + `"}`, want: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_RESPONSE_TOO_LARGE},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var hits atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				hits.Add(1)
				w.Header().Set("content-type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			svc := newRealmUnaryHarnessService(t, server.URL)
			completeLogin(t, svc)
			response, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:       realmDesktopShellCaller(),
				MethodId:     tc.methodID,
				RealmBaseUrl: server.URL,
				RequestJson:  tc.requestJSON,
			})
			if err != nil {
				t.Fatalf("InvokeRealmUnary: %v", err)
			}
			if response.GetAccepted() || response.GetResponseJson() != "" || response.GetAccountReasonCode() != tc.want {
				t.Fatalf("typed broker failure mismatch: %+v", response)
			}
			if (tc.name == "request_shape" || tc.name == "credential_request") && hits.Load() != 0 {
				t.Fatalf("invalid broker request reached Realm upstream")
			}
		})
	}
}

func TestInvokeRealmUnaryFailsClosedOnCredentialLikeResponse(t *testing.T) {
	for _, tc := range []struct {
		name   string
		header bool
		body   string
	}{
		{name: "credential_key", body: `{"accessToken":"realm-secret"}`},
		{name: "bearer_value", body: `{"value":"Bearer realm-secret"}`},
		{name: "jwt_shape", body: `{"value":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhY2N0In0.signature"}`}, // pragma: allowlist secret -- synthetic token-leak rejection fixture
		{name: "authorization_header", header: true, body: `{"ok":true}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("content-type", "application/json")
				if tc.header {
					w.Header().Set("authorization", "Bearer realm-secret")
				}
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			svc := newRealmUnaryHarnessService(t, server.URL)
			completeLoginAs(t, svc, realmDesktopShellCaller())
			response, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:       realmDesktopShellCaller(),
				MethodId:     "WorldPublicController_listWorlds",
				RealmBaseUrl: server.URL,
				RequestJson:  `{}`,
			})
			if err != nil {
				t.Fatalf("InvokeRealmUnary: %v", err)
			}
			if response.GetAccepted() || response.GetResponseJson() != "" || !strings.Contains(strings.ToLower(response.GetErrorMessage()), "credential") {
				t.Fatalf("credential-like broker response must fail closed without payload: %+v", response)
			}
		})
	}
}

func TestRuntimePrivateRefreshIsSingleFlightForTokenProjection(t *testing.T) {
	refresher := &countingAccountRefresher{material: testMaterial("acct-1", "access-refreshed", "refresh-refreshed")}
	svc := newHarnessService(t, nil, WithRefresher(refresher))
	completeLogin(t, svc)
	svc.mu.Lock()
	svc.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED
	svc.material.AccessTokenExpires = time.Now().UTC().Add(-time.Minute)
	svc.mu.Unlock()

	const callers = 12
	var wait sync.WaitGroup
	wait.Add(callers)
	errors := make(chan error, callers)
	for range callers {
		go func() {
			defer wait.Done()
			accessToken, reason, ok, err := svc.realmUnaryAccessToken(context.Background(), nil)
			if err != nil {
				errors <- err
				return
			}
			if !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED || accessToken != "access-refreshed" {
				errors <- fmt.Errorf("unexpected private credential: ok=%v reason=%v token=%q", ok, reason, accessToken)
			}
		}()
	}
	wait.Wait()
	close(errors)
	for err := range errors {
		t.Fatal(err)
	}
	if calls := refresher.calls.Load(); calls != 1 {
		t.Fatalf("Runtime private refresh calls = %d, want exactly one", calls)
	}
}

func TestProductionLocalCallerRequiresRuntimeAppSessionProof(t *testing.T) {
	custody := &memoryCustody{material: testMaterial("acct-1", "access-1", "refresh-1"), has: true}
	svc := newProductionHarnessService(t, custody)

	withoutProof, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus without proof: %v", err)
	}
	if withoutProof.GetReasonCode() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED || withoutProof.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH {
		t.Fatalf("production local caller without app-session proof must fail closed: %+v", withoutProof)
	}

	caller := firstPartyCaller()
	appSessionContext := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", caller.GetAppId(),
		"x-nimi-app-instance-id", caller.GetAppInstanceId(),
		"x-nimi-device-id", caller.GetDeviceId(),
		"x-nimi-session-id", "desktop-runtime-session",
		"x-nimi-session-token", "desktop-runtime-session-token",
	))
	withProof, err := svc.GetAccountSessionStatus(appSessionContext, &runtimev1.GetAccountSessionStatusRequest{Caller: caller})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus with proof: %v", err)
	}
	if withProof.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || accountStatusProjection(withProof).GetAccountId() != "acct-1" {
		t.Fatalf("bound Runtime app-session proof must admit local caller: %+v", withProof)
	}
}

type countingAccountRefresher struct {
	calls    atomic.Int32
	material AccountMaterial
}

func (r *countingAccountRefresher) Refresh(context.Context, AccountMaterial) (AccountMaterial, error) {
	r.calls.Add(1)
	time.Sleep(25 * time.Millisecond)
	return r.material, nil
}

func beginLoginAs(t *testing.T, svc *Service, caller *runtimev1.AccountCaller) *runtimev1.BeginLoginResponse {
	t.Helper()
	response, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: caller})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if !response.GetAccepted() {
		t.Fatalf("BeginLogin not accepted: %+v", response)
	}
	return response
}

func completeLoginAttemptAs(t *testing.T, svc *Service, caller *runtimev1.AccountCaller, begin *runtimev1.BeginLoginResponse) {
	t.Helper()
	response, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         caller,
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "auth-code",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
	})
	if err != nil {
		t.Fatalf("CompleteLogin: %v", err)
	}
	if !response.GetAccepted() {
		t.Fatalf("CompleteLogin not accepted: %+v", response)
	}
}

func completeLoginAs(t *testing.T, svc *Service, caller *runtimev1.AccountCaller) {
	t.Helper()
	completeLoginAttemptAs(t, svc, caller, beginLoginAs(t, svc, caller))
}

func TestRealmBrokerAuthorizationProfileRejectsSameAppNonDesktopInstance(t *testing.T) {
	caller := realmDesktopShellCaller()
	background := &runtimev1.AccountCaller{
		AppId:         caller.GetAppId(),
		AppInstanceId: "nimi.desktop.runtime-agent",
		DeviceId:      "runtime-agent",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
	operation := realmBrokerOperations["WorldCoreController_getPersonaCharacter"]
	if !operation.admitsProtectedSourceReadinessCaller(caller) {
		t.Fatal("protected Desktop caller must satisfy the exact source-readiness profile")
	}
	if operation.admitsProtectedSourceReadinessCaller(background) {
		t.Fatal("same-app background instance must not inherit Desktop broker admission")
	}
}
