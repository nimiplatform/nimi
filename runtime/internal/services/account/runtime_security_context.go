package account

import (
	"context"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
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
// @nimi-authority: rule.nimi.runtime.protected-session.r031
func (s *Service) BindAuthenticatedRuntimeGeneration(context.Context) (*runtimev1.AccountProjection, uint64, <-chan struct{}, bool) {
	if s == nil || !s.isActivated() {
		return nil, 0, nil, false
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	return s.authenticatedRuntimeGenerationLocked()
}

// @nimi-authority: rule.nimi.runtime.integration.final-publication
// This fence shares the account owner's generation mutation lock, rather than
// waiting for an App session watcher to observe its invalidation signal. The
// callback is a short final publication; it must not call back into Account.
func (s *Service) CommitAuthenticatedRuntimeGeneration(ctx context.Context, accountID, realmID string, generation uint64, commit func() error) (bool, error) {
	if s == nil || !s.isActivated() || commit == nil {
		return false, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return false, err
	}
	projection, current, _, live := s.authenticatedRuntimeGenerationLocked()
	if !live || generation == 0 || current != generation || projection.GetAccountId() != accountID || projection.GetRealmEnvironmentId() != realmID {
		return false, nil
	}
	return true, commit()
}

func (s *Service) authenticatedRuntimeGenerationLocked() (*runtimev1.AccountProjection, uint64, <-chan struct{}, bool) {
	// Trusted local sign-in identity survives natural expiration of the
	// short-lived online Realm access token while offline and across routine
	// refresh attempts. Only explicit logout, account switch, identity
	// replacement, known revocation/deletion, or custody loss invalidates the
	// local generation; online Realm and remote calls separately enforce a
	// live, non-expired online access token.
	liveState := s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING
	generation := s.accountGeneration
	invalidated := s.accountGenerationInvalidated
	if !liveState ||
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

// projectedAccountAuthorizationLocked reports local sign-in continuity without
// advancing a fence or mutating the refresh state machine. Natural expiry of
// the short-lived online access token does not revoke trusted local sign-in.
// @nimi-authority: rule.nimi.runtime.protected-session.r031
func (s *Service) projectedAccountAuthorizationLocked() (runtimev1.AccountSessionState, string) {
	state := s.state
	liveState := state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING
	if !liveState || !s.authenticatedRuntimeIdentity ||
		s.accountGeneration == 0 || s.accountGenerationInvalidated == nil || s.projection == nil ||
		strings.TrimSpace(s.projection.GetAccountId()) == "" || strings.TrimSpace(s.projection.GetRealmEnvironmentId()) == "" {
		return state, ""
	}
	return state, s.authorizationRevision
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
	// This non-authorizing label is never persisted or accepted as input. A new
	// Runtime gets a new label even when its numeric generation starts at one.
	s.authorizationRevision = ulid.Make().String()
	s.notifyStateObserversLocked()
	return s.accountGeneration != 0
}
