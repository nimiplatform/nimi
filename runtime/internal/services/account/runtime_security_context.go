package account

import (
	"context"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// AuthenticatedRuntimeSecurityContext returns the account identity and its
// generation for Runtime-private security decisions. The projection and
// generation are captured under the same lock; neither is a renderer or app
// credential surface.
func (s *Service) AuthenticatedRuntimeSecurityContext(ctx context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	projection, generation, _, ok := s.BindAuthenticatedRuntimeGeneration(ctx)
	return projection, generation, ok
}

// BindAuthenticatedRuntimeGeneration atomically captures the Runtime-owned
// account identity, generation, and its central invalidation signal. Protected
// streams bind to the signal instead of polling account state.
func (s *Service) BindAuthenticatedRuntimeGeneration(context.Context) (*runtimev1.AccountProjection, uint64, <-chan struct{}, bool) {
	if s == nil || !s.isActivated() {
		return nil, 0, nil, false
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED && s.accountMaterialExpiredLocked() {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED
		s.invalidateAuthenticatedRuntimeIdentityLocked()
	}
	generation := s.accountGeneration
	invalidated := s.accountGenerationInvalidated
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		!s.authenticatedRuntimeIdentity || generation == 0 || invalidated == nil {
		return nil, generation, invalidated, false
	}
	projection := cloneProjection(s.projection)
	if projection == nil ||
		strings.TrimSpace(projection.GetAccountId()) == "" ||
		strings.TrimSpace(projection.GetRealmEnvironmentId()) == "" {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
		s.clearAuthenticatedRuntimeIdentityLocked()
		return nil, s.accountGeneration, s.accountGenerationInvalidated, false
	}
	return projection, generation, invalidated, true
}

func (s *Service) installAuthenticatedRuntimeIdentityLocked(material AccountMaterial) bool {
	accountID := strings.TrimSpace(material.AccountID)
	realmEnvironmentID := strings.TrimSpace(material.RealmEnvironmentID)
	if accountID == "" || realmEnvironmentID == "" {
		s.clearAuthenticatedRuntimeIdentityLocked()
		return false
	}

	sameIdentity := s.authenticatedRuntimeIdentity &&
		s.projection != nil &&
		strings.TrimSpace(s.projection.GetAccountId()) == accountID &&
		strings.TrimSpace(s.projection.GetRealmEnvironmentId()) == realmEnvironmentID
	if !sameIdentity && !s.advanceAccountGenerationLocked() {
		s.authenticatedRuntimeIdentity = false
		s.material = AccountMaterial{}
		s.projection = nil
		return false
	}

	s.material = material
	s.projection = projectionFromMaterial(material)
	s.authenticatedRuntimeIdentity = true
	return true
}

func (s *Service) clearAuthenticatedRuntimeIdentityLocked() bool {
	wasAuthenticated := s.authenticatedRuntimeIdentity
	s.authenticatedRuntimeIdentity = false
	s.material = AccountMaterial{}
	s.projection = nil
	if !wasAuthenticated {
		return true
	}
	return s.advanceAccountGenerationLocked()
}

func (s *Service) invalidateAuthenticatedRuntimeIdentityLocked() bool {
	wasAuthenticated := s.authenticatedRuntimeIdentity
	s.authenticatedRuntimeIdentity = false
	if !wasAuthenticated {
		return true
	}
	return s.advanceAccountGenerationLocked()
}

func (s *Service) advanceAccountGenerationLocked() bool {
	if s.accountGeneration == math.MaxUint64 {
		return false
	}
	if s.accountGenerationInvalidated != nil {
		close(s.accountGenerationInvalidated)
	}
	s.accountGeneration++
	s.accountGenerationInvalidated = make(chan struct{})
	return s.accountGeneration != 0
}
