package account

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"google.golang.org/grpc/metadata"
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
			modHostBinding := issueBindingForRelation(t, svc, bindingRelationFor("window-mod", "avatar-mod", "agent-mod", "anchor-mod"))
			for _, binding := range []*runtimev1.IssueScopedAppBindingResponse{avatarBinding, modHostBinding} {
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
			for _, binding := range []*runtimev1.IssueScopedAppBindingResponse{avatarBinding, modHostBinding} {
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

func TestGetAccessTokenRejectsAnonymousUnavailableAvatarModAndRevokedCaller(t *testing.T) {
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
	mod := *firstPartyCaller()
	mod.Mode = runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_MOD
	resp, err = svc.GetAccessToken(context.Background(), &runtimev1.GetAccessTokenRequest{Caller: &mod})
	if err != nil {
		t.Fatalf("mod GetAccessToken: %v", err)
	}
	if resp.GetAccepted() || resp.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_MOD_TOKEN_FORBIDDEN {
		t.Fatalf("mod token request must fail: %+v", resp)
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
		if r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("code") != "auth-code" || r.Form.Get("code_verifier") == "" {
			t.Fatalf("unexpected exchange form: %v", r.Form)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"access-prod","refresh_token":"refresh-prod","expires_in":300,"user":{"id":"acct-prod","displayName":"Prod User"}}`))
	}))
	defer authServer.Close()
	exchanger := newRealmOAuthExchanger(resolveProductionConfig(ProductionConfig{
		RealmBaseURL:     authServer.URL,
		AuthorizationURL: authServer.URL + "/authorize",
		TokenURL:         authServer.URL + "/token",
		ClientID:         "desktop-test",
		RedirectURI:      "http://localhost/callback",
		HTTPClient:       authServer.Client(),
	}))
	svc := newProductionHarnessService(t, custody, WithLoginExchanger(exchanger))
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
		Caller:      firstPartyCaller(),
		RedirectUri: "http://localhost/callback",
	})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if !begin.GetAccepted() ||
		!strings.Contains(begin.GetOauthAuthorizationUrl(), "#/login?") ||
		!strings.Contains(begin.GetOauthAuthorizationUrl(), "desktop_callback=") ||
		!strings.Contains(begin.GetOauthAuthorizationUrl(), "desktop_state=") {
		t.Fatalf("production BeginLogin did not return Nimi Web browser callback instruction: %+v", begin)
	}
	complete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         firstPartyCaller(),
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "auth-code",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
		RedirectUri:    "http://localhost/callback",
	})
	if err != nil {
		t.Fatalf("CompleteLogin: %v", err)
	}
	if !complete.GetAccepted() || complete.GetAccountProjection().GetAccountId() != "acct-prod" {
		t.Fatalf("production CompleteLogin failed: %+v", complete)
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

func TestProductionCompleteLoginAdoptsNimiWebBrowserCallbackTokens(t *testing.T) {
	custody := &memoryCustody{}
	exchanger := newRealmOAuthExchanger(resolveProductionConfig(ProductionConfig{
		AuthorizationURL: "https://app.nimi.test#/login",
		ClientID:         "desktop-test",
		RedirectURI:      "http://localhost/callback",
		HTTPClient:       http.DefaultClient,
	}))
	svc := newProductionHarnessService(t, custody, WithLoginExchanger(exchanger))
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{
		Caller:      firstPartyCaller(),
		RedirectUri: "http://localhost/callback",
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
		RedirectUri:    "http://localhost/callback",
	})
	if err != nil {
		t.Fatalf("CompleteLogin: %v", err)
	}
	if !complete.GetAccepted() || complete.GetAccountProjection().GetAccountId() != "acct-web-callback" {
		t.Fatalf("browser callback token adoption failed: %+v", complete)
	}
	if !custody.has || custody.material.AccessToken != accessToken || custody.material.RefreshToken != "refresh-web-callback" {
		t.Fatalf("browser callback material not stored in Runtime custody: %+v", custody.material)
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
