package account

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// AuthenticatedRuntimeProjection returns the current authenticated account
// projection for Runtime-internal service composition. It is not a public app
// auth surface and does not admit external callers.
func (s *Service) AuthenticatedRuntimeProjection(ctx context.Context) (*runtimev1.AccountProjection, bool) {
	projection, _, ok := s.AuthenticatedRuntimeSecurityContext(ctx)
	return projection, ok
}
