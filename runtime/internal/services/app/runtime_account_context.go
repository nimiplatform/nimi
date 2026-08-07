package app

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type runtimeAccountSecurityContextProvider interface {
	AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool)
}

type runtimeAccountGenerationBinder interface {
	BindAuthenticatedRuntimeGeneration(context.Context) (*runtimev1.AccountProjection, uint64, <-chan struct{}, bool)
}

// authenticatedRuntimeAccount resolves the current Runtime-owned account
// partition used by active local-development operations.
func (s *Service) bindAuthenticatedRuntimeAccount(ctx context.Context) (*runtimev1.AccountProjection, uint64, <-chan struct{}, bool) {
	binder, ok := s.accountSecurity.(runtimeAccountGenerationBinder)
	if !ok {
		return nil, 0, nil, false
	}
	projection, generation, invalidated, ok := binder.BindAuthenticatedRuntimeGeneration(ctx)
	if !ok || projection == nil || generation == 0 || invalidated == nil || strings.TrimSpace(projection.GetAccountId()) == "" || strings.TrimSpace(projection.GetRealmEnvironmentId()) == "" {
		return nil, generation, invalidated, false
	}
	return projection, generation, invalidated, true
}

func (s *Service) authenticatedRuntimeAccount(ctx context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	if s == nil || s.accountSecurity == nil {
		return nil, 0, false
	}
	projection, generation, ok := s.accountSecurity.AuthenticatedRuntimeSecurityContext(ctx)
	if !ok || projection == nil || generation == 0 || strings.TrimSpace(projection.GetAccountId()) == "" || strings.TrimSpace(projection.GetRealmEnvironmentId()) == "" {
		return nil, generation, false
	}
	return projection, generation, true
}
