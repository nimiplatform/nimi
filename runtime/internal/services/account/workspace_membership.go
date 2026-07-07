package account

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) hasActiveWorkspaceMembershipLocked(workspaceID string, realmEnvironmentID string) bool {
	workspaceID = strings.TrimSpace(workspaceID)
	realmEnvironmentID = strings.TrimSpace(realmEnvironmentID)
	if workspaceID == "" || realmEnvironmentID == "" {
		return false
	}
	for _, membership := range s.material.WorkspaceMemberships {
		if strings.TrimSpace(membership.GetWorkspaceId()) != workspaceID {
			continue
		}
		if strings.TrimSpace(membership.GetRealmEnvironmentId()) != realmEnvironmentID {
			return false
		}
		return membership.GetMembershipState() == runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE &&
			s.workspaceMembershipProjectionFreshLocked(membership)
	}
	return false
}

func (s *Service) workspaceMembershipProjectionFreshLocked(membership *runtimev1.WorkspaceMembershipProjection) bool {
	if membership.GetObservedAt() == nil {
		return false
	}
	observedAt := membership.GetObservedAt().AsTime()
	if observedAt.IsZero() {
		return false
	}
	now := s.now().UTC()
	if observedAt.After(now) {
		return false
	}
	return !observedAt.Before(now.Add(-workspaceMembershipProjectionMaxAge))
}
