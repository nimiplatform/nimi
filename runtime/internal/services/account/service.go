package account

import (
	"context"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) GetAccountSessionStatus(ctx context.Context, req *runtimev1.GetAccountSessionStatusRequest) (*runtimev1.GetAccountSessionStatusResponse, error) {
	if !s.isActivated() {
		return &runtimev1.GetAccountSessionStatusResponse{
			State:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED,
			ProductionInert:   true,
		}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.GetAccountSessionStatusResponse{
			State:             s.currentState(),
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: reason,
		}, nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return &runtimev1.GetAccountSessionStatusResponse{
		State:             s.state,
		AccountProjection: cloneProjection(s.projection),
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) SubscribeAccountSessionEvents(req *runtimev1.SubscribeAccountSessionEventsRequest, stream runtimev1.RuntimeAccountService_SubscribeAccountSessionEventsServer) error {
	if !s.isActivated() {
		return stream.Send(s.rejectedAccountSessionEvent(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED))
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return stream.Send(s.rejectedAccountSessionEvent(reason))
	}
	snapshot, replay, sub := s.subscribe(req)
	if err := stream.Send(snapshot); err != nil {
		s.removeSubscriber(sub.id)
		return err
	}
	for _, event := range replay {
		if err := stream.Send(event); err != nil {
			s.removeSubscriber(sub.id)
			return err
		}
	}
	defer s.removeSubscriber(sub.id)
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case event := <-sub.ch:
			if err := stream.Send(event); err != nil {
				return err
			}
		}
	}
}

func (s *Service) BeginLogin(ctx context.Context, req *runtimev1.BeginLoginRequest) (*runtimev1.BeginLoginResponse, error) {
	if !s.isActivated() {
		return &runtimev1.BeginLoginResponse{
			Accepted:          false,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED,
			ProductionInert:   true,
		}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.BeginLoginResponse{ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	now := s.now().UTC()
	ttl := time.Duration(req.GetTtlSeconds()) * time.Second
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	requestRedirectURI := strings.TrimSpace(req.GetRedirectUri())
	requestCallbackOrigin := strings.TrimSpace(req.GetCallbackOrigin())
	s.mu.RLock()
	if s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGIN_PENDING {
		for _, record := range s.loginAttempts {
			// A renderer restart may leave an old loopback listener alive while
			// the new renderer waits on a different port. Reuse only when the
			// callback endpoint is identical, so browser success and the active
			// desktop login promise cannot diverge.
			if !record.consumed &&
				record.attempt.ExpiresAt.After(now) &&
				loginAttemptMatchesRequest(record.attempt, requestRedirectURI, requestCallbackOrigin) {
				authorizationURL, ok := s.authorizationURLForAttempt(record.attempt)
				s.mu.RUnlock()
				if !ok {
					return s.loginExchangeUnavailableResponse(), nil
				}
				return &runtimev1.BeginLoginResponse{
					Accepted:              true,
					LoginAttemptId:        record.attempt.LoginAttemptID,
					OauthAuthorizationUrl: authorizationURL,
					CallbackOrigin:        record.attempt.CallbackOrigin,
					State:                 record.attempt.State,
					Nonce:                 record.attempt.Nonce,
					PkceChallenge:         record.attempt.PKCEChallenge,
					ExpiresAt:             timestamppb.New(record.attempt.ExpiresAt),
					ReasonCode:            runtimev1.ReasonCode_ACTION_EXECUTED,
					AccountReasonCode:     runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
				}, nil
			}
		}
	}
	if s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING ||
		s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_SWITCHING ||
		s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGGING_OUT {
		s.mu.RUnlock()
		return &runtimev1.BeginLoginResponse{
			Accepted:          false,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE,
		}, nil
	}
	s.mu.RUnlock()
	attempt := LoginAttempt{
		LoginAttemptID: ulid.Make().String(),
		State:          randomToken(),
		Nonce:          randomToken(),
		PKCEVerifier:   randomToken(),
		RedirectURI:    requestRedirectURI,
		CallbackOrigin: requestCallbackOrigin,
		ExpiresAt:      now.Add(ttl),
	}
	attempt.PKCEChallenge = pkceChallenge(attempt.PKCEVerifier)
	authorizationURL, ok := s.authorizationURLForAttempt(attempt)
	if !ok {
		return s.loginExchangeUnavailableResponse(), nil
	}

	s.mu.Lock()
	if s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGIN_PENDING {
		for id, record := range s.loginAttempts {
			if record.consumed ||
				!record.attempt.ExpiresAt.After(now) ||
				!loginAttemptMatchesRequest(record.attempt, requestRedirectURI, requestCallbackOrigin) {
				delete(s.loginAttempts, id)
			}
		}
	}
	s.loginAttempts[attempt.LoginAttemptID] = loginAttemptRecord{attempt: attempt}
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGIN_PENDING
	event := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_LOGIN_STARTED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	s.mu.Unlock()
	s.publish(event)
	s.publish(statusEvent)

	return &runtimev1.BeginLoginResponse{
		Accepted:              true,
		LoginAttemptId:        attempt.LoginAttemptID,
		OauthAuthorizationUrl: authorizationURL,
		CallbackOrigin:        attempt.CallbackOrigin,
		State:                 attempt.State,
		Nonce:                 attempt.Nonce,
		PkceChallenge:         attempt.PKCEChallenge,
		ExpiresAt:             timestamppb.New(attempt.ExpiresAt),
		ReasonCode:            runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode:     runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) authorizationURLForAttempt(attempt LoginAttempt) (string, bool) {
	provider, ok := s.exchanger.(LoginAuthorizationURLProvider)
	if !ok {
		return "", false
	}
	resolved := strings.TrimSpace(provider.AuthorizationURL(attempt))
	if resolved == "" {
		return "", false
	}
	return resolved, true
}

func (s *Service) loginExchangeUnavailableResponse() *runtimev1.BeginLoginResponse {
	return &runtimev1.BeginLoginResponse{
		Accepted:          false,
		ReasonCode:        commonReason(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE),
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE,
	}
}

func (s *Service) CompleteLogin(ctx context.Context, req *runtimev1.CompleteLoginRequest) (*runtimev1.CompleteLoginResponse, error) {
	if !s.isActivated() {
		return &runtimev1.CompleteLoginResponse{
			Accepted:          false,
			State:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
			ReasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED,
			ProductionInert:   true,
		}, nil
	}
	if strings.TrimSpace(req.GetSealedCompletionTicket()) != "" {
		return &runtimev1.CompleteLoginResponse{
			Accepted:          false,
			State:             s.currentState(),
			ReasonCode:        runtimev1.ReasonCode_AUTH_UNSUPPORTED_PROOF_TYPE,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_UNSUPPORTED,
		}, nil
	}
	attemptID := strings.TrimSpace(req.GetLoginAttemptId())
	code := strings.TrimSpace(req.GetCode())
	if attemptID == "" || code == "" {
		return &runtimev1.CompleteLoginResponse{State: s.currentState(), ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED}, nil
	}

	s.mu.Lock()
	record, exists := s.loginAttempts[attemptID]
	if !exists {
		s.mu.Unlock()
		return &runtimev1.CompleteLoginResponse{State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED}, nil
	}
	if record.consumed {
		s.mu.Unlock()
		return &runtimev1.CompleteLoginResponse{State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_CONSUMED}, nil
	}
	if !record.attempt.ExpiresAt.After(s.now().UTC()) {
		delete(s.loginAttempts, attemptID)
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS
		event := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_LOGIN_TIMED_OUT, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_EXPIRED, "")
		statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_EXPIRED, "")
		s.mu.Unlock()
		s.publish(event)
		s.publish(statusEvent)
		return &runtimev1.CompleteLoginResponse{State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS, ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_EXPIRED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_EXPIRED}, nil
	}
	if record.attempt.State != strings.TrimSpace(req.GetState()) || record.attempt.Nonce != strings.TrimSpace(req.GetNonce()) {
		s.mu.Unlock()
		return &runtimev1.CompleteLoginResponse{State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_MISMATCHED}, nil
	}
	record.consumed = true
	s.loginAttempts[attemptID] = record
	s.mu.Unlock()

	if strings.TrimSpace(req.GetRefreshToken()) != "" {
		s.transitionToReauthRequired(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_UNSUPPORTED)
		return &runtimev1.CompleteLoginResponse{
			Accepted:          false,
			State:             s.currentState(),
			ReasonCode:        runtimev1.ReasonCode_AUTH_UNSUPPORTED_PROOF_TYPE,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_PROOF_UNSUPPORTED,
		}, nil
	}

	material, err := s.exchanger.Exchange(ctx, record.attempt, code)
	if err != nil {
		reason := runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE
		if errors.Is(err, ErrInertNotActivated) {
			reason = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED
		}
		s.transitionToReauthRequired(reason)
		return &runtimev1.CompleteLoginResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	normalized := normalizeMaterial(material)
	if normalized.AccountID == "" || normalized.RefreshToken == "" || normalized.AccessToken == "" {
		s.transitionToReauthRequired(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE)
		return &runtimev1.CompleteLoginResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE}, nil
	}
	if err := s.custody.Store(ctx, s.partition, normalized); err != nil {
		s.markCustodyUnavailable()
		return &runtimev1.CompleteLoginResponse{Accepted: false, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE}, nil
	}

	s.mu.Lock()
	s.material = normalized
	s.projection = projectionFromMaterial(normalized)
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
	loginEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_LOGIN_COMPLETED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	projection := cloneProjection(s.projection)
	s.mu.Unlock()
	s.publish(loginEvent)
	s.publish(statusEvent)

	return &runtimev1.CompleteLoginResponse{
		Accepted:          true,
		State:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
		AccountProjection: projection,
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) GetAccessToken(ctx context.Context, req *runtimev1.GetAccessTokenRequest) (*runtimev1.GetAccessTokenResponse, error) {
	if !s.isActivated() {
		return &runtimev1.GetAccessTokenResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), true); !ok {
		return &runtimev1.GetAccessTokenResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	s.mu.RLock()
	if (s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED && s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED) || s.material.RefreshToken == "" {
		s.mu.RUnlock()
		return &runtimev1.GetAccessTokenResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	needsRefresh := s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED || !s.material.AccessTokenExpires.IsZero() && !s.material.AccessTokenExpires.After(s.now().UTC().Add(30*time.Second))
	s.mu.RUnlock()
	if needsRefresh {
		refresh, err := s.RefreshAccountSession(ctx, &runtimev1.RefreshAccountSessionRequest{Caller: req.GetCaller()})
		if err != nil {
			return nil, err
		}
		if !refresh.GetAccepted() {
			return &runtimev1.GetAccessTokenResponse{Accepted: false, ReasonCode: refresh.GetReasonCode(), AccountReasonCode: refresh.GetAccountReasonCode()}, nil
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED || s.material.AccessToken == "" {
		return &runtimev1.GetAccessTokenResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	return &runtimev1.GetAccessTokenResponse{
		Accepted:          true,
		AccessToken:       s.material.AccessToken,
		ExpiresAt:         timestamppb.New(s.material.AccessTokenExpires),
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RefreshAccountSession(ctx context.Context, req *runtimev1.RefreshAccountSessionRequest) (*runtimev1.RefreshAccountSessionResponse, error) {
	if !s.isActivated() {
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	s.mu.Lock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED && s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED {
		state := s.state
		s.mu.Unlock()
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: state, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	current := s.material
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING
	startEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_STARTED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	s.mu.Unlock()
	s.publish(startEvent)

	next, err := s.refresher.Refresh(ctx, current)
	if err != nil {
		s.transitionToReauthRequired(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE)
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE}, nil
	}
	next = normalizeMaterial(next)
	next.RefreshTokenHashes = copyRefreshHashes(current.RefreshTokenHashes)
	next.RefreshTokenHashes[refreshHash(current.RefreshToken)] = true
	if next.RefreshToken == "" || next.AccessToken == "" || next.AccountID != current.AccountID {
		s.transitionToReauthRequired(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE)
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_AUTH_TOKEN_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_LOGIN_EXCHANGE_UNAVAILABLE}, nil
	}
	if err := s.custody.Store(ctx, s.partition, next); err != nil {
		s.markCustodyUnavailable()
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE}, nil
	}
	s.mu.Lock()
	s.material = next
	s.projection = projectionFromMaterial(next)
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
	revoked := s.revokeWorkspaceBindingsWithoutActiveMembershipLocked()
	refreshEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_COMPLETED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	projection := cloneProjection(s.projection)
	s.mu.Unlock()
	for _, event := range revoked {
		s.publish(event)
	}
	s.publish(refreshEvent)
	s.publish(statusEvent)
	return &runtimev1.RefreshAccountSessionResponse{Accepted: true, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED, AccountProjection: projection, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED}, nil
}

func (s *Service) Logout(ctx context.Context, req *runtimev1.LogoutRequest) (*runtimev1.LogoutResponse, error) {
	if !s.isActivated() {
		return &runtimev1.LogoutResponse{Accepted: false, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAccountControlCaller(req.GetCaller()); !ok {
		return &runtimev1.LogoutResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	return s.logout(ctx, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
}

func (s *Service) SwitchAccount(ctx context.Context, req *runtimev1.SwitchAccountRequest) (*runtimev1.SwitchAccountResponse, error) {
	if !s.isActivated() {
		return &runtimev1.SwitchAccountResponse{Accepted: false, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAccountControlCaller(req.GetCaller()); !ok {
		return &runtimev1.SwitchAccountResponse{Accepted: false, State: s.currentState(), ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	s.mu.Lock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		state := s.state
		s.mu.Unlock()
		return &runtimev1.SwitchAccountResponse{Accepted: false, State: state, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_SWITCHING
	switchStart := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_SWITCH_STARTED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	revoked := s.revokeBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
	s.material = AccountMaterial{}
	s.projection = nil
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS
	switchDone := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_SWITCH_COMPLETED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	state := s.state
	s.mu.Unlock()
	_ = s.custody.Clear(ctx, s.partition)
	s.publish(switchStart)
	for _, event := range revoked {
		s.publish(event)
	}
	s.publish(switchDone)
	s.publish(statusEvent)
	return &runtimev1.SwitchAccountResponse{Accepted: true, State: state, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED}, nil
}

func (s *Service) IssueScopedAppBinding(ctx context.Context, req *runtimev1.IssueScopedAppBindingRequest) (*runtimev1.IssueScopedAppBindingResponse, error) {
	if !s.isActivated() {
		return &runtimev1.IssueScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.IssueScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	relation := cloneRelation(req.GetRelation())
	if relation == nil || strings.TrimSpace(relation.GetRuntimeAppId()) == "" || strings.TrimSpace(relation.GetAgentId()) == "" {
		return &runtimev1.IssueScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE}, nil
	}
	if reason, ok := validateBindingCallerRelation(req.GetCaller(), relation); !ok {
		return &runtimev1.IssueScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	s.mu.Lock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		stateEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		s.mu.Unlock()
		s.publish(stateEvent)
		return &runtimev1.IssueScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	now := s.now().UTC()
	ttl := time.Duration(req.GetTtlSeconds()) * time.Second
	if ttl <= 0 {
		ttl = time.Hour
	}
	bindingID := ulid.Make().String()
	relation.BindingId = bindingID
	relation.IssuedAt = timestamppb.New(now)
	relation.ExpiresAt = timestamppb.New(now.Add(ttl))
	relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_ISSUED
	relation.ReasonCode = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED
	issued := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_ISSUED, relation)
	relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_ACTIVE
	activated := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_ACTIVATED, relation)
	carrier := "binding:" + bindingID
	s.bindings[bindingID] = bindingRecord{relation: cloneRelation(relation), carrier: carrier}
	s.mu.Unlock()
	s.publish(issued)
	s.publish(activated)

	return &runtimev1.IssueScopedAppBindingResponse{
		Accepted:          true,
		BindingId:         bindingID,
		BindingCarrier:    carrier,
		Relation:          cloneRelation(relation),
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RevokeScopedAppBinding(ctx context.Context, req *runtimev1.RevokeScopedAppBindingRequest) (*runtimev1.RevokeScopedAppBindingResponse, error) {
	if !s.isActivated() {
		return &runtimev1.RevokeScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateRuntimeAdmittedCaller(req.GetCaller(), false); !ok {
		return &runtimev1.RevokeScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	bindingID := strings.TrimSpace(req.GetBindingId())
	s.mu.Lock()
	record, exists := s.bindings[bindingID]
	if !exists {
		s.mu.Unlock()
		return &runtimev1.RevokeScopedAppBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_APP_GRANT_INVALID, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND}, nil
	}
	if reason, ok := validateBindingCallerRelation(req.GetCaller(), record.relation); !ok {
		s.mu.Unlock()
		return &runtimev1.RevokeScopedAppBindingResponse{Accepted: false, ReasonCode: commonReason(reason), AccountReasonCode: reason}, nil
	}
	reason := req.GetReasonCode()
	if reason == runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_UNSPECIFIED {
		reason = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED
	}
	record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_REVOKED
	record.relation.ReasonCode = reason
	s.bindings[bindingID] = record
	event := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED, record.relation)
	s.mu.Unlock()
	s.publish(event)
	return &runtimev1.RevokeScopedAppBindingResponse{Accepted: true, Relation: cloneRelation(record.relation), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: reason}, nil
}

func (s *Service) IssueWorkspaceBinding(ctx context.Context, req *runtimev1.IssueWorkspaceBindingRequest) (*runtimev1.IssueWorkspaceBindingResponse, error) {
	if !s.isActivated() {
		return &runtimev1.IssueWorkspaceBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateWorkspaceBindingCaller(req.GetCaller()); !ok {
		return &runtimev1.IssueWorkspaceBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	workspaceID := strings.TrimSpace(req.GetWorkspaceId())
	scopes := normalizeWorkspaceScopes(req.GetScopes())
	if workspaceID == "" || !workspaceScopesValid(scopes) {
		return &runtimev1.IssueWorkspaceBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_WORKSPACE_BINDING_MALFORMED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE}, nil
	}
	s.mu.Lock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		stateEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		s.mu.Unlock()
		s.publish(stateEvent)
		return &runtimev1.IssueWorkspaceBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	if s.accountMaterialExpiredLocked() {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED
		revoked := s.revokeBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE)
		stateEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		s.mu.Unlock()
		for _, event := range revoked {
			s.publish(event)
		}
		s.publish(stateEvent)
		return &runtimev1.IssueWorkspaceBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	if !s.hasActiveWorkspaceMembershipLocked(workspaceID, s.material.RealmEnvironmentID) {
		s.mu.Unlock()
		return &runtimev1.IssueWorkspaceBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	now := s.now().UTC()
	ttl := time.Duration(req.GetTtlSeconds()) * time.Second
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	bindingID := ulid.Make().String()
	attachment := &runtimev1.WorkspaceBindingAttachment{
		BindingId:          bindingID,
		BindingHandle:      "workspace-binding:" + bindingID,
		RuntimeAppId:       strings.TrimSpace(req.GetCaller().GetAppId()),
		AppInstanceId:      strings.TrimSpace(req.GetCaller().GetAppInstanceId()),
		WorkspaceId:        workspaceID,
		RealmEnvironmentId: strings.TrimSpace(s.material.RealmEnvironmentID),
	}
	relation := &runtimev1.WorkspaceBindingRelation{
		BindingId:          bindingID,
		RuntimeAppId:       attachment.GetRuntimeAppId(),
		AppInstanceId:      attachment.GetAppInstanceId(),
		DeviceId:           strings.TrimSpace(req.GetCaller().GetDeviceId()),
		AccountId:          strings.TrimSpace(s.material.AccountID),
		RealmEnvironmentId: attachment.GetRealmEnvironmentId(),
		WorkspaceId:        workspaceID,
		Purpose:            runtimev1.WorkspaceBindingPurpose_WORKSPACE_BINDING_PURPOSE_KNOWLEDGE_CONSUME,
		Scopes:             append([]string(nil), scopes...),
		IssuedAt:           timestamppb.New(now),
		ExpiresAt:          timestamppb.New(now.Add(ttl)),
		State:              runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_ISSUED,
		ReasonCode:         runtimev1.ReasonCode_ACTION_EXECUTED,
	}
	issued := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_ISSUED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, bindingID)
	relation.State = runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_ACTIVE
	activated := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_ACTIVATED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, bindingID)
	s.workspaceBindings[bindingID] = workspaceBindingRecord{relation: cloneWorkspaceRelation(relation), attachment: cloneWorkspaceAttachment(attachment)}
	s.mu.Unlock()
	s.publish(issued)
	s.publish(activated)
	return &runtimev1.IssueWorkspaceBindingResponse{
		Accepted:          true,
		BindingId:         bindingID,
		Attachment:        cloneWorkspaceAttachment(attachment),
		Relation:          cloneWorkspaceRelation(relation),
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RevokeWorkspaceBinding(ctx context.Context, req *runtimev1.RevokeWorkspaceBindingRequest) (*runtimev1.RevokeWorkspaceBindingResponse, error) {
	if !s.isActivated() {
		return &runtimev1.RevokeWorkspaceBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED, ProductionInert: true}, nil
	}
	if reason, ok := s.validateWorkspaceBindingCaller(req.GetCaller()); !ok {
		return &runtimev1.RevokeWorkspaceBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: reason}, nil
	}
	bindingID := strings.TrimSpace(req.GetBindingId())
	s.mu.Lock()
	record, exists := s.workspaceBindings[bindingID]
	if !exists {
		s.mu.Unlock()
		return &runtimev1.RevokeWorkspaceBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_WORKSPACE_BINDING_NOT_FOUND, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND}, nil
	}
	if strings.TrimSpace(req.GetCaller().GetAppId()) != strings.TrimSpace(record.relation.GetRuntimeAppId()) ||
		strings.TrimSpace(req.GetCaller().GetAppInstanceId()) != strings.TrimSpace(record.relation.GetAppInstanceId()) ||
		strings.TrimSpace(req.GetCaller().GetDeviceId()) != strings.TrimSpace(record.relation.GetDeviceId()) {
		s.mu.Unlock()
		return &runtimev1.RevokeWorkspaceBindingResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_WORKSPACE_BINDING_CALLER_MISMATCH, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED}, nil
	}
	reason := req.GetReasonCode()
	if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		reason = runtimev1.ReasonCode_WORKSPACE_BINDING_REVOKED
	}
	if record.relation.GetState() != runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_REVOKED {
		record.relation.State = runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_REVOKED
		record.relation.ReasonCode = reason
		s.workspaceBindings[bindingID] = record
		event := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED, workspaceBindingAccountReason(reason), bindingID)
		s.mu.Unlock()
		s.publish(event)
		return &runtimev1.RevokeWorkspaceBindingResponse{Accepted: true, Relation: cloneWorkspaceRelation(record.relation), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: workspaceBindingAccountReason(reason)}, nil
	}
	s.mu.Unlock()
	return &runtimev1.RevokeWorkspaceBindingResponse{Accepted: true, Relation: cloneWorkspaceRelation(record.relation), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: workspaceBindingAccountReason(record.relation.GetReasonCode())}, nil
}

func (s *Service) ValidateScopedBinding(bindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool) {
	trimmed := strings.TrimSpace(bindingID)
	s.mu.Lock()
	defer s.mu.Unlock()
	record, exists := s.bindings[trimmed]
	if !exists {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND, false
	}
	if record.relation.GetState() != runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_ACTIVE {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE, false
	}
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_REVOKED
		record.relation.ReasonCode = bindingRevocationReasonForAccountState(s.state)
		s.bindings[trimmed] = record
		event := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED, record.relation)
		go s.publish(event)
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, false
	}
	now := s.now().UTC()
	if expires := record.relation.GetExpiresAt().AsTime(); !expires.IsZero() && !expires.After(now) {
		record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_EXPIRED
		record.relation.ReasonCode = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE
		s.bindings[trimmed] = record
		event := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_EXPIRED, record.relation)
		go s.publish(event)
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE, false
	}
	if relationReplay(record.relation, actual) {
		record.relation.State = runtimev1.ScopedAppBindingState_SCOPED_APP_BINDING_STATE_REVOKED
		record.relation.ReasonCode = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_REPLAY
		s.bindings[trimmed] = record
		event := s.appendBindingEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REPLAY_DETECTED, record.relation)
		go s.publish(event)
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_REPLAY, false
	}
	if requiredScope != "" && !scopeIncluded(record.relation.GetScopes(), requiredScope) {
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_STALE, false
	}
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func (s *Service) hasActiveWorkspaceMembershipLocked(workspaceID string, realmEnvironmentID string) bool {
	workspaceID = strings.TrimSpace(workspaceID)
	realmEnvironmentID = strings.TrimSpace(realmEnvironmentID)
	if workspaceID == "" || realmEnvironmentID == "" {
		return false
	}
	for _, membership := range s.material.WorkspaceMemberships {
		if strings.TrimSpace(membership.GetWorkspaceId()) != workspaceID {
			continue
		}
		if strings.TrimSpace(membership.GetRealmEnvironmentId()) != realmEnvironmentID {
			return false
		}
		return membership.GetMembershipState() == runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE &&
			s.workspaceMembershipProjectionFreshLocked(membership)
	}
	return false
}

func (s *Service) workspaceMembershipProjectionFreshLocked(membership *runtimev1.WorkspaceMembershipProjection) bool {
	if membership.GetObservedAt() == nil {
		return false
	}
	observedAt := membership.GetObservedAt().AsTime()
	if observedAt.IsZero() {
		return false
	}
	now := s.now().UTC()
	if observedAt.After(now) {
		return false
	}
	return !observedAt.Before(now.Add(-workspaceMembershipProjectionMaxAge))
}

func (s *Service) accountMaterialExpiredLocked() bool {
	return !s.material.AccessTokenExpires.IsZero() && !s.material.AccessTokenExpires.After(s.now().UTC())
}

func (s *Service) ObserveRefreshToken(ctx context.Context, token string) (runtimev1.AccountReasonCode, bool) {
	hash := refreshHash(token)
	s.mu.Lock()
	if s.material.RefreshTokenHashes[hash] {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
		revoked := s.revokeBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED)
		s.material = AccountMaterial{}
		s.projection = nil
		event := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED, "")
		statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED, "")
		s.mu.Unlock()
		for _, revokeEvent := range revoked {
			go s.publish(revokeEvent)
		}
		go s.publish(event)
		go s.publish(statusEvent)
		_ = s.custody.Clear(ctx, s.partition)
		return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_REUSE_DETECTED, false
	}
	s.mu.Unlock()
	return runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, true
}

func (s *Service) recoverFromCustody(ctx context.Context) {
	material, err := s.custody.Load(ctx, s.partition)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		if errors.Is(err, ErrNoStoredAccount) {
			s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS
			s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
			return
		}
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_CUSTODY_UNAVAILABLE, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE, "")
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE, "")
		return
	}
	material = normalizeMaterial(material)
	if material.AccountID == "" || material.RefreshToken == "" || material.AccessToken == "" {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		return
	}
	if !material.AccessTokenExpires.IsZero() && !material.AccessTokenExpires.After(s.now().UTC()) {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED
		s.material = material
		s.projection = projectionFromMaterial(material)
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		return
	}
	s.material = material
	s.projection = projectionFromMaterial(material)
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_CUSTODY_RECOVERED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
}

func (s *Service) logout(ctx context.Context, reason runtimev1.AccountReasonCode) (*runtimev1.LogoutResponse, error) {
	s.mu.Lock()
	if s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS {
		s.mu.Unlock()
		return &runtimev1.LogoutResponse{Accepted: true, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED}, nil
	}
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_LOGGING_OUT
	start := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_LOGOUT_STARTED, reason, "")
	revoked := s.revokeBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
	s.material = AccountMaterial{}
	s.projection = nil
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS
	done := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_LOGOUT_COMPLETED, reason, "")
	statusEvent := s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, reason, "")
	s.mu.Unlock()
	_ = s.custody.Clear(ctx, s.partition)
	s.publish(start)
	for _, event := range revoked {
		s.publish(event)
	}
	s.publish(done)
	s.publish(statusEvent)
	return &runtimev1.LogoutResponse{Accepted: true, State: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, AccountReasonCode: reason}, nil
}

func (s *Service) mustEmbedUnimplementedRuntimeAccountServiceServer() {}
