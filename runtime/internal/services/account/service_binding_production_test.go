package account

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"google.golang.org/grpc/metadata"
)

func TestIssueScopedAppBindingRejectsUnregisteredAndRelationMismatchedCaller(t *testing.T) {
	t.Run("unregistered", func(t *testing.T) {
		svc := newHarnessService(t, nil)
		completeLogin(t, svc)
		svc.registry = appregistry.New()
		resp, err := svc.IssueScopedAppBinding(context.Background(), &runtimev1.IssueScopedAppBindingRequest{
			Caller:     firstPartyCaller(),
			Relation:   bindingRelation(),
			TtlSeconds: 600,
		})
		if err != nil {
			t.Fatalf("IssueScopedAppBinding: %v", err)
		}
		if resp.GetAccepted() || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
			t.Fatalf("unregistered caller must not issue binding: %+v", resp)
		}
	})

	t.Run("relation_mismatch", func(t *testing.T) {
		svc := newHarnessService(t, nil)
		completeLogin(t, svc)
		relation := bindingRelation()
		relation.AppInstanceId = "spoofed-instance"
		resp, err := svc.IssueScopedAppBinding(context.Background(), &runtimev1.IssueScopedAppBindingRequest{
			Caller:     firstPartyCaller(),
			Relation:   relation,
			TtlSeconds: 600,
		})
		if err != nil {
			t.Fatalf("IssueScopedAppBinding: %v", err)
		}
		if resp.GetAccepted() || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
			t.Fatalf("relation-mismatched caller must not issue binding: %+v", resp)
		}
	})
}

func TestBindingIssueRevokeReplayAndStaleRequestBehavior(t *testing.T) {
	svc := newHarnessService(t, nil)
	unauthIssue, err := svc.IssueScopedAppBinding(context.Background(), &runtimev1.IssueScopedAppBindingRequest{Caller: firstPartyCaller(), Relation: bindingRelation()})
	if err != nil {
		t.Fatalf("unauth IssueScopedAppBinding: %v", err)
	}
	if unauthIssue.GetAccepted() {
		t.Fatalf("binding issue must fail without authenticated account")
	}
	completeLogin(t, svc)
	issued := issueBinding(t, svc)
	if reason, ok := svc.ValidateScopedBinding(issued.GetBindingId(), issued.GetRelation(), "runtime.agent.turn.read"); !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
		t.Fatalf("active binding should validate, ok=%v reason=%v", ok, reason)
	}
	resolved := svc.ResolveScopedBindingRelation(issued.GetBindingId())
	if resolved.GetBindingId() != issued.GetBindingId() ||
		resolved.GetRuntimeAppId() != issued.GetRelation().GetRuntimeAppId() ||
		resolved.GetAppInstanceId() != issued.GetRelation().GetAppInstanceId() {
		t.Fatalf("resolved scoped binding relation mismatch: %#v", resolved)
	}
	resolved.AppInstanceId = "mutated-copy"
	if again := svc.ResolveScopedBindingRelation(issued.GetBindingId()); again.GetAppInstanceId() == "mutated-copy" {
		t.Fatalf("resolved scoped binding relation must be a copy")
	}
	replayRelation := cloneRelation(issued.GetRelation())
	replayRelation.WindowId = "other-window"
	if reason, ok := svc.ValidateScopedBinding(issued.GetBindingId(), replayRelation, "runtime.agent.turn.read"); ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_REPLAY {
		t.Fatalf("relation replay must fail closed, ok=%v reason=%v", ok, reason)
	}
	stale, err := svc.RevokeScopedAppBinding(context.Background(), &runtimev1.RevokeScopedAppBindingRequest{Caller: firstPartyCaller(), BindingId: issued.GetBindingId()})
	if err != nil {
		t.Fatalf("RevokeScopedAppBinding after replay: %v", err)
	}
	if !stale.GetAccepted() {
		t.Fatalf("explicit revoke remains idempotent over known binding: %+v", stale)
	}
	if reason, ok := svc.ValidateScopedBinding(issued.GetBindingId(), issued.GetRelation(), "runtime.agent.turn.read"); ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE {
		t.Fatalf("revoked binding must be stale, ok=%v reason=%v", ok, reason)
	}
}

func TestRevokeScopedAppBindingRejectsUnauthorizedCallersWithoutMutation(t *testing.T) {
	for _, tc := range []struct {
		name         string
		configure    func(*testing.T, *Service)
		caller       *runtimev1.AccountCaller
		wantReason   runtimev1.AccountReasonCode
		wantCommon   runtimev1.ReasonCode
		registerMore []*runtimev1.AccountCaller
	}{
		{
			name:       "unregistered",
			configure:  func(t *testing.T, svc *Service) { svc.registry = appregistry.New() },
			caller:     firstPartyCaller(),
			wantReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
			wantCommon: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
		},
		{
			name: "avatar",
			caller: &runtimev1.AccountCaller{
				AppId:         "nimi.avatar",
				AppInstanceId: "avatar-1",
				DeviceId:      "device-1",
				Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR,
			},
			wantReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_AVATAR_BINDING_ONLY,
			wantCommon: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
		},
		{
			name: "admitted_instance_mismatch",
			caller: &runtimev1.AccountCaller{
				AppId:         "nimi.desktop",
				AppInstanceId: "desktop-2",
				DeviceId:      "device-2",
				Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
			},
			wantReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
			wantCommon: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			registerMore: []*runtimev1.AccountCaller{{
				AppId:         "nimi.desktop",
				AppInstanceId: "desktop-2",
				DeviceId:      "device-2",
				Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
			}},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			callers := []*runtimev1.AccountCaller{firstPartyCaller()}
			callers = append(callers, tc.registerMore...)
			svc := newHarnessService(t, nil, WithAppRegistry(testAppRegistry(t, callers...)))
			completeLogin(t, svc)
			issued := issueBinding(t, svc)
			eventCount := len(svc.events)
			if tc.configure != nil {
				tc.configure(t, svc)
			}

			resp, err := svc.RevokeScopedAppBinding(context.Background(), &runtimev1.RevokeScopedAppBindingRequest{
				Caller:    tc.caller,
				BindingId: issued.GetBindingId(),
			})
			if err != nil {
				t.Fatalf("RevokeScopedAppBinding: %v", err)
			}
			if resp.GetAccepted() ||
				resp.GetAccountReasonCode() != tc.wantReason ||
				resp.GetReasonCode() != tc.wantCommon {
				t.Fatalf("unauthorized revoke must be rejected with expected reason: %+v", resp)
			}
			if len(svc.events) != eventCount {
				t.Fatalf("unauthorized revoke emitted events: before=%d after=%d", eventCount, len(svc.events))
			}
			if reason, ok := svc.ValidateScopedBinding(issued.GetBindingId(), issued.GetRelation(), "runtime.agent.turn.read"); !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
				t.Fatalf("unauthorized revoke must leave binding active, ok=%v reason=%v", ok, reason)
			}
		})
	}
}

func TestValidateScopedBindingFailsAfterNonAuthenticatedAccountTransitions(t *testing.T) {
	for _, tc := range []struct {
		name string
		act  func(*testing.T, *Service)
	}{
		{
			name: "custody_unavailable",
			act: func(t *testing.T, svc *Service) {
				svc.markCustodyUnavailable()
			},
		},
		{
			name: "refresh_failure_reauth_required",
			act: func(t *testing.T, svc *Service) {
				svc.refresher = staticRefresher{err: errors.New("refresh failed")}
				resp, err := svc.RefreshAccountSession(context.Background(), &runtimev1.RefreshAccountSessionRequest{Caller: firstPartyCaller()})
				if err != nil {
					t.Fatalf("RefreshAccountSession: %v", err)
				}
				if resp.GetAccepted() || resp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED {
					t.Fatalf("refresh failure must enter reauth_required: %+v", resp)
				}
			},
		},
		{
			name: "refresh_reuse_reauth_required",
			act: func(t *testing.T, svc *Service) {
				resp, err := svc.RefreshAccountSession(context.Background(), &runtimev1.RefreshAccountSessionRequest{Caller: firstPartyCaller()})
				if err != nil {
					t.Fatalf("RefreshAccountSession: %v", err)
				}
				if !resp.GetAccepted() {
					t.Fatalf("refresh should seed reuse hash: %+v", resp)
				}
				if reason, ok := svc.ObserveRefreshToken(context.Background(), "refresh-1"); ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED {
					t.Fatalf("reuse must force reauth_required, ok=%v reason=%v", ok, reason)
				}
			},
		},
		{
			name: "logout",
			act: func(t *testing.T, svc *Service) {
				resp, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: firstPartyCaller()})
				if err != nil {
					t.Fatalf("Logout: %v", err)
				}
				if !resp.GetAccepted() {
					t.Fatalf("logout should be accepted: %+v", resp)
				}
			},
		},
		{
			name: "switch",
			act: func(t *testing.T, svc *Service) {
				resp, err := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: firstPartyCaller()})
				if err != nil {
					t.Fatalf("SwitchAccount: %v", err)
				}
				if !resp.GetAccepted() {
					t.Fatalf("switch should be accepted: %+v", resp)
				}
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newHarnessService(t, nil, WithRefresher(staticRefresher{material: testMaterial("acct-1", "access-2", "refresh-2")}))
			completeLogin(t, svc)
			issued := issueBinding(t, svc)
			if reason, ok := svc.ValidateScopedBinding(issued.GetBindingId(), issued.GetRelation(), "runtime.agent.turn.read"); !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
				t.Fatalf("binding should validate before transition, ok=%v reason=%v", ok, reason)
			}

			tc.act(t, svc)

			if reason, ok := svc.ValidateScopedBinding(issued.GetBindingId(), issued.GetRelation(), "runtime.agent.turn.read"); ok {
				t.Fatalf("binding must fail after %s, reason=%v", tc.name, reason)
			}
		})
	}
}

func TestValidateScopedBindingFailsAfterRestartNoCustody(t *testing.T) {
	custody := &memoryCustody{}
	beforeRestart := newHarnessService(t, custody)
	completeLogin(t, beforeRestart)
	issued := issueBinding(t, beforeRestart)

	afterRestart := newHarnessService(t, &memoryCustody{err: ErrCustodyUnavailable})
	if reason, ok := afterRestart.ValidateScopedBinding(issued.GetBindingId(), issued.GetRelation(), "runtime.agent.turn.read"); ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND {
		t.Fatalf("old binding must fail after no-custody restart, ok=%v reason=%v", ok, reason)
	}
}

func TestProductionSubstrateIsInertForFirstPartyDesktopSDKAvatar(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	for name, caller := range map[string]*runtimev1.AccountCaller{
		"desktop": firstPartyCaller(),
		"sdk":     {AppId: "sdk.local", AppInstanceId: "sdk-1", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP},
		"avatar":  {AppId: "avatar", AppInstanceId: "avatar-1", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR},
	} {
		t.Run(name, func(t *testing.T) {
			statusResp, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: caller})
			if err != nil {
				t.Fatalf("GetAccountSessionStatus: %v", err)
			}
			if !statusResp.GetProductionInert() || statusResp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE {
				t.Fatalf("status must be inert unavailable: %+v", statusResp)
			}
			tokenResp, err := svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: caller})
			if err != nil {
				t.Fatalf("GetAccessToken: %v", err)
			}
			if tokenResp.GetAccepted() || !tokenResp.GetProductionInert() {
				t.Fatalf("production token issuance must be inert: %+v", tokenResp)
			}
			bindingResp, err := svc.IssueScopedAppBinding(context.Background(), &runtimev1.IssueScopedAppBindingRequest{Caller: caller, Relation: bindingRelation()})
			if err != nil {
				t.Fatalf("IssueScopedAppBinding: %v", err)
			}
			if bindingResp.GetAccepted() || !bindingResp.GetProductionInert() {
				t.Fatalf("production binding issuance must be inert: %+v", bindingResp)
			}
		})
	}
}

func TestProductionActivationCodeStateExchangeCustodyAndTokenProjection(t *testing.T) {
	custody := &memoryCustody{}
	exchangeCalls := 0
	authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		exchangeCalls++
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		// R-OAUTH-002 / R-OAUTH-005 / R-OAUTH-012: token exchange must send
		// authorization_code grant, the raw code, the matching redirect_uri,
		// and the code_verifier.
		if r.Form.Get("grant_type") != "authorization_code" {
			t.Fatalf("token exchange grant_type = %q, want authorization_code", r.Form.Get("grant_type"))
		}
		if r.Form.Get("code") != "auth-code" {
			t.Fatalf("token exchange code = %q, want auth-code", r.Form.Get("code"))
		}
		if r.Form.Get("code_verifier") == "" {
			t.Fatalf("token exchange code_verifier missing")
		}
		if r.Form.Get("redirect_uri") != "http://localhost:46373/oauth/callback" {
			t.Fatalf("token exchange redirect_uri = %q, want http://localhost:46373/oauth/callback (R-OAUTH-005)", r.Form.Get("redirect_uri"))
		}
		if r.Form.Get("client_id") != "desktop-test" {
			t.Fatalf("token exchange client_id = %q, want desktop-test", r.Form.Get("client_id"))
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"access-prod","refresh_token":"refresh-prod","token_type":"Bearer","expires_in":300,"account_id":"acct-prod","display_name":"Prod User","realm_environment_id":"realm-prod"}`))
	}))
	defer func() { authServer.Close() }()
	exchanger := newRealmOAuthExchanger(resolveProductionConfig(ProductionConfig{
		RealmBaseURL:     authServer.URL,
		AuthorizationURL: authServer.URL + "/api/auth/oauth/authorize",
		TokenURL:         authServer.URL + "/token",
		ClientID:         "desktop-test",
		RedirectURI:      "http://localhost:46373/oauth/callback",
		HTTPClient:       authServer.Client(),
	}))
	svc := newProductionHarnessService(t, custody, WithLoginExchanger(exchanger))
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
		Caller:      firstPartyCaller(),
		RedirectUri: "http://localhost:46373/oauth/callback",
	})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if !begin.GetAccepted() {
		t.Fatalf("BeginLogin not accepted: %+v", begin)
	}
	authorizeURL := begin.GetOauthAuthorizationUrl()
	parsed, err := url.Parse(authorizeURL)
	if err != nil {
		t.Fatalf("parse authorize URL %q: %v", authorizeURL, err)
	}
	// R-OAUTH-002 / R-OAUTH-003 / R-OAUTH-005 / R-OAUTH-011: authorize URL
	// is shaped per OAuth 2.0 + PKCE S256, not the legacy web-relay fragment.
	authQuery := parsed.Query()
	if got, want := authQuery.Get("response_type"), "code"; got != want {
		t.Fatalf("authorize response_type = %q, want %q", got, want)
	}
	if got, want := authQuery.Get("client_id"), "desktop-test"; got != want {
		t.Fatalf("authorize client_id = %q, want %q", got, want)
	}
	if got, want := authQuery.Get("redirect_uri"), "http://localhost:46373/oauth/callback"; got != want {
		t.Fatalf("authorize redirect_uri = %q, want %q", got, want)
	}
	if authQuery.Get("code_challenge") == "" {
		t.Fatalf("authorize code_challenge missing")
	}
	if got, want := authQuery.Get("code_challenge_method"), "S256"; got != want {
		t.Fatalf("authorize code_challenge_method = %q, want %q", got, want)
	}
	if authQuery.Get("state") != begin.GetState() {
		t.Fatalf("authorize state = %q, want %q (begin response state)", authQuery.Get("state"), begin.GetState())
	}
	if parsed.Fragment != "" {
		t.Fatalf("authorize URL must not carry a fragment, got %q", parsed.Fragment)
	}
	if strings.Contains(authorizeURL, "desktop_callback=") || strings.Contains(authorizeURL, "desktop_state=") {
		t.Fatalf("authorize URL must not embed legacy web-relay params, got %q", authorizeURL)
	}
	complete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         firstPartyCaller(),
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "auth-code",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
		RedirectUri:    "http://localhost:46373/oauth/callback",
	})
	if err != nil {
		t.Fatalf("CompleteLogin: %v", err)
	}
	if !complete.GetAccepted() || complete.GetAccountProjection().GetAccountId() != "acct-prod" {
		t.Fatalf("production CompleteLogin failed: %+v", complete)
	}
	if complete.GetAccountProjection().GetDisplayName() != "Prod User" || complete.GetAccountProjection().GetRealmEnvironmentId() != "realm-prod" {
		t.Fatalf("canonical account projection missing fields: %+v", complete.GetAccountProjection())
	}
	if exchangeCalls != 1 || !custody.has || custody.material.RefreshToken != "refresh-prod" {
		t.Fatalf("exchange/custody mismatch calls=%d custody=%+v", exchangeCalls, custody.material)
	}
	token, err := svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccessToken: %v", err)
	}
	if !token.GetAccepted() || token.GetAccessToken() != "access-prod" {
		t.Fatalf("Runtime token projection mismatch: %+v", token)
	}
}

func TestProductionCompleteLoginRejectsNonCanonicalOAuthTokenResponses(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
	}{
		{
			name: "camelCase aliases",
			body: `{"accessToken":"access-alias","refreshToken":"refresh-alias","tokenType":"Bearer","expiresIn":300,"accountId":"acct-alias","displayName":"Alias User","realmEnvironmentId":"realm-prod"}`,
		},
		{
			name: "nested tokens and user",
			body: `{"tokens":{"access_token":"access-nested","refresh_token":"refresh-nested"},"token_type":"Bearer","expires_in":300,"user":{"id":"acct-nested","displayName":"Nested User"},"realm_environment_id":"realm-prod"}`,
		},
		{
			name: "user_id fallback",
			body: `{"access_token":"access-user-id","refresh_token":"refresh-user-id","token_type":"Bearer","expires_in":300,"user_id":"acct-user-id","display_name":"User ID","realm_environment_id":"realm-prod"}`,
		},
		{
			name: "jwt subject fallback",
			body: `{"access_token":"` + unsignedTestJWT("acct-jwt") + `","refresh_token":"refresh-jwt","token_type":"Bearer","expires_in":300,"display_name":"JWT User","realm_environment_id":"realm-prod"}`,
		},
		{
			name: "non Bearer token type",
			body: `{"access_token":"access-basic","refresh_token":"refresh-basic","token_type":"Basic","expires_in":300,"account_id":"acct-basic","display_name":"Basic User","realm_environment_id":"realm-prod"}`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			custody := &memoryCustody{}
			authServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("content-type", "application/json")
				_, _ = w.Write([]byte(tc.body))
			}))
			defer authServer.Close()
			exchanger := newRealmOAuthExchanger(resolveProductionConfig(ProductionConfig{
				RealmBaseURL:     authServer.URL,
				AuthorizationURL: authServer.URL + "/api/auth/oauth/authorize",
				TokenURL:         authServer.URL + "/token",
				ClientID:         "desktop-test",
				RedirectURI:      "http://localhost:46373/oauth/callback",
				HTTPClient:       authServer.Client(),
			}))
			svc := newProductionHarnessService(t, custody, WithLoginExchanger(exchanger))
			begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
				Caller:      firstPartyCaller(),
				RedirectUri: "http://localhost:46373/oauth/callback",
			})
			if err != nil {
				t.Fatalf("BeginLogin: %v", err)
			}
			if !begin.GetAccepted() {
				t.Fatalf("BeginLogin not accepted: %+v", begin)
			}
			complete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
				Caller:         firstPartyCaller(),
				LoginAttemptId: begin.GetLoginAttemptId(),
				Code:           "auth-code",
				State:          begin.GetState(),
				Nonce:          begin.GetNonce(),
				RedirectUri:    "http://localhost:46373/oauth/callback",
			})
			if err != nil {
				t.Fatalf("CompleteLogin: %v", err)
			}
			if complete.GetAccepted() ||
				complete.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE ||
				complete.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED {
				t.Fatalf("non-canonical token response must fail closed: %+v", complete)
			}
			if custody.has {
				t.Fatalf("non-canonical token response must not be stored in Runtime custody: %+v", custody.material)
			}
		})
	}
}

func TestProductionBeginLoginMissingOAuthAuthorityFailsClosed(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL", "")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL", "")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_TOKEN_URL", "")
	t.Setenv("NIMI_REALM_URL", "")
	exchanger := newRealmOAuthExchanger(resolveProductionConfig(ProductionConfig{
		ClientID:    "desktop-test",
		RedirectURI: "http://localhost:46373/oauth/callback",
		HTTPClient:  http.DefaultClient,
	}))
	svc := newProductionHarnessService(t, &memoryCustody{}, WithLoginExchanger(exchanger))
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
		Caller:      firstPartyCaller(),
		RedirectUri: "http://localhost:46373/oauth/callback",
	})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if begin.GetAccepted() {
		t.Fatalf("missing OAuth authority must not be accepted: %+v", begin)
	}
	if begin.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE {
		t.Fatalf("reason = %v, want LOGIN_EXCHANGE_UNAVAILABLE", begin.GetAccountReasonCode())
	}
	if strings.Contains(begin.GetOauthAuthorizationUrl(), "auth.nimi.invalid") {
		t.Fatalf("sentinel URL must not be returned on fail-closed begin: %+v", begin)
	}
	if svc.currentState() == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGIN_PENDING {
		t.Fatalf("missing OAuth authority must not create a pending login attempt")
	}
}

func TestProductionBeginLoginSentinelOAuthAuthorityFailsClosed(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL", "")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL", "")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_TOKEN_URL", "")
	t.Setenv("NIMI_REALM_URL", "")
	exchanger := newRealmOAuthExchanger(resolveProductionConfig(ProductionConfig{
		AuthorizationURL: "https://auth.nimi.invalid/oauth/authorize",
		ClientID:         "desktop-test",
		RedirectURI:      "http://localhost:46373/oauth/callback",
		HTTPClient:       http.DefaultClient,
	}))
	svc := newProductionHarnessService(t, &memoryCustody{}, WithLoginExchanger(exchanger))
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
		Caller:      firstPartyCaller(),
		RedirectUri: "http://localhost:46373/oauth/callback",
	})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if begin.GetAccepted() {
		t.Fatalf("sentinel OAuth authority must not be accepted: %+v", begin)
	}
	if begin.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE {
		t.Fatalf("reason = %v, want LOGIN_EXCHANGE_UNAVAILABLE", begin.GetAccountReasonCode())
	}
	if strings.Contains(begin.GetOauthAuthorizationUrl(), "auth.nimi.invalid") {
		t.Fatalf("sentinel URL must not be returned on fail-closed begin: %+v", begin)
	}
	if svc.currentState() == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGIN_PENDING {
		t.Fatalf("sentinel OAuth authority must not create a pending login attempt")
	}
}

func TestProductionCompleteLoginRejectsBrowserCallbackTokens(t *testing.T) {
	custody := &memoryCustody{}
	exchanger := newRealmOAuthExchanger(resolveProductionConfig(ProductionConfig{
		AuthorizationURL: "https://app.nimi.test/api/auth/oauth/authorize",
		ClientID:         "desktop-test",
		RedirectURI:      "http://localhost:46373/oauth/callback",
		HTTPClient:       http.DefaultClient,
	}))
	svc := newProductionHarnessService(t, custody, WithLoginExchanger(exchanger))
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
		Caller:      firstPartyCaller(),
		RedirectUri: "http://localhost:46373/oauth/callback",
	})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	accessToken := unsignedTestJWT("acct-web-callback")
	complete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         firstPartyCaller(),
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           accessToken,
		RefreshToken:   "refresh-web-callback",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
		RedirectUri:    "http://localhost:46373/oauth/callback",
	})
	if err != nil {
		t.Fatalf("CompleteLogin: %v", err)
	}
	if complete.GetAccepted() ||
		complete.GetReasonCode() != runtimev1.ReasonCode_AUTH_UNSUPPORTED_PROOF_TYPE ||
		complete.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_UNSUPPORTED {
		t.Fatalf("browser callback token material must fail closed: %+v", complete)
	}
	if custody.has {
		t.Fatalf("browser callback material must not be stored in Runtime custody: %+v", custody.material)
	}
}

func TestProductionSecureCustodyUnavailableFailsClosed(t *testing.T) {
	svc := newProductionHarnessService(t, &memoryCustody{err: ErrCustodyUnavailable})
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	complete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         firstPartyCaller(),
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "auth-code",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
	})
	if err != nil {
		t.Fatalf("CompleteLogin: %v", err)
	}
	if complete.GetAccepted() || complete.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE {
		t.Fatalf("production unavailable custody must fail closed: %+v", complete)
	}
}

func TestProductionFileCustodyPersistsAndClears(t *testing.T) {
	custody := fileAccountCustody{path: filepath.Join(t.TempDir(), "account", "custody.json")}
	if _, err := custody.Load(context.Background(), "partition-1"); !errors.Is(err, ErrNoStoredAccount) {
		t.Fatalf("missing file should report no stored account, got %v", err)
	}

	material := testMaterial("acct-file", "access-file", "refresh-file")
	material.DisplayName = "File Custody"
	if err := custody.Store(context.Background(), "partition-1", material); err != nil {
		t.Fatalf("Store: %v", err)
	}
	loaded, err := custody.Load(context.Background(), "partition-1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.AccountID != "acct-file" || loaded.AccessToken != "access-file" || loaded.RefreshToken != "refresh-file" {
		t.Fatalf("loaded material mismatch: %+v", loaded)
	}
	if err := custody.Clear(context.Background(), "partition-1"); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	if _, err := custody.Load(context.Background(), "partition-1"); !errors.Is(err, ErrNoStoredAccount) {
		t.Fatalf("cleared file should report no stored account, got %v", err)
	}
}

func TestProductionGetAccessTokenRefreshesExpiredProjection(t *testing.T) {
	expired := testMaterial("acct-1", "access-old", "refresh-old")
	expired.AccessTokenExpires = time.Now().UTC().Add(-time.Minute)
	custody := &memoryCustody{material: expired, has: true}
	svc := newProductionHarnessService(t, custody, WithRefresher(staticRefresher{material: testMaterial("acct-1", "access-new", "refresh-new")}))
	token, err := svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccessToken: %v", err)
	}
	if !token.GetAccepted() || token.GetAccessToken() != "access-new" {
		t.Fatalf("expired projection should refresh through Runtime: %+v", token)
	}
}

func TestCompleteLoginRejectsSealedTicketAndInertExchange(t *testing.T) {
	svc := newHarnessService(t, nil)
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	resp, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:                 firstPartyCaller(),
		LoginAttemptId:         begin.GetLoginAttemptId(),
		State:                  begin.GetState(),
		Nonce:                  begin.GetNonce(),
		SealedCompletionTicket: "sealed",
	})
	if err != nil {
		t.Fatalf("CompleteLogin sealed: %v", err)
	}
	if resp.GetAccepted() || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_UNSUPPORTED {
		t.Fatalf("sealed ticket must fail closed before spec admission: %+v", resp)
	}

	exchangeDown := newHarnessService(t, nil, WithLoginExchanger(staticExchanger{err: errors.New("exchange unavailable")}))
	begin, err = exchangeDown.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("BeginLogin exchangeDown: %v", err)
	}
	resp, err = exchangeDown.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         firstPartyCaller(),
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "auth-code",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
	})
	if err != nil {
		t.Fatalf("CompleteLogin exchangeDown: %v", err)
	}
	if resp.GetAccepted() || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE {
		t.Fatalf("exchange unavailable must fail closed: %+v", resp)
	}
}

// TestProductionAuthorizationURLEmitsPKCEOauthShape locks the realm OAuth
// authorize URL contract from the runtime side
// (.nimi/spec/realm/kernel/oauth-authority-contract.md R-OAUTH-002 /
// R-OAUTH-003 / R-OAUTH-005 / R-OAUTH-011). Any drift back to the legacy
// `#/login?desktop_callback=&desktop_state=` web-relay shape must fail this
// test on sight.
func TestProductionAuthorizationURLEmitsPKCEOauthShape(t *testing.T) {
	cases := []struct {
		name             string
		authorizationURL string
	}{
		{
			name:             "realm authorize endpoint",
			authorizationURL: "https://realm.nimi.test/api/auth/oauth/authorize",
		},
		{
			name:             "config carries pre-existing query params",
			authorizationURL: "https://realm.nimi.test/api/auth/oauth/authorize?audience=desktop",
		},
		{
			name:             "explicit staging override",
			authorizationURL: "https://override.nimi.test/oauth/authorize",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			exchanger := newRealmOAuthExchanger(resolveProductionConfig(ProductionConfig{
				AuthorizationURL: tc.authorizationURL,
				ClientID:         "nimi-desktop",
				RedirectURI:      "http://127.0.0.1:34939/oauth/callback",
				HTTPClient:       http.DefaultClient,
			}))
			attempt := LoginAttempt{
				LoginAttemptID: "attempt-test",
				State:          "state-xyz",
				Nonce:          "nonce-xyz",
				PKCEVerifier:   "verifier-test-1234567890abcdef",
				RedirectURI:    "http://127.0.0.1:34939/oauth/callback",
			}
			attempt.PKCEChallenge = pkceChallenge(attempt.PKCEVerifier)

			raw := exchanger.AuthorizationURL(attempt)
			if raw == "" {
				t.Fatalf("AuthorizationURL returned empty for config %q", tc.authorizationURL)
			}
			parsed, err := url.Parse(raw)
			if err != nil {
				t.Fatalf("parse %q: %v", raw, err)
			}
			if parsed.Fragment != "" {
				t.Fatalf("authorize URL must not carry a fragment, got %q (full %q)", parsed.Fragment, raw)
			}
			if strings.Contains(raw, "desktop_callback=") || strings.Contains(raw, "desktop_state=") {
				t.Fatalf("authorize URL must not embed legacy web-relay params, got %q", raw)
			}
			if strings.Contains(raw, "#/login") {
				t.Fatalf("authorize URL must not embed web-app login fragment, got %q", raw)
			}
			q := parsed.Query()
			wants := map[string]string{
				"response_type":         "code",
				"client_id":             "nimi-desktop",
				"redirect_uri":          "http://127.0.0.1:34939/oauth/callback",
				"code_challenge":        attempt.PKCEChallenge,
				"code_challenge_method": "S256",
				"state":                 "state-xyz",
			}
			for k, want := range wants {
				if got := q.Get(k); got != want {
					t.Fatalf("authorize query %q = %q, want %q (full URL %q)", k, got, want, raw)
				}
			}
			// Pre-existing query params must be preserved.
			if strings.Contains(tc.authorizationURL, "audience=desktop") && q.Get("audience") != "desktop" {
				t.Fatalf("pre-existing query param must be preserved, got %q", raw)
			}
			// Path segment from config must be preserved.
			if parsed.Path != "/api/auth/oauth/authorize" && parsed.Path != "/oauth/authorize" {
				t.Fatalf("authorize URL must preserve configured path, got %q", raw)
			}
		})
	}
}

func TestProductionAuthorizationURLRejectsLegacyOverrideShape(t *testing.T) {
	for _, raw := range []string{
		"https://realm.nimi.test/api/auth/oauth/authorize#/login",
		"https://realm.nimi.test/login?desktop_callback=http%3A%2F%2Flocalhost",
		"https://realm.nimi.test/api/auth/oauth/authorize?desktop_state=state",
		"https://auth.nimi.invalid/oauth/authorize",
	} {
		t.Run(raw, func(t *testing.T) {
			resolved := resolveProductionConfig(ProductionConfig{
				AuthorizationURL: raw,
				ClientID:         "nimi-desktop",
				RedirectURI:      "http://127.0.0.1:34939/oauth/callback",
				HTTPClient:       http.DefaultClient,
			})
			if resolved.AuthorizationURL != "" {
				t.Fatalf("legacy override %q resolved to %q", raw, resolved.AuthorizationURL)
			}
		})
	}
}

func TestProductionAuthorizationURLRejectsSentinelEnvOverride(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL", "https://auth.nimi.invalid/oauth/authorize")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL", "")
	t.Setenv("NIMI_REALM_URL", "")
	resolved := resolveProductionConfig(ProductionConfig{
		RealmBaseURL: "https://realm.nimi.test",
		ClientID:     "nimi-desktop",
		RedirectURI:  "http://127.0.0.1:34939/oauth/callback",
		HTTPClient:   http.DefaultClient,
	})
	if resolved.AuthorizationURL != "" {
		t.Fatalf("sentinel env override resolved to %q", resolved.AuthorizationURL)
	}
}

// TestProductionAuthorizationURLDefaultsToRealmAuthorizeEndpoint asserts that
// when ProductionConfig sets only RealmBaseURL (no AuthorizationURL override),
// the runtime resolves the authorize endpoint to
// `${RealmBaseURL}/api/auth/oauth/authorize` rather than the legacy NIMI_WEB_URL
// web-relay default (R-OAUTH-002).
func TestProductionAuthorizationURLDefaultsToRealmAuthorizeEndpoint(t *testing.T) {
	t.Setenv("NIMI_WEB_URL", "https://web.nimi.test")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL", "")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL", "")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_REDIRECT_URI", "")
	t.Setenv("NIMI_REALM_URL", "")
	resolved := resolveProductionConfig(ProductionConfig{
		RealmBaseURL: "https://realm.nimi.test",
		ClientID:     "nimi-desktop",
		HTTPClient:   http.DefaultClient,
	})
	if resolved.AuthorizationURL != "https://realm.nimi.test/api/auth/oauth/authorize" {
		t.Fatalf("default AuthorizationURL = %q, want https://realm.nimi.test/api/auth/oauth/authorize", resolved.AuthorizationURL)
	}
	if resolved.TokenURL != "https://realm.nimi.test/api/auth/oauth/token" {
		t.Fatalf("default TokenURL = %q, want https://realm.nimi.test/api/auth/oauth/token", resolved.TokenURL)
	}
	if resolved.RedirectURI != "http://localhost:46373/oauth/callback" {
		t.Fatalf("default RedirectURI = %q, want http://localhost:46373/oauth/callback", resolved.RedirectURI)
	}
}

// TestProductionAuthorizationURLHonoursExplicitOverride asserts that the
// NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL env override wins over the default
// realm authorize endpoint, while a missing override still resolves to the
// API authorize endpoint (Wave A-fix R-OAUTH-011 split UI/API topology). The
// override exists for staging/test environments — production deployments
// MUST NOT point this at the apps/web origin.
func TestProductionAuthorizationURLHonoursExplicitOverride(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL", "https://override.nimi.test/oauth/authorize")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL", "")
	t.Setenv("NIMI_REALM_URL", "")
	resolved := resolveProductionConfig(ProductionConfig{
		RealmBaseURL: "https://realm.nimi.test",
		ClientID:     "nimi-desktop",
		RedirectURI:  "http://127.0.0.1:34939/oauth/callback",
		HTTPClient:   http.DefaultClient,
	})
	if resolved.AuthorizationURL != "https://override.nimi.test/oauth/authorize" {
		t.Fatalf("override AuthorizationURL = %q, want https://override.nimi.test/oauth/authorize", resolved.AuthorizationURL)
	}
	// Token URL is NOT covered by the authorize override — it stays bound to
	// the realm base URL so the runtime always exchanges the code at the
	// realm token endpoint.
	if resolved.TokenURL != "https://realm.nimi.test/api/auth/oauth/token" {
		t.Fatalf("TokenURL with authorize override = %q, want https://realm.nimi.test/api/auth/oauth/token", resolved.TokenURL)
	}
}

func issueBinding(t *testing.T, svc *Service) *runtimev1.IssueScopedAppBindingResponse {
	t.Helper()
	return issueBindingForRelation(t, svc, bindingRelation())
}

func issueBindingForRelation(t *testing.T, svc *Service, relation *runtimev1.ScopedAppBindingRelation) *runtimev1.IssueScopedAppBindingResponse {
	t.Helper()
	resp, err := svc.IssueScopedAppBinding(context.Background(), &runtimev1.IssueScopedAppBindingRequest{
		Caller:     firstPartyCaller(),
		Relation:   relation,
		TtlSeconds: 600,
	})
	if err != nil {
		t.Fatalf("IssueScopedAppBinding: %v", err)
	}
	if !resp.GetAccepted() || resp.GetBindingId() == "" || resp.GetBindingCarrier() == "" {
		t.Fatalf("binding issue failed: %+v", resp)
	}
	return resp
}

func bindingRelation() *runtimev1.ScopedAppBindingRelation {
	return bindingRelationFor("window-1", "avatar-1", "agent-1", "anchor-1")
}

func bindingRelationFor(windowID string, avatarInstanceID string, agentID string, anchorID string) *runtimev1.ScopedAppBindingRelation {
	return &runtimev1.ScopedAppBindingRelation{
		RuntimeAppId:         "nimi.desktop",
		AppInstanceId:        "desktop-1",
		WindowId:             windowID,
		AvatarInstanceId:     avatarInstanceID,
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		WorldId:              "world-1",
		Purpose:              runtimev1.ScopedAppBindingPurpose_SCOPED_APP_BINDING_PURPOSE_AVATAR_INTERACTION_CONSUME,
		Scopes: []string{
			"runtime.agent.turn.read",
			"runtime.agent.presentation.read",
			"runtime.agent.state.read",
		},
	}
}

type accountSessionEventStream struct {
	runtimev1.UnimplementedRuntimeAccountServiceServer
	ctx       context.Context
	sent      []*runtimev1.AccountSessionEvent
	afterSend func()
}

func (s *accountSessionEventStream) Send(event *runtimev1.AccountSessionEvent) error {
	s.sent = append(s.sent, event)
	if s.afterSend != nil {
		s.afterSend()
	}
	return nil
}

func (s *accountSessionEventStream) SetHeader(metadata.MD) error  { return nil }
func (s *accountSessionEventStream) SendHeader(metadata.MD) error { return nil }
func (s *accountSessionEventStream) SetTrailer(metadata.MD)       {}
func (s *accountSessionEventStream) Context() context.Context {
	if s.ctx == nil {
		return context.Background()
	}
	return s.ctx
}
func (s *accountSessionEventStream) SendMsg(any) error { return nil }
func (s *accountSessionEventStream) RecvMsg(any) error { return nil }
