package account

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestRealmAccountEndpointsRejectAmbientURLAuthority(t *testing.T) {
	if got := realmv1.OauthTokenOperation.ResolveBaseURL("https://user:secret@realm.test"); got != "" {
		t.Fatalf("generated operation accepted userinfo authority: %q", got)
	}
	if got := normalizeOAuthAuthorizeEndpoint("https://user:secret@realm.test/api/auth/oauth/authorize"); got != "" {
		t.Fatalf("OAuth authorize endpoint accepted userinfo authority: %q", got)
	}
	if got := normalizeRealmOperationEndpoint("https://user:secret@realm.test/api/auth/oauth/token", realmv1.OauthTokenOperation); got != "" {
		t.Fatalf("OAuth token endpoint accepted userinfo authority: %q", got)
	}
}

func TestRealmOAuthExchangeRejectsRedirectWithoutForwardingLoginProof(t *testing.T) {
	var forwarded atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		forwarded.Add(1)
	}))
	defer target.Close()
	issuer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("location", target.URL+"/capture")
		response.WriteHeader(http.StatusTemporaryRedirect)
	}))
	defer issuer.Close()

	exchanger := realmOAuthExchanger{
		httpClient:  issuer.Client(),
		tokenURL:    issuer.URL + "/api/auth/oauth/token",
		clientID:    "nimi-desktop",
		redirectURI: "http://127.0.0.1:12345/oauth/callback",
	}
	_, err := exchanger.Exchange(context.Background(), LoginAttempt{
		PKCEVerifier: "pkce-verifier",
		RedirectURI:  "http://127.0.0.1:12345/oauth/callback",
	}, "authorization-code")
	if err == nil || forwarded.Load() != 0 {
		t.Fatalf("redirect exchange error=%v forwarded=%d", err, forwarded.Load())
	}
}

func TestRealmTokenRefresherConsumesCurrentQuartetAndPreservesCustodiedIdentity(t *testing.T) {
	current := testMaterial("acct-refresh", "access-old", "refresh-old")
	current.DisplayName = "Refresh Identity"
	current.RealmEnvironmentID = "realm-refresh"
	current.WorkspaceMemberships = []*runtimev1.WorkspaceMembershipProjection{{
		WorkspaceId:        "workspace-refresh",
		MembershipState:    runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE,
		RealmEnvironmentId: "realm-refresh",
		DisplayMetadata:    map[string]string{"name": "Refresh Workspace"},
	}}
	current.RefreshTokenHashes = map[string]bool{"previous-family-member": true}
	custody := &memoryCustody{material: current, has: true}

	var refreshCalls int
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		refreshCalls++
		if request.Method != http.MethodPost || request.URL.Path != "/api/auth/refresh" {
			t.Fatalf("refresh request = %s %s", request.Method, request.URL.Path)
		}
		decoder := json.NewDecoder(request.Body)
		decoder.DisallowUnknownFields()
		var body struct {
			RefreshToken string `json:"refreshToken"`
		}
		if err := decoder.Decode(&body); err != nil {
			t.Fatalf("decode refresh request: %v", err)
		}
		var trailing any
		if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
			t.Fatalf("refresh request has trailing JSON: %v", err)
		}
		if body.RefreshToken != "refresh-old" {
			t.Fatalf("refresh request token = %q", body.RefreshToken)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"accessToken":"access-rotated","refreshToken":"refresh-rotated","tokenType":"Bearer","expiresIn":300}`))
	}))
	defer server.Close()

	refresher := newRealmTokenRefresher(resolveProductionConfig(ProductionConfig{
		RealmBaseURL: server.URL,
		TokenURL:     server.URL + "/api/auth/oauth/token",
		HTTPClient:   server.Client(),
	}))
	service := newProductionHarnessService(t, custody, WithRefresher(refresher))
	result, err := service.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || !result.accepted {
		t.Fatalf("production private refresh = (%+v, %v)", result, err)
	}
	if refreshCalls != 1 {
		t.Fatalf("refresh calls = %d, want 1", refreshCalls)
	}
	got := custody.material
	if got.AccountID != current.AccountID || got.DisplayName != current.DisplayName ||
		got.RealmEnvironmentID != current.RealmEnvironmentID {
		t.Fatalf("refresh changed custodied identity: got=%+v current=%+v", got, current)
	}
	if len(got.WorkspaceMemberships) != 1 || !proto.Equal(got.WorkspaceMemberships[0], current.WorkspaceMemberships[0]) {
		t.Fatalf("refresh changed workspace projection: got=%+v current=%+v", got.WorkspaceMemberships, current.WorkspaceMemberships)
	}
	if got.AccessToken != "access-rotated" || got.RefreshToken != "refresh-rotated" ||
		!got.AccessTokenExpires.After(time.Now().UTC().Add(4*time.Minute)) {
		t.Fatalf("refresh did not atomically install rotated tokens: %+v", got)
	}
	if !got.RefreshTokenHashes["previous-family-member"] || !got.RefreshTokenHashes[refreshHash("refresh-old")] {
		t.Fatalf("refresh rotation lineage = %#v", got.RefreshTokenHashes)
	}
	projection, _, ok := service.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok || projection.GetAccountId() != current.AccountID || projection.GetDisplayName() != current.DisplayName ||
		projection.GetRealmEnvironmentId() != current.RealmEnvironmentID {
		t.Fatalf("post-refresh Runtime identity = (%+v, %v)", projection, ok)
	}
}

func TestRealmTokenRefresherRejectsNonCanonicalOrUnsafeResponses(t *testing.T) {
	current := testMaterial("acct-refresh", "access-old", "refresh-old")
	current.RefreshTokenHashes = map[string]bool{
		"retained":                      true,
		refreshHash("refresh-replayed"): true,
	}
	cases := []struct {
		name        string
		status      int
		body        string
		contentType string
	}{
		{name: "missing access token", status: http.StatusOK, body: `{"refreshToken":"refresh-new","tokenType":"Bearer","expiresIn":300}`},
		{name: "missing refresh token", status: http.StatusOK, body: `{"accessToken":"access-new","tokenType":"Bearer","expiresIn":300}`},
		{name: "missing token type", status: http.StatusOK, body: `{"accessToken":"access-new","refreshToken":"refresh-new","expiresIn":300}`},
		{name: "missing expiry", status: http.StatusOK, body: `{"accessToken":"access-new","refreshToken":"refresh-new","tokenType":"Bearer"}`},
		{name: "unknown field", status: http.StatusOK, body: `{"accessToken":"access-new","refreshToken":"refresh-new","tokenType":"Bearer","expiresIn":300,"accountId":"acct-spoof"}`},
		{name: "duplicate field", status: http.StatusOK, body: `{"accessToken":"access-new","accessToken":"access-shadow","refreshToken":"refresh-new","tokenType":"Bearer","expiresIn":300}`},
		{name: "login response aliases", status: http.StatusOK, body: `{"access_token":"access-new","refresh_token":"refresh-new","token_type":"Bearer","expires_in":300}`},
		{name: "non bearer", status: http.StatusOK, body: `{"accessToken":"access-new","refreshToken":"refresh-new","tokenType":"Basic","expiresIn":300}`},
		{name: "fractional expiry", status: http.StatusOK, body: `{"accessToken":"access-new","refreshToken":"refresh-new","tokenType":"Bearer","expiresIn":1.5}`},
		{name: "zero expiry", status: http.StatusOK, body: `{"accessToken":"access-new","refreshToken":"refresh-new","tokenType":"Bearer","expiresIn":0}`},
		{name: "unrotated refresh token", status: http.StatusOK, body: `{"accessToken":"access-new","refreshToken":"refresh-old","tokenType":"Bearer","expiresIn":300}`},
		{name: "replayed family refresh token", status: http.StatusOK, body: `{"accessToken":"access-new","refreshToken":"refresh-replayed","tokenType":"Bearer","expiresIn":300}`},
		{name: "whitespace token", status: http.StatusOK, body: `{"accessToken":" access-new","refreshToken":"refresh-new","tokenType":"Bearer","expiresIn":300}`},
		{name: "trailing JSON", status: http.StatusOK, body: `{"accessToken":"access-new","refreshToken":"refresh-new","tokenType":"Bearer","expiresIn":300}{}`},
		{name: "non success status", status: http.StatusUnauthorized, body: `{}`},
		{name: "wrong content type", status: http.StatusOK, contentType: "text/plain", body: `{"accessToken":"access-new","refreshToken":"refresh-new","tokenType":"Bearer","expiresIn":300}`},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				contentType := testCase.contentType
				if contentType == "" {
					contentType = "application/json"
				}
				response.Header().Set("content-type", contentType)
				response.WriteHeader(testCase.status)
				_, _ = response.Write([]byte(testCase.body))
			}))
			defer server.Close()
			refresher := newRealmTokenRefresher(resolveProductionConfig(ProductionConfig{
				RealmBaseURL: server.URL,
				TokenURL:     server.URL + "/api/auth/oauth/token",
				HTTPClient:   server.Client(),
			}))
			before := current
			before.WorkspaceMemberships = cloneWorkspaceMemberships(current.WorkspaceMemberships)
			before.RefreshTokenHashes = copyRefreshHashes(current.RefreshTokenHashes)
			if next, err := refresher.Refresh(context.Background(), current); !errors.Is(err, ErrLoginExchangeFailure) || !reflect.DeepEqual(next, AccountMaterial{}) {
				t.Fatalf("unsafe refresh response = (%+v, %v)", next, err)
			}
			if !reflect.DeepEqual(current, before) {
				t.Fatalf("failed refresh mutated current material: before=%+v after=%+v", before, current)
			}
		})
	}
}

func TestRealmTokenRefresherRejectsRedirectWithoutForwardingRefreshToken(t *testing.T) {
	for _, status := range []int{http.StatusTemporaryRedirect, http.StatusPermanentRedirect} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var firstRequests atomic.Int64
			var secondRequests atomic.Int64
			var callerRedirectChecks atomic.Int64
			second := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				secondRequests.Add(1)
			}))
			defer second.Close()
			first := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				firstRequests.Add(1)
				response.Header().Set("location", second.URL+"/refresh-token-capture")
				response.WriteHeader(status)
			}))
			defer first.Close()

			callerClient := first.Client()
			callerClient.CheckRedirect = func(*http.Request, []*http.Request) error {
				callerRedirectChecks.Add(1)
				return nil
			}
			originalRedirectPolicy := reflect.ValueOf(callerClient.CheckRedirect).Pointer()
			refresher := newRealmTokenRefresher(resolveProductionConfig(ProductionConfig{
				RealmBaseURL: first.URL,
				TokenURL:     first.URL + "/api/auth/oauth/token",
				HTTPClient:   callerClient,
			}))
			if next, err := refresher.Refresh(context.Background(), testMaterial("acct-refresh", "access-old", "refresh-old")); !errors.Is(err, ErrLoginExchangeFailure) || !reflect.DeepEqual(next, AccountMaterial{}) {
				t.Fatalf("redirected refresh = (%+v, %v)", next, err)
			}
			if firstRequests.Load() != 1 || secondRequests.Load() != 0 || callerRedirectChecks.Load() != 0 {
				t.Fatalf("redirect request counts first=%d second=%d callerPolicy=%d", firstRequests.Load(), secondRequests.Load(), callerRedirectChecks.Load())
			}
			if callerClient.CheckRedirect == nil || reflect.ValueOf(callerClient.CheckRedirect).Pointer() != originalRedirectPolicy {
				t.Fatal("realmTokenRefresher mutated the caller-owned HTTP client")
			}
		})
	}
}

type refreshRestartProofCustody struct {
	material   AccountMaterial
	has        bool
	clearCalls int
	storeCalls int
	clearErr   error
	storeErr   error
}

func (custody *refreshRestartProofCustody) Load(context.Context, string) (AccountMaterial, error) {
	if !custody.has {
		return AccountMaterial{}, ErrNoStoredAccount
	}
	return custody.material, nil
}

func (custody *refreshRestartProofCustody) Store(_ context.Context, _ string, material AccountMaterial) error {
	custody.storeCalls++
	if custody.storeErr != nil {
		return custody.storeErr
	}
	custody.material = material
	custody.has = true
	return nil
}

func (custody *refreshRestartProofCustody) Clear(context.Context, string) error {
	custody.clearCalls++
	if custody.clearErr != nil {
		return custody.clearErr
	}
	custody.material = AccountMaterial{}
	custody.has = false
	return nil
}

func TestFailedRefreshCustodyClearFailureIsUnavailable(t *testing.T) {
	custody := &refreshRestartProofCustody{
		material: testMaterial("acct-refresh", "access-old", "refresh-old"),
		has:      true,
		clearErr: ErrCustodyUnavailable,
	}
	service := New(nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("refresh-clear-failure"),
		WithRefresher(staticRefresher{err: ErrLoginExchangeFailure}),
	)
	result, err := service.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || result.accepted ||
		result.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE ||
		result.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE {
		t.Fatalf("clear-failed refresh result = (%+v, %v)", result, err)
	}
	if custody.clearCalls != 1 {
		t.Fatalf("custody clear calls = %d, want 1", custody.clearCalls)
	}
	if custody.storeCalls != 1 || !custody.material.RefreshTokenHashes[refreshHash(custody.material.RefreshToken)] {
		t.Fatalf("failed refresh did not retain a durable in-flight marker: %+v", custody)
	}
	if _, _, ok := service.AuthenticatedRuntimeSecurityContext(context.Background()); ok {
		t.Fatal("custody clear failure retained an authenticated Runtime security context")
	}
	restarted := New(nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("refresh-clear-failure"),
	)
	if restarted.currentState() == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		t.Fatal("restart recovered marked material after custody clear failure")
	}
	if _, _, ok := restarted.AuthenticatedRuntimeSecurityContext(context.Background()); ok {
		t.Fatal("restart exposed marked material after custody clear failure")
	}
}

func TestRecoverFromCustodyRejectsInFlightRefreshMarker(t *testing.T) {
	material := testMaterial("acct-refresh", "access-old", "refresh-old")
	material.RefreshTokenHashes = map[string]bool{refreshHash(material.RefreshToken): true}
	custody := &refreshRestartProofCustody{material: material, has: true}
	service := New(nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("refresh-crash-marker"),
	)
	if service.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED {
		t.Fatalf("marked recovery state = %v", service.currentState())
	}
	if custody.clearCalls != 1 || custody.has {
		t.Fatalf("marked recovery custody = %+v", custody)
	}
	if _, _, ok := service.AuthenticatedRuntimeSecurityContext(context.Background()); ok {
		t.Fatal("in-flight refresh marker recovered authenticated identity")
	}
}

func TestRefreshPreflightMarkerStoreFailureDoesNotCallRealm(t *testing.T) {
	var realmRequests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		realmRequests.Add(1)
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"accessToken":"access-new","refreshToken":"refresh-new","tokenType":"Bearer","expiresIn":300}`))
	}))
	defer server.Close()
	custody := &refreshRestartProofCustody{
		material: testMaterial("acct-refresh", "access-old", "refresh-old"),
		has:      true,
		storeErr: ErrCustodyUnavailable,
	}
	refresher := newRealmTokenRefresher(resolveProductionConfig(ProductionConfig{
		RealmBaseURL: server.URL,
		TokenURL:     server.URL + "/api/auth/oauth/token",
		HTTPClient:   server.Client(),
	}))
	service := New(nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("refresh-marker-store-failure"),
		WithRefresher(refresher),
	)
	result, err := service.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || result.accepted ||
		result.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE ||
		result.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE {
		t.Fatalf("marker-store-failed refresh = (%+v, %v)", result, err)
	}
	if custody.storeCalls != 1 || realmRequests.Load() != 0 {
		t.Fatalf("marker store calls=%d Realm requests=%d", custody.storeCalls, realmRequests.Load())
	}
	if _, _, ok := service.AuthenticatedRuntimeSecurityContext(context.Background()); ok {
		t.Fatal("marker store failure retained authenticated Runtime identity")
	}
}

func TestRefreshTwoPhaseMarkerSuccessCommitsNewActiveToken(t *testing.T) {
	current := testMaterial("acct-refresh", "access-old", "refresh-old")
	next := testMaterial("acct-refresh", "access-new", "refresh-new")
	custody := &refreshRestartProofCustody{material: current, has: true}
	service := New(nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("refresh-marker-success"),
		WithRefresher(staticRefresher{material: next}),
	)
	result, err := service.refreshAccountSessionInternal(context.Background(), true)
	if err != nil || !result.accepted || result.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		t.Fatalf("two-phase refresh = (%+v, %v)", result, err)
	}
	if custody.storeCalls != 2 || custody.clearCalls != 0 ||
		custody.material.RefreshToken != "refresh-new" ||
		!custody.material.RefreshTokenHashes[refreshHash("refresh-old")] ||
		custody.material.RefreshTokenHashes[refreshHash("refresh-new")] {
		t.Fatalf("two-phase success custody = %+v", custody)
	}
	restarted := New(nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("refresh-marker-success"),
	)
	if _, _, ok := restarted.AuthenticatedRuntimeSecurityContext(context.Background()); !ok {
		t.Fatal("restart rejected the successfully committed new active token")
	}
}

func TestFailedRefreshClearsDurableCustodyBeforeRestart(t *testing.T) {
	tests := []struct {
		name      string
		refresher func(*testing.T) Refresher
	}{
		{
			name: "current Realm response rejected",
			refresher: func(t *testing.T) Refresher {
				server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
					response.Header().Set("content-type", "application/json")
					_, _ = response.Write([]byte(`{"accessToken":"access-new","refreshToken":"refresh-new","tokenType":"Bearer","expiresIn":300,"identity":"forbidden"}`))
				}))
				t.Cleanup(server.Close)
				return newRealmTokenRefresher(resolveProductionConfig(ProductionConfig{
					RealmBaseURL: server.URL,
					TokenURL:     server.URL + "/api/auth/oauth/token",
					HTTPClient:   server.Client(),
				}))
			},
		},
		{
			name: "refresh transport failed",
			refresher: func(*testing.T) Refresher {
				return staticRefresher{err: ErrLoginExchangeFailure}
			},
		},
		{
			name: "next identity invalid",
			refresher: func(*testing.T) Refresher {
				return staticRefresher{material: testMaterial("acct-other", "access-new", "refresh-new")}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			current := testMaterial("acct-refresh", "access-old", "refresh-old")
			custody := &refreshRestartProofCustody{material: current, has: true}
			service := New(nil,
				WithProductionActivation(),
				WithCustody(custody),
				WithCustodyPartition("refresh-restart-proof"),
				WithRefresher(test.refresher(t)),
			)
			if _, _, ok := service.AuthenticatedRuntimeSecurityContext(context.Background()); !ok {
				t.Fatal("precondition: current custody did not authenticate Runtime")
			}
			result, err := service.refreshAccountSessionInternal(context.Background(), true)
			if err != nil || result.accepted || result.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED {
				t.Fatalf("failed refresh result = (%+v, %v)", result, err)
			}
			if custody.clearCalls != 1 || custody.storeCalls != 1 || custody.has || !reflect.DeepEqual(custody.material, AccountMaterial{}) {
				t.Fatalf("failed refresh custody = %+v", custody)
			}

			restarted := New(nil,
				WithProductionActivation(),
				WithCustody(custody),
				WithCustodyPartition("refresh-restart-proof"),
			)
			if restarted.currentState() == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
				t.Fatal("restart recovered stale material after failed refresh")
			}
			if _, _, ok := restarted.AuthenticatedRuntimeSecurityContext(context.Background()); ok {
				t.Fatal("restart exposed an authenticated security context after failed refresh")
			}
		})
	}
}
