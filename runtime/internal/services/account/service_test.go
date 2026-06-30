package account

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"google.golang.org/protobuf/proto"
)

type memoryCustody struct {
	material AccountMaterial
	has      bool
	err      error
}

func newProductionHarnessService(t *testing.T, custody *memoryCustody, opts ...Option) *Service {
	t.Helper()
	if custody == nil {
		custody = &memoryCustody{}
	}
	allOpts := []Option{
		WithProductionActivation(),
		WithCustody(custody),
		WithLoginExchanger(staticExchanger{material: testMaterial("acct-1", "access-1", "refresh-1")}),
		WithAppRegistry(testAppRegistry(t, firstPartyCaller())),
	}
	allOpts = append(allOpts, opts...)
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)), allOpts...)
}

func (m *memoryCustody) Load(context.Context, string) (AccountMaterial, error) {
	if m.err != nil {
		return AccountMaterial{}, m.err
	}
	if !m.has {
		return AccountMaterial{}, ErrCustodyUnavailable
	}
	return m.material, nil
}

func (m *memoryCustody) Store(_ context.Context, _ string, material AccountMaterial) error {
	if m.err != nil {
		return m.err
	}
	m.material = material
	m.has = true
	return nil
}

func (m *memoryCustody) Clear(context.Context, string) error {
	if m.err != nil {
		return m.err
	}
	m.material = AccountMaterial{}
	m.has = false
	return nil
}

type staticExchanger struct {
	material AccountMaterial
	err      error
}

func (s staticExchanger) Exchange(context.Context, LoginAttempt, string) (AccountMaterial, error) {
	if s.err != nil {
		return AccountMaterial{}, s.err
	}
	return s.material, nil
}

func (s staticExchanger) AuthorizationURL(attempt LoginAttempt) string {
	u := "https://realm.test/api/auth/oauth/authorize?response_type=code&client_id=nimi-desktop"
	u += "&redirect_uri=http%3A%2F%2Flocalhost%3A46373%2Fauth%2Fcallback"
	u += "&code_challenge=" + attempt.PKCEChallenge
	u += "&code_challenge_method=S256"
	u += "&state=" + attempt.State
	return u
}

type staticRefresher struct {
	material AccountMaterial
	err      error
}

func (s staticRefresher) Refresh(context.Context, AccountMaterial) (AccountMaterial, error) {
	if s.err != nil {
		return AccountMaterial{}, s.err
	}
	return s.material, nil
}

func newHarnessService(t *testing.T, custody *memoryCustody, opts ...Option) *Service {
	t.Helper()
	if custody == nil {
		custody = &memoryCustody{}
	}
	allOpts := []Option{
		WithNonProductionHarnessMode(),
		WithCustody(custody),
		WithLoginExchanger(staticExchanger{material: testMaterial("acct-1", "access-1", "refresh-1")}),
		WithAppRegistry(testAppRegistry(t, firstPartyCaller())),
	}
	allOpts = append(allOpts, opts...)
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)), allOpts...)
}

func testMaterial(accountID string, accessToken string, refreshToken string) AccountMaterial {
	return AccountMaterial{
		AccountID:          accountID,
		DisplayName:        "Nimi User",
		RealmEnvironmentID: "realm-local",
		AccessToken:        accessToken,
		AccessTokenExpires: time.Now().UTC().Add(5 * time.Minute),
		RefreshToken:       refreshToken,
	}
}

func unsignedTestJWT(subject string) string {
	payload := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"sub":%q,"exp":4102444800}`, subject)))
	return "eyJhbGciOiJub25lIn0." + payload + "."
}

func firstPartyCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         "nimi.desktop",
		AppInstanceId: "desktop-1",
		DeviceId:      "device-1",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
}

func testerCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         "nimi.tester",
		AppInstanceId: "nimi.tester.local-first-party",
		DeviceId:      "local-first-party-device",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
}

func localDeveloperCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         "nimi.tester",
		AppInstanceId: "nimi.tester.local-developer",
		DeviceId:      "tester-local-developer-device",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_DEVELOPER_APP,
	}
}

func installedNimiAppCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:                "community.nimi.fixture.platform-proof",
		AppInstanceId:        "community.nimi.fixture.platform-proof.desktop-host",
		DeviceId:             "desktop-installed-app-host-device",
		Mode:                 runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_NIMI_APP,
		LaunchHostId:         appregistry.DesktopInstalledAppLaunchHostID,
		LaunchNonce:          "launch-nonce-1",
		ReleaseDescriptorRef: "community.nimi.fixture.platform-proof.0.1.0-sandbox",
	}
}

func testAppRegistry(t *testing.T, callers ...*runtimev1.AccountCaller) *appregistry.Registry {
	t.Helper()
	registry := appregistry.New()
	for _, caller := range callers {
		if caller == nil {
			continue
		}
		if err := registry.UpsertInstance(caller.GetAppId(), caller.GetAppInstanceId(), caller.GetDeviceId(), &runtimev1.AppModeManifest{
			AppMode:         runtimev1.AppMode_APP_MODE_FULL,
			RuntimeRequired: true,
			RealmRequired:   true,
			WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
		}, nil); err != nil {
			t.Fatalf("register test app caller: %v", err)
		}
	}
	return registry
}

func testInstalledNimiAppRegistry(t *testing.T, caller *runtimev1.AccountCaller, configure func(*appregistry.DesktopLaunchedNimiAppAdmission)) *appregistry.Registry {
	t.Helper()
	registry := testAppRegistry(t, firstPartyCaller())
	admission := appregistry.DesktopLaunchedNimiAppAdmission{
		PlatformRegistryAdmitted: true,
		ReleaseDescriptorRef:     "community.nimi.fixture.platform-proof.0.1.0-sandbox",
		ActiveReleaseRoot:        "D:/nimi-data/apps/community.nimi.fixture.platform-proof/releases/0.1.0",
		LaunchHostID:             appregistry.DesktopInstalledAppLaunchHostID,
		LaunchNonce:              "launch-nonce-1",
		AccountInventoryEntitled: true,
		LocalMaterialized:        true,
	}
	if configure != nil {
		configure(&admission)
	}
	if err := registry.UpsertDesktopLaunchedNimiAppInstance(caller.GetAppId(), caller.GetAppInstanceId(), caller.GetDeviceId(), &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}, nil, admission); err != nil {
		t.Fatalf("register installed Nimi App caller: %v", err)
	}
	return registry
}

func testDeveloperAppRegistry(t *testing.T, caller *runtimev1.AccountCaller) *appregistry.Registry {
	t.Helper()
	registry := testAppRegistry(t, firstPartyCaller())
	if err := registry.UpsertInstanceWithAdmission(caller.GetAppId(), caller.GetAppInstanceId(), caller.GetDeviceId(), &runtimev1.AppModeManifest{
		AppMode:         runtimev1.AppMode_APP_MODE_FULL,
		RuntimeRequired: true,
		RealmRequired:   true,
		WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
	}, nil, true); err != nil {
		t.Fatalf("register developer app caller: %v", err)
	}
	return registry
}

func completeLogin(t *testing.T, svc *Service) {
	t.Helper()
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: firstPartyCaller()})
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
	})
	if err != nil {
		t.Fatalf("CompleteLogin: %v", err)
	}
	if !complete.GetAccepted() || complete.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		t.Fatalf("CompleteLogin failed: %+v", complete)
	}
}

func TestStateMachineTransitionsAndSingleActiveAccountInvariant(t *testing.T) {
	svc := newHarnessService(t, nil)
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: firstPartyCaller(), TtlSeconds: 60})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if svc.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGIN_PENDING {
		t.Fatalf("state after BeginLogin = %v", svc.currentState())
	}
	duplicate, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: firstPartyCaller(), TtlSeconds: 60})
	if err != nil {
		t.Fatalf("duplicate BeginLogin: %v", err)
	}
	if duplicate.GetLoginAttemptId() != begin.GetLoginAttemptId() {
		t.Fatalf("duplicate pending login must return same attempt")
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
	if !complete.GetAccepted() || complete.GetAccountProjection().GetAccountId() != "acct-1" {
		t.Fatalf("authenticated projection missing: %+v", complete)
	}
	second, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("BeginLogin while authenticated: %v", err)
	}
	if second.GetAccepted() {
		t.Fatalf("second active login must not overlap authenticated account")
	}
}

func TestPendingLoginReuseRequiresSameLoopbackCallback(t *testing.T) {
	svc := newHarnessService(t, nil)
	first, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
		Caller:         firstPartyCaller(),
		RedirectUri:    "http://127.0.0.1:41001/oauth/callback",
		CallbackOrigin: "http://127.0.0.1:41001",
		TtlSeconds:     60,
	})
	if err != nil {
		t.Fatalf("first BeginLogin: %v", err)
	}
	if !first.GetAccepted() {
		t.Fatalf("first BeginLogin not accepted: %+v", first)
	}

	reused, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
		Caller:         firstPartyCaller(),
		RedirectUri:    "http://127.0.0.1:41001/oauth/callback",
		CallbackOrigin: "http://127.0.0.1:41001",
		TtlSeconds:     60,
	})
	if err != nil {
		t.Fatalf("matching BeginLogin: %v", err)
	}
	if reused.GetLoginAttemptId() != first.GetLoginAttemptId() {
		t.Fatalf("matching pending login should reuse same attempt: first=%s reused=%s", first.GetLoginAttemptId(), reused.GetLoginAttemptId())
	}

	next, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
		Caller:         firstPartyCaller(),
		RedirectUri:    "http://127.0.0.1:41002/oauth/callback",
		CallbackOrigin: "http://127.0.0.1:41002",
		TtlSeconds:     60,
	})
	if err != nil {
		t.Fatalf("mismatched BeginLogin: %v", err)
	}
	if !next.GetAccepted() {
		t.Fatalf("mismatched BeginLogin not accepted: %+v", next)
	}
	if next.GetLoginAttemptId() == first.GetLoginAttemptId() {
		t.Fatalf("mismatched loopback callback must not reuse stale pending attempt")
	}

	staleComplete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         firstPartyCaller(),
		LoginAttemptId: first.GetLoginAttemptId(),
		Code:           "old-code",
		State:          first.GetState(),
		Nonce:          first.GetNonce(),
	})
	if err != nil {
		t.Fatalf("stale CompleteLogin: %v", err)
	}
	if staleComplete.GetAccepted() ||
		staleComplete.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED {
		t.Fatalf("stale callback must fail closed after loopback callback replacement: %+v", staleComplete)
	}

	complete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         firstPartyCaller(),
		LoginAttemptId: next.GetLoginAttemptId(),
		Code:           "auth-code",
		State:          next.GetState(),
		Nonce:          next.GetNonce(),
	})
	if err != nil {
		t.Fatalf("new CompleteLogin: %v", err)
	}
	if !complete.GetAccepted() || complete.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		t.Fatalf("new loopback callback should complete login: %+v", complete)
	}
}

func TestRegisteredLocalFirstPartyAppReadsSingleActiveAccountProjection(t *testing.T) {
	custody := &memoryCustody{}
	svc := newHarnessService(t, custody, WithAppRegistry(testAppRegistry(t, firstPartyCaller(), testerCaller())))
	completeLogin(t, svc)

	status, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{
		Caller: testerCaller(),
	})
	if err != nil {
		t.Fatalf("tester GetAccountSessionStatus: %v", err)
	}
	if status.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED ||
		status.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		status.GetAccountProjection().GetAccountId() != "acct-1" {
		t.Fatalf("registered tester caller should read the Runtime single active account projection: %+v", status)
	}

	token, err := svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{
		Caller: testerCaller(),
	})
	if err != nil {
		t.Fatalf("tester GetAccessToken: %v", err)
	}
	if !token.GetAccepted() || token.GetAccessToken() != "access-1" {
		t.Fatalf("registered tester caller should receive Runtime-issued short-lived access token: %+v", token)
	}
}

func TestUnavailableCustodyFailsClosed(t *testing.T) {
	svc := newHarnessService(t, &memoryCustody{err: ErrCustodyUnavailable})
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	resp, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         firstPartyCaller(),
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "auth-code",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
	})
	if err != nil {
		t.Fatalf("CompleteLogin: %v", err)
	}
	if resp.GetAccepted() || resp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE {
		t.Fatalf("custody unavailable must fail closed: %+v", resp)
	}
}

func TestNoDesktopSharedAuthReadMirrorPath(t *testing.T) {
	root := "."
	var hits []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return err
		}
		body, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		for _, needle := range []string{"auth_session_load", "auth_session_save", "shared_auth", "subject_user_id"} {
			if strings.Contains(string(body), needle) {
				hits = append(hits, path+":"+needle)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan account service: %v", err)
	}
	if len(hits) > 0 {
		t.Fatalf("account service must not read/mirror Desktop shared auth or app subject truth: %v", hits)
	}
}

func TestEventStreamSnapshotReplayOrderAndTruncation(t *testing.T) {
	svc := newHarnessService(t, nil, WithEventRetention(2))
	completeLogin(t, svc)
	snapshot, replay, _ := svc.subscribe(&runtimev1.SubscribeAccountSessionEventsRequest{AfterSequence: 0})
	if snapshot.GetEventType() != runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS {
		t.Fatalf("expected status snapshot, got %v", snapshot.GetEventType())
	}
	if len(replay) != 2 {
		t.Fatalf("expected retained replay of 2 events, got %d", len(replay))
	}
	if replay[0].GetSequence() >= replay[1].GetSequence() {
		t.Fatalf("replay must be ordered by sequence: %v then %v", replay[0].GetSequence(), replay[1].GetSequence())
	}
	truncated, replay, _ := svc.subscribe(&runtimev1.SubscribeAccountSessionEventsRequest{AfterSequence: 1})
	if !truncated.GetReplayTruncated() {
		t.Fatalf("expected replay_truncated when after_sequence predates retention")
	}
	if len(replay) != 0 {
		t.Fatalf("truncated replay should force snapshot-only delivery")
	}
}

func TestRefreshRotationAndReuseDetection(t *testing.T) {
	custody := &memoryCustody{}
	svc := newHarnessService(t, custody, WithRefresher(staticRefresher{material: testMaterial("acct-1", "access-2", "refresh-2")}))
	completeLogin(t, svc)
	refresh, err := svc.RefreshAccountSession(context.Background(), &runtimev1.RefreshAccountSessionRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("RefreshAccountSession: %v", err)
	}
	if !refresh.GetAccepted() {
		t.Fatalf("refresh failed: %+v", refresh)
	}
	if reason, ok := svc.ObserveRefreshToken(context.Background(), "refresh-1"); ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED {
		t.Fatalf("old refresh token reuse must be detected, ok=%v reason=%v", ok, reason)
	}
	if svc.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED {
		t.Fatalf("reuse detection state = %v", svc.currentState())
	}
}

func TestLogoutRevokesBindingsBeforeFinalAccountStatus(t *testing.T) {
	svc := newHarnessService(t, nil)
	completeLogin(t, svc)
	issueBinding(t, svc)
	resp, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if !resp.GetAccepted() {
		t.Fatalf("logout failed: %+v", resp)
	}
	var bindingRevokedSeq, finalStatusSeq uint64
	for _, event := range svc.events {
		if event.GetEventType() == runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED {
			bindingRevokedSeq = event.GetSequence()
		}
		if event.GetEventType() == runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS &&
			event.GetState() == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
			finalStatusSeq = event.GetSequence()
		}
	}
	if bindingRevokedSeq == 0 || finalStatusSeq == 0 || bindingRevokedSeq > finalStatusSeq {
		t.Fatalf("binding revoke must precede final anonymous status, binding=%d status=%d", bindingRevokedSeq, finalStatusSeq)
	}
}

func TestSwitchAccountRevokesBindingsAndClearsActiveProjection(t *testing.T) {
	svc := newHarnessService(t, nil)
	completeLogin(t, svc)
	issueBinding(t, svc)
	resp, err := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("SwitchAccount: %v", err)
	}
	if !resp.GetAccepted() || resp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
		t.Fatalf("switch must clear old active account in wave-2 substrate: %+v", resp)
	}
	if token, err := svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: firstPartyCaller()}); err != nil || token.GetAccepted() {
		t.Fatalf("token after switch must fail closed: resp=%+v err=%v", token, err)
	}
}

func TestLogoutAndUserSwitchRevokeMultiConsumerProjections(t *testing.T) {
	for _, tc := range []struct {
		name string
		act  func(*Service) error
	}{
		{
			name: "logout",
			act: func(svc *Service) error {
				resp, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: firstPartyCaller()})
				if err != nil {
					return err
				}
				if !resp.GetAccepted() || resp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
					return fmt.Errorf("logout not accepted: %+v", resp)
				}
				return nil
			},
		},
		{
			name: "user_switch",
			act: func(svc *Service) error {
				resp, err := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: firstPartyCaller()})
				if err != nil {
					return err
				}
				if !resp.GetAccepted() || resp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
					return fmt.Errorf("switch not accepted: %+v", resp)
				}
				return nil
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newHarnessService(t, nil)
			completeLogin(t, svc)
			desktopToken, err := svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: firstPartyCaller()})
			if err != nil {
				t.Fatalf("GetAccessToken before revoke: %v", err)
			}
			if !desktopToken.GetAccepted() {
				t.Fatalf("Desktop/SDK Runtime token provider should work before revoke: %+v", desktopToken)
			}
			avatarBinding := issueBinding(t, svc)
			secondaryHostBinding := issueBindingForRelation(t, svc, bindingRelationFor("window-2", "avatar-2", "agent-2", "anchor-2"))
			for _, binding := range []*runtimev1.IssueScopedAppBindingResponse{avatarBinding, secondaryHostBinding} {
				if reason, ok := svc.ValidateScopedBinding(binding.GetBindingId(), binding.GetRelation(), "runtime.agent.turn.read"); !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
					t.Fatalf("binding should validate before revoke, ok=%v reason=%v", ok, reason)
				}
			}

			if err := tc.act(svc); err != nil {
				t.Fatal(err)
			}

			status, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
			if err != nil {
				t.Fatalf("GetAccountSessionStatus after revoke: %v", err)
			}
			if status.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS || status.GetAccountProjection() != nil {
				t.Fatalf("Runtime account projection must be revoked: %+v", status)
			}
			token, err := svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: firstPartyCaller()})
			if err != nil {
				t.Fatalf("GetAccessToken after revoke: %v", err)
			}
			if token.GetAccepted() {
				t.Fatalf("Runtime token projection must fail closed after %s: %+v", tc.name, token)
			}
			for _, binding := range []*runtimev1.IssueScopedAppBindingResponse{avatarBinding, secondaryHostBinding} {
				if reason, ok := svc.ValidateScopedBinding(binding.GetBindingId(), binding.GetRelation(), "runtime.agent.turn.read"); ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE {
					t.Fatalf("binding must be stale after %s, ok=%v reason=%v", tc.name, ok, reason)
				}
			}
		})
	}
}

func TestDaemonRestartRecoveryAndNoCustodyRestartBehavior(t *testing.T) {
	recoveredCustody := &memoryCustody{material: testMaterial("acct-1", "access-1", "refresh-1"), has: true}
	recovered := newHarnessService(t, recoveredCustody)
	statusResp, err := recovered.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus: %v", err)
	}
	if statusResp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		t.Fatalf("restart with custody should recover authenticated state: %+v", statusResp)
	}

	unavailable := newHarnessService(t, &memoryCustody{err: ErrCustodyUnavailable})
	statusResp, err = unavailable.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus unavailable: %v", err)
	}
	if statusResp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE {
		t.Fatalf("restart without custody must be unavailable: %+v", statusResp)
	}
}

func TestDaemonRestartRecoversAccountButInvalidatesScopedBindings(t *testing.T) {
	custody := &memoryCustody{}
	beforeRestart := newHarnessService(t, custody)
	completeLogin(t, beforeRestart)
	issued := issueBinding(t, beforeRestart)
	if reason, ok := beforeRestart.ValidateScopedBinding(issued.GetBindingId(), issued.GetRelation(), "runtime.agent.turn.read"); !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
		t.Fatalf("binding should validate before restart, ok=%v reason=%v", ok, reason)
	}

	afterRestart := newHarnessService(t, custody)
	status, err := afterRestart.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus after restart: %v", err)
	}
	if status.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED || status.GetAccountProjection().GetAccountId() != "acct-1" {
		t.Fatalf("restart should recover account projection from custody: %+v", status)
	}
	token, err := afterRestart.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccessToken after restart: %v", err)
	}
	if !token.GetAccepted() || token.GetAccessToken() != "access-1" {
		t.Fatalf("Runtime token projection should recover through custody: %+v", token)
	}
	if reason, ok := afterRestart.ValidateScopedBinding(issued.GetBindingId(), issued.GetRelation(), "runtime.agent.turn.read"); ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND {
		t.Fatalf("pre-restart binding must not survive daemon restart, ok=%v reason=%v", ok, reason)
	}

	unavailable := newHarnessService(t, &memoryCustody{err: ErrCustodyUnavailable})
	status, err = unavailable.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus unavailable restart: %v", err)
	}
	if status.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE {
		t.Fatalf("unrecoverable restart must fail closed: %+v", status)
	}
	token, err = unavailable.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccessToken unavailable restart: %v", err)
	}
	if token.GetAccepted() {
		t.Fatalf("unrecoverable restart must not project access token: %+v", token)
	}
}

func TestGetAccessTokenRejectsAnonymousUnavailableAvatarAndRevokedCaller(t *testing.T) {
	anonymous := newHarnessService(t, &memoryCustody{err: ErrCustodyUnavailable})
	resp, err := anonymous.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("anonymous GetAccessToken: %v", err)
	}
	if resp.GetAccepted() || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE {
		t.Fatalf("anonymous token request must fail: %+v", resp)
	}

	svc := newHarnessService(t, nil)
	completeLogin(t, svc)
	avatar := *firstPartyCaller()
	avatar.Mode = runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR
	resp, err = svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: &avatar})
	if err != nil {
		t.Fatalf("avatar GetAccessToken: %v", err)
	}
	if resp.GetAccepted() || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_AVATAR_BINDING_ONLY {
		t.Fatalf("avatar token request must fail: %+v", resp)
	}
	if _, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: firstPartyCaller()}); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	resp, err = svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("post-logout GetAccessToken: %v", err)
	}
	if resp.GetAccepted() {
		t.Fatalf("token request after logout must fail closed")
	}
}

func TestGetAccessTokenRejectsUnregisteredLocalFirstPartyCaller(t *testing.T) {
	svc := newHarnessService(t, nil)
	completeLogin(t, svc)
	svc.registry = appregistry.New()

	resp, err := svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccessToken: %v", err)
	}
	if resp.GetAccepted() || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
		t.Fatalf("unregistered caller must not receive access token: %+v", resp)
	}
}

func TestLocalDeveloperAppAccountSurfaceRejectsFirstPartyTokenAndControlAuthority(t *testing.T) {
	developer := localDeveloperCaller()
	svc := newHarnessService(
		t,
		nil,
		WithAppRegistry(testDeveloperAppRegistry(t, developer)),
		WithRefresher(staticRefresher{material: testMaterial("acct-1", "access-2", "refresh-2")}),
	)
	completeLogin(t, svc)

	status, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: developer})
	if err != nil {
		t.Fatalf("developer GetAccountSessionStatus: %v", err)
	}
	if status.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED ||
		status.GetAccountProjection().GetAccountId() != "acct-1" {
		t.Fatalf("developer caller should receive Runtime account projection: %+v", status)
	}

	refresh, err := svc.RefreshAccountSession(context.Background(), &runtimev1.RefreshAccountSessionRequest{Caller: developer})
	if err != nil {
		t.Fatalf("developer RefreshAccountSession: %v", err)
	}
	if !refresh.GetAccepted() || refresh.GetAccountProjection().GetAccountId() != "acct-1" {
		t.Fatalf("developer caller should refresh through Runtime custody: %+v", refresh)
	}

	binding, err := svc.IssueScopedAppBinding(context.Background(), &runtimev1.IssueScopedAppBindingRequest{
		Caller: developer,
		Relation: &runtimev1.ScopedAppBindingRelation{
			RuntimeAppId:  developer.GetAppId(),
			AppInstanceId: developer.GetAppInstanceId(),
			AgentId:       "agent-1",
			Purpose:       runtimev1.ScopedAppBindingPurpose_SCOPED_APP_BINDING_PURPOSE_APP_SCOPED_RUNTIME,
		},
	})
	if err != nil {
		t.Fatalf("developer IssueScopedAppBinding: %v", err)
	}
	if !binding.GetAccepted() || binding.GetBindingId() == "" {
		t.Fatalf("developer caller should issue scoped app binding: %+v", binding)
	}

	token, err := svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: developer})
	if err != nil {
		t.Fatalf("developer GetAccessToken: %v", err)
	}
	if token.GetAccepted() || token.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
		t.Fatalf("developer caller must not receive raw Realm access token: %+v", token)
	}

	logout, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: developer})
	if err != nil {
		t.Fatalf("developer Logout: %v", err)
	}
	if logout.GetAccepted() || logout.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
		t.Fatalf("developer caller must not own logout authority: %+v", logout)
	}

	switchAccount, err := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: developer})
	if err != nil {
		t.Fatalf("developer SwitchAccount: %v", err)
	}
	if switchAccount.GetAccepted() || switchAccount.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
		t.Fatalf("developer caller must not own switch authority: %+v", switchAccount)
	}
}

func TestLocalDeveloperRegistrationCannotBeClaimedAsLocalFirstPartyCaller(t *testing.T) {
	developer := localDeveloperCaller()
	firstPartyClaim := proto.Clone(developer).(*runtimev1.AccountCaller)
	firstPartyClaim.Mode = runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP

	svc := newHarnessService(t, nil, WithAppRegistry(testDeveloperAppRegistry(t, developer)))
	completeLogin(t, svc)

	token, err := svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: firstPartyClaim})
	if err != nil {
		t.Fatalf("claimed first-party GetAccessToken: %v", err)
	}
	if token.GetAccepted() || token.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
		t.Fatalf("developer-registered instance must not become first-party by caller mode: %+v", token)
	}
}

func TestDesktopLaunchedInstalledNimiAppAccountSurfaceRequiresInstalledLaunchEvidence(t *testing.T) {
	caller := installedNimiAppCaller()
	svc := newHarnessService(
		t,
		nil,
		WithAppRegistry(testInstalledNimiAppRegistry(t, caller, nil)),
		WithRefresher(staticRefresher{material: testMaterial("acct-1", "access-2", "refresh-2")}),
	)
	completeLogin(t, svc)

	status, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: caller})
	if err != nil {
		t.Fatalf("installed app GetAccountSessionStatus: %v", err)
	}
	if status.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED ||
		status.GetAccountProjection().GetAccountId() != "acct-1" {
		t.Fatalf("installed app should receive host-owned account projection after launch evidence: %+v", status)
	}

	refresh, err := svc.RefreshAccountSession(context.Background(), &runtimev1.RefreshAccountSessionRequest{Caller: caller})
	if err != nil {
		t.Fatalf("installed app RefreshAccountSession: %v", err)
	}
	if !refresh.GetAccepted() || refresh.GetAccountProjection().GetAccountId() != "acct-1" {
		t.Fatalf("installed app should refresh through Runtime custody: %+v", refresh)
	}

	binding, err := svc.IssueScopedAppBinding(context.Background(), &runtimev1.IssueScopedAppBindingRequest{
		Caller: caller,
		Relation: &runtimev1.ScopedAppBindingRelation{
			RuntimeAppId:  caller.GetAppId(),
			AppInstanceId: caller.GetAppInstanceId(),
			AgentId:       "agent-1",
			Purpose:       runtimev1.ScopedAppBindingPurpose_SCOPED_APP_BINDING_PURPOSE_APP_SCOPED_RUNTIME,
		},
	})
	if err != nil {
		t.Fatalf("installed app IssueScopedAppBinding: %v", err)
	}
	if !binding.GetAccepted() || binding.GetBindingId() == "" {
		t.Fatalf("installed app should receive mediated scoped binding: %+v", binding)
	}

	token, err := svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: caller})
	if err != nil {
		t.Fatalf("installed app GetAccessToken: %v", err)
	}
	if token.GetAccepted() || token.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
		t.Fatalf("installed app must not receive raw Realm access token: %+v", token)
	}

	logout, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: caller})
	if err != nil {
		t.Fatalf("installed app Logout: %v", err)
	}
	if logout.GetAccepted() || logout.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
		t.Fatalf("installed app must not own logout authority: %+v", logout)
	}
}

func TestDesktopLaunchedInstalledNimiAppCallerFailsClosedWithoutInstalledEvidence(t *testing.T) {
	caller := installedNimiAppCaller()
	cases := []struct {
		name     string
		registry *appregistry.Registry
		want     runtimev1.AccountReasonCode
	}{
		{
			name:     "shape_only_first_party_registration",
			registry: testAppRegistry(t, firstPartyCaller(), caller),
			want:     runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
		},
		{
			name:     "developer_registration",
			registry: testDeveloperAppRegistry(t, caller),
			want:     runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
		},
		{
			name: "missing_release_descriptor",
			registry: testInstalledNimiAppRegistry(t, caller, func(admission *appregistry.DesktopLaunchedNimiAppAdmission) {
				admission.ReleaseDescriptorRef = ""
			}),
			want: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
		},
		{
			name: "wrong_desktop_host",
			registry: testInstalledNimiAppRegistry(t, caller, func(admission *appregistry.DesktopLaunchedNimiAppAdmission) {
				admission.LaunchHostID = "desktop-shell"
			}),
			want: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
		},
		{
			name: "missing_account_inventory_entitlement",
			registry: testInstalledNimiAppRegistry(t, caller, func(admission *appregistry.DesktopLaunchedNimiAppAdmission) {
				admission.AccountInventoryEntitled = false
			}),
			want: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
		},
		{
			name: "missing_local_materialization",
			registry: testInstalledNimiAppRegistry(t, caller, func(admission *appregistry.DesktopLaunchedNimiAppAdmission) {
				admission.LocalMaterialized = false
			}),
			want: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
		},
		{
			name: "wrong_device",
			registry: testInstalledNimiAppRegistry(t, caller, func(admission *appregistry.DesktopLaunchedNimiAppAdmission) {
			}),
			want: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
		},
		{
			name: "wrong_launch_nonce",
			registry: testInstalledNimiAppRegistry(t, caller, func(admission *appregistry.DesktopLaunchedNimiAppAdmission) {
			}),
			want: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			testCaller := proto.Clone(caller).(*runtimev1.AccountCaller)
			if tc.name == "wrong_device" {
				testCaller.DeviceId = "other-device"
			}
			if tc.name == "wrong_launch_nonce" {
				testCaller.LaunchNonce = "wrong-launch-nonce"
			}
			svc := newHarnessService(t, nil, WithAppRegistry(tc.registry))
			completeLogin(t, svc)

			status, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: testCaller})
			if err != nil {
				t.Fatalf("GetAccountSessionStatus: %v", err)
			}
			if status.GetReasonCode() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED ||
				status.GetAccountReasonCode() != tc.want ||
				status.GetAccountProjection() != nil {
				t.Fatalf("installed app caller without full evidence must fail closed: %+v", status)
			}
		})
	}
}

func TestDesktopLaunchedInstalledNimiAppCallerRequiresAuthenticatedAccount(t *testing.T) {
	caller := installedNimiAppCaller()
	svc := newHarnessService(
		t,
		&memoryCustody{err: ErrNoStoredAccount},
		WithAppRegistry(testInstalledNimiAppRegistry(t, caller, nil)),
	)

	status, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: caller})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus: %v", err)
	}
	if status.GetReasonCode() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED ||
		status.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE ||
		status.GetAccountProjection() != nil {
		t.Fatalf("installed app caller must require authenticated Runtime account custody: %+v", status)
	}

	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: caller})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if begin.GetAccepted() || begin.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE {
		t.Fatalf("installed app caller must not bootstrap login from anonymous account state: %+v", begin)
	}
}

func TestAccountStatusRejectsUnregisteredLocalFirstPartyCaller(t *testing.T) {
	t.Run("authenticated", func(t *testing.T) {
		svc := newHarnessService(t, nil)
		completeLogin(t, svc)
		svc.registry = appregistry.New()

		resp, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
		if err != nil {
			t.Fatalf("GetAccountSessionStatus: %v", err)
		}
		if resp.GetReasonCode() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED ||
			resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED ||
			resp.GetAccountProjection() != nil {
			t.Fatalf("unregistered caller must not receive account status projection: %+v", resp)
		}
	})

	t.Run("anonymous_requires_admission", func(t *testing.T) {
		anonymous := newHarnessService(t, &memoryCustody{err: ErrNoStoredAccount})
		allowed, err := anonymous.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
		if err != nil {
			t.Fatalf("admitted anonymous GetAccountSessionStatus: %v", err)
		}
		if allowed.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED ||
			allowed.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
			t.Fatalf("admitted caller should receive anonymous status: %+v", allowed)
		}

		anonymous.registry = appregistry.New()
		rejected, err := anonymous.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
		if err != nil {
			t.Fatalf("unregistered anonymous GetAccountSessionStatus: %v", err)
		}
		if rejected.GetReasonCode() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED ||
			rejected.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
			t.Fatalf("anonymous status reads still require admitted caller registration: %+v", rejected)
		}
	})
}

func TestSubscribeAccountSessionEventsRequiresAdmittedCallerAndRedactsAvatar(t *testing.T) {
	svc := newHarnessService(t, nil)
	completeLogin(t, svc)
	eventCount := len(svc.events)

	unregistered := &accountSessionEventStream{ctx: context.Background()}
	svc.registry = appregistry.New()
	if err := svc.SubscribeAccountSessionEvents(&runtimev1.SubscribeAccountSessionEventsRequest{Caller: firstPartyCaller()}, unregistered); err != nil {
		t.Fatalf("unregistered SubscribeAccountSessionEvents: %v", err)
	}
	if len(unregistered.sent) != 1 ||
		unregistered.sent[0].GetReasonCode() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED ||
		unregistered.sent[0].GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED ||
		unregistered.sent[0].GetAccountProjection() != nil {
		t.Fatalf("unregistered subscription must receive only redacted rejection: %+v", unregistered.sent)
	}
	if len(svc.subscribers) != 0 || len(svc.events) != eventCount {
		t.Fatalf("rejected subscription must not register subscriber or append events subscribers=%d before=%d after=%d", len(svc.subscribers), eventCount, len(svc.events))
	}

	avatar := *firstPartyCaller()
	avatar.AppId = "nimi.avatar"
	avatar.AppInstanceId = "avatar-1"
	avatar.Mode = runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR
	avatarStream := &accountSessionEventStream{ctx: context.Background()}
	if err := svc.SubscribeAccountSessionEvents(&runtimev1.SubscribeAccountSessionEventsRequest{Caller: &avatar}, avatarStream); err != nil {
		t.Fatalf("avatar SubscribeAccountSessionEvents: %v", err)
	}
	if len(avatarStream.sent) != 1 ||
		avatarStream.sent[0].GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_AVATAR_BINDING_ONLY ||
		avatarStream.sent[0].GetAccountProjection() != nil {
		t.Fatalf("Desktop-launched Avatar subscription must be binding-only/redacted: %+v", avatarStream.sent)
	}

	svc.registry = testAppRegistry(t, firstPartyCaller())
	ctx, cancel := context.WithCancel(context.Background())
	admitted := &accountSessionEventStream{ctx: ctx, afterSend: cancel}
	if err := svc.SubscribeAccountSessionEvents(&runtimev1.SubscribeAccountSessionEventsRequest{Caller: firstPartyCaller()}, admitted); err != context.Canceled {
		t.Fatalf("admitted SubscribeAccountSessionEvents should exit on cancellation, got %v", err)
	}
	if len(admitted.sent) == 0 || admitted.sent[0].GetAccountProjection().GetAccountId() != "acct-1" {
		t.Fatalf("admitted caller should receive account projection snapshot: %+v", admitted.sent)
	}
}

func TestLifecycleRPCsRejectUnregisteredCallerWithoutMutation(t *testing.T) {
	for _, tc := range []struct {
		name string
		act  func(*Service) (bool, runtimev1.AccountReasonCode, error)
	}{
		{
			name: "refresh",
			act: func(svc *Service) (bool, runtimev1.AccountReasonCode, error) {
				resp, err := svc.RefreshAccountSession(context.Background(), &runtimev1.RefreshAccountSessionRequest{Caller: firstPartyCaller()})
				return resp.GetAccepted(), resp.GetAccountReasonCode(), err
			},
		},
		{
			name: "logout",
			act: func(svc *Service) (bool, runtimev1.AccountReasonCode, error) {
				resp, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: firstPartyCaller()})
				return resp.GetAccepted(), resp.GetAccountReasonCode(), err
			},
		},
		{
			name: "switch",
			act: func(svc *Service) (bool, runtimev1.AccountReasonCode, error) {
				resp, err := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: firstPartyCaller()})
				return resp.GetAccepted(), resp.GetAccountReasonCode(), err
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			custody := &memoryCustody{}
			svc := newHarnessService(t, custody, WithRefresher(staticRefresher{material: testMaterial("acct-1", "access-2", "refresh-2")}))
			completeLogin(t, svc)
			issued := issueBinding(t, svc)
			eventCount := len(svc.events)
			material := svc.material
			projection := cloneProjection(svc.projection)
			svc.registry = appregistry.New()

			accepted, reason, err := tc.act(svc)
			if err != nil {
				t.Fatalf("%s: %v", tc.name, err)
			}
			if accepted || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
				t.Fatalf("unregistered %s must be rejected, accepted=%v reason=%v", tc.name, accepted, reason)
			}
			if svc.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
				t.Fatalf("rejected %s mutated account state to %v", tc.name, svc.currentState())
			}
			if svc.material.AccessToken != material.AccessToken ||
				svc.material.RefreshToken != material.RefreshToken ||
				svc.projection.GetAccountId() != projection.GetAccountId() ||
				custody.material.RefreshToken != material.RefreshToken {
				t.Fatalf("rejected %s mutated account material/projection custody=%+v service=%+v projection=%+v", tc.name, custody.material, svc.material, svc.projection)
			}
			if len(svc.events) != eventCount {
				t.Fatalf("rejected %s emitted lifecycle events: before=%d after=%d", tc.name, eventCount, len(svc.events))
			}
			if reason, ok := svc.ValidateScopedBinding(issued.GetBindingId(), issued.GetRelation(), "runtime.agent.turn.read"); !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
				t.Fatalf("rejected %s must not revoke bindings, ok=%v reason=%v", tc.name, ok, reason)
			}
		})
	}
}
