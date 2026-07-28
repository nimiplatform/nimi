package account

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/apppermission"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

const localAppPermissionReasonMaxBytes = localappkernel.MaxPermissionRequestReasonBytes

func (s *Service) GetLocalAppPermissionStatus(ctx context.Context, req *runtimev1.GetLocalAppPermissionStatusRequest) (*runtimev1.GetLocalAppPermissionStatusResponse, error) {
	permissionID := ""
	if req != nil {
		permissionID = req.GetPermissionId()
	}
	projection := s.localAppPermissionProjection(ctx, permissionID)
	return &runtimev1.GetLocalAppPermissionStatusResponse{Projection: projection}, nil
}

func (s *Service) RequestLocalAppPermission(ctx context.Context, req *runtimev1.RequestLocalAppPermissionRequest) (*runtimev1.RequestLocalAppPermissionResponse, error) {
	permissionID := ""
	reason := ""
	if req != nil {
		permissionID = req.GetPermissionId()
		reason = req.GetReason()
	}
	projection := s.localAppPermissionProjection(ctx, permissionID)
	if !canonicalPermissionReason(reason) {
		projection.Posture = runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE
		projection.CanRequest = false
		projection.ReasonCode = runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
		return &runtimev1.RequestLocalAppPermissionResponse{Projection: projection}, nil
	}
	if projection.GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT &&
		projection.GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		return &runtimev1.RequestLocalAppPermissionResponse{Projection: projection}, nil
	}
	caller, err := s.AuthorizeLocalAppCaller(ctx)
	if err != nil || s.localAppKernel == nil {
		return &runtimev1.RequestLocalAppPermissionResponse{Projection: unavailablePermissionProjection(permissionID, LocalAppCallerAuthorizationReason(err))}, nil
	}
	principal, err := s.localAppKernel.Principals().Get(ctx, caller.LocalAppPrincipalID)
	if err != nil || principal.State != localappkernel.PrincipalStateActive {
		return &runtimev1.RequestLocalAppPermissionResponse{Projection: unavailablePermissionProjection(permissionID, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
	}
	request, err := s.localAppKernel.PermissionGrants().GetPendingRequest(ctx, caller.LocalOSUserAnchor, caller.AccountID, caller.LocalAppPrincipalID, permissionID)
	switch {
	case errors.Is(err, localappkernel.ErrNotFound):
		binding := apppermission.AuditBinding{
			OwnerSubjectID: caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID, DisplayAppID: principal.AppID,
			PermissionID: permissionID, OldPosture: apppermission.PosturePrompt, NewPosture: apppermission.PosturePending,
			Trigger: "app_request", Timestamp: s.now().UTC(), OwnerRevision: 1,
		}
		if err := apppermission.NewAuditEmitter(s.auditStore).EmitPendingRequestTransition(ctx, binding); err != nil {
			return &runtimev1.RequestLocalAppPermissionResponse{Projection: unavailablePermissionProjection(permissionID, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
		}
		request, err = s.localAppKernel.PermissionGrants().CreatePendingRequest(ctx, localappkernel.CreatePermissionRequestInput{
			LocalOSUserAnchor: caller.LocalOSUserAnchor, AccountID: caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID,
			PermissionID: permissionID, DisplayAppID: principal.AppID, Reason: reason,
		})
	case err == nil:
		request, err = s.localAppKernel.PermissionGrants().RefreshPendingRequest(ctx, localappkernel.RefreshPermissionRequestInput{
			LocalOSUserAnchor: caller.LocalOSUserAnchor, AccountID: caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID,
			PermissionID: permissionID, DisplayAppID: principal.AppID, Reason: reason, ExpectedRevision: request.Revision,
		})
	}
	if err != nil || request.Revision == 0 {
		return &runtimev1.RequestLocalAppPermissionResponse{Projection: unavailablePermissionProjection(permissionID, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
	}
	projection.Posture = runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING
	projection.CanRequest = false
	projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED
	s.publishPermissionInbox(ctx, caller.AccountID)
	return &runtimev1.RequestLocalAppPermissionResponse{Projection: projection}, nil
}

func (s *Service) localAppPermissionProjection(ctx context.Context, permissionID string) *runtimev1.LocalAppPermissionProjection {
	projection := &runtimev1.LocalAppPermissionProjection{
		PermissionId: permissionID,
		Posture:      runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE,
		CanRequest:   false,
		ReasonCode:   runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE,
	}
	if permissionID == "" || strings.TrimSpace(permissionID) != permissionID {
		projection.ReasonCode = runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
		return projection
	}
	caller, err := s.AuthorizeLocalAppCaller(ctx)
	if err != nil {
		projection.ReasonCode = LocalAppCallerAuthorizationReason(err)
		return projection
	}
	descriptor, known := apppermission.Lookup(permissionID)
	if !known {
		projection.ReasonCode = runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
		return projection
	}
	if !descriptor.ManifestAllowed || s.permissionAdmitted == nil || !s.permissionAdmitted(permissionID) ||
		!containsLocalAppCapability(s.currentLocalAppCapabilities(ctx, caller.AccountGeneration), permissionID) || s.localAppKernel == nil {
		return projection
	}
	grants, err := s.localAppKernel.PermissionGrants().ListForPrincipal(ctx, caller.LocalOSUserAnchor, caller.AccountID, caller.LocalAppPrincipalID, permissionID)
	if err != nil {
		return projection
	}
	best := apppermission.PostureEvaluation{Posture: apppermission.PosturePrompt, Reason: apppermission.PostureReasonPrompt}
	for index := range grants {
		evaluation := apppermission.EvaluatePosture(s.now().UTC(), true, true, grants[index].Key, &grants[index])
		if posturePriority(evaluation.Posture) > posturePriority(best.Posture) {
			best = evaluation
		}
	}
	if best.Posture == apppermission.PosturePrompt {
		decision, decisionErr := s.localAppKernel.PermissionGrants().GetPermissionRequestDecision(ctx, caller.LocalOSUserAnchor, caller.AccountID, caller.LocalAppPrincipalID, permissionID)
		if decisionErr == nil && decision.State == localappkernel.PermissionGrantStateDenied {
			best = apppermission.PostureEvaluation{Posture: apppermission.PostureDenied, Reason: apppermission.PostureReasonOwnerDenied}
		} else if decisionErr != nil && !errors.Is(decisionErr, localappkernel.ErrNotFound) {
			return projection
		}
	}
	if best.Posture == apppermission.PosturePrompt {
		request, requestErr := s.localAppKernel.PermissionGrants().GetPendingRequest(ctx, caller.LocalOSUserAnchor, caller.AccountID, caller.LocalAppPrincipalID, permissionID)
		if requestErr == nil && request.Revision > 0 {
			best = apppermission.PostureEvaluation{Posture: apppermission.PosturePending, Reason: apppermission.PostureReasonPending}
		} else if requestErr != nil && !errors.Is(requestErr, localappkernel.ErrNotFound) {
			return projection
		}
	}
	projection.Posture = runtimePermissionPosture(best.Posture)
	projection.CanRequest = best.Posture == apppermission.PosturePrompt
	switch best.Reason {
	case apppermission.PostureReasonGranted:
		projection.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
	case apppermission.PostureReasonGrantRevoked:
		projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED
	case apppermission.PostureReasonOwnerDenied, apppermission.PostureReasonGrantExpired, apppermission.PostureReasonBindingInvalid:
		projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED
	default:
		projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED
	}
	return projection
}

func (s *Service) currentLocalAppCapabilities(ctx context.Context, accountGeneration uint64) []string {
	if s == nil || s.localAppSessions == nil {
		return nil
	}
	binding, err := s.localAppSessions.ResolveLocalAppSession(ctx, accountGeneration)
	if err != nil {
		return nil
	}
	return binding.Capabilities
}

func posturePriority(posture apppermission.Posture) int {
	switch posture {
	case apppermission.PostureGranted:
		return 4
	case apppermission.PosturePending:
		return 3
	case apppermission.PostureDenied:
		return 2
	case apppermission.PosturePrompt:
		return 1
	default:
		return 0
	}
}

func runtimePermissionPosture(posture apppermission.Posture) runtimev1.LocalAppPermissionPosture {
	switch posture {
	case apppermission.PosturePrompt:
		return runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT
	case apppermission.PosturePending:
		return runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING
	case apppermission.PostureGranted:
		return runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_GRANTED
	case apppermission.PostureDenied:
		return runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_DENIED
	default:
		return runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE
	}
}

func unavailablePermissionProjection(permissionID string, reason runtimev1.ReasonCode) *runtimev1.LocalAppPermissionProjection {
	return &runtimev1.LocalAppPermissionProjection{
		PermissionId: permissionID, Posture: runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE,
		CanRequest: false, ReasonCode: reason,
	}
}

func canonicalPermissionReason(value string) bool {
	return value != "" && strings.TrimSpace(value) == value && utf8.ValidString(value) && len([]byte(value)) <= localAppPermissionReasonMaxBytes
}
