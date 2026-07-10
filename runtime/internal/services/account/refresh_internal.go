package account

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) refreshAccountSessionInternal(ctx context.Context, force bool) (*runtimev1.RefreshAccountSessionResponse, error) {
	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()

	s.mu.Lock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED && s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED {
		state := s.state
		s.mu.Unlock()
		return &runtimev1.RefreshAccountSessionResponse{Accepted: false, State: state, ReasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	current := s.material
	if !force && s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED &&
		strings.TrimSpace(current.AccessToken) != "" &&
		(current.AccessTokenExpires.IsZero() || current.AccessTokenExpires.After(s.now().UTC().Add(30*time.Second))) {
		projection := cloneProjection(s.projection)
		s.mu.Unlock()
		return &runtimev1.RefreshAccountSessionResponse{
			Accepted:          true,
			State:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
			AccountProjection: projection,
			ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
		}, nil
	}
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
