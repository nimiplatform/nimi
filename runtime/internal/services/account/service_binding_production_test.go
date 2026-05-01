package account

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
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
