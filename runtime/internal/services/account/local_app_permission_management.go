package account

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/apppermission"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func (s *Service) IssueLocalAppAgentSelectorHandle(ctx context.Context, req *runtimev1.IssueLocalAppAgentSelectorHandleRequest) (*runtimev1.IssueLocalAppAgentSelectorHandleResponse, error) {
	if req == nil || s.permissionAdmitted == nil || !s.permissionAdmitted(req.GetPermissionId()) {
		return &runtimev1.IssueLocalAppAgentSelectorHandleResponse{ReasonCode: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE}, nil
	}
	issued, err := s.IssueOwnerLocalAppAgentSelectorHandle(ctx, req.GetCaller(), req.GetLocalAppPrincipalId(), req.GetPermissionId(), req.GetLocalAgentId())
	if err != nil {
		return &runtimev1.IssueLocalAppAgentSelectorHandleResponse{ReasonCode: runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED}, nil
	}
	return &runtimev1.IssueLocalAppAgentSelectorHandleResponse{Accepted: true, SelectorHandle: issued.Handle, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) DecideLocalAppPermission(ctx context.Context, req *runtimev1.DecideLocalAppPermissionRequest) (*runtimev1.DecideLocalAppPermissionResponse, error) {
	if req == nil || req.GetExpectedOwnerRevision() == 0 || (req.GetApproved() && req.GetSelectorHandle() == "") || (!req.GetApproved() && req.GetSelectorHandle() != "") {
		return ownerDecisionResponse(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID), nil
	}
	if s.permissionAdmitted == nil || !s.permissionAdmitted(req.GetPermissionId()) || !apppermission.IsManifestAllowed(req.GetPermissionId()) {
		return ownerDecisionResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
	}
	accountID, ok := s.authorizePermissionOwner(ctx, req.GetCaller())
	if !ok {
		return ownerDecisionResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
	}
	principal, err := s.localAppKernel.Principals().Get(ctx, req.GetLocalAppPrincipalId())
	if err != nil || principal.State != localappkernel.PrincipalStateActive {
		return ownerDecisionResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
	}
	pending, err := s.localAppKernel.PermissionGrants().GetPendingRequest(ctx, s.localAppKernel.LocalOSUserAnchor(), accountID, principal.LocalAppPrincipalID, req.GetPermissionId())
	if err != nil || pending.Revision != req.GetExpectedOwnerRevision() {
		return ownerDecisionResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
	}
	nextState := localappkernel.PermissionGrantStateDenied
	nextPosture := apppermission.PostureDenied
	selectorDigest := ""
	if req.GetApproved() {
		selector, resolvedPrincipal, resolvedAccountID, resolved := s.resolveOwnerPermissionSelector(ctx, req.GetCaller(), req.GetLocalAppPrincipalId(), req.GetPermissionId(), req.GetSelectorHandle())
		if !resolved || resolvedPrincipal.LocalAppPrincipalID != principal.LocalAppPrincipalID || resolvedAccountID != accountID {
			return ownerDecisionResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
		}
		nextState = localappkernel.PermissionGrantStateGranted
		nextPosture = apppermission.PostureGranted
		selectorDigest = selector.OwnerSelectorDigest
	}
	key := localappkernel.PermissionGrantKey{LocalOSUserAnchor: s.localAppKernel.LocalOSUserAnchor(), AccountID: accountID,
		LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: req.GetPermissionId(), OwnerSelectorDigest: selectorDigest}
	binding := s.permissionAuditBinding(principal, accountID, key, apppermission.PosturePending, nextPosture, "owner_deny", pending.Revision+1)
	emitter := apppermission.NewAuditEmitter(s.auditStore)
	if req.GetApproved() {
		binding.Trigger = "owner_approve"
		err = emitter.EmitDecisionTransition(ctx, binding)
	} else {
		err = emitter.EmitPendingRequestDenial(ctx, binding)
	}
	if err != nil {
		return ownerDecisionResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
	}
	decision, err := s.localAppKernel.PermissionGrants().DecidePendingRequest(ctx, localappkernel.DecidePermissionRequestInput{
		LocalOSUserAnchor: s.localAppKernel.LocalOSUserAnchor(), AccountID: accountID, LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: req.GetPermissionId(), ExpectedRevision: pending.Revision, State: nextState, OwnerSelectorDigest: selectorDigest,
	})
	if err != nil {
		return ownerDecisionResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
	}
	s.publishPermissionInbox(ctx, accountID)
	return &runtimev1.DecideLocalAppPermissionResponse{
		Accepted: true, Posture: runtimePermissionPosture(nextPosture), OwnerRevision: decision.Revision, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RevokeLocalAppPermission(ctx context.Context, req *runtimev1.RevokeLocalAppPermissionRequest) (*runtimev1.RevokeLocalAppPermissionResponse, error) {
	if req == nil {
		return ownerRevokeResponse(runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID), nil
	}
	selector, principal, accountID, ok := s.resolveOwnerPermissionSelector(ctx, req.GetCaller(), req.GetLocalAppPrincipalId(), req.GetPermissionId(), req.GetSelectorHandle())
	if !ok {
		return ownerRevokeResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
	}
	key := localappkernel.PermissionGrantKey{
		LocalOSUserAnchor: s.localAppKernel.LocalOSUserAnchor(), AccountID: accountID,
		LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: req.GetPermissionId(), OwnerSelectorDigest: selector.OwnerSelectorDigest,
	}
	grant, err := s.localAppKernel.PermissionGrants().Get(ctx, key)
	if err != nil {
		return ownerRevokeResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
	}
	binding := s.permissionAuditBinding(principal, accountID, key, permissionGrantPublicPosture(grant.State), apppermission.PostureDenied, "owner_revoke", grant.Revision+1)
	if err := apppermission.NewAuditEmitter(s.auditStore).EmitDecisionTransition(ctx, binding); err != nil {
		return ownerRevokeResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
	}
	grant, err = s.localAppKernel.PermissionGrants().Transition(ctx, localappkernel.TransitionPermissionGrantInput{
		Key: key, ExpectedRevision: grant.Revision, State: localappkernel.PermissionGrantStateRevoked,
	})
	if err != nil {
		return ownerRevokeResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
	}
	return &runtimev1.RevokeLocalAppPermissionResponse{
		Accepted: true, Posture: runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_DENIED,
		OwnerRevision: grant.Revision, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) resolveOwnerPermissionSelector(ctx context.Context, caller *runtimev1.AccountCaller, principalID string, permissionID string, handle string) (localappkernel.AgentSelectorHandle, localappkernel.Principal, string, bool) {
	if s == nil || s.localAppKernel == nil || s.localAgentOwnership == nil || s.permissionAdmitted == nil || !s.permissionAdmitted(permissionID) || !apppermission.IsManifestAllowed(permissionID) {
		return localappkernel.AgentSelectorHandle{}, localappkernel.Principal{}, "", false
	}
	if reason, ok := s.validateRuntimeAccountControlCaller(ctx, caller); !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
		return localappkernel.AgentSelectorHandle{}, localappkernel.Principal{}, "", false
	}
	projection, _, authenticated := s.AuthenticatedRuntimeSecurityContext(ctx)
	accountID := projection.GetAccountId()
	if !authenticated || accountID == "" {
		return localappkernel.AgentSelectorHandle{}, localappkernel.Principal{}, "", false
	}
	principal, err := s.localAppKernel.Principals().Get(ctx, principalID)
	if err != nil || principal.State != localappkernel.PrincipalStateActive {
		return localappkernel.AgentSelectorHandle{}, localappkernel.Principal{}, "", false
	}
	selector, err := s.localAppKernel.AgentSelectorHandles().Resolve(ctx, localappkernel.ResolveAgentSelectorHandleInput{
		Handle: handle, AccountID: accountID, LocalAppPrincipalID: principalID, PermissionID: permissionID,
	})
	if err != nil {
		return localappkernel.AgentSelectorHandle{}, localappkernel.Principal{}, "", false
	}
	owned, err := s.localAgentOwnership.OwnsActiveLocalAgent(ctx, accountID, selector.LocalAgentID)
	if err != nil || !owned {
		return localappkernel.AgentSelectorHandle{}, localappkernel.Principal{}, "", false
	}
	return selector, principal, accountID, true
}

func (s *Service) permissionAuditBinding(principal localappkernel.Principal, accountID string, key localappkernel.PermissionGrantKey, oldPosture apppermission.Posture, newPosture apppermission.Posture, trigger string, revision uint64) apppermission.AuditBinding {
	return apppermission.AuditBinding{
		OwnerSubjectID: accountID, LocalAppPrincipalID: principal.LocalAppPrincipalID, DisplayAppID: principal.AppID,
		PermissionID: key.PermissionID, SelectorDigest: key.OwnerSelectorDigest, OldPosture: oldPosture, NewPosture: newPosture,
		Trigger: trigger, Timestamp: s.now().UTC(), OwnerRevision: revision,
	}
}

func permissionGrantPublicPosture(state localappkernel.PermissionGrantState) apppermission.Posture {
	switch state {
	case localappkernel.PermissionGrantStatePending:
		return apppermission.PosturePending
	case localappkernel.PermissionGrantStateGranted:
		return apppermission.PostureGranted
	default:
		return apppermission.PostureDenied
	}
}

func ownerDecisionResponse(reason runtimev1.ReasonCode) *runtimev1.DecideLocalAppPermissionResponse {
	return &runtimev1.DecideLocalAppPermissionResponse{Posture: runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE, ReasonCode: reason}
}

func ownerRevokeResponse(reason runtimev1.ReasonCode) *runtimev1.RevokeLocalAppPermissionResponse {
	return &runtimev1.RevokeLocalAppPermissionResponse{Posture: runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE, ReasonCode: reason}
}
