package account

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/metadata"
)

func TestProductionSubstrateIsInertForFirstPartyDesktopSDKAvatar(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	for name, caller := range map[string]*runtimev1.AccountCaller{
		"desktop": firstPartyCaller(),
		"sdk":     {AppId: "sdk.local", AppInstanceId: "sdk-1", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP},
		"avatar":  {AppId: "avatar", AppInstanceId: "avatar-1", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_AVATAR_NATIVE_HOST},
	} {
		t.Run(name, func(t *testing.T) {
			statusResp, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: caller})
			if err != nil {
				t.Fatalf("GetAccountSessionStatus: %v", err)
			}
			if statusResp.GetAccepted() || statusResp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED || statusResp.GetSnapshot() != nil {
				t.Fatalf("status must be inert unavailable: %+v", statusResp)
			}
		})
	}
}

func TestProductionActivationCodeStateExchangeCustodyAndPrivateCredential(t *testing.T) {
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
		TokenURL:         authServer.URL + "/api/auth/oauth/token",
		ClientID:         "desktop-test",
		RedirectURI:      "http://localhost:46373/oauth/callback",
		HTTPClient:       authServer.Client(),
	}))
	svc := newProductionHarnessService(t, custody, WithLoginExchanger(exchanger))
	begin, err := svc.BeginLogin(desktopAccountControlContext(t), &runtimev1.BeginLoginRequest{
		Caller:      desktopAccountControlCaller(),
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
	complete, err := svc.CompleteLogin(desktopAccountControlContext(t), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
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
	token, reason, ok, err := svc.realmUnaryAccessToken(context.Background(), nil)
	if err != nil {
		t.Fatalf("Runtime-private broker credential: %v", err)
	}
	if !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED || token != "access-prod" {
		t.Fatalf("Runtime-private broker credential mismatch: ok=%v reason=%v token=%q", ok, reason, token)
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
			begin, err := svc.BeginLogin(desktopAccountControlContext(t), &runtimev1.BeginLoginRequest{
				Caller:      desktopAccountControlCaller(),
				RedirectUri: "http://localhost:46373/oauth/callback",
			})
			if err != nil {
				t.Fatalf("BeginLogin: %v", err)
			}
			if !begin.GetAccepted() {
				t.Fatalf("BeginLogin not accepted: %+v", begin)
			}
			complete, err := svc.CompleteLogin(desktopAccountControlContext(t), &runtimev1.CompleteLoginRequest{
				Caller:         desktopAccountControlCaller(),
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
	begin, err := svc.BeginLogin(desktopAccountControlContext(t), &runtimev1.BeginLoginRequest{
		Caller:      desktopAccountControlCaller(),
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
	begin, err := svc.BeginLogin(desktopAccountControlContext(t), &runtimev1.BeginLoginRequest{
		Caller:      desktopAccountControlCaller(),
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
	begin, err := svc.BeginLogin(desktopAccountControlContext(t), &runtimev1.BeginLoginRequest{
		Caller:      desktopAccountControlCaller(),
		RedirectUri: "http://localhost:46373/oauth/callback",
	})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	accessToken := unsignedTestJWT("acct-web-callback")
	complete, err := svc.CompleteLogin(desktopAccountControlContext(t), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
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
	begin, err := svc.BeginLogin(desktopAccountControlContext(t), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	complete, err := svc.CompleteLogin(desktopAccountControlContext(t), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
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

func TestProductionPrivateBrokerRefreshesExpiredCredential(t *testing.T) {
	expired := testMaterial("acct-1", "access-old", "refresh-old")
	expired.AccessTokenExpires = time.Now().UTC().Add(-time.Minute)
	custody := &memoryCustody{material: expired, has: true}
	svc := newProductionHarnessService(t, custody, WithRefresher(staticRefresher{material: testMaterial("acct-1", "access-new", "refresh-new")}))
	token, reason, ok, err := svc.realmUnaryAccessToken(context.Background(), nil)
	if err != nil {
		t.Fatalf("Runtime-private broker credential: %v", err)
	}
	if !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED || token != "access-new" {
		t.Fatalf("expired credential should refresh privately: ok=%v reason=%v token=%q", ok, reason, token)
	}
}

func TestCompleteLoginRejectsSealedTicketAndInertExchange(t *testing.T) {
	svc := newHarnessService(t, nil)
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	resp, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:                 desktopAccountControlCaller(),
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
	begin, err = exchangeDown.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
	if err != nil {
		t.Fatalf("BeginLogin exchangeDown: %v", err)
	}
	resp, err = exchangeDown.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
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
// (realm:spec/realm/oauth.authority.yaml rule.realm.oauth.r002 /
// rule.realm.oauth.r003 / rule.realm.oauth.r005 /
// rule.realm.oauth.r011). Any drift back to the legacy
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
			name:             "explicit staging override",
			authorizationURL: "https://override.nimi.test/api/auth/oauth/authorize",
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
			if parsed.Path != "/api/auth/oauth/authorize" {
				t.Fatalf("authorize URL must use the generated operation path, got %q", raw)
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
		"https://realm.nimi.test/api/auth/oauth/authorize?audience=desktop",
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

func TestProductionAuthorizationURLIgnoresSentinelEnvOverride(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL", "https://auth.nimi.invalid/oauth/authorize")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL", "")
	t.Setenv("NIMI_REALM_URL", "")
	resolved := resolveProductionConfig(ProductionConfig{
		RealmBaseURL: "https://realm.nimi.test",
		ClientID:     "nimi-desktop",
		RedirectURI:  "http://127.0.0.1:34939/oauth/callback",
		HTTPClient:   http.DefaultClient,
	})
	if resolved.AuthorizationURL != "https://realm.nimi.test/api/auth/oauth/authorize" {
		t.Fatalf("environment override affected production URL resolution: %q", resolved.AuthorizationURL)
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

// TestProductionAuthorizationURLHonoursExplicitOverride asserts that an
// explicitly injected service-owned URL wins while environment input remains
// non-authoritative.
func TestProductionAuthorizationURLHonoursExplicitOverride(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL", "https://ignored.nimi.test/oauth/authorize")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL", "")
	t.Setenv("NIMI_REALM_URL", "")
	resolved := resolveProductionConfig(ProductionConfig{
		RealmBaseURL:     "https://realm.nimi.test",
		AuthorizationURL: "https://override.nimi.test/api/auth/oauth/authorize",
		ClientID:         "nimi-desktop",
		RedirectURI:      "http://127.0.0.1:34939/oauth/callback",
		HTTPClient:       http.DefaultClient,
	})
	if resolved.AuthorizationURL != "https://override.nimi.test/api/auth/oauth/authorize" {
		t.Fatalf("override AuthorizationURL = %q, want generated authorize path", resolved.AuthorizationURL)
	}
	// Token URL is NOT covered by the authorize override — it stays bound to
	// the realm base URL so the runtime always exchanges the code at the
	// realm token endpoint.
	if resolved.TokenURL != "https://realm.nimi.test/api/auth/oauth/token" {
		t.Fatalf("TokenURL with authorize override = %q, want https://realm.nimi.test/api/auth/oauth/token", resolved.TokenURL)
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
