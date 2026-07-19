package account

import (
	"context"
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
	switch s.state {
	case runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED:
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
		if s.stateReason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED {
			return
		}
		attempt := s.refreshRetryAttempt
		if attempt > 5 {
			attempt = 5
		}
		delay = time.Second * time.Duration(1<<attempt)
	default:
		return
	}
	s.refreshTimer = time.AfterFunc(delay, func() {
		result, err := s.refreshAccountSessionInternal(context.Background(), false)
		if err != nil && s.logger != nil {
			s.logger.Warn("runtime account scheduled refresh failed", "error", err)
			return
		}
		if result != nil && !result.accepted && s.logger != nil {
			s.logger.Debug("runtime account scheduled refresh deferred or rejected", "state", result.state.String(), "reason", result.accountReasonCode.String())
		}
	})
}
