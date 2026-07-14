package app

import (
	"context"
	"errors"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

// ReconcileLocalDevelopmentKernel closes crash windows between the separate
// Developer Mode authority store and the shared local-app kernel before any
// protected RPC is served. It never reconstructs positive authority from app
// identity or project contents: an incomplete or conflicting pair is revoked
// and tombstoned, while a complete pair is advanced to the exact stored
// authorization lifecycle.
func (s *Service) ReconcileLocalDevelopmentKernel(ctx context.Context) error {
	if s == nil || s.localDevelopment == nil || s.localAppKernel == nil {
		return errLocalDevelopmentInvalid
	}
	authorizations, err := s.localDevelopment.List(ctx)
	if err != nil {
		return err
	}
	known := make(map[string]localDevelopmentAuthorization, len(authorizations))
	for _, authorization := range authorizations {
		ref := localDevelopmentAuthorizationRef(authorization.ID)
		known[ref] = authorization
		switch authorization.State {
		case localDevelopmentAuthorizationActive:
			if _, _, prepareErr := s.prepareLocalDevelopmentRecord(ctx, authorization); prepareErr != nil {
				if _, revokeErr := s.localDevelopment.RevokeAuthorization(ctx, authorization.ID); revokeErr != nil {
					return revokeErr
				}
				if transitionErr := s.transitionLocalDevelopmentRecord(ctx, authorization, localappkernel.LifecycleStateRemoved, true); transitionErr != nil {
					return transitionErr
				}
			}
		case localDevelopmentAuthorizationDormant:
			principal, principalErr := s.localAppKernel.Principals().GetByDevelopmentAuthorizationID(ctx, ref)
			if principalErr != nil || principal.State != localappkernel.PrincipalStateActive {
				if _, revokeErr := s.localDevelopment.RevokeAuthorization(ctx, authorization.ID); revokeErr != nil {
					return revokeErr
				}
				continue
			}
			if transitionErr := s.transitionLocalDevelopmentRecord(ctx, authorization, localappkernel.LifecycleStateDormant, false); transitionErr != nil {
				if !errors.Is(transitionErr, localappkernel.ErrNotFound) {
					return transitionErr
				}
				if _, revokeErr := s.localDevelopment.RevokeAuthorization(ctx, authorization.ID); revokeErr != nil {
					return revokeErr
				}
			}
		case localDevelopmentAuthorizationDenied, localDevelopmentAuthorizationRevoked:
			if transitionErr := s.transitionLocalDevelopmentRecord(ctx, authorization, localappkernel.LifecycleStateRemoved, true); transitionErr != nil {
				return transitionErr
			}
		default:
			return errLocalDevelopmentAuthorization
		}
	}
	principals, err := s.localAppKernel.Principals().ListDevelopment(ctx, false)
	if err != nil {
		return err
	}
	for _, principal := range principals {
		if _, ok := known[principal.DevelopmentAuthorizationID]; ok {
			continue
		}
		if _, err := s.localAppKernel.Principals().Tombstone(ctx, principal.LocalAppPrincipalID); err != nil && !errors.Is(err, localappkernel.ErrPrincipalTombstoned) {
			return err
		}
	}
	return nil
}
