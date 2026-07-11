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
func (s *Service) AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	if s == nil || !s.isActivated() {
		return nil, 0, false
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED && s.accountMaterialExpiredLocked() {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED
		s.invalidateAuthenticatedRuntimeIdentityLocked()
	}
	generation := s.accountGeneration
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		!s.authenticatedRuntimeIdentity || generation == 0 {
		return nil, generation, false
	}
	projection := cloneProjection(s.projection)
	if projection == nil ||
		strings.TrimSpace(projection.GetAccountId()) == "" ||
		strings.TrimSpace(projection.GetRealmEnvironmentId()) == "" {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
		s.clearAuthenticatedRuntimeIdentityLocked()
		return nil, s.accountGeneration, false
	}
	return projection, generation, true
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
	s.accountGeneration++
	return s.accountGeneration != 0
}
