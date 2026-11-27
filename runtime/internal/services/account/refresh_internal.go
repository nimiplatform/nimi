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
	generation uint64,
) (*refreshAccountSessionResult, error) {
	return s.refreshAccountSessionForRejectedToken(ctx, true, rejectedAccessToken, accountRefreshRealmUnauthorized, &generation)
}

func (s *Service) refreshAccountSessionInternal(ctx context.Context, force bool) (*refreshAccountSessionResult, error) {
	return s.refreshAccountSessionForRejectedToken(ctx, force, "", accountRefreshInternal, nil)
}

// @nimi-authority: rule.nimi.runtime.protected-session.r030
// @nimi-authority: rule.nimi.runtime.protected-session.r031
func (s *Service) refreshAccountSessionForRejectedToken(
	ctx context.Context,
	force bool,
	rejectedAccessToken string,
	cause accountRefreshCause,
	expectedGeneration *uint64,
) (*refreshAccountSessionResult, error) {
	s.identityMutationMu.Lock()
	defer s.identityMutationMu.Unlock()
	return s.refreshAccountSessionLocked(ctx, force, rejectedAccessToken, cause, expectedGeneration)
}

func (s *Service) refreshAccountSessionLocked(ctx context.Context, force bool, rejectedAccessToken string, cause accountRefreshCause, expectedGeneration *uint64) (result *refreshAccountSessionResult, err error) {
	var auditSubjectID string
	var beforeState runtimev1.AccountSessionState
	var beforeRevision string
	refreshAttempted := false
	defer func() {
		if refreshAttempted && result != nil && !result.accepted && result.accountReasonCode != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_DELETED {
			s.emitRejectedAudit(ctx, "account.refresh.failed", auditSubjectID, result.reasonCode, result.accountReasonCode, "")
		}
		if refreshAttempted {
			s.logAccountAuthorizationTransition(cause, beforeState, beforeRevision, result != nil && result.accepted)
		}
	}()

	s.mu.Lock()
	if expectedGeneration != nil && *expectedGeneration != s.accountGeneration {
		state := s.state
		s.mu.Unlock()
		return &refreshAccountSessionResult{state: state, reasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED &&
		s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED &&
		s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING {
		state := s.state
		s.mu.Unlock()
		return &refreshAccountSessionResult{accepted: false, state: state, reasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	current := s.material
	beforeState, beforeRevision = s.projectedAccountAuthorizationLocked()
	if current.OnlineCredentialsCleared || strings.TrimSpace(current.RefreshToken) == "" {
		state := s.state
		projection := cloneProjection(s.projection)
		reason := runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED
		accountReason := runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE
		if current.OnlineCredentialsCleared {
			reason = runtimev1.ReasonCode_REALM_UNAVAILABLE
			accountReason = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS
		}
		s.mu.Unlock()
		return &refreshAccountSessionResult{
			accepted:          false,
			state:             state,
			accountProjection: projection,
			reasonCode:        reason,
			accountReasonCode: accountReason,
		}, nil
	}
	if rejected := strings.TrimSpace(rejectedAccessToken); rejected != "" &&
		s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED &&
		s.onlineAccessTokenLiveLocked() &&
		strings.TrimSpace(current.AccessToken) != rejected {
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
		if s.stateReason == runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED {
			s.stateReason = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED
			s.refreshRetryAttempt = 0
			s.rebuildRefreshTimerLocked()
		}
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
	auditSubjectID = current.AccountID
	refreshAttempted = true
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_STARTED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
	s.mu.Unlock()

	// Persist a consumed-active-token marker before the refresh request leaves
	// Runtime. If the process exits after Realm rotates the token but before the
	// new pair commits, restart recovery will reject this marked material rather
	// than resurrecting an uncertain refresh token.
	markedCurrent := current
	markedCurrent.WorkspaceMemberships = cloneWorkspaceMemberships(current.WorkspaceMemberships)
	// Realm owns refresh-family replay detection. Locally retain only the
	// active transaction marker needed to reject uncertain restart recovery.
	markedCurrent.RefreshTokenHashes = map[string]bool{refreshHash(current.RefreshToken): true}
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
		if deleted, ok := observedRealmAccountDeletedResultFromError(err); ok {
			s.mu.RLock()
			observer := s.realmAccountDeletedObserver
			s.mu.RUnlock()
			if observer == nil || observer.ConsumeRealmAccountDeletedResult(ctx, deleted) != nil {
				return s.failAccountDeletedObservationAndPreserveCustody(ctx, markedCurrent, deleted), nil
			}
			result := s.failRefreshAndClearCustody(ctx, markedCurrent, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_DELETED)
			if result.accountReasonCode == runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_DELETED {
				s.emitAudit(ctx, "account.realm_account_deleted", deleted.AccountID(), runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
					"operation_id": deleted.OperationID(),
				})
			}
			return result, nil
		}
		switch refreshFailureDispositionOf(err) {
		case refreshFailurePreDispatch:
			return s.deferRefreshAndRestoreCustody(ctx, current), nil
		case refreshFailureOutcomeAmbiguous:
			return s.clearOnlineCredentialsAfterAmbiguousRefresh(ctx, current, markedCurrent), nil
		case refreshFailureTokenInvalid:
			return s.failRefreshAndClearCustody(ctx, markedCurrent, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_TOKEN_INVALID), nil
		case refreshFailureContractInvalid:
			return s.failRefreshAndClearCustody(ctx, markedCurrent, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_CONTRACT_INVALID), nil
		default:
			return s.failRefreshAndClearCustody(ctx, markedCurrent, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS), nil
		}
	}
	next.OnlineCredentialsCleared = false
	next.PendingRevocation = false
	next = normalizeMaterial(next)
	next.RefreshTokenHashes = nil
	if next.RefreshToken == "" || next.AccessToken == "" || next.AccountID != current.AccountID {
		return s.failRefreshAndClearCustody(ctx, markedCurrent, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_CONTRACT_INVALID), nil
	}
	if err := s.custody.Store(ctx, s.partition, next); err != nil {
		s.markCustodyUnavailable()
		return &refreshAccountSessionResult{accepted: false, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, reasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE}, nil
	}
	s.mu.Lock()
	if !s.installAuthenticatedRuntimeIdentityLocked(next) {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE)
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE)
		s.mu.Unlock()
		_ = s.custody.Clear(ctx, s.partition)
		return &refreshAccountSessionResult{accepted: false, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE, reasonCode: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE}, nil
	}
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
	s.refreshRetryAttempt = 0
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_COMPLETED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED)
	projection := cloneProjection(s.projection)
	s.mu.Unlock()
	s.emitAudit(ctx, "account.refresh.complete", next.AccountID, runtimev1.ReasonCode_ACTION_EXECUTED, nil)
	return &refreshAccountSessionResult{accepted: true, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED, accountProjection: projection, reasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED}, nil
}

func (s *Service) failAccountDeletedObservationAndPreserveCustody(
	ctx context.Context,
	markedCurrent AccountMaterial,
	deleted ObservedRealmAccountDeletedResult,
) *refreshAccountSessionResult {
	// Realm has already returned exact ACCOUNT_DELETED. Preserve both the
	// pre-refresh self-hash marker and the closed typed terminal fact in the
	// existing Account custody. Runtime can replay the same fact after its local
	// namespace owner becomes available, while the credential remains unusable.
	pending := deleted
	markedCurrent.pendingRealmDeletion = &pending
	if err := s.custody.Store(custodyCleanupContext(ctx), s.partition, markedCurrent); err != nil {
		s.markCustodyUnavailable()
		return &refreshAccountSessionResult{
			accepted: false, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
			reasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE,
		}
	}
	s.mu.Lock()
	s.material = markedCurrent
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE
	s.realmDeletionRetryAttempt = 0
	s.invalidateAuthenticatedRuntimeIdentityLocked()
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE)
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE)
	projection := cloneProjection(s.projection)
	s.mu.Unlock()
	return &refreshAccountSessionResult{
		accepted: false, state: runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
		accountProjection: projection, reasonCode: runtimev1.ReasonCode_REALM_UNAVAILABLE,
		accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE,
	}
}

func (s *Service) deferRefreshAndRestoreCustody(ctx context.Context, current AccountMaterial) *refreshAccountSessionResult {
	if err := s.custody.Store(custodyCleanupContext(ctx), s.partition, current); err != nil {
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
	// A provably pre-dispatch failure preserves durable refresh custody and any
	// established trusted local sign-in identity even if the short-lived online
	// Realm access token has expired. Online Realm and remote operations still
	// fail closed until refresh succeeds on reconnect.
	if s.authenticatedRuntimeIdentity {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
	} else {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING
	}
	if s.refreshRetryAttempt < 5 {
		s.refreshRetryAttempt++
	}
	nextState := s.state
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_DEFERRED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED)
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED)
	projection := cloneProjection(s.projection)
	s.mu.Unlock()
	return &refreshAccountSessionResult{
		accepted:          false,
		state:             nextState,
		accountProjection: projection,
		reasonCode:        runtimev1.ReasonCode_REALM_UNAVAILABLE,
		accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED,
	}
}

// clearOnlineCredentialsAfterAmbiguousRefresh runs while identityMutationMu is
// held. On ambiguous or possibly-rotated refresh outcomes (such as post-dispatch
// transport drop or Realm 503 verification unavailability), Runtime immediately
// erases potentially rotated online tokens from memory and durable custody so
// they are never retained or replayed, while preserving any previously
// established trusted local authenticated Runtime identity across offline use
// and cold-start recovery.
// @nimi-authority: rule.nimi.runtime.protected-session.r031
func (s *Service) clearOnlineCredentialsAfterAmbiguousRefresh(
	ctx context.Context,
	current AccountMaterial,
	markedCurrent AccountMaterial,
) *refreshAccountSessionResult {
	s.mu.RLock()
	hasTrustedLocalIdentity := s.authenticatedRuntimeIdentity &&
		strings.TrimSpace(current.AccountID) != "" &&
		strings.TrimSpace(current.RealmEnvironmentID) != ""
	s.mu.RUnlock()
	if !hasTrustedLocalIdentity {
		return s.failRefreshAndClearCustody(ctx, markedCurrent, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS)
	}
	cleared := clearOnlineCredentialsFromMaterial(current)
	if err := s.custody.Store(custodyCleanupContext(ctx), s.partition, cleared); err != nil {
		s.markCustodyUnavailable()
		return &refreshAccountSessionResult{
			accepted:          false,
			state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
			reasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE,
		}
	}
	s.mu.Lock()
	s.material = cleared
	s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED
	s.refreshRetryAttempt = 0
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_REFRESH_FAILED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS)
	s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS)
	projection := cloneProjection(s.projection)
	s.mu.Unlock()
	return &refreshAccountSessionResult{
		accepted:          false,
		state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED,
		accountProjection: projection,
		reasonCode:        runtimev1.ReasonCode_REALM_UNAVAILABLE,
		accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS,
	}
}

// failRefreshAndClearCustody runs while identityMutationMu is held. Durable
// material is removed before the in-memory failure transition is published, so
// another account mutation cannot race a stale authenticated restart into the
// failed refresh epoch. A custody clear failure is itself an unavailable
// authority state and must not be reported as an ordinary reauthentication.
func (s *Service) failRefreshAndClearCustody(
	ctx context.Context,
	markedCurrent AccountMaterial,
	reason runtimev1.AccountReasonCode,
) *refreshAccountSessionResult {
	cleanupCtx := custodyCleanupContext(ctx)
	if err := s.custody.Clear(cleanupCtx, s.partition); err != nil {
		// Best-effort durable revocation fence when delete fails so restart
		// recovery never mistakes a confirmed revocation for an unrevoked
		// in-flight refresh crash fence.
		_ = s.custody.Store(cleanupCtx, s.partition, pendingRevocationMaterial(markedCurrent))
		s.markCustodyUnavailable()
		return &refreshAccountSessionResult{
			accepted:          false,
			state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
			reasonCode:        runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
			accountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE,
		}
	}
	s.transitionToReauthRequired(reason)
	failureReason := runtimev1.ReasonCode_AUTH_TOKEN_INVALID
	if reason == runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_OUTCOME_AMBIGUOUS {
		failureReason = runtimev1.ReasonCode_REALM_UNAVAILABLE
	}
	return &refreshAccountSessionResult{
		accepted:          false,
		state:             runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED,
		reasonCode:        failureReason,
		accountReasonCode: reason,
	}
}

func custodyCleanupContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return context.WithoutCancel(ctx)
}
