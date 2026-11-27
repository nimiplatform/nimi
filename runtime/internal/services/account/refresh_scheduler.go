package account

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const proactiveRefreshLead = 30 * time.Second

// rebuildRefreshTimerLocked is called only while Service.mu is held. Runtime
// owns this timer; no Desktop or SDK state participates in refresh scheduling.
func (s *Service) rebuildRefreshTimerLocked() {
	if s.refreshTimer != nil {
		s.refreshTimer.Stop()
		s.refreshTimer = nil
	}
	var delay time.Duration
	cause := accountRefreshScheduled
	replayRealmDeletion := false
	switch s.state {
	case runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED:
		if s.material.OnlineCredentialsCleared || strings.TrimSpace(s.material.RefreshToken) == "" {
			return
		}
		if s.stateReason == runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED {
			if s.refreshRetryAttempt == 0 {
				delay = 100 * time.Millisecond
			} else {
				attempt := s.refreshRetryAttempt
				if attempt > 5 {
					attempt = 5
				}
				delay = time.Second * time.Duration(1<<attempt)
			}
			cause = accountRefreshScheduledRetry
			break
		}
		s.refreshRetryAttempt = 0
		if s.material.AccessTokenExpires.IsZero() {
			return
		}
		ttl := s.material.AccessTokenExpires.Sub(s.now().UTC())
		lead := proactiveRefreshLead
		if bounded := ttl / 3; bounded < lead {
			lead = bounded
		}
		delay = ttl - lead
		if delay < 100*time.Millisecond {
			delay = 100 * time.Millisecond
		}
	case runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING:
		if s.material.OnlineCredentialsCleared || strings.TrimSpace(s.material.RefreshToken) == "" {
			return
		}
		if s.stateReason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED {
			return
		}
		attempt := s.refreshRetryAttempt
		if attempt > 5 {
			attempt = 5
		}
		delay = time.Second * time.Duration(1<<attempt)
		cause = accountRefreshScheduledRetry
	case runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE,
		runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED:
		if s.realmAccountDeletedObserver == nil || s.material.pendingRealmDeletion == nil {
			return
		}
		attempt := s.realmDeletionRetryAttempt
		if attempt > 6 {
			attempt = 6
		}
		delay = 100 * time.Millisecond * time.Duration(1<<attempt)
		if delay > 5*time.Second {
			delay = 5 * time.Second
		}
		replayRealmDeletion = true
	default:
		return
	}
	if !replayRealmDeletion && s.logger != nil {
		s.logger.Info("runtime account refresh scheduled", "cause", string(cause), "state", s.state.String(), "delay_ms", delay.Milliseconds())
	}
	var timer *time.Timer
	timer = time.AfterFunc(delay, func() {
		if replayRealmDeletion {
			if err := s.replayPendingRealmAccountDeletedResult(context.Background()); err != nil && s.logger != nil {
				s.logger.Warn("runtime account terminal deletion replay deferred", "error", err)
			}
			return
		}
		s.identityMutationMu.Lock()
		s.mu.RLock()
		current := s.refreshTimer == timer
		s.mu.RUnlock()
		if !current {
			s.identityMutationMu.Unlock()
			return
		}
		// A deferred retry continues a refresh already required by the owner,
		// even if Realm rejected an access token with a future expiry.
		result, err := s.refreshAccountSessionLocked(context.Background(), cause == accountRefreshScheduledRetry, "", cause, nil)
		s.identityMutationMu.Unlock()
		if err != nil && s.logger != nil {
			s.logger.Warn("runtime account scheduled refresh failed", "error", err)
			return
		}
		if result != nil && !result.accepted && s.logger != nil {
			s.logger.Debug("runtime account scheduled refresh deferred or rejected", "state", result.state.String(), "reason", result.accountReasonCode.String())
		}
	})
	s.refreshTimer = timer
}
