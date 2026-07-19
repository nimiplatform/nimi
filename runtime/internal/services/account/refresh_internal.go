package account

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type refreshAccountSessionResult struct {
	accepted          bool
	state             runtimev1.AccountSessionState
	accountProjection *runtimev1.AccountProjection
	reasonCode        runtimev1.ReasonCode
	accountReasonCode runtimev1.AccountReasonCode
}

func (s *Service) refreshAccountSessionAfterUnauthorized(
	ctx context.Context,
	rejectedAccessToken string,
) (*refreshAccountSessionResult, error) {
	return s.refreshAccountSessionForRejectedToken(ctx, true, rejectedAccessToken)
}

func (s *Service) refreshAccountSessionInternal(ctx context.Context, force bool) (*refreshAccountSessionResult, error) {
	return s.refreshAccountSessionForRejectedToken(ctx, force, "")
}

func (s *Service) refreshAccountSessionForRejectedToken(
	ctx context.Context,
	force bool,
	rejectedAccessToken string,
) (*refreshAccountSessionResult, error) {
	s.identityMutationMu.Lock()
	defer s.identityMutationMu.Unlock()

	s.mu.Lock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED &&
		s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED &&
		s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING {
		state := s.state
		s.mu.Unlock()
		return &refreshAccountSessionResult{accepted: false, state: state, reasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	current := s.material
	if rejected := strings.TrimSpace(rejectedAccessToken); rejected != "" &&
		s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED &&
		strings.TrimSpace(current.AccessToken) != "" && strings.TrimSpace(current.AccessToken) != rejected {
		projection := cloneProjection(s.projection)
		s.mu.Unlock()
		return &refreshAccountSessionResult{
			accepted:          true,
			state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
			accountProjection: projection,
			reasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
			accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
		}, nil
	}
	if !force && s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED &&
		strings.TrimSpace(current.AccessToken) != "" &&
		(current.AccessTokenExpires.IsZero() || current.AccessTokenExpires.After(s.now().UTC().Add(30*time.Second))) {
		projection := cloneProjection(s.projection)
		s.mu.Unlock()
		return &refreshAccountSessionResult{
			accepted:          true,
			state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
			accountProjection: projection,
			reasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
			accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
		}, nil
	}
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_STARTED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	s.mu.Unlock()

	// Persist a consumed-active-token marker before the refresh request leaves
	// Runtime. If the process exits after Realm rotates the token but before the
	// new pair commits, restart recovery will reject this marked material rather
	// than resurrecting an uncertain refresh token.
	markedCurrent := current
	markedCurrent.WorkspaceMemberships = cloneWorkspaceMemberships(current.WorkspaceMemberships)
	markedCurrent.RefreshTokenHashes = copyRefreshHashes(current.RefreshTokenHashes)
	markedCurrent.RefreshTokenHashes[refreshHash(current.RefreshToken)] = true
	if err := s.custody.Store(ctx, s.partition, markedCurrent); err != nil {
		s.markCustodyUnavailable()
		return &refreshAccountSessionResult{
			accepted:          false,
			state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
			reasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE,
		}, nil
	}

	next, err := s.refresher.Refresh(ctx, markedCurrent)
	if err != nil {
		switch refreshFailureDispositionOf(err) {
		case refreshFailurePreDispatch:
			return s.deferRefreshAndRestoreCustody(ctx, current), nil
		case refreshFailureTokenInvalid:
			return s.failRefreshAndClearCustody(ctx, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_TOKEN_INVALID), nil
		case refreshFailureContractInvalid:
			return s.failRefreshAndClearCustody(ctx, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_CONTRACT_INVALID), nil
		default:
			return s.failRefreshAndClearCustody(ctx, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS), nil
		}
	}
	next = normalizeMaterial(next)
	next.RefreshTokenHashes = copyRefreshHashes(markedCurrent.RefreshTokenHashes)
	if next.RefreshToken == "" || next.AccessToken == "" || next.AccountID != current.AccountID {
		return s.failRefreshAndClearCustody(ctx, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_CONTRACT_INVALID), nil
	}
	if err := s.custody.Store(ctx, s.partition, next); err != nil {
		s.markCustodyUnavailable()
		return &refreshAccountSessionResult{accepted: false, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, reasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE}, nil
	}
	s.mu.Lock()
	if !s.installAuthenticatedRuntimeIdentityLocked(next) {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE
		s.revokeBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE)
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		s.mu.Unlock()
		_ = s.custody.Clear(ctx, s.partition)
		return &refreshAccountSessionResult{accepted: false, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, reasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
	s.refreshRetryAttempt = 0
	s.revokeWorkspaceBindingsWithoutActiveMembershipLocked()
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_COMPLETED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED, "")
	projection := cloneProjection(s.projection)
	s.mu.Unlock()
	return &refreshAccountSessionResult{accepted: true, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED, accountProjection: projection, reasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED}, nil
}

func (s *Service) deferRefreshAndRestoreCustody(ctx context.Context, current AccountMaterial) *refreshAccountSessionResult {
	if err := s.custody.Store(ctx, s.partition, current); err != nil {
		s.markCustodyUnavailable()
		return &refreshAccountSessionResult{
			accepted:          false,
			state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
			reasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE,
		}
	}
	s.mu.Lock()
	s.material = current
	if !current.AccessTokenExpires.IsZero() && !current.AccessTokenExpires.After(s.now().UTC()) {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED
		s.refreshRetryAttempt = 0
		s.invalidateAuthenticatedRuntimeIdentityLocked()
		s.revokeBindingsLocked(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE)
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, "")
		projection := cloneProjection(s.projection)
		s.mu.Unlock()
		return &refreshAccountSessionResult{
			accepted:          false,
			state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED,
			accountProjection: projection,
			reasonCode:        runtimev1.ReasonCode_AUTH_TOKEN_EXPIRED,
			accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE,
		}
	}
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING
	if s.refreshRetryAttempt < 5 {
		s.refreshRetryAttempt++
	}
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_DEFERRED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED, "")
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED, "")
	projection := cloneProjection(s.projection)
	s.mu.Unlock()
	return &refreshAccountSessionResult{
		accepted:          false,
		state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING,
		accountProjection: projection,
		reasonCode:        runtimev1.ReasonCode_REALM_UNAVAILABLE,
		accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED,
	}
}

// failRefreshAndClearCustody runs while identityMutationMu is held. Durable
// material is removed before the in-memory failure transition is published, so
// another account mutation cannot race a stale authenticated restart into the
// failed refresh epoch. A custody clear failure is itself an unavailable
// authority state and must not be reported as an ordinary reauthentication.
func (s *Service) failRefreshAndClearCustody(
	ctx context.Context,
	reason runtimev1.AccountReasonCode,
) *refreshAccountSessionResult {
	if err := s.custody.Clear(ctx, s.partition); err != nil {
		s.markCustodyUnavailable()
		return &refreshAccountSessionResult{
			accepted:          false,
			state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
			reasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE,
		}
	}
	s.transitionToReauthRequired(reason)
	return &refreshAccountSessionResult{
		accepted:          false,
		state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED,
		reasonCode:        runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
		accountReasonCode: reason,
	}
}
