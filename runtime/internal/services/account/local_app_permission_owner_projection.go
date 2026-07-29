package account

import (
	"context"
	"errors"
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
	requests, err := s.localAppKernel.PermissionGrants().ListPermissionRequestsForPrincipal(ctx, s.localAppKernel.LocalOSUserAnchor(), accountID, principal.LocalAppPrincipalID)
	if err != nil {
		return ownerPermissionProjectionResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
	}
	permissions := make([]*runtimev1.LocalAppPermissionOwnerProjection, 0, len(requests))
	for _, request := range requests {
		projection, projectionErr := s.projectOwnerPermission(ctx, accountID, request)
		if projectionErr != nil {
			return ownerPermissionProjectionResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
		}
		permissions = append(permissions, projection)
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
	permissions := make([]*runtimev1.LocalAppPermissionOwnerProjection, 0, len(requests))
	for _, request := range requests {
		projection, projectionErr := s.projectOwnerPermission(ctx, accountID, request)
		if projectionErr != nil {
			return listOwnerPermissionProjectionsResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
		}
		permissions = append(permissions, projection)
	}
	return &runtimev1.ListLocalAppPermissionOwnerProjectionsResponse{Accepted: true, Permissions: permissions, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) projectOwnerPermission(ctx context.Context, accountID string, request localappkernel.PermissionRequest) (*runtimev1.LocalAppPermissionOwnerProjection, error) {
	projection := &runtimev1.LocalAppPermissionOwnerProjection{
		LocalAppPrincipalId: request.LocalAppPrincipalID, DisplayAppId: request.DisplayAppID, PermissionId: request.PermissionID,
		Posture:       runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_PENDING,
		OwnerRevision: request.Revision, RequestedAt: timestamppb.New(request.RequestedAt),
	}
	decision, err := s.localAppKernel.PermissionGrants().GetPermissionRequestDecision(ctx, request.LocalOSUserAnchor, accountID, request.LocalAppPrincipalID, request.PermissionID)
	if errors.Is(err, localappkernel.ErrNotFound) {
		return projection, nil
	}
	if err != nil {
		return nil, err
	}
	projection.OwnerRevision = decision.Revision
	projection.DecidedAt = timestamppb.New(decision.DecidedAt)
	if decision.State == localappkernel.PermissionGrantStateDenied {
		projection.Posture = runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_DENIED
		return projection, nil
	}
	key := localappkernel.PermissionGrantKey{LocalOSUserAnchor: request.LocalOSUserAnchor, AccountID: accountID,
		LocalAppPrincipalID: request.LocalAppPrincipalID, PermissionID: request.PermissionID, OwnerSelectorDigest: decision.OwnerSelectorDigest}
	grant, err := s.localAppKernel.PermissionGrants().Get(ctx, key)
	if err != nil {
		return nil, err
	}
	projection.OwnerRevision = grant.Revision
	projection.DecidedAt = timestamppb.New(grant.UpdatedAt)
	switch grant.State {
	case localappkernel.PermissionGrantStateGranted:
		if grant.ExpiresAt != nil && !s.now().UTC().Before(*grant.ExpiresAt) {
			projection.Posture = runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_EXPIRED
		} else {
			projection.Posture = runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_GRANTED
		}
	case localappkernel.PermissionGrantStateDenied:
		projection.Posture = runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_DENIED
	case localappkernel.PermissionGrantStateExpired:
		projection.Posture = runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_EXPIRED
	case localappkernel.PermissionGrantStateRevoked:
		projection.Posture = runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_REVOKED
	default:
		return nil, localappkernel.ErrStateConflict
	}
	if projection.Posture != runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_GRANTED {
		return projection, nil
	}
	if decision.OwnerSelectorDigest != localappkernel.AgentAccountScopeDigest(accountID) || s.localAgentOwnership == nil {
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

func ownerPermissionProjectionResponse(reason runtimev1.ReasonCode) *runtimev1.GetLocalAppPermissionOwnerProjectionResponse {
	return &runtimev1.GetLocalAppPermissionOwnerProjectionResponse{ReasonCode: reason}
}

func listOwnerPermissionProjectionsResponse(reason runtimev1.ReasonCode) *runtimev1.ListLocalAppPermissionOwnerProjectionsResponse {
	return &runtimev1.ListLocalAppPermissionOwnerProjectionsResponse{ReasonCode: reason}
}
