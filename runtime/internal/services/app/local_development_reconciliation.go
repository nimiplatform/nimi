package app

import (
	"context"
	"errors"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

// ReconcileLocalDevelopmentKernel closes crash windows between the separate
// Developer Mode authority store and the shared local-app kernel before any
// protected RPC is served. A missing or tombstoned candidate projection may be
// rebuilt only from an exact active durable authorization. Project identity or
// provenance conflicts still revoke and tombstone; a project changing during
// observation defers reconciliation without destroying consent.
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
				if errors.Is(prepareErr, errLocalDevelopmentProjectUnstable) {
					if s.logger != nil {
						s.logger.Warn("deferred local development projection reconciliation", "app_id", authorization.Project.AppID, "error", prepareErr)
					}
					continue
				}
				if !localDevelopmentPreparationInvalidatesAuthorization(prepareErr) {
					return prepareErr
				}
				if _, revokeErr := s.localDevelopment.RevokeAuthorization(ctx, authorization.ID); revokeErr != nil {
					return revokeErr
				}
				if transitionErr := s.transitionLocalDevelopmentRecord(ctx, authorization, localappkernel.LifecycleStateRemoved, true); transitionErr != nil {
					return transitionErr
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
