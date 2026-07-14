package app

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type runtimeAccountSecurityContextProvider interface {
	AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool)
}

// authenticatedLifecycleAccount is shared by the active local-development
// lifecycle. Immutable package lifecycle intent production is unavailable in
// 0K and does not consume this account authority.
func (s *Service) authenticatedLifecycleAccount(ctx context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	if s == nil || s.accountSecurity == nil {
		return nil, 0, false
	}
	projection, generation, ok := s.accountSecurity.AuthenticatedRuntimeSecurityContext(ctx)
	if !ok || projection == nil || generation == 0 || strings.TrimSpace(projection.GetAccountId()) == "" || strings.TrimSpace(projection.GetRealmEnvironmentId()) == "" {
		return nil, generation, false
	}
	return projection, generation, true
}
