package account

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type controllableClock struct {
	mu  sync.Mutex
	now time.Time
}

func newControllableClock(initial time.Time) *controllableClock {
	return &controllableClock{now: initial.UTC()}
}

func (c *controllableClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *controllableClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

type fakeRealmTransport struct {
	mu            sync.Mutex
	offline       bool
	refreshFn     func(*http.Request) (*http.Response, error)
	apiFn         func(*http.Request) (*http.Response, error)
	refreshCalls  atomic.Int32
	apiCalls      atomic.Int32
	lastAPIBearer string
}

func (t *fakeRealmTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	t.mu.Lock()
	offline := t.offline
	refreshFn := t.refreshFn
	apiFn := t.apiFn
	t.mu.Unlock()

	if req.URL.Path == realmv1.RefreshTokenOperation.Path() {
		t.refreshCalls.Add(1)
		if offline {
			return nil, errors.New("dial tcp: network unreachable")
		}
		if refreshFn != nil {
			return refreshFn(req)
		}
		return jsonHTTPResponse(req, http.StatusOK, `{"accessToken":"access-fresh","refreshToken":"refresh-fresh","tokenType":"Bearer","expiresIn":300}`), nil
	}

	t.apiCalls.Add(1)
	t.mu.Lock()
	t.lastAPIBearer = req.Header.Get("Authorization")
	t.mu.Unlock()
	if offline {
		return nil, errors.New("dial tcp: network unreachable")
	}
	if apiFn != nil {
		return apiFn(req)
	}
	return jsonHTTPResponse(req, http.StatusOK, `[{"id":"world-1"}]`), nil
}

func jsonHTTPResponse(req *http.Request, statusCode int, body string) *http.Response {
	return &http.Response{
		StatusCode: statusCode,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}

func TestOfflineColdStartWithExpiredAccessTokenPreservesLocalIdentityAndBlocksOnlineCalls(t *testing.T) {
	clock := newControllableClock(time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC))
	transport := &fakeRealmTransport{offline: true}
	httpClient := &http.Client{Transport: transport}
	realmBaseURL := "https://realm.offline.test"

	stored := testMaterial("acct-offline", "access-expired", "refresh-valid")
	stored.RealmOrigin = realmBaseURL
	stored.CurrentUserHandle = "offline_user"
	stored.AccessTokenExpires = clock.Now().Add(-2 * time.Hour)
	custody := &refreshRestartProofCustody{material: stored, has: true}

	cfg := resolveProductionConfig(ProductionConfig{
		RealmBaseURL: realmBaseURL,
		HTTPClient:   httpClient,
	})
	svc := newHarnessService(t, nil,
		WithCustody(custody),
		WithCustodyPartition("offline-cold-start"),
		WithRealmBaseURL(realmBaseURL),
		WithRealmRealtimeURL("wss://realm.offline.test/realtime"),
		WithRealmHTTPClient(httpClient),
		WithRefresher(newRealmTokenRefresher(cfg)),
		WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmDesktopShellCaller())),
		WithClock(clock.Now),
		func(s *Service) {
			s.primarySecrets = newAccountBinarySecretStore()
			s.primaryKeyScope = "install-offline\x00os-user"
		},
	)
	stopAccountRefreshTimer(t, svc)

	// Trusted local sign-in must survive offline cold-start so Home and local Apps can open.
	statusResp, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil || !statusResp.GetAccepted() {
		t.Fatalf("GetAccountSessionStatus = (%+v, %v)", statusResp, err)
	}
	snapshot := statusResp.GetSnapshot()
	if snapshot.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		snapshot.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED ||
		snapshot.GetAccountProjection().GetAccountId() != "acct-offline" ||
		strings.TrimSpace(snapshot.GetAuthorizationRevision()) == "" {
		t.Fatalf("cold-start offline snapshot = %+v", snapshot)
	}
	projection, gen, fence, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !ok || gen == 0 || fence == nil || projection.GetAccountId() != "acct-offline" {
		t.Fatalf("BindAuthenticatedRuntimeGeneration = (%+v, %d, %v, %v)", projection, gen, fence, ok)
	}
	if runtimeProj, ok := svc.AuthenticatedRuntimeProjection(context.Background()); !ok || runtimeProj.GetAccountId() != "acct-offline" {
		t.Fatalf("AuthenticatedRuntimeProjection = (%+v, %v)", runtimeProj, ok)
	}
	display, err := svc.CurrentUserDisplay(context.Background())
	if err != nil || display.Handle != "offline_user" || display.DisplayName != "Nimi User" {
		t.Fatalf("CurrentUserDisplay offline = (%+v, %v)", display, err)
	}

	// Online Realm unary calls (Desktop and Local App) must NEVER send the expired token
	// and must fail honestly as REALM_UNAVAILABLE while preserving local identity.
	unaryResp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:      realmDesktopShellCaller(),
		MethodId:    "WorldPublicController_listWorldCatalog",
		RequestJson: `{}`,
	})
	if err != nil {
		t.Fatalf("InvokeRealmUnary: %v", err)
	}
	if unaryResp.GetAccepted() ||
		unaryResp.GetReasonCode() != runtimev1.ReasonCode_REALM_UNAVAILABLE ||
		unaryResp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED {
		t.Fatalf("offline InvokeRealmUnary = %+v, want REALM_UNAVAILABLE + REFRESH_RETRY_DEFERRED", unaryResp)
	}

	localAppCtx := ContextWithAuthorizedLocalAppDecision(context.Background(), LocalAppCallerDecision{
		RegisteredAppSubject: "lap_world_studio",
		AccountID:            "acct-offline",
		Operation:            LocalAppOperationRealmWorldCoreList,
	})
	localAppResp, err := svc.InvokeRealmUnary(localAppCtx, &runtimev1.InvokeRealmUnaryRequest{
		MethodId:    "WorldCoreController_listWorldCores",
		RequestJson: `{"path":{},"query":{"take":10}}`,
	})
	if err != nil {
		t.Fatalf("local app InvokeRealmUnary: %v", err)
	}
	if localAppResp.GetAccepted() ||
		localAppResp.GetReasonCode() != runtimev1.ReasonCode_REALM_UNAVAILABLE ||
		localAppResp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED {
		t.Fatalf("offline local app InvokeRealmUnary = %+v", localAppResp)
	}

	// Online Realm realtime, protected remote control, source materialization, and presence must reject expired access token.
	if _, err := svc.BindRealmRealtimeAccount(context.Background()); err == nil {
		t.Fatal("BindRealmRealtimeAccount succeeded with expired offline access token")
	}
	if _, err := svc.BindPrimaryRuntimeControl(context.Background()); status.Code(err) != codes.Unavailable {
		t.Fatalf("BindPrimaryRuntimeControl error = %v, want Unavailable", err)
	}
	p := protectedprincipal.NewDirect("nimi.desktop", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductProfileID, projection, gen, fence, make(chan struct{}))
	if _, err := svc.GetPrimaryRuntimeState(protectedprincipal.With(context.Background(), p), &runtimev1.GetPrimaryRuntimeStateRequest{}); status.Code(err) != codes.Unavailable {
		t.Fatalf("GetPrimaryRuntimeState error = %v, want Unavailable", err)
	}
	if _, err := svc.AcquireRealmSourceMaterialization(context.Background(), RealmSourceMaterializationIssuanceRequest{
		AuthenticatedAccountID: "acct-offline",
		SourceRef: RealmSourceMaterializationSourceRefV3{
			Kind: "worldCharacter", ID: "char-1", WorldID: "world-1", SourceHash: strings.Repeat("a", 64),
			WorldEntityRef: &RealmSourceMaterializationWorldEntityRefV3{WorldID: "world-1", EntityID: "entity-1"},
		},
		Challenge: RealmSourceMaterializationChallengeV3{
			ChallengeID: "challenge-123456", ChallengeDigest: strings.Repeat("b", 64), IntendedRuntimeAudience: "nimi-runtime:test", ExpiresAt: clock.Now().Add(time.Minute),
		},
		Limits: RealmSourceMaterializationLimitsV3{
			MaxSegmentBytes: 8388608, MaxSegmentComponentCount: 256, MaxChunkBytes: 262144, MaxSegmentChunks: 4096,
			MaxSetSegments: 64, MaxSetBytes: 134217728, MaxSetComponentCount: 16384, MaxSetChunks: 65536,
		},
	}); !errors.Is(err, ErrRealmSourceMaterializationUnavailable) {
		t.Fatalf("AcquireRealmSourceMaterialization error = %v, want ErrRealmSourceMaterializationUnavailable", err)
	}
	if transport.apiCalls.Load() != 0 {
		t.Fatalf("expired access token reached Realm API %d times", transport.apiCalls.Load())
	}

	// Local identity and clean refresh custody must remain intact after all rejected online calls.
	if _, afterGen, afterFence, afterOK := svc.BindAuthenticatedRuntimeGeneration(context.Background()); !afterOK || afterGen != gen || afterFence != fence {
		t.Fatalf("offline online-call failures disrupted local identity: ok=%v gen=%d want=%d", afterOK, afterGen, gen)
	}
	select {
	case <-fence:
		t.Fatal("offline online-call failures closed local execution fence")
	default:
	}
	if !custody.has || custody.clearCalls != 0 || custody.material.RefreshToken != "refresh-valid" || custody.material.RefreshTokenHashes[refreshHash("refresh-valid")] {
		t.Fatalf("offline pre-dispatch failures corrupted custody: %+v", custody)
	}
}

func TestOfflineAccessExpiryDuringSessionSurvivesAndReconnectRevalidates(t *testing.T) {
	clock := newControllableClock(time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC))
	transport := &fakeRealmTransport{offline: false}
	httpClient := &http.Client{Transport: transport}
	realmBaseURL := "https://realm.reconnect.test"
	initial := testMaterial("acct-1", "access-initial", "refresh-initial")
	initial.RealmOrigin = realmBaseURL
	initial.AccessTokenExpires = clock.Now().Add(5 * time.Minute)
	custody := &refreshRestartProofCustody{}
	cfg := resolveProductionConfig(ProductionConfig{
		RealmBaseURL: realmBaseURL,
		HTTPClient:   httpClient,
	})
	refresher := newRealmTokenRefresher(cfg)
	refresher.now = clock.Now
	svc := newHarnessService(t, nil,
		WithCustody(custody),
		WithCustodyPartition("offline-reconnect"),
		WithLoginExchanger(staticExchanger{material: initial}),
		WithRefresher(refresher),
		WithRealmBaseURL(realmBaseURL),
		WithRealmHTTPClient(httpClient),
		WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmDesktopShellCaller())),
		WithClock(clock.Now),
	)
	stopAccountRefreshTimer(t, svc)
	completeLogin(t, svc)

	proj, gen, fence, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !ok {
		t.Fatal("initial login did not establish local identity")
	}
	beforeStatus, _ := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	beforeRevision := beforeStatus.GetSnapshot().GetAuthorizationRevision()

	// Go offline and advance past access token expiry.
	transport.mu.Lock()
	transport.offline = true
	transport.mu.Unlock()
	clock.Advance(30 * time.Minute)

	// Local work continues on the same generation/fence.
	committed, commitErr := svc.CommitAuthenticatedRuntimeGeneration(context.Background(), proj.GetAccountId(), proj.GetRealmEnvironmentId(), gen, func() error {
		return nil
	})
	if !committed || commitErr != nil {
		t.Fatalf("local commit blocked while offline after access expiry: committed=%v err=%v", committed, commitErr)
	}
	offlineCall, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:      realmDesktopShellCaller(),
		MethodId:    "WorldPublicController_listWorldCatalog",
		RequestJson: `{}`,
	})
	if err != nil || offlineCall.GetAccepted() || offlineCall.GetReasonCode() != runtimev1.ReasonCode_REALM_UNAVAILABLE || transport.apiCalls.Load() != 0 {
		t.Fatalf("offline Realm call = (%+v, %v), apiCalls=%d", offlineCall, err, transport.apiCalls.Load())
	}

	// Reconnect: Realm refreshes token and online calls resume without disrupting local generation/revision.
	transport.mu.Lock()
	transport.offline = false
	transport.mu.Unlock()

	onlineCall, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:      realmDesktopShellCaller(),
		MethodId:    "WorldPublicController_listWorldCatalog",
		RequestJson: `{}`,
	})
	if err != nil || !onlineCall.GetAccepted() || onlineCall.GetResponseJson() != `[{"id":"world-1"}]` {
		t.Fatalf("reconnected Realm call = (%+v, %v)", onlineCall, err)
	}
	transport.mu.Lock()
	bearer := transport.lastAPIBearer
	transport.mu.Unlock()
	if bearer != "Bearer access-fresh" {
		t.Fatalf("reconnected Realm call bearer = %q, want Bearer access-fresh", bearer)
	}
	_, afterGen, afterFence, afterOK := svc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !afterOK || afterGen != gen || afterFence != fence {
		t.Fatalf("same-identity reconnect disrupted local generation: ok=%v gen=%d want=%d", afterOK, afterGen, gen)
	}
	afterStatus, _ := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if afterStatus.GetSnapshot().GetAuthorizationRevision() != beforeRevision ||
		afterStatus.GetSnapshot().GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
		t.Fatalf("reconnected snapshot = %+v, want revision %q and ACTION_EXECUTED", afterStatus.GetSnapshot(), beforeRevision)
	}
	if custody.material.RefreshToken != "refresh-fresh" || len(custody.material.RefreshTokenHashes) != 0 {
		t.Fatalf("reconnected custody = %+v", custody.material)
	}
}

func TestReconnectKnownRevocationAndDeletionBlockImmediately(t *testing.T) {
	cases := []struct {
		name              string
		body              string
		wantAccountReason runtimev1.AccountReasonCode
	}{
		{
			name:              "revoked refresh token",
			body:              `{"statusCode":401,"message":"Revoked","reasonCode":"AUTH_REFRESH_TOKEN_REVOKED","traceId":"trace-revoked"}`,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_TOKEN_INVALID,
		},
		{
			name:              "restricted account",
			body:              `{"statusCode":403,"message":"Restricted","reasonCode":"AUTH_ACCOUNT_RESTRICTED","traceId":"trace-banned"}`,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_TOKEN_INVALID,
		},
		{
			name:              "session revoked",
			body:              `{"statusCode":401,"message":"Session revoked","reasonCode":"AUTH_SESSION_REVOKED","traceId":"trace-session-revoked"}`,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_TOKEN_INVALID,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clock := newControllableClock(time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC))
			statusCode := http.StatusUnauthorized
			if strings.Contains(tc.body, `"statusCode":403`) {
				statusCode = http.StatusForbidden
			}
			transport := &fakeRealmTransport{
				offline: true,
				refreshFn: func(req *http.Request) (*http.Response, error) {
					return jsonHTTPResponse(req, statusCode, tc.body), nil
				},
			}
			httpClient := &http.Client{Transport: transport}
			realmBaseURL := "https://realm.revoked.test"
			stored := testMaterial("acct-revoked", "access-expired", "refresh-revoked")
			stored.RealmOrigin = realmBaseURL
			stored.AccessTokenExpires = clock.Now().Add(-time.Hour)
			custody := &refreshRestartProofCustody{material: stored, has: true}
			cfg := resolveProductionConfig(ProductionConfig{RealmBaseURL: realmBaseURL, HTTPClient: httpClient})
			svc := newHarnessService(t, nil,
				WithCustody(custody),
				WithCustodyPartition("reconnect-revoked-"+tc.name),
				WithRefresher(newRealmTokenRefresher(cfg)),
				WithRealmBaseURL(realmBaseURL),
				WithRealmHTTPClient(httpClient),
				WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmDesktopShellCaller())),
				WithClock(clock.Now),
			)
			stopAccountRefreshTimer(t, svc)

			_, gen, fence, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
			if !ok {
				t.Fatal("offline trusted sign-in was not active before reconnect")
			}

			// Reconnect and observe revocation from Realm.
			transport.mu.Lock()
			transport.offline = false
			transport.mu.Unlock()
			resp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:      realmDesktopShellCaller(),
				MethodId:    "WorldPublicController_listWorldCatalog",
				RequestJson: `{}`,
			})
			if err != nil || resp.GetAccepted() ||
				resp.GetReasonCode() != runtimev1.ReasonCode_AUTH_TOKEN_INVALID ||
				resp.GetAccountReasonCode() != tc.wantAccountReason {
				t.Fatalf("revoked Realm call = (%+v, %v)", resp, err)
			}
			select {
			case <-fence:
			default:
				t.Fatal("known revocation did not immediately close local account fence")
			}
			if proj, afterGen, _, live := svc.BindAuthenticatedRuntimeGeneration(context.Background()); live || proj != nil || afterGen <= gen {
				t.Fatalf("known revocation left local identity active: proj=%+v gen=%d live=%v", proj, afterGen, live)
			}
			statusResp, _ := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
			if statusResp.GetSnapshot().GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED ||
				statusResp.GetSnapshot().GetAuthorizationRevision() != "" ||
				statusResp.GetSnapshot().GetAccountProjection() != nil {
				t.Fatalf("revoked snapshot = %+v", statusResp.GetSnapshot())
			}
			if custody.has || custody.clearCalls != 1 {
				t.Fatalf("known revocation did not clear durable custody: %+v", custody)
			}
		})
	}
}

func TestOfflineExplicitLogoutAndSwitchAccountClearLocalIdentityImmediately(t *testing.T) {
	for _, action := range []string{"logout", "switch"} {
		t.Run(action, func(t *testing.T) {
			clock := newControllableClock(time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC))
			stored := testMaterial("acct-offline", "access-expired", "refresh-valid")
			stored.AccessTokenExpires = clock.Now().Add(-3 * time.Hour)
			custody := &refreshRestartProofCustody{material: stored, has: true}
			svc := newHarnessService(t, nil,
				WithCustody(custody),
				WithCustodyPartition("offline-"+action),
				WithRefresher(staticRefresher{err: newRefreshFailure(refreshFailurePreDispatch, errors.New("offline"))}),
				WithClock(clock.Now),
			)
			stopAccountRefreshTimer(t, svc)

			_, gen, fence, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
			if !ok {
				t.Fatal("offline trusted sign-in should be active before explicit action")
			}

			if action == "logout" {
				resp, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
				if err != nil || !resp.GetAccepted() || resp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
					t.Fatalf("offline Logout = (%+v, %v)", resp, err)
				}
			} else {
				resp, err := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: desktopAccountControlCaller()})
				if err != nil || !resp.GetAccepted() || resp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
					t.Fatalf("offline SwitchAccount = (%+v, %v)", resp, err)
				}
				begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
				if err != nil || !begin.GetAccepted() {
					t.Fatalf("BeginLogin after offline switch = (%+v, %v)", begin, err)
				}
				parsed, err := url.Parse(begin.GetOauthAuthorizationUrl())
				if err != nil || parsed.Query().Get("prompt") != "login" {
					t.Fatalf("switch authorize URL did not enforce fresh account selection: %q", begin.GetOauthAuthorizationUrl())
				}
			}

			select {
			case <-fence:
			default:
				t.Fatalf("offline %s did not close local account fence", action)
			}
			if proj, afterGen, _, live := svc.BindAuthenticatedRuntimeGeneration(context.Background()); live || proj != nil || afterGen <= gen {
				t.Fatalf("offline %s left local identity active: proj=%+v gen=%d live=%v", action, proj, afterGen, live)
			}
			if custody.has || custody.clearCalls != 1 {
				t.Fatalf("offline %s did not clear durable custody: %+v", action, custody)
			}

			restarted := newHarnessService(t, nil,
				WithCustody(custody),
				WithCustodyPartition("offline-"+action),
				WithClock(clock.Now),
			)
			stopAccountRefreshTimer(t, restarted)
			if restarted.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
				t.Fatalf("restart after %s state = %v, want ANONYMOUS", action, restarted.currentState())
			}
		})
	}
}

type contextCheckingCustody struct {
	refreshRestartProofCustody
}

func (c *contextCheckingCustody) Store(ctx context.Context, partition string, material AccountMaterial) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("store observed canceled context: %w", err)
	}
	return c.refreshRestartProofCustody.Store(ctx, partition, material)
}

func (c *contextCheckingCustody) Clear(ctx context.Context, partition string) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("clear observed canceled context: %w", err)
	}
	return c.refreshRestartProofCustody.Clear(ctx, partition)
}

func TestRefreshCustodyThreeWayDistinctionNotDispatchedVsUnknownVsRevoked(t *testing.T) {
	tests := []struct {
		name               string
		roundTrip          func(req *http.Request) (*http.Response, error)
		cancelBeforeReturn bool
		wantState          runtimev1.AccountSessionState
		wantAccountReason  runtimev1.AccountReasonCode
		wantLocalLive      bool
		wantCustodyIntact  bool
		wantOnlineCleared  bool
	}{
		{
			name: "not dispatched dial failure retains custody and local identity",
			roundTrip: func(*http.Request) (*http.Response, error) {
				return nil, errors.New("dial tcp: connection refused")
			},
			wantState:         runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED,
			wantLocalLive:     true,
			wantCustodyIntact: true,
		},
		{
			name: "not dispatched canceled caller context still restores custody cleanly",
			roundTrip: func(*http.Request) (*http.Response, error) {
				return nil, context.Canceled
			},
			cancelBeforeReturn: true,
			wantState:          runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
			wantAccountReason:  runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED,
			wantLocalLive:      true,
			wantCustodyIntact:  true,
		},
		{
			name: "not dispatched 429 AUTH_RATE_LIMITED retains custody and local identity",
			roundTrip: func(req *http.Request) (*http.Response, error) {
				return jsonHTTPResponse(req, http.StatusTooManyRequests, `{"statusCode":429,"message":"Rate limited","reasonCode":"AUTH_RATE_LIMITED","traceId":"trace-429"}`), nil
			},
			wantState:         runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED,
			wantLocalLive:     true,
			wantCustodyIntact: true,
		},
		{
			name: "possibly rotated after WroteHeaders clears online tokens while preserving local identity",
			roundTrip: func(req *http.Request) (*http.Response, error) {
				if trace := httptrace.ContextClientTrace(req.Context()); trace != nil && trace.WroteHeaders != nil {
					trace.WroteHeaders()
				}
				return nil, errors.New("connection reset by peer")
			},
			wantState:         runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS,
			wantLocalLive:     true,
			wantOnlineCleared: true,
		},
		{
			name: "possibly rotated after WroteRequest clears online tokens while preserving local identity",
			roundTrip: func(req *http.Request) (*http.Response, error) {
				if trace := httptrace.ContextClientTrace(req.Context()); trace != nil && trace.WroteRequest != nil {
					trace.WroteRequest(httptrace.WroteRequestInfo{})
				}
				return nil, errors.New("unexpected EOF")
			},
			wantState:         runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS,
			wantLocalLive:     true,
			wantOnlineCleared: true,
		},
		{
			name: "unknown outcome 503 clears online tokens while preserving local identity",
			roundTrip: func(req *http.Request) (*http.Response, error) {
				return jsonHTTPResponse(req, http.StatusServiceUnavailable, `{"statusCode":503,"message":"Unavailable","reasonCode":"AUTH_TOKEN_VERIFICATION_UNAVAILABLE","traceId":"trace-503"}`), nil
			},
			wantState:         runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS,
			wantLocalLive:     true,
			wantOnlineCleared: true,
		},
		{
			name: "known revoked clears custody and revokes local identity immediately",
			roundTrip: func(req *http.Request) (*http.Response, error) {
				return jsonHTTPResponse(req, http.StatusUnauthorized, `{"statusCode":401,"message":"Revoked","reasonCode":"AUTH_REFRESH_TOKEN_REVOKED","traceId":"trace-rev"}`), nil
			},
			wantState:         runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_TOKEN_INVALID,
			wantLocalLive:     false,
		},
		{
			name: "contract invalid response clears custody and revokes local identity immediately",
			roundTrip: func(req *http.Request) (*http.Response, error) {
				return jsonHTTPResponse(req, http.StatusOK, `{"accessToken":"access-2","refreshToken":"refresh-1","tokenType":"Bearer","expiresIn":300}`), nil
			},
			wantState:         runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_CONTRACT_INVALID,
			wantLocalLive:     false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			clock := newControllableClock(time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC))
			current := testMaterial("acct-custody", "access-expired", "refresh-1")
			current.RealmOrigin = "https://realm.custody.test"
			current.AccessTokenExpires = clock.Now().Add(-10 * time.Minute)
			custody := &contextCheckingCustody{
				refreshRestartProofCustody: refreshRestartProofCustody{material: current, has: true},
			}
			var refreshCalls atomic.Int32
			callCtx, cancel := context.WithCancel(context.Background())
			defer cancel()
			client := &http.Client{Transport: accountRoundTripFunc(func(req *http.Request) (*http.Response, error) {
				refreshCalls.Add(1)
				if tc.cancelBeforeReturn {
					cancel()
				}
				return tc.roundTrip(req)
			})}
			cfg := resolveProductionConfig(ProductionConfig{
				RealmBaseURL: "https://realm.custody.test",
				HTTPClient:   client,
			})
			svc := New(nil,
				WithProductionActivation(),
				WithCustody(custody),
				WithCustodyPartition("three-way-"+tc.name),
				WithRealmBaseURL("https://realm.custody.test"),
				WithRefresher(newRealmTokenRefresher(cfg)),
				WithClock(clock.Now),
			)
			stopAccountRefreshTimer(t, svc)

			_, gen, fence, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
			if !ok {
				t.Fatal("baseline local identity unavailable")
			}
			svc.mu.RLock()
			beforeRevision := svc.currentSnapshotLocked().GetAuthorizationRevision()
			svc.mu.RUnlock()

			result, err := svc.refreshAccountSessionInternal(callCtx, true)
			if err != nil || result.accepted ||
				result.state != tc.wantState ||
				result.accountReasonCode != tc.wantAccountReason {
				t.Fatalf("refresh = (%+v, %v), want state=%v reason=%v", result, err, tc.wantState, tc.wantAccountReason)
			}

			_, afterGen, afterFence, afterLive := svc.BindAuthenticatedRuntimeGeneration(context.Background())
			if afterLive != tc.wantLocalLive {
				t.Fatalf("local live = %v, want %v", afterLive, tc.wantLocalLive)
			}
			if tc.wantLocalLive {
				if afterGen != gen || afterFence != fence {
					t.Fatalf("preserved local identity changed generation %d -> %d", gen, afterGen)
				}
				select {
				case <-fence:
					t.Fatal("preserved local identity closed fence")
				default:
				}
				svc.mu.RLock()
				afterRevision := svc.currentSnapshotLocked().GetAuthorizationRevision()
				svc.mu.RUnlock()
				if afterRevision != beforeRevision || afterRevision == "" {
					t.Fatalf("preserved local identity changed authorization_revision %q -> %q", beforeRevision, afterRevision)
				}
			} else {
				select {
				case <-fence:
				default:
					t.Fatal("revoked/invalid refresh left local fence open")
				}
			}

			if tc.wantCustodyIntact {
				if !custody.has || custody.clearCalls != 0 || custody.material.RefreshToken != "refresh-1" ||
					custody.material.RefreshTokenHashes[refreshHash("refresh-1")] || custody.material.OnlineCredentialsCleared {
					t.Fatalf("expected intact custody without self-hash marker, got %+v", custody)
				}
			} else if tc.wantOnlineCleared {
				if !custody.has || custody.clearCalls != 0 ||
					!custody.material.OnlineCredentialsCleared ||
					custody.material.AccessToken != "" || custody.material.RefreshToken != "" ||
					!custody.material.AccessTokenExpires.IsZero() || len(custody.material.RefreshTokenHashes) != 0 {
					t.Fatalf("expected online-cleared local custody, got %+v", custody)
				}
				svc.mu.RLock()
				memMaterial := svc.material
				timer := svc.refreshTimer
				svc.mu.RUnlock()
				if !memMaterial.OnlineCredentialsCleared || memMaterial.AccessToken != "" || memMaterial.RefreshToken != "" ||
					!memMaterial.AccessTokenExpires.IsZero() || len(memMaterial.RefreshTokenHashes) != 0 {
					t.Fatalf("expected online tokens erased from memory, got %+v", memMaterial)
				}
				if timer != nil {
					t.Fatal("ambiguous refresh must stop background refresh timer")
				}
				// Zero replay attempts on subsequent refresh or cold-start restart.
				replayRes, replayErr := svc.refreshAccountSessionInternal(context.Background(), true)
				if replayErr != nil || replayRes.accepted || refreshCalls.Load() != 1 {
					t.Fatalf("ambiguous refresh replayed token: res=%+v err=%v calls=%d", replayRes, replayErr, refreshCalls.Load())
				}
				restarted := New(nil,
					WithProductionActivation(),
					WithCustody(custody),
					WithCustodyPartition("three-way-"+tc.name),
					WithRealmBaseURL("https://realm.custody.test"),
					WithRefresher(newRealmTokenRefresher(cfg)),
					WithClock(clock.Now),
				)
				stopAccountRefreshTimer(t, restarted)
				proj, rGen, _, rLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
				if !rLive || rGen == 0 || proj.GetAccountId() != "acct-custody" {
					t.Fatalf("cold-start restart after ambiguous refresh lost local identity: proj=%+v gen=%d live=%v", proj, rGen, rLive)
				}
				if _, _, _, credOK, credErr := restarted.realmUnaryCredential(context.Background()); credErr != nil || credOK || refreshCalls.Load() != 1 {
					t.Fatalf("cold-start restart after ambiguous refresh allowed online call or replayed refresh: ok=%v err=%v calls=%d", credOK, credErr, refreshCalls.Load())
				}
			} else {
				if custody.has || custody.clearCalls != 1 {
					t.Fatalf("expected cleared custody, got %+v", custody)
				}
			}
		})
	}
}

func TestAmbiguousRefreshPreservesLocalIdentityAcrossRestartAndBlocksOnlineUntilReauth(t *testing.T) {
	clock := newControllableClock(time.Date(2026, 11, 27, 14, 0, 0, 0, time.UTC))
	secrets := newAccountBinarySecretStore()
	custody, err := NewProtectedBinaryCustody(secrets)
	if err != nil {
		t.Fatal(err)
	}
	realmBaseURL := "https://realm.ambiguous.test"
	initial := testMaterial("acct-ambig", "access-initial", "refresh-initial")
	initial.RealmOrigin = realmBaseURL
	initial.CurrentUserHandle = "ambig_user"
	initial.AccessTokenExpires = clock.Now().Add(-5 * time.Minute)
	if err := custody.Store(context.Background(), "ambiguous-e2e", initial); err != nil {
		t.Fatal(err)
	}

	transport := &fakeRealmTransport{
		refreshFn: func(req *http.Request) (*http.Response, error) {
			return jsonHTTPResponse(req, http.StatusServiceUnavailable, `{"statusCode":503,"message":"Unavailable","reasonCode":"AUTH_TOKEN_VERIFICATION_UNAVAILABLE","traceId":"trace-503"}`), nil
		},
	}
	httpClient := &http.Client{Transport: transport}
	presenceProvider := &staticPresenceVerifier{
		result: PresenceVerification{
			State:         runtimev1.PresenceVerificationState_PRESENCE_VERIFICATION_STATE_VERIFIED,
			Method:        runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL,
			VerifiedUntil: clock.Now().Add(2 * time.Minute),
		},
	}
	reauthMaterial := testMaterial("acct-ambig", "access-reauthed", "refresh-reauthed")
	reauthMaterial.RealmOrigin = realmBaseURL
	reauthMaterial.CurrentUserHandle = "ambig_user"
	reauthMaterial.AccessTokenExpires = clock.Now().Add(15 * time.Minute)

	newService := func(exchanger LoginExchanger) *Service {
		cfg := resolveProductionConfig(ProductionConfig{
			RealmBaseURL: realmBaseURL,
			HTTPClient:   httpClient,
		})
		refresher := newRealmTokenRefresher(cfg)
		refresher.now = clock.Now
		svc := newHarnessService(t, nil,
			WithProductionActivation(),
			WithCustody(custody),
			WithCustodyPartition("ambiguous-e2e"),
			WithRealmBaseURL(realmBaseURL),
			WithRealmRealtimeURL("wss://realm.ambiguous.test/realtime"),
			WithRealmHTTPClient(httpClient),
			WithLoginExchanger(exchanger),
			WithRefresher(refresher),
			WithPresenceVerifier(presenceProvider),
			WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmDesktopShellCaller())),
			WithClock(clock.Now),
			func(s *Service) {
				s.primarySecrets = newAccountBinarySecretStore()
				s.primaryKeyScope = "install-ambig\x00os-user"
			},
		)
		stopAccountRefreshTimer(t, svc)
		return svc
	}

	svc := newService(staticExchanger{material: reauthMaterial})
	proj, gen, fence, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
	if !ok || proj.GetAccountId() != "acct-ambig" {
		t.Fatalf("baseline BindAuthenticatedRuntimeGeneration = (%+v, %d, %v)", proj, gen, ok)
	}
	beforeStatus, _ := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	beforeRevision := beforeStatus.GetSnapshot().GetAuthorizationRevision()

	// Trigger Realm 503 ambiguous refresh via an online Realm call.
	firstResp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:      realmDesktopShellCaller(),
		MethodId:    "WorldPublicController_listWorldCatalog",
		RequestJson: `{}`,
	})
	if err != nil || firstResp.GetAccepted() ||
		firstResp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
		t.Fatalf("503 InvokeRealmUnary = (%+v, %v), want REFRESH_OUTCOME_AMBIGUOUS", firstResp, err)
	}
	if transport.refreshCalls.Load() != 1 || transport.apiCalls.Load() != 0 {
		t.Fatalf("after 503: refreshCalls=%d apiCalls=%d, want 1 and 0", transport.refreshCalls.Load(), transport.apiCalls.Load())
	}

	assertLocalPreservedAndOnlineBlocked := func(target *Service, wantGen uint64, wantFence <-chan struct{}, wantRevision string) {
		t.Helper()
		statusResp, err := target.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
		if err != nil || !statusResp.GetAccepted() {
			t.Fatalf("GetAccountSessionStatus = (%+v, %v)", statusResp, err)
		}
		snap := statusResp.GetSnapshot()
		if snap.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
			snap.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS ||
			snap.GetAccountProjection().GetAccountId() != "acct-ambig" ||
			strings.TrimSpace(snap.GetAuthorizationRevision()) == "" {
			t.Fatalf("ambiguous status snapshot = %+v", snap)
		}
		if wantRevision != "" && snap.GetAuthorizationRevision() != wantRevision {
			t.Fatalf("authorization_revision changed %q -> %q", wantRevision, snap.GetAuthorizationRevision())
		}
		p, g, f, live := target.BindAuthenticatedRuntimeGeneration(context.Background())
		if !live || p.GetAccountId() != "acct-ambig" {
			t.Fatalf("local identity not live: p=%+v g=%d live=%v", p, g, live)
		}
		if wantGen != 0 && (g != wantGen || f != wantFence) {
			t.Fatalf("local generation/fence changed: g=%d want=%d", g, wantGen)
		}
		select {
		case <-f:
			t.Fatal("local fence closed after ambiguous refresh")
		default:
		}
		committed, commitErr := target.CommitAuthenticatedRuntimeGeneration(context.Background(), p.GetAccountId(), p.GetRealmEnvironmentId(), g, func() error {
			return nil
		})
		if !committed || commitErr != nil {
			t.Fatalf("local commit failed after ambiguous refresh: committed=%v err=%v", committed, commitErr)
		}
		display, dispErr := target.CurrentUserDisplay(context.Background())
		if dispErr != nil || display.Handle != "ambig_user" {
			t.Fatalf("CurrentUserDisplay = (%+v, %v)", display, dispErr)
		}
		if _, _, selected := target.RemoteAccessSettingsOwner(); selected {
			t.Fatal("RemoteAccessSettingsOwner must return false when online credentials are cleared")
		}
		target.mu.RLock()
		timer := target.refreshTimer
		target.mu.RUnlock()
		if timer != nil {
			t.Fatal("refresh scheduler must not run when online credentials are cleared")
		}

		// Every online Realm & protected remote path must fail closed with 0 API calls and 0 refresh replays.
		beforeRefreshes := transport.refreshCalls.Load()
		beforeAPIs := transport.apiCalls.Load()
		beforePresence := presenceProvider.calls

		desktopUnary, err := target.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
			Caller:      realmDesktopShellCaller(),
			MethodId:    "WorldPublicController_listWorldCatalog",
			RequestJson: `{}`,
		})
		if err != nil || desktopUnary.GetAccepted() ||
			desktopUnary.GetReasonCode() != runtimev1.ReasonCode_AUTH_TOKEN_INVALID ||
			desktopUnary.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
			t.Fatalf("blocked Desktop InvokeRealmUnary = (%+v, %v)", desktopUnary, err)
		}
		localAppCtx := ContextWithAuthorizedLocalAppDecision(context.Background(), LocalAppCallerDecision{
			RegisteredAppSubject: "lap_world_studio",
			AccountID:            "acct-ambig",
			Operation:            LocalAppOperationRealmWorldCoreList,
		})
		localAppUnary, err := target.InvokeRealmUnary(localAppCtx, &runtimev1.InvokeRealmUnaryRequest{
			MethodId:    "WorldCoreController_listWorldCores",
			RequestJson: `{"path":{},"query":{"take":10}}`,
		})
		if err != nil || localAppUnary.GetAccepted() ||
			localAppUnary.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
			t.Fatalf("blocked Local App InvokeRealmUnary = (%+v, %v)", localAppUnary, err)
		}
		if _, err := target.BindRealmRealtimeAccount(context.Background()); err == nil {
			t.Fatal("BindRealmRealtimeAccount succeeded after ambiguous refresh")
		}
		if _, err := target.BindPrimaryRuntimeControl(context.Background()); status.Code(err) != codes.Unauthenticated {
			t.Fatalf("BindPrimaryRuntimeControl error = %v, want Unauthenticated", err)
		}
		principal := protectedprincipal.NewDirect("nimi.desktop", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductProfileID, p, g, f, make(chan struct{}))
		if _, err := target.GetPrimaryRuntimeState(protectedprincipal.With(context.Background(), principal), &runtimev1.GetPrimaryRuntimeStateRequest{}); status.Code(err) != codes.Unauthenticated {
			t.Fatalf("GetPrimaryRuntimeState error = %v, want Unauthenticated", err)
		}
		if _, err := target.AcquireRealmSourceMaterialization(context.Background(), RealmSourceMaterializationIssuanceRequest{
			AuthenticatedAccountID: "acct-ambig",
			SourceRef: RealmSourceMaterializationSourceRefV3{
				Kind: "worldCharacter", ID: "char-1", WorldID: "world-1", SourceHash: strings.Repeat("a", 64),
				WorldEntityRef: &RealmSourceMaterializationWorldEntityRefV3{WorldID: "world-1", EntityID: "entity-1"},
			},
			Challenge: RealmSourceMaterializationChallengeV3{
				ChallengeID: "challenge-123456", ChallengeDigest: strings.Repeat("b", 64), IntendedRuntimeAudience: "nimi-runtime:test", ExpiresAt: clock.Now().Add(time.Minute),
			},
			Limits: RealmSourceMaterializationLimitsV3{
				MaxSegmentBytes: 8388608, MaxSegmentComponentCount: 256, MaxChunkBytes: 262144, MaxSegmentChunks: 4096,
				MaxSetSegments: 64, MaxSetBytes: 134217728, MaxSetComponentCount: 16384, MaxSetChunks: 65536,
			},
		}); !errors.Is(err, ErrRealmSourceMaterializationAccountLease) {
			t.Fatalf("AcquireRealmSourceMaterialization error = %v, want ErrRealmSourceMaterializationAccountLease", err)
		}
		presenceResp, err := target.RequestPresenceVerification(context.Background(), &runtimev1.RequestPresenceVerificationRequest{
			Caller:     firstPartyCaller(),
			Purpose:    "shijing.profile.reveal",
			TtlSeconds: 60,
		})
		if err != nil || presenceResp.GetAccepted() ||
			presenceResp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
			t.Fatalf("blocked RequestPresenceVerification = (%+v, %v)", presenceResp, err)
		}
		if transport.refreshCalls.Load() != beforeRefreshes || transport.apiCalls.Load() != beforeAPIs || presenceProvider.calls != beforePresence {
			t.Fatalf("blocked calls leaked network or provider work: refresh=%d->%d api=%d->%d presence=%d->%d",
				beforeRefreshes, transport.refreshCalls.Load(), beforeAPIs, transport.apiCalls.Load(), beforePresence, presenceProvider.calls)
		}
	}

	assertLocalPreservedAndOnlineBlocked(svc, gen, fence, beforeRevision)

	// Verify durable binary custody erased all tokens and survives cold-start offline restart.
	stored, err := custody.Load(context.Background(), "ambiguous-e2e")
	if err != nil || !stored.OnlineCredentialsCleared || stored.AccessToken != "" || stored.RefreshToken != "" || !stored.AccessTokenExpires.IsZero() || len(stored.RefreshTokenHashes) != 0 {
		t.Fatalf("durable binary custody = (%+v, %v)", stored, err)
	}
	restarted := newService(staticExchanger{material: reauthMaterial})
	_, restartGen, restartFence, _ := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
	restartStatus, _ := restarted.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	restartRevision := restartStatus.GetSnapshot().GetAuthorizationRevision()
	assertLocalPreservedAndOnlineBlocked(restarted, restartGen, restartFence, restartRevision)

	// Fresh online login for the SAME account restores online credentials without disrupting local generation/fence/revision.
	begin, err := restarted.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !begin.GetAccepted() {
		t.Fatalf("BeginLogin for online reauth = (%+v, %v)", begin, err)
	}
	if restarted.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		t.Fatalf("BeginLogin during online reauth dropped AUTHENTICATED state to %v", restarted.currentState())
	}
	complete, err := restarted.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "auth-code-same",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
	})
	if err != nil || !complete.GetAccepted() || complete.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		t.Fatalf("CompleteLogin same account = (%+v, %v)", complete, err)
	}
	_, afterReauthGen, afterReauthFence, afterReauthLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
	if !afterReauthLive || afterReauthGen != restartGen || afterReauthFence != restartFence {
		t.Fatalf("same-account reauth disrupted local generation/fence: gen=%d want=%d", afterReauthGen, restartGen)
	}
	afterReauthStatus, _ := restarted.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if afterReauthStatus.GetSnapshot().GetAuthorizationRevision() != restartRevision ||
		afterReauthStatus.GetSnapshot().GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
		t.Fatalf("same-account reauth snapshot = %+v, want revision %q and ACTION_EXECUTED", afterReauthStatus.GetSnapshot(), restartRevision)
	}
	if _, _, selected := restarted.RemoteAccessSettingsOwner(); !selected {
		t.Fatal("RemoteAccessSettingsOwner remained false after same-account reauth")
	}
	onlineResp, err := restarted.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
		Caller:      realmDesktopShellCaller(),
		MethodId:    "WorldPublicController_listWorldCatalog",
		RequestJson: `{}`,
	})
	if err != nil || !onlineResp.GetAccepted() || onlineResp.GetResponseJson() != `[{"id":"world-1"}]` {
		t.Fatalf("online Realm call after reauth = (%+v, %v)", onlineResp, err)
	}
	transport.mu.Lock()
	bearer := transport.lastAPIBearer
	transport.mu.Unlock()
	if bearer != "Bearer access-reauthed" {
		t.Fatalf("online call bearer after reauth = %q, want Bearer access-reauthed", bearer)
	}

	// Re-enter ambiguous refresh state, then CompleteLogin for a DIFFERENT account must invalidate old local identity & fence!
	restarted.mu.Lock()
	restarted.material.AccessTokenExpires = clock.Now().Add(-time.Minute)
	restarted.mu.Unlock()
	if res, rErr := restarted.refreshAccountSessionInternal(context.Background(), true); rErr != nil || res.accepted ||
		res.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
		t.Fatalf("second ambiguous refresh = (%+v, %v)", res, rErr)
	}
	otherAccount := testMaterial("acct-other", "access-other", "refresh-other")
	otherAccount.RealmOrigin = realmBaseURL
	otherAccount.AccessTokenExpires = clock.Now().Add(15 * time.Minute)
	restarted.exchanger = staticExchanger{material: otherAccount}
	beginOther, err := restarted.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !beginOther.GetAccepted() {
		t.Fatalf("BeginLogin for different account = (%+v, %v)", beginOther, err)
	}
	completeOther, err := restarted.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
		LoginAttemptId: beginOther.GetLoginAttemptId(),
		Code:           "auth-code-other",
		State:          beginOther.GetState(),
		Nonce:          beginOther.GetNonce(),
	})
	if err != nil || !completeOther.GetAccepted() {
		t.Fatalf("CompleteLogin different account = (%+v, %v)", completeOther, err)
	}
	select {
	case <-restartFence:
	default:
		t.Fatal("different-account reauth did not close old local account fence")
	}
	otherProj, otherGen, _, otherLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
	if !otherLive || otherProj.GetAccountId() != "acct-other" || otherGen <= restartGen {
		t.Fatalf("different-account reauth identity = (%+v, %d, %v)", otherProj, otherGen, otherLive)
	}
	otherStatus, _ := restarted.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if otherStatus.GetSnapshot().GetAuthorizationRevision() == restartRevision || otherStatus.GetSnapshot().GetAuthorizationRevision() == "" {
		t.Fatalf("different-account reauth reused old authorization_revision: %+v", otherStatus.GetSnapshot())
	}

	// From ambiguous-refresh state: invalid callback, explicit logout, and account switch still revoke local identity & clear custody immediately.
	for _, action := range []string{"invalid-callback", "logout", "switch"} {
		t.Run(action+"-from-ambiguous-state", func(t *testing.T) {
			actionSecrets := newAccountBinarySecretStore()
			actionCustody, err := NewProtectedBinaryCustody(actionSecrets)
			if err != nil {
				t.Fatal(err)
			}
			base := testMaterial("acct-action", "access-a", "refresh-a")
			base.RealmOrigin = realmBaseURL
			base.AccessTokenExpires = clock.Now().Add(-time.Minute)
			if err := actionCustody.Store(context.Background(), "ambig-"+action, base); err != nil {
				t.Fatal(err)
			}
			cfg := resolveProductionConfig(ProductionConfig{RealmBaseURL: realmBaseURL, HTTPClient: httpClient})
			s := newHarnessService(t, nil,
				WithProductionActivation(),
				WithCustody(actionCustody),
				WithCustodyPartition("ambig-"+action),
				WithRealmBaseURL(realmBaseURL),
				WithRealmHTTPClient(httpClient),
				WithLoginExchanger(staticExchanger{material: reauthMaterial}),
				WithRefresher(newRealmTokenRefresher(cfg)),
				WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmDesktopShellCaller())),
				WithClock(clock.Now),
			)
			stopAccountRefreshTimer(t, s)
			if res, rErr := s.refreshAccountSessionInternal(context.Background(), true); rErr != nil || res.accepted ||
				res.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
				t.Fatalf("setup ambiguous state = (%+v, %v)", res, rErr)
			}
			_, beforeGen, beforeFence, live := s.BindAuthenticatedRuntimeGeneration(context.Background())
			if !live {
				t.Fatal("ambiguous setup did not preserve local identity")
			}

			switch action {
			case "invalid-callback":
				b, bErr := s.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
				if bErr != nil || !b.GetAccepted() {
					t.Fatalf("BeginLogin = (%+v, %v)", b, bErr)
				}
				c, cErr := s.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
					Caller:         desktopAccountControlCaller(),
					LoginAttemptId: b.GetLoginAttemptId(),
					Code:           "code",
					RefreshToken:   "forbidden-callback-refresh-token",
					State:          b.GetState(),
					Nonce:          b.GetNonce(),
				})
				if cErr != nil || c.GetAccepted() || c.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED {
					t.Fatalf("invalid callback = (%+v, %v)", c, cErr)
				}
			case "logout":
				l, lErr := s.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
				if lErr != nil || !l.GetAccepted() || l.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
					t.Fatalf("Logout = (%+v, %v)", l, lErr)
				}
			case "switch":
				sw, swErr := s.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: desktopAccountControlCaller()})
				if swErr != nil || !sw.GetAccepted() || sw.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
					t.Fatalf("SwitchAccount = (%+v, %v)", sw, swErr)
				}
			}

			select {
			case <-beforeFence:
			default:
				t.Fatalf("%s from ambiguous state did not close local fence", action)
			}
			if p, afterGen, _, afterLive := s.BindAuthenticatedRuntimeGeneration(context.Background()); afterLive || p != nil || afterGen <= beforeGen {
				t.Fatalf("%s from ambiguous state left local identity live: p=%+v gen=%d live=%v", action, p, afterGen, afterLive)
			}
			if _, loadErr := actionCustody.Load(context.Background(), "ambig-"+action); !errors.Is(loadErr, ErrNoStoredAccount) {
				t.Fatalf("%s from ambiguous state retained custody: err=%v", action, loadErr)
			}
		})
	}
}

func TestBoundPrimaryRuntimeControlFailsClosedAfterAmbiguousRefresh(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	binding := realmv1.PrimaryRuntimeBindingDto{
		RuntimeId:   "86ba1c17-84de-4132-bf83-c201b9ef0521",
		BindingId:   "14e92c91-d872-4a0e-9d72-4ea05bbea917",
		PublicKey:   base64.RawURLEncoding.EncodeToString(public),
		DisplayName: "PC",
		ValidAfter:  time.Now().UTC().Format(time.RFC3339Nano),
	}
	var controlRequests atomic.Int32
	var refreshRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == realmv1.RefreshTokenOperation.Path() {
			refreshRequests.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"statusCode":503,"message":"Unavailable","reasonCode":"AUTH_TOKEN_VERIFICATION_UNAVAILABLE","traceId":"trace-503"}`))
			return
		}
		controlRequests.Add(1)
		switch r.URL.Path {
		case realmv1.GetMyPrimaryRuntimePath:
			_ = json.NewEncoder(w).Encode(realmv1.PrimaryRuntimeSnapshotDto{
				AccountId:  "acct-1",
				Binding:    &binding,
				ServerTime: time.Now().UTC().Format(time.RFC3339Nano),
			})
		case realmv1.RegisterPrimaryRuntimeControlPath:
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeControlRegisterResultDto{
				ControlSessionId: "2893d76e-607e-446c-bb9d-52a634ea3514",
			})
		case realmv1.HeartbeatPrimaryRuntimeControlPath:
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(realmv1.RuntimeControlHeartbeatResultDto{Status: "idle"})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	secrets := newAccountBinarySecretStore()
	custody := &refreshRestartProofCustody{
		material: func() AccountMaterial {
			m := testMaterial("acct-1", "access-1", "refresh-1")
			m.RealmOrigin = server.URL
			return m
		}(),
		has: true,
	}
	cfg := resolveProductionConfig(ProductionConfig{
		RealmBaseURL: server.URL,
		HTTPClient:   server.Client(),
	})
	svc := newHarnessService(t, nil,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition("bound-control-ambiguous"),
		WithRealmBaseURL(server.URL),
		WithRealmHTTPClient(server.Client()),
		WithRefresher(newRealmTokenRefresher(cfg)),
		func(s *Service) {
			s.primarySecrets, s.primaryKeyScope = secrets, "bound-control-ambig\x00os-user"
		},
	)
	stopAccountRefreshTimer(t, svc)

	ctx := context.Background()
	_, keyName, err := svc.loadPrimaryAccountKeys(ctx, "acct-1", "realm-local")
	if err != nil {
		t.Fatal(err)
	}
	encodedKeys, _ := json.Marshal(primaryHostKeys{
		Version: 1,
		Active:  &primaryHostKey{RuntimeID: binding.RuntimeId, Seed: private.Seed()},
	})
	if err := secrets.Store(ctx, keyName, encodedKeys); err != nil {
		t.Fatal(err)
	}

	control, err := svc.BindPrimaryRuntimeControl(ctx)
	if err != nil {
		t.Fatalf("baseline BindPrimaryRuntimeControl: %v", err)
	}
	if err := svc.RegisterPrimaryRuntimeControl(ctx, control); err != nil {
		t.Fatalf("baseline RegisterPrimaryRuntimeControl: %v", err)
	}
	if hb, err := svc.HeartbeatPrimaryRuntimeControl(ctx, control, ""); err != nil || hb != "idle" {
		t.Fatalf("baseline HeartbeatPrimaryRuntimeControl = (%q, %v), want idle", hb, err)
	}

	// Trigger ambiguous 503 refresh: local identity & control.invalidated stay open,
	// while online credentials are erased.
	res, err := svc.refreshAccountSessionInternal(ctx, true)
	if err != nil || res.accepted || res.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
		t.Fatalf("ambiguous refresh = (%+v, %v)", res, err)
	}
	select {
	case <-control.State().Invalidated:
		t.Fatal("ambiguous refresh closed local identity fence")
	default:
	}

	// Already-bound PrimaryRuntimeControl must fail closed with 0 Realm HTTP requests.
	beforeControlCalls := controlRequests.Load()
	beforeRefreshCalls := refreshRequests.Load()
	if _, err := svc.HeartbeatPrimaryRuntimeControl(ctx, control, ""); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("post-ambiguous HeartbeatPrimaryRuntimeControl error = %v, want Unauthenticated", err)
	}
	if _, err := svc.SyncPrimaryRuntimeConnections(ctx, control, nil); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("post-ambiguous SyncPrimaryRuntimeConnections error = %v, want Unauthenticated", err)
	}
	if err := svc.AnswerPrimaryRuntimeConnection(ctx, control, "feb29b08-c6b3-46c4-a1fb-afb0a7344184", "v=0\r\ns=answer\r\n", ""); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("post-ambiguous AnswerPrimaryRuntimeConnection error = %v, want Unauthenticated", err)
	}
	if err := svc.RegisterPrimaryRuntimeControl(ctx, control); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("post-ambiguous RegisterPrimaryRuntimeControl error = %v, want Unauthenticated", err)
	}
	if controlRequests.Load() != beforeControlCalls || refreshRequests.Load() != beforeRefreshCalls {
		t.Fatalf("already-bound control leaked Realm HTTP requests after ambiguous refresh: control=%d->%d refresh=%d->%d",
			beforeControlCalls, controlRequests.Load(), beforeRefreshCalls, refreshRequests.Load())
	}
}

func TestCompleteLoginCustodyClearFailureFromAmbiguousStateFencesRestartRecovery(t *testing.T) {
	for _, tc := range []struct {
		name         string
		refreshToken string
		exchangeErr  error
	}{
		{name: "invalid-callback", refreshToken: "forbidden-callback-refresh-token"},
		{name: "exchange-failure", exchangeErr: ErrLoginExchangeFailure},
	} {
		t.Run(tc.name, func(t *testing.T) {
			clock := newControllableClock(time.Date(2026, 11, 27, 15, 0, 0, 0, time.UTC))
			realmBaseURL := "https://realm.clear-fail.test"
			initial := testMaterial("acct-clear-fail", "access-old", "refresh-old")
			initial.RealmOrigin = realmBaseURL
			initial.AccessTokenExpires = clock.Now().Add(-time.Minute)
			custody := &refreshRestartProofCustody{material: initial, has: true}
			transport := &fakeRealmTransport{
				refreshFn: func(req *http.Request) (*http.Response, error) {
					return jsonHTTPResponse(req, http.StatusServiceUnavailable, `{"statusCode":503,"message":"Unavailable","reasonCode":"AUTH_TOKEN_VERIFICATION_UNAVAILABLE","traceId":"trace-503"}`), nil
				},
			}
			httpClient := &http.Client{Transport: transport}
			cfg := resolveProductionConfig(ProductionConfig{RealmBaseURL: realmBaseURL, HTTPClient: httpClient})

			svc := newHarnessService(t, nil,
				WithProductionActivation(),
				WithCustody(custody),
				WithCustodyPartition("clear-fail-"+tc.name),
				WithRealmBaseURL(realmBaseURL),
				WithRealmHTTPClient(httpClient),
				WithLoginExchanger(staticExchanger{err: tc.exchangeErr, material: testMaterial("acct-clear-fail", "access-new", "refresh-new")}),
				WithRefresher(newRealmTokenRefresher(cfg)),
				WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller())),
				WithClock(clock.Now),
			)
			stopAccountRefreshTimer(t, svc)

			if res, err := svc.refreshAccountSessionInternal(context.Background(), true); err != nil || res.accepted ||
				res.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
				t.Fatalf("setup ambiguous state = (%+v, %v)", res, err)
			}
			_, beforeGen, beforeFence, live := svc.BindAuthenticatedRuntimeGeneration(context.Background())
			if !live {
				t.Fatal("ambiguous state did not retain local identity")
			}

			begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
			if err != nil || !begin.GetAccepted() {
				t.Fatalf("BeginLogin = (%+v, %v)", begin, err)
			}
			custody.clearErr = ErrCustodyUnavailable

			complete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
				Caller:         desktopAccountControlCaller(),
				LoginAttemptId: begin.GetLoginAttemptId(),
				Code:           "auth-code",
				RefreshToken:   tc.refreshToken,
				State:          begin.GetState(),
				Nonce:          begin.GetNonce(),
			})
			if err != nil || complete.GetAccepted() ||
				complete.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE ||
				complete.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE {
				t.Fatalf("CompleteLogin with custody.Clear failure = (%+v, %v), want UNAVAILABLE + CUSTODY_UNAVAILABLE", complete, err)
			}
			select {
			case <-beforeFence:
			default:
				t.Fatal("custody.Clear failure did not close local account fence")
			}
			if proj, afterGen, _, afterLive := svc.BindAuthenticatedRuntimeGeneration(context.Background()); afterLive || proj != nil || afterGen <= beforeGen {
				t.Fatalf("custody.Clear failure left local identity live: proj=%+v gen=%d live=%v", proj, afterGen, afterLive)
			}
			if !custody.material.PendingRevocation || custody.material.OnlineCredentialsCleared || custody.material.RefreshToken != "" || custody.material.AccessToken != "" {
				t.Fatalf("custody.Clear failure did not persist PendingRevocation fence: %+v", custody.material)
			}

			// Restart while custody.Clear still fails must NEVER resurrect local identity.
			restartedStillBroken := New(nil,
				WithProductionActivation(),
				WithCustody(custody),
				WithCustodyPartition("clear-fail-"+tc.name),
				WithRealmBaseURL(realmBaseURL),
				WithClock(clock.Now),
			)
			stopAccountRefreshTimer(t, restartedStillBroken)
			if restartedStillBroken.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE {
				t.Fatalf("restart with PendingRevocation + clearErr state = %v, want UNAVAILABLE", restartedStillBroken.currentState())
			}
			if _, _, _, rLive := restartedStillBroken.BindAuthenticatedRuntimeGeneration(context.Background()); rLive {
				t.Fatal("restart with PendingRevocation resurrected local authenticated identity")
			}

			// Once custody.Clear recovers, restart clears custody and moves to REAUTH_REQUIRED.
			custody.clearErr = nil
			restartedRecovered := New(nil,
				WithProductionActivation(),
				WithCustody(custody),
				WithCustodyPartition("clear-fail-"+tc.name),
				WithRealmBaseURL(realmBaseURL),
				WithClock(clock.Now),
			)
			stopAccountRefreshTimer(t, restartedRecovered)
			if restartedRecovered.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED || custody.has {
				t.Fatalf("recovered restart state=%v custody=%+v, want REAUTH_REQUIRED + cleared", restartedRecovered.currentState(), custody)
			}
			if _, _, _, rLive := restartedRecovered.BindAuthenticatedRuntimeGeneration(context.Background()); rLive {
				t.Fatal("recovered PendingRevocation restart authenticated locally")
			}
		})
	}
}

type funcAccountRefresher struct {
	fn func(context.Context, AccountMaterial) (AccountMaterial, error)
}

func (r funcAccountRefresher) Refresh(ctx context.Context, current AccountMaterial) (AccountMaterial, error) {
	return r.fn(ctx, current)
}

func TestInvokeRealmUnary401RetryNeverDispatchesExpiredOnlineToken(t *testing.T) {
	t.Run("concurrent rotation to expired token cannot bypass refresh on 401 retry", func(t *testing.T) {
		clock := newControllableClock(time.Date(2026, 11, 27, 13, 0, 0, 0, time.UTC))
		initial := testMaterial("acct-401-a", "access-1", "refresh-1")
		initial.RealmOrigin = "https://realm.offline.test"
		initial.AccessTokenExpires = clock.Now().Add(5 * time.Minute)
		custody := &refreshRestartProofCustody{material: initial, has: true}

		transport := &fakeRealmTransport{}
		client := &http.Client{Transport: transport}
		cfg := resolveProductionConfig(ProductionConfig{
			RealmBaseURL: "https://realm.offline.test",
			HTTPClient:   client,
		})
		refresher := newRealmTokenRefresher(cfg)
		refresher.now = clock.Now

		svc := newHarnessService(t, nil,
			WithCustody(custody),
			WithCustodyPartition("offline-401-concurrent-expired"),
			WithRealmBaseURL("https://realm.offline.test"),
			WithRealmHTTPClient(client),
			WithRefresher(refresher),
			WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmDesktopShellCaller())),
			WithClock(clock.Now),
		)
		stopAccountRefreshTimer(t, svc)

		_, gen, fence, ok := svc.BindAuthenticatedRuntimeGeneration(context.Background())
		if !ok {
			t.Fatal("expected authenticated local identity")
		}

		transport.apiFn = func(req *http.Request) (*http.Response, error) {
			// Simulate a concurrent refresh rotating access-1 -> access-2, followed
			// by access-2 expiring before the 401 retry enters refreshAccountSessionLocked,
			// while Realm becomes unreachable.
			svc.mu.Lock()
			svc.material.AccessToken = "access-2"
			svc.material.AccessTokenExpires = clock.Now().Add(time.Minute)
			svc.mu.Unlock()
			clock.Advance(2 * time.Minute)
			transport.mu.Lock()
			transport.offline = true
			transport.mu.Unlock()
			return jsonHTTPResponse(req, http.StatusUnauthorized, `{"statusCode":401,"message":"Unauthorized"}`), nil
		}

		resp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
			Caller:      realmDesktopShellCaller(),
			MethodId:    "WorldPublicController_listWorldCatalog",
			RequestJson: `{}`,
		})
		if err != nil {
			t.Fatalf("InvokeRealmUnary err = %v", err)
		}
		if resp.GetAccepted() ||
			resp.GetReasonCode() != runtimev1.ReasonCode_REALM_UNAVAILABLE ||
			resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED {
			t.Fatalf("InvokeRealmUnary = %+v, want REALM_UNAVAILABLE/REFRESH_RETRY_DEFERRED", resp)
		}
		if got := transport.refreshCalls.Load(); got != 1 {
			t.Fatalf("refreshCalls = %d, want 1 (expired rotated token must not bypass refresh)", got)
		}
		if got := transport.apiCalls.Load(); got != 1 {
			t.Fatalf("apiCalls = %d, want 1 (expired access-2 must never be dispatched to Realm)", got)
		}
		transport.mu.Lock()
		lastBearer := transport.lastAPIBearer
		transport.mu.Unlock()
		if lastBearer != "Bearer access-1" {
			t.Fatalf("lastAPIBearer = %q, want Bearer access-1", lastBearer)
		}

		// Local identity must survive the offline pre-dispatch refresh deferral.
		_, afterGen, _, afterLive := svc.BindAuthenticatedRuntimeGeneration(context.Background())
		if !afterLive || afterGen != gen {
			t.Fatalf("local identity changed unexpectedly: live=%v gen=%d->%d", afterLive, gen, afterGen)
		}
		select {
		case <-fence:
			t.Fatal("local identity fence closed on offline refresh deferral")
		default:
		}
	})

	t.Run("refreshed token already expired before retry fails closed without dispatching", func(t *testing.T) {
		clock := newControllableClock(time.Date(2026, 11, 27, 13, 30, 0, 0, time.UTC))
		initial := testMaterial("acct-401-b", "access-1", "refresh-1")
		initial.RealmOrigin = "https://realm.offline.test"
		initial.AccessTokenExpires = clock.Now().Add(5 * time.Minute)
		custody := &refreshRestartProofCustody{material: initial, has: true}

		transport := &fakeRealmTransport{
			apiFn: func(req *http.Request) (*http.Response, error) {
				return jsonHTTPResponse(req, http.StatusUnauthorized, `{"statusCode":401,"message":"Unauthorized"}`), nil
			},
		}
		client := &http.Client{Transport: transport}

		var refreshCalls atomic.Int32
		refresher := funcAccountRefresher{fn: func(_ context.Context, current AccountMaterial) (AccountMaterial, error) {
			refreshCalls.Add(1)
			next := current
			next.AccessToken = "access-expired-on-arrival"
			next.RefreshToken = "refresh-2"
			next.AccessTokenExpires = clock.Now().Add(30 * time.Second)
			// Advance clock past the newly minted token expiry before retry reads it.
			clock.Advance(time.Minute)
			return next, nil
		}}

		svc := newHarnessService(t, nil,
			WithCustody(custody),
			WithCustodyPartition("offline-401-expired-refreshed"),
			WithRealmBaseURL("https://realm.offline.test"),
			WithRealmHTTPClient(client),
			WithRefresher(refresher),
			WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmDesktopShellCaller())),
			WithClock(clock.Now),
		)
		stopAccountRefreshTimer(t, svc)

		resp, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
			Caller:      realmDesktopShellCaller(),
			MethodId:    "WorldPublicController_listWorldCatalog",
			RequestJson: `{}`,
		})
		if err != nil {
			t.Fatalf("InvokeRealmUnary err = %v", err)
		}
		if resp.GetAccepted() ||
			resp.GetReasonCode() != runtimev1.ReasonCode_AUTH_TOKEN_INVALID ||
			resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_AUTH_INVALID {
			t.Fatalf("InvokeRealmUnary = %+v, want AUTH_TOKEN_INVALID/BROKER_AUTH_INVALID", resp)
		}
		if got := refreshCalls.Load(); got != 1 {
			t.Fatalf("refreshCalls = %d, want 1", got)
		}
		if got := transport.apiCalls.Load(); got != 1 {
			t.Fatalf("apiCalls = %d, want 1 (expired refreshed token must never be dispatched)", got)
		}
		transport.mu.Lock()
		lastBearer := transport.lastAPIBearer
		transport.mu.Unlock()
		if lastBearer != "Bearer access-1" {
			t.Fatalf("lastAPIBearer = %q, want Bearer access-1", lastBearer)
		}
	})
}

type errReadCloser struct {
	err error
}

func (r errReadCloser) Read([]byte) (int, error) {
	return 0, r.err
}

func (r errReadCloser) Close() error {
	return nil
}

type funcLoginExchanger struct {
	exchangeFn func(context.Context, LoginAttempt, string) (AccountMaterial, error)
}

func (f funcLoginExchanger) Exchange(ctx context.Context, attempt LoginAttempt, code string) (AccountMaterial, error) {
	return f.exchangeFn(ctx, attempt, code)
}

func (funcLoginExchanger) AuthorizationURL(attempt LoginAttempt) string {
	return staticExchanger{}.AuthorizationURL(attempt)
}

func TestRealmOAuthExchangerTransientFailureClassification(t *testing.T) {
	t.Run("client timeout wraps ErrLoginExchangeFailure and DeadlineExceeded as transient", func(t *testing.T) {
		releaseStall := make(chan struct{})
		server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
			case <-releaseStall:
			}
		}))
		defer server.Close()
		defer close(releaseStall)

		client := server.Client()
		client.Timeout = 100 * time.Millisecond
		exchanger := newRealmOAuthExchanger(resolveProductionConfig(ProductionConfig{
			RealmBaseURL: server.URL,
			HTTPClient:   client,
		}))
		_, err := exchanger.Exchange(context.Background(), LoginAttempt{
			PKCEVerifier: "pkce-verifier",
			RedirectURI:  "http://127.0.0.1:46373/oauth/callback",
		}, "auth-code")
		if err == nil {
			t.Fatal("expected timeout error from stalled /oauth/token server")
		}
		if !errors.Is(err, ErrLoginExchangeFailure) {
			t.Fatalf("timeout error must satisfy ErrLoginExchangeFailure, got %v", err)
		}
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("timeout error must preserve context.DeadlineExceeded unwrapping, got %v", err)
		}
		if !isTransientLoginExchangeFailure(err) {
			t.Fatalf("timeout error must be classified transient, got %v", err)
		}
	})

	t.Run("token response transient vs non-transient classification", func(t *testing.T) {
		if _, err := materialFromTokenResponse(nil); !errors.Is(err, ErrLoginExchangeFailure) || !isTransientLoginExchangeFailure(err) {
			t.Fatalf("nil response = %v, want transient ErrLoginExchangeFailure", err)
		}
		if _, err := materialFromTokenResponse(&http.Response{StatusCode: http.StatusOK}); !errors.Is(err, ErrLoginExchangeFailure) || !isTransientLoginExchangeFailure(err) {
			t.Fatalf("nil body = %v, want transient ErrLoginExchangeFailure", err)
		}
		readResp := &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       errReadCloser{err: io.ErrUnexpectedEOF},
		}
		if _, err := materialFromTokenResponse(readResp); !errors.Is(err, ErrLoginExchangeFailure) || !errors.Is(err, io.ErrUnexpectedEOF) || !isTransientLoginExchangeFailure(err) {
			t.Fatalf("body read error = %v, want transient ErrLoginExchangeFailure wrapping ErrUnexpectedEOF", err)
		}

		for _, statusCode := range []int{
			http.StatusRequestTimeout,
			http.StatusTooManyRequests,
			http.StatusInternalServerError,
			http.StatusBadGateway,
			http.StatusServiceUnavailable,
			http.StatusGatewayTimeout,
		} {
			resp := jsonHTTPResponse(nil, statusCode, `{"error":"temporarily_unavailable"}`)
			if _, err := materialFromTokenResponse(resp); !errors.Is(err, ErrLoginExchangeFailure) || !isTransientLoginExchangeFailure(err) {
				t.Fatalf("http %d error = %v, want transient ErrLoginExchangeFailure", statusCode, err)
			}
		}

		for _, tc := range []struct {
			name string
			resp *http.Response
		}{
			{name: "http 400", resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant"}`)},
			{name: "http 401", resp: jsonHTTPResponse(nil, http.StatusUnauthorized, `{"error":"invalid_client"}`)},
			{name: "http 403", resp: jsonHTTPResponse(nil, http.StatusForbidden, `{"error":"access_denied"}`)},
			{name: "http 422", resp: jsonHTTPResponse(nil, http.StatusUnprocessableEntity, `{"error":"invalid_request"}`)},
			{
				name: "bad content-type",
				resp: &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": []string{"text/plain"}},
					Body:       io.NopCloser(strings.NewReader(`{}`)),
				},
			},
			{
				name: "oversized body",
				resp: jsonHTTPResponse(nil, http.StatusOK, strings.Repeat("a", (1<<20)+16)),
			},
			{name: "malformed json", resp: jsonHTTPResponse(nil, http.StatusOK, `{not-json`)},
			{name: "missing required fields", resp: jsonHTTPResponse(nil, http.StatusOK, `{"access_token":"only-access","token_type":"Bearer","expires_in":300}`)},
		} {
			if _, err := materialFromTokenResponse(tc.resp); !errors.Is(err, ErrLoginExchangeFailure) || isTransientLoginExchangeFailure(err) {
				t.Fatalf("%s error = %v, want non-transient ErrLoginExchangeFailure", tc.name, err)
			}
		}

		if isTransientLoginExchangeFailure(ErrInertNotActivated) ||
			isTransientLoginExchangeFailure(newTransientLoginExchangeFailure(ErrInertNotActivated)) {
			t.Fatal("ErrInertNotActivated must never be classified transient")
		}
	})
}

func TestTransientOnlineReauthFailurePreservesLocalIdentityAndRecoversOnRetry(t *testing.T) {
	cases := []struct {
		name string
		mode string
	}{
		{name: "production-oauth-token-timeout", mode: "timeout"},
		{name: "production-oauth-token-503", mode: "503"},
		{name: "custom-exchanger-deadline-exceeded", mode: "custom-deadline"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clock := newControllableClock(time.Now().UTC())
			secrets := newAccountBinarySecretStore()
			custody, err := NewProtectedBinaryCustody(secrets)
			if err != nil {
				t.Fatal(err)
			}

			var (
				mu            sync.Mutex
				tokenMode     = tc.mode
				lastAPIBearer string
			)
			var (
				tokenCalls   atomic.Int32
				refreshCalls atomic.Int32
				apiCalls     atomic.Int32
			)
			releaseStall := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case realmv1.RefreshTokenOperation.Path():
					refreshCalls.Add(1)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte(`{"statusCode":503,"message":"Unavailable","reasonCode":"AUTH_TOKEN_VERIFICATION_UNAVAILABLE","traceId":"trace-503"}`))
				case realmv1.OauthTokenOperation.Path():
					tokenCalls.Add(1)
					mu.Lock()
					currentMode := tokenMode
					mu.Unlock()
					switch currentMode {
					case "timeout":
						select {
						case <-r.Context().Done():
						case <-releaseStall:
						}
						return
					case "503":
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusServiceUnavailable)
						_, _ = w.Write([]byte(`{"statusCode":503,"message":"Token exchange unavailable"}`))
						return
					default:
						w.Header().Set("Content-Type", "application/json")
						_, _ = w.Write([]byte(`{"access_token":"access-recovered","refresh_token":"refresh-recovered","token_type":"Bearer","expires_in":600,"account_id":"acct-d5","display_name":"Nimi User","realm_environment_id":"realm-local"}`))
						return
					}
				case "/api/human/me":
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"id":"acct-d5","handle":"d5_user","displayName":"Nimi User","avatarUrl":null}`))
				default:
					apiCalls.Add(1)
					mu.Lock()
					lastAPIBearer = r.Header.Get("Authorization")
					mu.Unlock()
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`[{"id":"world-1"}]`))
				}
			}))
			defer server.Close()
			defer close(releaseStall)

			partition := "d5-reauth-" + tc.name
			initial := testMaterial("acct-d5", "access-initial", "refresh-initial")
			initial.RealmOrigin = server.URL
			initial.CurrentUserHandle = "d5_user"
			initial.AccessTokenExpires = clock.Now().Add(-5 * time.Minute)
			if err := custody.Store(context.Background(), partition, initial); err != nil {
				t.Fatal(err)
			}

			newService := func(exchanger LoginExchanger, httpClient *http.Client) *Service {
				cfg := resolveProductionConfig(ProductionConfig{
					RealmBaseURL: server.URL,
					HTTPClient:   httpClient,
				})
				if exchanger == nil {
					exchanger = newRealmOAuthExchanger(cfg)
				}
				refresher := newRealmTokenRefresher(cfg)
				refresher.now = clock.Now
				svc := newHarnessService(t, nil,
					WithProductionActivation(),
					WithCustody(custody),
					WithCustodyPartition(partition),
					WithRealmBaseURL(server.URL),
					WithRealmRealtimeURL("wss://realm.d5.test/realtime"),
					WithRealmHTTPClient(httpClient),
					WithLoginExchanger(exchanger),
					WithRefresher(refresher),
					WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmDesktopShellCaller())),
					WithClock(clock.Now),
					func(s *Service) {
						s.primarySecrets = newAccountBinarySecretStore()
						s.primaryKeyScope = "install-d5\x00os-user"
					},
				)
				stopAccountRefreshTimer(t, svc)
				return svc
			}

			// Step 1: Logged-in device triggers ambiguous refresh (HTTP 503).
			svc := newService(nil, server.Client())
			firstUnary, err := svc.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:      realmDesktopShellCaller(),
				MethodId:    "WorldPublicController_listWorldCatalog",
				RequestJson: `{}`,
			})
			if err != nil || firstUnary.GetAccepted() ||
				firstUnary.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
				t.Fatalf("ambiguous refresh setup = (%+v, %v)", firstUnary, err)
			}

			// Step 2: Cold restart keeps local identity live and blocks online calls.
			reauthHTTPClient := server.Client()
			if tc.mode == "timeout" {
				reauthHTTPClient.Timeout = 200 * time.Millisecond
			}
			var customExchanger LoginExchanger
			if tc.mode == "custom-deadline" {
				customExchanger = funcLoginExchanger{
					exchangeFn: func(context.Context, LoginAttempt, string) (AccountMaterial, error) {
						mu.Lock()
						currentMode := tokenMode
						mu.Unlock()
						if currentMode == "custom-deadline" {
							return AccountMaterial{}, context.DeadlineExceeded
						}
						recovered := testMaterial("acct-d5", "access-recovered", "refresh-recovered")
						recovered.RealmOrigin = server.URL
						recovered.CurrentUserHandle = "d5_user"
						recovered.AccessTokenExpires = clock.Now().Add(10 * time.Minute)
						return recovered, nil
					},
				}
			}
			restarted := newService(customExchanger, reauthHTTPClient)
			restartProj, restartGen, restartFence, restartLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
			if !restartLive || restartGen == 0 || restartFence == nil || restartProj.GetAccountId() != "acct-d5" {
				t.Fatalf("post-restart local identity = (%+v, %d, %v, %v)", restartProj, restartGen, restartFence, restartLive)
			}
			restartStatus, err := restarted.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
			if err != nil || !restartStatus.GetAccepted() ||
				restartStatus.GetSnapshot().GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
				restartStatus.GetSnapshot().GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
				t.Fatalf("post-restart status = (%+v, %v)", restartStatus, err)
			}
			restartRevision := restartStatus.GetSnapshot().GetAuthorizationRevision()
			if strings.TrimSpace(restartRevision) == "" {
				t.Fatal("post-restart authorization_revision is empty")
			}

			// Step 3: User attempts online reauth (BeginLogin -> valid CompleteLogin), which hits transient exchange failure.
			beginFailed, err := restarted.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
				Caller:      desktopAccountControlCaller(),
				RedirectUri: "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || !beginFailed.GetAccepted() {
				t.Fatalf("BeginLogin during ambiguous state = (%+v, %v)", beginFailed, err)
			}
			completeFailed, err := restarted.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
				Caller:         desktopAccountControlCaller(),
				LoginAttemptId: beginFailed.GetLoginAttemptId(),
				Code:           "auth-code-transient-fail",
				State:          beginFailed.GetState(),
				Nonce:          beginFailed.GetNonce(),
				RedirectUri:    "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil {
				t.Fatalf("CompleteLogin transient failure returned error: %v", err)
			}
			if completeFailed.GetAccepted() ||
				completeFailed.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
				completeFailed.GetReasonCode() != runtimev1.ReasonCode_REALM_UNAVAILABLE ||
				completeFailed.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE {
				t.Fatalf("CompleteLogin transient failure = %+v, want Accepted=false State=AUTHENTICATED ReasonCode=REALM_UNAVAILABLE AccountReasonCode=LOGIN_EXCHANGE_UNAVAILABLE", completeFailed)
			}
			if tc.mode != "custom-deadline" && tokenCalls.Load() != 1 {
				t.Fatalf("expected 1 /oauth/token call, got %d", tokenCalls.Load())
			}

			// Surviving trusted local identity, generation, fence, authorization_revision, and online-cleared custody must all remain intact.
			afterProj, afterGen, afterFence, afterLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
			if !afterLive || afterProj.GetAccountId() != "acct-d5" || afterGen != restartGen || afterFence != restartFence {
				t.Fatalf("transient reauth failure disrupted local identity: proj=%+v gen=%d(want %d) live=%v", afterProj, afterGen, restartGen, afterLive)
			}
			select {
			case <-restartFence:
				t.Fatal("transient reauth failure closed surviving local execution fence")
			default:
			}
			committed, commitErr := restarted.CommitAuthenticatedRuntimeGeneration(context.Background(), afterProj.GetAccountId(), afterProj.GetRealmEnvironmentId(), afterGen, func() error {
				return nil
			})
			if !committed || commitErr != nil {
				t.Fatalf("local commit failed after transient reauth failure: committed=%v err=%v", committed, commitErr)
			}
			afterStatus, err := restarted.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
			if err != nil || !afterStatus.GetAccepted() {
				t.Fatalf("GetAccountSessionStatus after transient failure = (%+v, %v)", afterStatus, err)
			}
			afterSnap := afterStatus.GetSnapshot()
			if afterSnap.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
				afterSnap.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS ||
				afterSnap.GetAuthorizationRevision() != restartRevision ||
				afterSnap.GetAccountProjection().GetAccountId() != "acct-d5" {
				t.Fatalf("status after transient failure = %+v, want AUTHENTICATED + REFRESH_OUTCOME_AMBIGUOUS + revision %q", afterSnap, restartRevision)
			}
			stored, loadErr := custody.Load(context.Background(), partition)
			if loadErr != nil || !stored.OnlineCredentialsCleared || stored.AccountID != "acct-d5" ||
				stored.AccessToken != "" || stored.RefreshToken != "" || !stored.AccessTokenExpires.IsZero() {
				t.Fatalf("durable custody after transient failure = (%+v, %v), want intact OnlineCredentialsCleared", stored, loadErr)
			}
			restarted.mu.RLock()
			timer := restarted.refreshTimer
			restarted.mu.RUnlock()
			if timer != nil {
				t.Fatal("refresh timer must remain stopped while online credentials are cleared")
			}

			// Online and protected remote calls must remain blocked after the failed reauth attempt.
			beforeAPIs := apiCalls.Load()
			blockedUnary, err := restarted.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:      realmDesktopShellCaller(),
				MethodId:    "WorldPublicController_listWorldCatalog",
				RequestJson: `{}`,
			})
			if err != nil || blockedUnary.GetAccepted() ||
				blockedUnary.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
				t.Fatalf("online Realm call after transient reauth failure = (%+v, %v)", blockedUnary, err)
			}
			if _, err := restarted.BindPrimaryRuntimeControl(context.Background()); status.Code(err) != codes.Unauthenticated {
				t.Fatalf("BindPrimaryRuntimeControl after transient reauth failure = %v, want Unauthenticated", err)
			}
			if _, _, selected := restarted.RemoteAccessSettingsOwner(); selected {
				t.Fatal("RemoteAccessSettingsOwner must remain false while online credentials are cleared")
			}
			if apiCalls.Load() != beforeAPIs {
				t.Fatalf("blocked online calls reached Realm API: before=%d after=%d", beforeAPIs, apiCalls.Load())
			}

			// Replaying the consumed failed attempt must fail closed as PROOF_CONSUMED without clearing local identity.
			replayed, err := restarted.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
				Caller:         desktopAccountControlCaller(),
				LoginAttemptId: beginFailed.GetLoginAttemptId(),
				Code:           "auth-code-transient-fail",
				State:          beginFailed.GetState(),
				Nonce:          beginFailed.GetNonce(),
				RedirectUri:    "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || replayed.GetAccepted() ||
				replayed.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_CONSUMED ||
				replayed.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
				t.Fatalf("replayed consumed attempt = (%+v, %v)", replayed, err)
			}

			// Step 4: Realm recovers; subsequent BeginLogin + CompleteLogin succeeds and restores online calls without disturbing local identity.
			mu.Lock()
			tokenMode = "ok"
			mu.Unlock()

			beginRetry, err := restarted.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
				Caller:      desktopAccountControlCaller(),
				RedirectUri: "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || !beginRetry.GetAccepted() || beginRetry.GetLoginAttemptId() == beginFailed.GetLoginAttemptId() {
				t.Fatalf("retry BeginLogin = (%+v, %v)", beginRetry, err)
			}
			completeRetry, err := restarted.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
				Caller:         desktopAccountControlCaller(),
				LoginAttemptId: beginRetry.GetLoginAttemptId(),
				Code:           "auth-code-recovered",
				State:          beginRetry.GetState(),
				Nonce:          beginRetry.GetNonce(),
				RedirectUri:    "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || !completeRetry.GetAccepted() ||
				completeRetry.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
				completeRetry.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED ||
				completeRetry.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
				t.Fatalf("retry CompleteLogin = (%+v, %v)", completeRetry, err)
			}
			_, recoveredGen, recoveredFence, recoveredLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
			if !recoveredLive || recoveredGen != restartGen || recoveredFence != restartFence {
				t.Fatalf("same-account recovery disrupted local generation/fence: gen=%d want=%d live=%v", recoveredGen, restartGen, recoveredLive)
			}
			recoveredStatus, _ := restarted.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
			if recoveredStatus.GetSnapshot().GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
				recoveredStatus.GetSnapshot().GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED ||
				recoveredStatus.GetSnapshot().GetAuthorizationRevision() != restartRevision {
				t.Fatalf("recovered status = %+v, want AUTHENTICATED + ACTION_EXECUTED + revision %q", recoveredStatus.GetSnapshot(), restartRevision)
			}
			recoveredCustody, loadErr := custody.Load(context.Background(), partition)
			if loadErr != nil || recoveredCustody.OnlineCredentialsCleared ||
				recoveredCustody.AccessToken != "access-recovered" || recoveredCustody.RefreshToken != "refresh-recovered" {
				t.Fatalf("recovered durable custody = (%+v, %v)", recoveredCustody, loadErr)
			}
			if _, _, selected := restarted.RemoteAccessSettingsOwner(); !selected {
				t.Fatal("RemoteAccessSettingsOwner remained false after successful recovery")
			}
			onlineUnary, err := restarted.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:      realmDesktopShellCaller(),
				MethodId:    "WorldPublicController_listWorldCatalog",
				RequestJson: `{}`,
			})
			if err != nil || !onlineUnary.GetAccepted() || onlineUnary.GetResponseJson() != `[{"id":"world-1"}]` {
				t.Fatalf("online Realm call after recovery = (%+v, %v)", onlineUnary, err)
			}
			mu.Lock()
			bearer := lastAPIBearer
			mu.Unlock()
			if bearer != "Bearer access-recovered" {
				t.Fatalf("online Realm call bearer after recovery = %q, want Bearer access-recovered", bearer)
			}
		})
	}
}

func TestPostRestartAmbiguousOnlineReauthFailsClosedOnNonTransientRejectionAndInvalidCallback(t *testing.T) {
	cases := []struct {
		name              string
		tokenStatus       int
		callbackRefresh   string
		wantAccountReason runtimev1.AccountReasonCode
	}{
		{
			name:              "oauth-token-401",
			tokenStatus:       http.StatusUnauthorized,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE,
		},
		{
			name:              "oauth-token-403",
			tokenStatus:       http.StatusForbidden,
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE,
		},
		{
			name:              "invalid-callback-refresh-token",
			tokenStatus:       http.StatusOK,
			callbackRefresh:   "forbidden-callback-refresh-token",
			wantAccountReason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_UNSUPPORTED,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clock := newControllableClock(time.Date(2026, 11, 27, 17, 0, 0, 0, time.UTC))
			secrets := newAccountBinarySecretStore()
			custody, err := NewProtectedBinaryCustody(secrets)
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case realmv1.RefreshTokenOperation.Path():
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte(`{"statusCode":503,"message":"Unavailable","reasonCode":"AUTH_TOKEN_VERIFICATION_UNAVAILABLE","traceId":"trace-503"}`))
				case realmv1.OauthTokenOperation.Path():
					w.WriteHeader(tc.tokenStatus)
					_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()

			partition := "d5-fail-closed-" + tc.name
			initial := testMaterial("acct-d5-fc", "access-initial", "refresh-initial")
			initial.RealmOrigin = server.URL
			initial.AccessTokenExpires = clock.Now().Add(-5 * time.Minute)
			if err := custody.Store(context.Background(), partition, initial); err != nil {
				t.Fatal(err)
			}

			newService := func() *Service {
				cfg := resolveProductionConfig(ProductionConfig{
					RealmBaseURL: server.URL,
					HTTPClient:   server.Client(),
				})
				refresher := newRealmTokenRefresher(cfg)
				refresher.now = clock.Now
				svc := newHarnessService(t, nil,
					WithProductionActivation(),
					WithCustody(custody),
					WithCustodyPartition(partition),
					WithRealmBaseURL(server.URL),
					WithRealmHTTPClient(server.Client()),
					WithLoginExchanger(newRealmOAuthExchanger(cfg)),
					WithRefresher(refresher),
					WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmDesktopShellCaller())),
					WithClock(clock.Now),
				)
				stopAccountRefreshTimer(t, svc)
				return svc
			}

			// Enter ambiguous refresh state and cold restart.
			svc := newService()
			if res, rErr := svc.refreshAccountSessionInternal(context.Background(), true); rErr != nil || res.accepted ||
				res.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
				t.Fatalf("setup ambiguous state = (%+v, %v)", res, rErr)
			}
			restarted := newService()
			_, restartGen, restartFence, restartLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
			if !restartLive {
				t.Fatal("post-restart ambiguous state did not preserve local identity")
			}

			begin, err := restarted.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
				Caller:      desktopAccountControlCaller(),
				RedirectUri: "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || !begin.GetAccepted() {
				t.Fatalf("BeginLogin = (%+v, %v)", begin, err)
			}
			complete, err := restarted.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
				Caller:         desktopAccountControlCaller(),
				LoginAttemptId: begin.GetLoginAttemptId(),
				Code:           "auth-code-rejected",
				RefreshToken:   tc.callbackRefresh,
				State:          begin.GetState(),
				Nonce:          begin.GetNonce(),
				RedirectUri:    "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || complete.GetAccepted() ||
				complete.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED ||
				complete.GetAccountReasonCode() != tc.wantAccountReason {
				t.Fatalf("%s CompleteLogin = (%+v, %v), want REAUTH_REQUIRED + %v", tc.name, complete, err, tc.wantAccountReason)
			}

			select {
			case <-restartFence:
			default:
				t.Fatalf("%s did not close local execution fence", tc.name)
			}
			if proj, afterGen, _, afterLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background()); afterLive || proj != nil || afterGen <= restartGen {
				t.Fatalf("%s left local identity live: proj=%+v gen=%d live=%v", tc.name, proj, afterGen, afterLive)
			}
			statusResp, _ := restarted.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
			if statusResp.GetSnapshot().GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED ||
				statusResp.GetSnapshot().GetAuthorizationRevision() != "" ||
				statusResp.GetSnapshot().GetAccountProjection() != nil {
				t.Fatalf("%s status snapshot = %+v", tc.name, statusResp.GetSnapshot())
			}
			if _, loadErr := custody.Load(context.Background(), partition); !errors.Is(loadErr, ErrNoStoredAccount) {
				t.Fatalf("%s retained durable custody: err=%v", tc.name, loadErr)
			}
		})
	}
}

func TestRealmOAuthExchangerRetryableOAuthGrantClassification(t *testing.T) {
	retryableCases := []struct {
		name string
		resp *http.Response
	}{
		{
			name: "minimal RFC6749 invalid_grant",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant"}`),
		},
		{
			name: "RFC6749 invalid_grant with description",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant","error_description":"Authorization code expired"}`),
		},
		{
			name: "Realm OAuthErrorResponseDto AUTH_INVALID_OAUTH_CREDENTIAL",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant","error_description":"Code expired","statusCode":400,"message":"Authorization code expired","reasonCode":"AUTH_INVALID_OAUTH_CREDENTIAL","traceId":"trace-1"}`),
		},
		{
			name: "Realm OAuthErrorResponseDto AUTH_TOKEN_EXPIRED",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant","statusCode":400,"message":"Code expired","reasonCode":"AUTH_TOKEN_EXPIRED","traceId":"trace-2"}`),
		},
		{
			name: "Realm OAuthErrorResponseDto AUTH_INVALID_REQUEST",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant","statusCode":400,"message":"Invalid grant","reasonCode":"AUTH_INVALID_REQUEST","traceId":"trace-3"}`),
		},
	}
	for _, tc := range retryableCases {
		t.Run("retryable/"+tc.name, func(t *testing.T) {
			_, err := materialFromTokenResponse(tc.resp)
			if !errors.Is(err, ErrLoginExchangeFailure) || isTransientLoginExchangeFailure(err) || !isRetryableOAuthGrantFailure(err) {
				t.Fatalf("%s error = %v, want non-transient retryable OAuth grant ErrLoginExchangeFailure", tc.name, err)
			}
		})
	}

	nonRetryableCases := []struct {
		name string
		resp *http.Response
	}{
		{
			name: "http 400 AUTH_ACCOUNT_RESTRICTED",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant","statusCode":400,"message":"Restricted","reasonCode":"AUTH_ACCOUNT_RESTRICTED","traceId":"trace-r1"}`),
		},
		{
			name: "http 400 ACCOUNT_DELETED",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant","statusCode":400,"message":"Deleted","reasonCode":"ACCOUNT_DELETED","operation_id":"op-1","deleted_at":"2026-11-27T12:00:00Z","traceId":"trace-r2"}`),
		},
		{
			name: "http 400 AUTH_SESSION_REVOKED",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant","statusCode":400,"message":"Revoked","reasonCode":"AUTH_SESSION_REVOKED","traceId":"trace-r3"}`),
		},
		{
			name: "http 400 AUTH_ACCOUNT_NOT_FOUND",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant","statusCode":400,"message":"Not found","reasonCode":"AUTH_ACCOUNT_NOT_FOUND","traceId":"trace-r4"}`),
		},
		{
			name: "http 400 AUTH_INVALID_CREDENTIALS",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant","statusCode":400,"message":"Invalid credentials","reasonCode":"AUTH_INVALID_CREDENTIALS","traceId":"trace-r5"}`),
		},
		{
			name: "http 400 invalid_request error code",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_request","statusCode":400,"message":"Bad request","reasonCode":"AUTH_INVALID_REQUEST","traceId":"trace-r6"}`),
		},
		{
			name: "http 400 mismatched statusCode",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant","statusCode":401,"message":"Mismatch","traceId":"trace-r7"}`),
		},
		{
			name: "http 400 malformed json",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{not-json`),
		},
		{
			name: "http 400 unknown json field",
			resp: jsonHTTPResponse(nil, http.StatusBadRequest, `{"error":"invalid_grant","unexpected":true}`),
		},
		{
			name: "http 400 non-json content type",
			resp: &http.Response{
				StatusCode: http.StatusBadRequest,
				Header:     http.Header{"Content-Type": []string{"text/plain"}},
				Body:       io.NopCloser(strings.NewReader(`{"error":"invalid_grant"}`)),
			},
		},
		{
			name: "http 401 with invalid_grant",
			resp: jsonHTTPResponse(nil, http.StatusUnauthorized, `{"error":"invalid_grant"}`),
		},
		{
			name: "http 403 with invalid_grant",
			resp: jsonHTTPResponse(nil, http.StatusForbidden, `{"error":"invalid_grant"}`),
		},
	}
	for _, tc := range nonRetryableCases {
		t.Run("fail-closed/"+tc.name, func(t *testing.T) {
			_, err := materialFromTokenResponse(tc.resp)
			if !errors.Is(err, ErrLoginExchangeFailure) || isTransientLoginExchangeFailure(err) || isRetryableOAuthGrantFailure(err) {
				t.Fatalf("%s error = %v, want non-transient non-retryable ErrLoginExchangeFailure", tc.name, err)
			}
		})
	}
	if isRetryableOAuthGrantFailure(ErrInertNotActivated) ||
		isRetryableOAuthGrantFailure(newRetryableOAuthGrantFailure(ErrInertNotActivated)) {
		t.Fatal("ErrInertNotActivated must never be classified as retryable OAuth grant failure")
	}
}

func TestOnlineReauthInvalidGrantPreservesLocalIdentityAndRecoversOnRetry(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{
			name: "plain-rfc6749-invalid-grant",
			body: `{"error":"invalid_grant","error_description":"Authorization code expired"}`,
		},
		{
			name: "realm-oauth-error-dto-invalid-oauth-credential",
			body: `{"error":"invalid_grant","error_description":"Authorization code expired","statusCode":400,"message":"Authorization code expired","reasonCode":"AUTH_INVALID_OAUTH_CREDENTIAL","traceId":"trace-ig-1"}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clock := newControllableClock(time.Now().UTC())
			secrets := newAccountBinarySecretStore()
			custody, err := NewProtectedBinaryCustody(secrets)
			if err != nil {
				t.Fatal(err)
			}

			var (
				mu            sync.Mutex
				failNextToken = true
				lastAPIBearer string
			)
			var (
				tokenCalls atomic.Int32
				apiCalls   atomic.Int32
			)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case realmv1.RefreshTokenOperation.Path():
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte(`{"statusCode":503,"message":"Unavailable","reasonCode":"AUTH_TOKEN_VERIFICATION_UNAVAILABLE","traceId":"trace-503"}`))
				case realmv1.OauthTokenOperation.Path():
					tokenCalls.Add(1)
					mu.Lock()
					shouldFail := failNextToken
					mu.Unlock()
					if shouldFail {
						w.WriteHeader(http.StatusBadRequest)
						_, _ = w.Write([]byte(tc.body))
						return
					}
					_, _ = w.Write([]byte(`{"access_token":"access-ig-recovered","refresh_token":"refresh-ig-recovered","token_type":"Bearer","expires_in":600,"account_id":"acct-ig","display_name":"Nimi User","realm_environment_id":"realm-local"}`))
				case "/api/human/me":
					_, _ = w.Write([]byte(`{"id":"acct-ig","handle":"ig_user","displayName":"Nimi User","avatarUrl":null}`))
				default:
					apiCalls.Add(1)
					mu.Lock()
					lastAPIBearer = r.Header.Get("Authorization")
					mu.Unlock()
					_, _ = w.Write([]byte(`[{"id":"world-1"}]`))
				}
			}))
			defer server.Close()

			partition := "ig-reauth-" + tc.name
			initial := testMaterial("acct-ig", "access-initial", "refresh-initial")
			initial.RealmOrigin = server.URL
			initial.CurrentUserHandle = "ig_user"
			initial.AccessTokenExpires = clock.Now().Add(-5 * time.Minute)
			if err := custody.Store(context.Background(), partition, initial); err != nil {
				t.Fatal(err)
			}

			newService := func() *Service {
				cfg := resolveProductionConfig(ProductionConfig{
					RealmBaseURL: server.URL,
					HTTPClient:   server.Client(),
				})
				refresher := newRealmTokenRefresher(cfg)
				refresher.now = clock.Now
				svc := newHarnessService(t, nil,
					WithProductionActivation(),
					WithCustody(custody),
					WithCustodyPartition(partition),
					WithRealmBaseURL(server.URL),
					WithRealmHTTPClient(server.Client()),
					WithLoginExchanger(newRealmOAuthExchanger(cfg)),
					WithRefresher(refresher),
					WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmDesktopShellCaller())),
					WithClock(clock.Now),
				)
				stopAccountRefreshTimer(t, svc)
				return svc
			}

			svc := newService()
			if res, rErr := svc.refreshAccountSessionInternal(context.Background(), true); rErr != nil || res.accepted ||
				res.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
				t.Fatalf("ambiguous refresh setup = (%+v, %v)", res, rErr)
			}
			restarted := newService()
			restartProj, restartGen, restartFence, restartLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
			if !restartLive || restartProj.GetAccountId() != "acct-ig" {
				t.Fatalf("post-restart local identity = (%+v, %d, %v)", restartProj, restartGen, restartLive)
			}
			restartStatus, _ := restarted.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
			restartRevision := restartStatus.GetSnapshot().GetAuthorizationRevision()

			// Step 1: Online re-auth hits HTTP 400 invalid_grant -> reject attempt WITHOUT invalidating local login.
			beginFailed, err := restarted.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
				Caller:      desktopAccountControlCaller(),
				RedirectUri: "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || !beginFailed.GetAccepted() {
				t.Fatalf("BeginLogin = (%+v, %v)", beginFailed, err)
			}
			completeFailed, err := restarted.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
				Caller:         desktopAccountControlCaller(),
				LoginAttemptId: beginFailed.GetLoginAttemptId(),
				Code:           "expired-auth-code",
				State:          beginFailed.GetState(),
				Nonce:          beginFailed.GetNonce(),
				RedirectUri:    "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || completeFailed.GetAccepted() ||
				completeFailed.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
				completeFailed.GetReasonCode() != runtimev1.ReasonCode_AUTH_TOKEN_INVALID ||
				completeFailed.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE {
				t.Fatalf("CompleteLogin invalid_grant = (%+v, %v), want Accepted=false State=AUTHENTICATED ReasonCode=AUTH_TOKEN_INVALID AccountReasonCode=LOGIN_EXCHANGE_UNAVAILABLE", completeFailed, err)
			}
			if tokenCalls.Load() != 1 {
				t.Fatalf("tokenCalls = %d, want 1", tokenCalls.Load())
			}

			// Local login, generation, open fence, authorization_revision, and online-cleared custody stay intact.
			afterProj, afterGen, afterFence, afterLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
			if !afterLive || afterProj.GetAccountId() != "acct-ig" || afterGen != restartGen || afterFence != restartFence {
				t.Fatalf("invalid_grant disrupted local identity: proj=%+v gen=%d(want %d) live=%v", afterProj, afterGen, restartGen, afterLive)
			}
			select {
			case <-restartFence:
				t.Fatal("invalid_grant closed surviving local execution fence")
			default:
			}
			afterStatus, _ := restarted.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
			if afterStatus.GetSnapshot().GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
				afterStatus.GetSnapshot().GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS ||
				afterStatus.GetSnapshot().GetAuthorizationRevision() != restartRevision {
				t.Fatalf("status after invalid_grant = %+v, want AUTHENTICATED + REFRESH_OUTCOME_AMBIGUOUS + revision %q", afterStatus.GetSnapshot(), restartRevision)
			}
			stored, loadErr := custody.Load(context.Background(), partition)
			if loadErr != nil || !stored.OnlineCredentialsCleared || stored.AccountID != "acct-ig" {
				t.Fatalf("durable custody after invalid_grant = (%+v, %v)", stored, loadErr)
			}
			blockedUnary, err := restarted.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:      realmDesktopShellCaller(),
				MethodId:    "WorldPublicController_listWorldCatalog",
				RequestJson: `{}`,
			})
			if err != nil || blockedUnary.GetAccepted() ||
				blockedUnary.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS ||
				apiCalls.Load() != 0 {
				t.Fatalf("online Realm call after invalid_grant = (%+v, %v) apiCalls=%d", blockedUnary, err, apiCalls.Load())
			}

			// Replaying consumed attempt fails closed as PROOF_CONSUMED without disturbing local login.
			replayed, err := restarted.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
				Caller:         desktopAccountControlCaller(),
				LoginAttemptId: beginFailed.GetLoginAttemptId(),
				Code:           "expired-auth-code",
				State:          beginFailed.GetState(),
				Nonce:          beginFailed.GetNonce(),
				RedirectUri:    "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || replayed.GetAccepted() ||
				replayed.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_CONSUMED ||
				replayed.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
				t.Fatalf("replayed consumed attempt = (%+v, %v)", replayed, err)
			}

			// Step 2: Retry with a fresh code succeeds and restores online calls on the same local generation.
			mu.Lock()
			failNextToken = false
			mu.Unlock()
			beginRetry, err := restarted.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
				Caller:      desktopAccountControlCaller(),
				RedirectUri: "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || !beginRetry.GetAccepted() || beginRetry.GetLoginAttemptId() == beginFailed.GetLoginAttemptId() {
				t.Fatalf("retry BeginLogin = (%+v, %v)", beginRetry, err)
			}
			completeRetry, err := restarted.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
				Caller:         desktopAccountControlCaller(),
				LoginAttemptId: beginRetry.GetLoginAttemptId(),
				Code:           "fresh-auth-code",
				State:          beginRetry.GetState(),
				Nonce:          beginRetry.GetNonce(),
				RedirectUri:    "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || !completeRetry.GetAccepted() || completeRetry.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
				t.Fatalf("retry CompleteLogin = (%+v, %v)", completeRetry, err)
			}
			_, recoveredGen, recoveredFence, recoveredLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
			if !recoveredLive || recoveredGen != restartGen || recoveredFence != restartFence {
				t.Fatalf("recovery disrupted local identity: gen=%d(want %d) live=%v", recoveredGen, restartGen, recoveredLive)
			}
			onlineUnary, err := restarted.InvokeRealmUnary(context.Background(), &runtimev1.InvokeRealmUnaryRequest{
				Caller:      realmDesktopShellCaller(),
				MethodId:    "WorldPublicController_listWorldCatalog",
				RequestJson: `{}`,
			})
			if err != nil || !onlineUnary.GetAccepted() || onlineUnary.GetResponseJson() != `[{"id":"world-1"}]` {
				t.Fatalf("online Realm call after recovery = (%+v, %v)", onlineUnary, err)
			}
			mu.Lock()
			bearer := lastAPIBearer
			mu.Unlock()
			if bearer != "Bearer access-ig-recovered" {
				t.Fatalf("bearer after recovery = %q, want Bearer access-ig-recovered", bearer)
			}

			// Step 3: When !onlineReauthPending (fresh initial login), HTTP 400 invalid_grant keeps existing fail-closed behavior.
			mu.Lock()
			failNextToken = true
			mu.Unlock()
			anonCustody := &memoryCustody{}
			anonCfg := resolveProductionConfig(ProductionConfig{RealmBaseURL: server.URL, HTTPClient: server.Client()})
			anonSvc := newProductionHarnessService(t, anonCustody, WithLoginExchanger(newRealmOAuthExchanger(anonCfg)))
			anonBegin, err := anonSvc.BeginLogin(desktopAccountControlContext(t), &runtimev1.BeginLoginRequest{
				Caller:      desktopAccountControlCaller(),
				RedirectUri: "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || !anonBegin.GetAccepted() {
				t.Fatalf("initial BeginLogin = (%+v, %v)", anonBegin, err)
			}
			anonComplete, err := anonSvc.CompleteLogin(desktopAccountControlContext(t), &runtimev1.CompleteLoginRequest{
				Caller:         desktopAccountControlCaller(),
				LoginAttemptId: anonBegin.GetLoginAttemptId(),
				Code:           "expired-initial-code",
				State:          anonBegin.GetState(),
				Nonce:          anonBegin.GetNonce(),
				RedirectUri:    "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || anonComplete.GetAccepted() ||
				anonComplete.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED ||
				anonComplete.GetReasonCode() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED ||
				anonComplete.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE {
				t.Fatalf("initial login invalid_grant = (%+v, %v), want REAUTH_REQUIRED + PRINCIPAL_UNAUTHORIZED + LOGIN_EXCHANGE_UNAVAILABLE", anonComplete, err)
			}
		})
	}
}

func TestOnlineReauthConfirmedRevocationAndMalformedPayloadClearLocalIdentity(t *testing.T) {
	cases := []struct {
		name        string
		statusCode  int
		contentType string
		body        string
	}{
		{
			name:        "http-400-AUTH_ACCOUNT_RESTRICTED",
			statusCode:  http.StatusBadRequest,
			contentType: "application/json",
			body:        `{"error":"invalid_grant","statusCode":400,"message":"Account restricted","reasonCode":"AUTH_ACCOUNT_RESTRICTED","traceId":"trace-restricted"}`,
		},
		{
			name:        "http-400-ACCOUNT_DELETED",
			statusCode:  http.StatusBadRequest,
			contentType: "application/json",
			body:        `{"error":"invalid_grant","statusCode":400,"message":"Account deleted","reasonCode":"ACCOUNT_DELETED","operation_id":"op-del-1","deleted_at":"2026-11-27T12:00:00Z","traceId":"trace-deleted"}`,
		},
		{
			name:        "http-400-AUTH_SESSION_REVOKED",
			statusCode:  http.StatusBadRequest,
			contentType: "application/json",
			body:        `{"error":"invalid_grant","statusCode":400,"message":"Session revoked","reasonCode":"AUTH_SESSION_REVOKED","traceId":"trace-revoked"}`,
		},
		{
			name:        "http-400-AUTH_ACCOUNT_NOT_FOUND",
			statusCode:  http.StatusBadRequest,
			contentType: "application/json",
			body:        `{"error":"invalid_grant","statusCode":400,"message":"Account not found","reasonCode":"AUTH_ACCOUNT_NOT_FOUND","traceId":"trace-notfound"}`,
		},
		{
			name:        "http-400-AUTH_INVALID_CREDENTIALS",
			statusCode:  http.StatusBadRequest,
			contentType: "application/json",
			body:        `{"error":"invalid_grant","statusCode":400,"message":"Invalid credentials","reasonCode":"AUTH_INVALID_CREDENTIALS","traceId":"trace-invcred"}`,
		},
		{
			name:        "http-401-AUTH_SESSION_REVOKED",
			statusCode:  http.StatusUnauthorized,
			contentType: "application/json",
			body:        `{"statusCode":401,"message":"Session revoked","reasonCode":"AUTH_SESSION_REVOKED","traceId":"trace-401"}`,
		},
		{
			name:        "http-403-AUTH_ACCOUNT_RESTRICTED",
			statusCode:  http.StatusForbidden,
			contentType: "application/json",
			body:        `{"statusCode":403,"message":"Account restricted","reasonCode":"AUTH_ACCOUNT_RESTRICTED","traceId":"trace-403"}`,
		},
		{
			name:        "http-400-malformed-json",
			statusCode:  http.StatusBadRequest,
			contentType: "application/json",
			body:        `{not-valid-json`,
		},
		{
			name:        "http-400-non-json-content-type",
			statusCode:  http.StatusBadRequest,
			contentType: "text/plain",
			body:        `{"error":"invalid_grant"}`,
		},
		{
			name:        "http-200-malformed-non-canonical-token-response",
			statusCode:  http.StatusOK,
			contentType: "application/json",
			body:        `{"accessToken":"alias-access","refreshToken":"alias-refresh","tokenType":"Bearer","expiresIn":300,"accountId":"acct-fc"}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clock := newControllableClock(time.Date(2026, 11, 27, 18, 0, 0, 0, time.UTC))
			secrets := newAccountBinarySecretStore()
			custody, err := NewProtectedBinaryCustody(secrets)
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case realmv1.RefreshTokenOperation.Path():
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte(`{"statusCode":503,"message":"Unavailable","reasonCode":"AUTH_TOKEN_VERIFICATION_UNAVAILABLE","traceId":"trace-503"}`))
				case realmv1.OauthTokenOperation.Path():
					w.Header().Set("Content-Type", tc.contentType)
					w.WriteHeader(tc.statusCode)
					_, _ = w.Write([]byte(tc.body))
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()

			partition := "rev-fc-" + tc.name
			initial := testMaterial("acct-fc", "access-initial", "refresh-initial")
			initial.RealmOrigin = server.URL
			initial.AccessTokenExpires = clock.Now().Add(-5 * time.Minute)
			if err := custody.Store(context.Background(), partition, initial); err != nil {
				t.Fatal(err)
			}

			newService := func() *Service {
				cfg := resolveProductionConfig(ProductionConfig{
					RealmBaseURL: server.URL,
					HTTPClient:   server.Client(),
				})
				refresher := newRealmTokenRefresher(cfg)
				refresher.now = clock.Now
				svc := newHarnessService(t, nil,
					WithProductionActivation(),
					WithCustody(custody),
					WithCustodyPartition(partition),
					WithRealmBaseURL(server.URL),
					WithRealmHTTPClient(server.Client()),
					WithLoginExchanger(newRealmOAuthExchanger(cfg)),
					WithRefresher(refresher),
					WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller(), realmDesktopShellCaller())),
					WithClock(clock.Now),
				)
				stopAccountRefreshTimer(t, svc)
				return svc
			}

			svc := newService()
			if res, rErr := svc.refreshAccountSessionInternal(context.Background(), true); rErr != nil || res.accepted ||
				res.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
				t.Fatalf("setup ambiguous state = (%+v, %v)", res, rErr)
			}
			restarted := newService()
			_, restartGen, restartFence, restartLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background())
			if !restartLive {
				t.Fatal("post-restart ambiguous state did not preserve local identity")
			}

			begin, err := restarted.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
				Caller:      desktopAccountControlCaller(),
				RedirectUri: "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || !begin.GetAccepted() {
				t.Fatalf("BeginLogin = (%+v, %v)", begin, err)
			}
			complete, err := restarted.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
				Caller:         desktopAccountControlCaller(),
				LoginAttemptId: begin.GetLoginAttemptId(),
				Code:           "auth-code-revoked",
				State:          begin.GetState(),
				Nonce:          begin.GetNonce(),
				RedirectUri:    "http://127.0.0.1:46373/oauth/callback",
			})
			if err != nil || complete.GetAccepted() ||
				complete.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED ||
				complete.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE {
				t.Fatalf("%s CompleteLogin = (%+v, %v), want REAUTH_REQUIRED + LOGIN_EXCHANGE_UNAVAILABLE", tc.name, complete, err)
			}

			select {
			case <-restartFence:
			default:
				t.Fatalf("%s did not close local execution fence", tc.name)
			}
			if proj, afterGen, _, afterLive := restarted.BindAuthenticatedRuntimeGeneration(context.Background()); afterLive || proj != nil || afterGen <= restartGen {
				t.Fatalf("%s left local identity live: proj=%+v gen=%d live=%v", tc.name, proj, afterGen, afterLive)
			}
			statusResp, _ := restarted.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
			if statusResp.GetSnapshot().GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED ||
				statusResp.GetSnapshot().GetAuthorizationRevision() != "" ||
				statusResp.GetSnapshot().GetAccountProjection() != nil {
				t.Fatalf("%s status snapshot = %+v", tc.name, statusResp.GetSnapshot())
			}
			if _, loadErr := custody.Load(context.Background(), partition); !errors.Is(loadErr, ErrNoStoredAccount) {
				t.Fatalf("%s retained durable custody: err=%v", tc.name, loadErr)
			}
		})
	}
}
