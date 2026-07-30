package account

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/apppermission"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func (s *Service) DecideLocalAppPermission(ctx context.Context, req *runtimev1.DecideLocalAppPermissionRequest) (*runtimev1.DecideLocalAppPermissionResponse, error) {
	if req == nil || req.GetExpectedOwnerRevision() == 0 {
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
	nextPosture := apppermission.PosturePrompt
	selectorDigest := ""
	if req.GetApproved() {
		nextState = localappkernel.PermissionGrantStateGranted
		nextPosture = apppermission.PostureGranted
		selectorDigest = localappkernel.AgentAccountScopeDigest(accountID)
	}
	key := localappkernel.PermissionGrantKey{LocalOSUserAnchor: s.localAppKernel.LocalOSUserAnchor(), AccountID: accountID,
		LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: req.GetPermissionId(), OwnerSelectorDigest: selectorDigest}
	auditPosture := nextPosture
	if !req.GetApproved() {
		auditPosture = apppermission.PostureDenied
	}
	binding := s.permissionAuditBinding(principal, accountID, key, apppermission.PosturePending, auditPosture, "owner_deny", pending.Revision+1)
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
	principal, accountID, ok := s.resolveOwnerPermissionAccountScope(ctx, req.GetCaller(), req.GetLocalAppPrincipalId(), req.GetPermissionId())
	if !ok {
		return ownerRevokeResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
	}
	key := localappkernel.PermissionGrantKey{
		LocalOSUserAnchor: s.localAppKernel.LocalOSUserAnchor(), AccountID: accountID,
		LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: req.GetPermissionId(),
		OwnerSelectorDigest: localappkernel.AgentAccountScopeDigest(accountID),
	}
	grant, err := s.localAppKernel.PermissionGrants().Get(ctx, key)
	if err != nil {
		return ownerRevokeResponse(runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED), nil
	}
	binding := s.permissionAuditBinding(principal, accountID, key, apppermission.PostureGranted, apppermission.PostureDenied, "owner_revoke", grant.Revision+1)
	if err := apppermission.NewAuditEmitter(s.auditStore).EmitDecisionTransition(ctx, binding); err != nil {
		return ownerRevokeResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
	}
	decision, err := s.localAppKernel.PermissionGrants().Revoke(ctx, localappkernel.RevokePermissionGrantInput{
		Key: key, ExpectedRevision: grant.Revision,
	})
	if err != nil {
		return ownerRevokeResponse(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE), nil
	}
	s.publishPermissionInbox(ctx, accountID)
	return &runtimev1.RevokeLocalAppPermissionResponse{
		Accepted: true, Posture: runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT,
		OwnerRevision: decision.Revision, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) resolveOwnerPermissionAccountScope(ctx context.Context, caller *runtimev1.AccountCaller, principalID string, permissionID string) (localappkernel.Principal, string, bool) {
	if s == nil || s.localAppKernel == nil || s.permissionAdmitted == nil || !s.permissionAdmitted(permissionID) || !apppermission.IsManifestAllowed(permissionID) {
		return localappkernel.Principal{}, "", false
	}
	if reason, ok := s.validateRuntimeAccountControlCaller(ctx, caller); !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
		return localappkernel.Principal{}, "", false
	}
	projection, _, authenticated := s.AuthenticatedRuntimeSecurityContext(ctx)
	accountID := projection.GetAccountId()
	if !authenticated || accountID == "" {
		return localappkernel.Principal{}, "", false
	}
	principal, err := s.localAppKernel.Principals().Get(ctx, principalID)
	if err != nil || principal.State != localappkernel.PrincipalStateActive {
		return localappkernel.Principal{}, "", false
	}
	return principal, accountID, true
}

func (s *Service) permissionAuditBinding(principal localappkernel.Principal, accountID string, key localappkernel.PermissionGrantKey, oldPosture apppermission.Posture, newPosture apppermission.Posture, trigger string, revision uint64) apppermission.AuditBinding {
	return apppermission.AuditBinding{
		OwnerSubjectID: accountID, LocalAppPrincipalID: principal.LocalAppPrincipalID, DisplayAppID: principal.AppID,
		PermissionID: key.PermissionID, SelectorDigest: key.OwnerSelectorDigest, OldPosture: oldPosture, NewPosture: newPosture,
		Trigger: trigger, Timestamp: s.now().UTC(), OwnerRevision: revision,
	}
}

func ownerDecisionResponse(reason runtimev1.ReasonCode) *runtimev1.DecideLocalAppPermissionResponse {
	return &runtimev1.DecideLocalAppPermissionResponse{Posture: runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE, ReasonCode: reason}
}

func ownerRevokeResponse(reason runtimev1.ReasonCode) *runtimev1.RevokeLocalAppPermissionResponse {
	return &runtimev1.RevokeLocalAppPermissionResponse{Posture: runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE, ReasonCode: reason}
}
