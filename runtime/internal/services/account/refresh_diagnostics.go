package account

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

type accountRefreshCause string

const (
	accountRefreshInternal          accountRefreshCause = "internal"
	accountRefreshScheduled         accountRefreshCause = "scheduled"
	accountRefreshScheduledRetry    accountRefreshCause = "scheduled-retry"
	accountRefreshNearExpiryAccess  accountRefreshCause = "near-expiry-realm-access"
	accountRefreshPendingAccess     accountRefreshCause = "pending-realm-access"
	accountRefreshExpiredAccess     accountRefreshCause = "expired-realm-access"
	accountRefreshRealmUnauthorized accountRefreshCause = "realm-unauthorized"
	accountRefreshRestore           accountRefreshCause = "restore"
)

// Diagnostics deliberately expose only closed causes, states and continuity
// change. Account identity, revision values and credential material stay out.
func (s *Service) logAccountAuthorizationTransition(cause accountRefreshCause, beforeState runtimev1.AccountSessionState, beforeRevision string, accepted bool) {
	if s.logger == nil {
		return
	}
	s.mu.RLock()
	state, revision := s.projectedAccountAuthorizationLocked()
	s.mu.RUnlock()
	s.logger.Info("runtime account authorization transition",
		"cause", string(cause),
		"from_state", beforeState.String(),
		"to_state", state.String(),
		"authorization_revision_changed", beforeRevision != revision,
		"accepted", accepted,
	)
}
