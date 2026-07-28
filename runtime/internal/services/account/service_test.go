package account

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/bundledavatar"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
)

func accountStatusState(response *runtimev1.GetAccountSessionStatusResponse) runtimev1.AccountSessionState {
	return response.GetSnapshot().GetState()
}

func accountStatusProjection(response *runtimev1.GetAccountSessionStatusResponse) *runtimev1.AccountProjection {
	return response.GetSnapshot().GetAccountProjection()
}

func accountEventState(event *runtimev1.AccountSessionEvent) runtimev1.AccountSessionState {
	return event.GetSnapshot().GetState()
}

func accountEventReason(event *runtimev1.AccountSessionEvent) runtimev1.ReasonCode {
	return event.GetSnapshot().GetReasonCode()
}

func accountEventAccountReason(event *runtimev1.AccountSessionEvent) runtimev1.AccountReasonCode {
	return event.GetSnapshot().GetAccountReasonCode()
}

func accountEventProjection(event *runtimev1.AccountSessionEvent) *runtimev1.AccountProjection {
	return event.GetSnapshot().GetAccountProjection()
}

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
		WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller())),
		WithAppSessionValidator(testAccountAppSessionValidator{}),
	}
	allOpts = append(allOpts, opts...)
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)), allOpts...)
}

func TestProductionCustodyRejectsRealmOriginMismatch(t *testing.T) {
	custody := &memoryCustody{
		has: true,
		material: func() AccountMaterial {
			material := testMaterial("acct-1", "access-dev", "refresh-dev")
			material.RealmOrigin = "http://127.0.0.1:3002"
			return material
		}(),
	}
	svc := newProductionHarnessService(t, custody, WithRealmBaseURL("https://realm.nimi.ai"))
	if svc.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED {
		t.Fatalf("Realm origin mismatch state = %s, want reauth required", svc.currentState())
	}
	if custody.has {
		t.Fatal("Realm origin mismatch retained old bearer custody")
	}
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
		WithAppRegistry(testAppRegistry(t, firstPartyCaller(), desktopAccountControlCaller())),
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

func desktopAccountControlCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         "nimi.desktop",
		AppInstanceId: "desktop-1",
		DeviceId:      "device-1",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL,
	}
}

type testAccountAppSessionValidator struct{}

func (testAccountAppSessionValidator) ValidateAppSessionBinding(appID string, appInstanceID string, deviceID string, sessionID string, sessionToken string) (runtimev1.ReasonCode, bool) {
	caller := desktopAccountControlCaller()
	valid := appID == caller.GetAppId() && appInstanceID == caller.GetAppInstanceId() && deviceID == caller.GetDeviceId() && sessionID == "desktop-runtime-session" && sessionToken == "desktop-runtime-session-token"
	if !valid {
		return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, false
	}
	return runtimev1.ReasonCode_ACTION_EXECUTED, true
}

func desktopAccountControlContext(t *testing.T) context.Context {
	t.Helper()
	return protectedDesktopAccountContext(t)
}

func testerCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         "nimi.tester",
		AppInstanceId: "nimi.tester.local-first-party",
		DeviceId:      "local-first-party-device",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
}

func testAppRegistry(t *testing.T, callers ...*runtimev1.AccountCaller) *appregistry.Registry {
	t.Helper()
	registry := appregistry.New()
	for _, caller := range callers {
		if caller == nil {
			continue
		}
		capabilities := []string{"account.session.read"}
		if caller.GetAppId() == firstPartyCaller().GetAppId() {
			capabilities = append(capabilities, "account.raw-token")
		}
		if err := registry.UpsertInstance(caller.GetAppId(), caller.GetAppInstanceId(), caller.GetDeviceId(), &runtimev1.AppModeManifest{
			AppMode:         runtimev1.AppMode_APP_MODE_FULL,
			RuntimeRequired: true,
			RealmRequired:   true,
			WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
		}, capabilities); err != nil {
			t.Fatalf("register test app caller: %v", err)
		}
	}
	return registry
}

func completeLogin(t *testing.T, svc *Service) {
	t.Helper()
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if !begin.GetAccepted() {
		t.Fatalf("BeginLogin not accepted: %+v", begin)
	}
	complete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
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
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller(), TtlSeconds: 60})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if svc.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGIN_PENDING {
		t.Fatalf("state after BeginLogin = %v", svc.currentState())
	}
	duplicate, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller(), TtlSeconds: 60})
	if err != nil {
		t.Fatalf("duplicate BeginLogin: %v", err)
	}
	if duplicate.GetLoginAttemptId() != begin.GetLoginAttemptId() {
		t.Fatalf("duplicate pending login must return same attempt")
	}
	complete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
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
	second, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
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
		Caller:         desktopAccountControlCaller(),
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
		Caller:         desktopAccountControlCaller(),
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
		Caller:         desktopAccountControlCaller(),
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
		Caller:         desktopAccountControlCaller(),
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
		Caller:         desktopAccountControlCaller(),
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
		accountStatusState(status) != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		accountStatusProjection(status).GetAccountId() != "acct-1" {
		t.Fatalf("registered tester caller should read the Runtime single active account projection: %+v", status)
	}

}

func TestUnavailableCustodyFailsClosed(t *testing.T) {
	svc := newHarnessService(t, &memoryCustody{err: ErrCustodyUnavailable})
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	resp, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
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

func TestEventStreamSnapshotReplayOrderAndTruncation(t *testing.T) {
	svc := newHarnessService(t, nil, WithEventRetention(2))
	completeLogin(t, svc)
	replay, snapshot, _ := svc.subscribe(&runtimev1.SubscribeAccountSessionEventsRequest{AfterSequence: 0})
	if snapshot.GetEventType() != runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS {
		t.Fatalf("expected status snapshot, got %v", snapshot.GetEventType())
	}
	if len(replay) != 0 {
		t.Fatalf("first subscription must start with snapshot only, got %d replay events", len(replay))
	}
	if snapshot.GetDeliveryKind() != runtimev1.AccountSessionDeliveryKind_ACCOUNT_SESSION_DELIVERY_KIND_SNAPSHOT || snapshot.GetSnapshot().GetSequence() != snapshot.GetSequence() {
		t.Fatalf("first delivery must be a coherent snapshot: %+v", snapshot)
	}
	replay, truncated, _ := svc.subscribe(&runtimev1.SubscribeAccountSessionEventsRequest{AfterSequence: 1})
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
	refresh, err := svc.refreshAccountSessionInternal(context.Background(), true)
	if err != nil {
		t.Fatalf("private refresh: %v", err)
	}
	if !refresh.accepted {
		t.Fatalf("refresh failed: %+v", refresh)
	}
	if reason, ok := svc.ObserveRefreshToken(context.Background(), "refresh-1"); ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED {
		t.Fatalf("old refresh token reuse must be detected, ok=%v reason=%v", ok, reason)
	}
	if svc.currentState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED {
		t.Fatalf("reuse detection state = %v", svc.currentState())
	}
}

func TestLogoutRevokesWorkspaceBindingsBeforeFinalAccountStatus(t *testing.T) {
	svc := newWorkspaceService(t)
	completeWorkspaceLogin(t, svc)
	issueWorkspaceBinding(t, svc)
	resp, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
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
			accountEventState(event) == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
			finalStatusSeq = event.GetSequence()
		}
	}
	if bindingRevokedSeq == 0 || finalStatusSeq == 0 || bindingRevokedSeq > finalStatusSeq {
		t.Fatalf("binding revoke must precede final anonymous status, binding=%d status=%d", bindingRevokedSeq, finalStatusSeq)
	}
}

func TestLogoutAndSwitchFailClosedWhenCustodyCannotBeCleared(t *testing.T) {
	for _, test := range []struct {
		name        string
		failureType runtimev1.AccountEventType
		invoke      func(*Service) (bool, runtimev1.AccountSessionState, runtimev1.AccountReasonCode, error)
	}{
		{
			name:        "logout",
			failureType: runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_LOGOUT_FAILED,
			invoke: func(service *Service) (bool, runtimev1.AccountSessionState, runtimev1.AccountReasonCode, error) {
				response, err := service.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
				return response.GetAccepted(), response.GetState(), response.GetAccountReasonCode(), err
			},
		},
		{
			name:        "switch",
			failureType: runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_SWITCH_FAILED,
			invoke: func(service *Service) (bool, runtimev1.AccountSessionState, runtimev1.AccountReasonCode, error) {
				response, err := service.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: desktopAccountControlCaller()})
				return response.GetAccepted(), response.GetState(), response.GetAccountReasonCode(), err
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			custody := &memoryCustody{}
			service := newHarnessService(t, custody)
			completeLogin(t, service)
			custody.err = ErrCustodyUnavailable

			accepted, state, reason, err := test.invoke(service)
			if err != nil || accepted || state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE ||
				reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE {
				t.Fatalf("failure response = (%t, %v, %v, %v)", accepted, state, reason, err)
			}
			service.mu.RLock()
			defer service.mu.RUnlock()
			if service.material.AccessToken != "" || service.projection != nil || !custody.has {
				t.Fatalf("failed clear state material=%+v projection=%+v custody=%+v", service.material, service.projection, custody)
			}
			var failureSequence, statusSequence uint64
			for _, event := range service.events {
				if event.GetEventType() == test.failureType {
					failureSequence = event.GetSequence()
				}
				if event.GetEventType() == runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS &&
					event.GetSnapshot().GetState() == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE {
					statusSequence = event.GetSequence()
				}
				if event.GetEventType() == runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS &&
					event.GetSnapshot().GetState() == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
					t.Fatal("custody clear failure published anonymous account truth")
				}
			}
			if failureSequence == 0 || statusSequence <= failureSequence {
				t.Fatalf("failure/status sequence = %d/%d", failureSequence, statusSequence)
			}
		})
	}
}

func TestSwitchAccountClearsActiveProjection(t *testing.T) {
	svc := newHarnessService(t, nil)
	completeLogin(t, svc)
	resp, err := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: desktopAccountControlCaller()})
	if err != nil {
		t.Fatalf("SwitchAccount: %v", err)
	}
	if !resp.GetAccepted() || resp.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
		t.Fatalf("switch must clear old active account in wave-2 substrate: %+v", resp)
	}
}

func TestLogoutAndUserSwitchRevokeAccountProjection(t *testing.T) {
	for _, tc := range []struct {
		name string
		act  func(*Service) error
	}{
		{
			name: "logout",
			act: func(svc *Service) error {
				resp, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
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
				resp, err := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: desktopAccountControlCaller()})
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
			desktopToken, reason, ok, err := svc.realmUnaryAccessToken(context.Background(), nil)
			if err != nil {
				t.Fatalf("Runtime-private broker credential before revoke: %v", err)
			}
			if !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED || desktopToken == "" {
				t.Fatalf("Runtime-private broker credential unavailable before revoke: ok=%v reason=%v token=%q", ok, reason, desktopToken)
			}
			if err := tc.act(svc); err != nil {
				t.Fatal(err)
			}

			status, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
			if err != nil {
				t.Fatalf("GetAccountSessionStatus after revoke: %v", err)
			}
			if accountStatusState(status) != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS || accountStatusProjection(status) != nil {
				t.Fatalf("Runtime account projection must be revoked: %+v", status)
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
	if accountStatusState(statusResp) != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		t.Fatalf("restart with custody should recover authenticated state: %+v", statusResp)
	}

	unavailable := newHarnessService(t, &memoryCustody{err: ErrCustodyUnavailable})
	statusResp, err = unavailable.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus unavailable: %v", err)
	}
	if accountStatusState(statusResp) != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE {
		t.Fatalf("restart without custody must be unavailable: %+v", statusResp)
	}
}

func TestDaemonRestartRecoversAccountAndPrivateBrokerCredential(t *testing.T) {
	custody := &memoryCustody{}
	beforeRestart := newHarnessService(t, custody)
	completeLogin(t, beforeRestart)

	afterRestart := newHarnessService(t, custody)
	status, err := afterRestart.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus after restart: %v", err)
	}
	if accountStatusState(status) != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED || accountStatusProjection(status).GetAccountId() != "acct-1" {
		t.Fatalf("restart should recover account projection from custody: %+v", status)
	}
	token, reason, ok, err := afterRestart.realmUnaryAccessToken(context.Background(), nil)
	if err != nil {
		t.Fatalf("Runtime-private broker credential after restart: %v", err)
	}
	if !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED || token != "access-1" {
		t.Fatalf("Runtime-private broker credential should recover through custody: ok=%v reason=%v token=%q", ok, reason, token)
	}
	unavailable := newHarnessService(t, &memoryCustody{err: ErrCustodyUnavailable})
	status, err = unavailable.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus unavailable restart: %v", err)
	}
	if accountStatusState(status) != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE {
		t.Fatalf("unrecoverable restart must fail closed: %+v", status)
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
			resp.GetSnapshot() != nil {
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
			accountStatusState(allowed) != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
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

func TestSubscribeAccountSessionEventsRequiresAdmittedCallerAndProtectsBundledAvatar(t *testing.T) {
	svc := newHarnessService(t, nil)
	completeLogin(t, svc)
	eventCount := len(svc.events)

	unregistered := &accountSessionEventStream{ctx: context.Background()}
	svc.registry = appregistry.New()
	if err := svc.SubscribeAccountSessionEvents(&runtimev1.SubscribeAccountSessionEventsRequest{Caller: firstPartyCaller()}, unregistered); err != nil {
		t.Fatalf("unregistered SubscribeAccountSessionEvents: %v", err)
	}
	if len(unregistered.sent) != 1 ||
		accountEventReason(unregistered.sent[0]) != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED ||
		accountEventAccountReason(unregistered.sent[0]) != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED ||
		accountEventProjection(unregistered.sent[0]) != nil {
		t.Fatalf("unregistered subscription must receive only redacted rejection: %+v", unregistered.sent)
	}
	if len(svc.subscribers) != 0 || len(svc.events) != eventCount {
		t.Fatalf("rejected subscription must not register subscriber or append events subscribers=%d before=%d after=%d", len(svc.subscribers), eventCount, len(svc.events))
	}

	avatar := *firstPartyCaller()
	avatar.AppId = bundledavatar.AppID
	avatar.AppInstanceId = bundledavatar.AppInstanceID
	avatar.DeviceId = bundledavatar.DeviceID
	avatar.Mode = runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_AVATAR_NATIVE_HOST
	avatarCtx := envelope.WithValidatedProtectedCapability(context.Background(), bundledavatar.AppID, "account.session.read")
	avatarCtx, avatarCancel := context.WithCancel(avatarCtx)
	avatarStream := &accountSessionEventStream{ctx: avatarCtx, afterSend: avatarCancel}
	if err := svc.SubscribeAccountSessionEvents(&runtimev1.SubscribeAccountSessionEventsRequest{Caller: &avatar}, avatarStream); err != context.Canceled {
		t.Fatalf("protected Avatar SubscribeAccountSessionEvents should exit on cancellation, got %v", err)
	}
	if len(avatarStream.sent) == 0 || accountEventProjection(avatarStream.sent[0]).GetAccountId() != "acct-1" {
		t.Fatalf("protected bundled Avatar must receive the Runtime-owned account projection: %+v", avatarStream.sent)
	}

	svc.registry = testAppRegistry(t, firstPartyCaller())
	ctx, cancel := context.WithCancel(context.Background())
	admitted := &accountSessionEventStream{ctx: ctx, afterSend: cancel}
	if err := svc.SubscribeAccountSessionEvents(&runtimev1.SubscribeAccountSessionEventsRequest{Caller: firstPartyCaller()}, admitted); err != context.Canceled {
		t.Fatalf("admitted SubscribeAccountSessionEvents should exit on cancellation, got %v", err)
	}
	if len(admitted.sent) == 0 || accountEventProjection(admitted.sent[0]).GetAccountId() != "acct-1" {
		t.Fatalf("admitted caller should receive account projection snapshot: %+v", admitted.sent)
	}
}

func TestLifecycleRPCsRejectUnregisteredCallerWithoutMutation(t *testing.T) {
	for _, tc := range []struct {
		name string
		act  func(*Service) (bool, runtimev1.AccountReasonCode, error)
	}{
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
		})
	}
}
