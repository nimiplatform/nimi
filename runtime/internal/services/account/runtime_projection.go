package account

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// AuthenticatedRuntimeProjection returns the current authenticated account
// projection for Runtime-internal service composition. It is not a public app
// auth surface and does not admit external callers.
func (s *Service) AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool) {
	if s == nil || !s.isActivated() {
		return nil, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		return nil, false
	}
	projection := cloneProjection(s.projection)
	if projection == nil || projection.GetAccountId() == "" {
		return nil, false
	}
	return projection, true
}
