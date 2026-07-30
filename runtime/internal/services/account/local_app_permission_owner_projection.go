package account

import (
	"context"
	"sort"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) GetLocalAppPermissionOwnerProjection(ctx context.Context, req *runtimev1.GetLocalAppPermissionOwnerProjectionRequest) (*runtimev1.GetLocalAppPermissionOwnerProjectionResponse, error) {
	if req == nil || req.GetLocalAppPrincipalId() == "" {
		return ownerPermissionProjectionResponse(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID), nil
	}
	accountID, ok := s.authorizePermissionOwner(ctx, req.GetCaller())
	if !ok {
		return ownerPermissionProjectionResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
	}
	principal, err := s.localAppKernel.Principals().Get(ctx, req.GetLocalAppPrincipalId())
	if err != nil || principal.State != localappkernel.PrincipalStateActive {
		return ownerPermissionProjectionResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
	}
	permissions, err := s.ownerPermissionProjectionsForPrincipal(ctx, accountID, principal)
	if err != nil {
		return ownerPermissionProjectionResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
	}
	return &runtimev1.GetLocalAppPermissionOwnerProjectionResponse{Accepted: true, Permissions: permissions, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) ListLocalAppPermissionOwnerProjections(ctx context.Context, req *runtimev1.ListLocalAppPermissionOwnerProjectionsRequest) (*runtimev1.ListLocalAppPermissionOwnerProjectionsResponse, error) {
	accountID, ok := s.authorizePermissionOwner(ctx, req.GetCaller())
	if !ok {
		return listOwnerPermissionProjectionsResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
	}
	requests, err := s.localAppKernel.PermissionGrants().ListPermissionRequests(ctx, s.localAppKernel.LocalOSUserAnchor(), accountID)
	if err != nil {
		return listOwnerPermissionProjectionsResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
	}
	grants, err := s.localAppKernel.PermissionGrants().ListActive(ctx, s.localAppKernel.LocalOSUserAnchor(), accountID)
	if err != nil {
		return listOwnerPermissionProjectionsResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
	}
	permissions := make([]*runtimev1.LocalAppPermissionOwnerProjection, 0, len(requests)+len(grants))
	for _, request := range requests {
		permissions = append(permissions, projectPendingOwnerPermission(request))
	}
	for _, grant := range grants {
		principal, principalErr := s.localAppKernel.Principals().Get(ctx, grant.Key.LocalAppPrincipalID)
		if principalErr != nil {
			return listOwnerPermissionProjectionsResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
		}
		if principal.State == localappkernel.PrincipalStateTombstoned {
			continue
		}
		if principal.State != localappkernel.PrincipalStateActive {
			return listOwnerPermissionProjectionsResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
		}
		projection, projectionErr := s.projectActiveOwnerPermission(ctx, accountID, principal, grant)
		if projectionErr != nil {
			return listOwnerPermissionProjectionsResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
		}
		permissions = append(permissions, projection)
	}
	sortOwnerPermissionProjections(permissions)
	return &runtimev1.ListLocalAppPermissionOwnerProjectionsResponse{Accepted: true, Permissions: permissions, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) ownerPermissionProjectionsForPrincipal(ctx context.Context, accountID string, principal localappkernel.Principal) ([]*runtimev1.LocalAppPermissionOwnerProjection, error) {
	requests, err := s.localAppKernel.PermissionGrants().ListPermissionRequestsForPrincipal(ctx, s.localAppKernel.LocalOSUserAnchor(), accountID, principal.LocalAppPrincipalID)
	if err != nil {
		return nil, err
	}
	grants, err := s.localAppKernel.PermissionGrants().ListActiveForPrincipal(ctx, s.localAppKernel.LocalOSUserAnchor(), accountID, principal.LocalAppPrincipalID)
	if err != nil {
		return nil, err
	}
	permissions := make([]*runtimev1.LocalAppPermissionOwnerProjection, 0, len(requests)+len(grants))
	for _, request := range requests {
		permissions = append(permissions, projectPendingOwnerPermission(request))
	}
	for _, grant := range grants {
		projection, projectionErr := s.projectActiveOwnerPermission(ctx, accountID, principal, grant)
		if projectionErr != nil {
			return nil, projectionErr
		}
		permissions = append(permissions, projection)
	}
	sortOwnerPermissionProjections(permissions)
	return permissions, nil
}

func projectPendingOwnerPermission(request localappkernel.PermissionRequest) *runtimev1.LocalAppPermissionOwnerProjection {
	return &runtimev1.LocalAppPermissionOwnerProjection{
		LocalAppPrincipalId: request.LocalAppPrincipalID,
		DisplayAppId:        request.DisplayAppID,
		PermissionId:        request.PermissionID,
		Posture:             runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_PENDING,
		OwnerRevision:       request.Revision,
		RequestedAt:         timestamppb.New(request.RequestedAt),
	}
}

func (s *Service) projectActiveOwnerPermission(ctx context.Context, accountID string, principal localappkernel.Principal, grant localappkernel.PermissionGrant) (*runtimev1.LocalAppPermissionOwnerProjection, error) {
	if grant.State != localappkernel.PermissionGrantStateGranted || grant.Key.AccountID != accountID ||
		grant.Key.LocalAppPrincipalID != principal.LocalAppPrincipalID {
		return nil, localappkernel.ErrStateConflict
	}
	projection := &runtimev1.LocalAppPermissionOwnerProjection{
		LocalAppPrincipalId: principal.LocalAppPrincipalID,
		DisplayAppId:        principal.AppID,
		PermissionId:        grant.Key.PermissionID,
		Posture:             runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_GRANTED,
		OwnerRevision:       grant.Revision,
		RequestedAt:         timestamppb.New(grant.CreatedAt),
		DecidedAt:           timestamppb.New(grant.UpdatedAt),
	}
	if grant.Key.OwnerSelectorDigest != localappkernel.AgentAccountScopeDigest(accountID) || s.localAgentOwnership == nil {
		return nil, ErrLocalAppSelectorUnavailable
	}
	agents, err := s.localAgentOwnership.ListOwnedActiveLocalAgents(ctx, accountID)
	if err != nil {
		return nil, ErrLocalAppSelectorUnavailable
	}
	sort.Slice(agents, func(i, j int) bool {
		if agents[i].DisplayName == agents[j].DisplayName {
			return agents[i].LocalAgentID < agents[j].LocalAgentID
		}
		return agents[i].DisplayName < agents[j].DisplayName
	})
	projection.CoveredAgents = make([]*runtimev1.LocalAppPermissionCoveredAgent, 0, len(agents))
	seenAgentIDs := make(map[string]struct{}, len(agents))
	for _, agent := range agents {
		if !exactSelectorText(agent.LocalAgentID) || !canonicalLocalAppAgentDisplayName(agent.DisplayName) {
			return nil, ErrLocalAppSelectorUnavailable
		}
		if _, duplicate := seenAgentIDs[agent.LocalAgentID]; duplicate {
			return nil, ErrLocalAppSelectorUnavailable
		}
		seenAgentIDs[agent.LocalAgentID] = struct{}{}
		projection.CoveredAgents = append(projection.CoveredAgents, &runtimev1.LocalAppPermissionCoveredAgent{
			LocalAgentId: agent.LocalAgentID,
			DisplayName:  agent.DisplayName,
		})
	}
	return projection, nil
}

func sortOwnerPermissionProjections(permissions []*runtimev1.LocalAppPermissionOwnerProjection) {
	sort.Slice(permissions, func(i, j int) bool {
		if permissions[i].GetDisplayAppId() != permissions[j].GetDisplayAppId() {
			return permissions[i].GetDisplayAppId() < permissions[j].GetDisplayAppId()
		}
		if permissions[i].GetLocalAppPrincipalId() != permissions[j].GetLocalAppPrincipalId() {
			return permissions[i].GetLocalAppPrincipalId() < permissions[j].GetLocalAppPrincipalId()
		}
		return permissions[i].GetPermissionId() < permissions[j].GetPermissionId()
	})
}

func ownerPermissionProjectionResponse(reason runtimev1.ReasonCode) *runtimev1.GetLocalAppPermissionOwnerProjectionResponse {
	return &runtimev1.GetLocalAppPermissionOwnerProjectionResponse{ReasonCode: reason}
}

func listOwnerPermissionProjectionsResponse(reason runtimev1.ReasonCode) *runtimev1.ListLocalAppPermissionOwnerProjectionsResponse {
	return &runtimev1.ListLocalAppPermissionOwnerProjectionsResponse{ReasonCode: reason}
}
