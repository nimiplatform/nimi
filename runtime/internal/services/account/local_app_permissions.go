package account

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/apppermission"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"google.golang.org/grpc/metadata"
)

const (
	localAppPermissionReasonMaxBytes    = localappkernel.MaxPermissionRequestReasonBytes
	localAppPermissionRequestIDMaxBytes = localappkernel.MaxPermissionRequestIDBytes
	localAppPermissionRequestDedupTTL   = 5 * time.Minute
	localAppAgentDisplayNameMaxBytes    = 240
)

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
	requestID := ""
	reason := ""
	if req != nil {
		permissionID = req.GetPermissionId()
		reason = req.GetReason()
	}
	requestID = localAppPermissionRequestID(ctx)
	projection := s.localAppPermissionProjection(ctx, permissionID)
	if !canonicalPermissionRequestID(requestID) || !canonicalPermissionReason(reason) {
		projection.Posture = runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE
		projection.CanRequest = false
		projection.ReasonCode = runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
		return &runtimev1.RequestLocalAppPermissionResponse{Projection: projection}, nil
	}
	if projection.GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT &&
		projection.GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		return &runtimev1.RequestLocalAppPermissionResponse{Projection: projection}, nil
	}
	s.permissionRequestMu.Lock()
	defer s.permissionRequestMu.Unlock()
	projection = s.localAppPermissionProjection(ctx, permissionID)
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
	if _, dedupErr := s.localAppKernel.PermissionGrants().GetRecentPermissionRequestDecisionByRequestID(
		ctx, caller.LocalOSUserAnchor, caller.AccountID, caller.LocalAppPrincipalID, requestID,
		s.now().UTC().Add(-localAppPermissionRequestDedupTTL),
	); dedupErr == nil {
		return &runtimev1.RequestLocalAppPermissionResponse{Projection: s.localAppPermissionProjection(ctx, permissionID)}, nil
	} else if !errors.Is(dedupErr, localappkernel.ErrNotFound) {
		return &runtimev1.RequestLocalAppPermissionResponse{Projection: unavailablePermissionProjection(permissionID, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
	}
	request, err := s.localAppKernel.PermissionGrants().GetPendingRequest(ctx, caller.LocalOSUserAnchor, caller.AccountID, caller.LocalAppPrincipalID, permissionID)
	switch {
	case errors.Is(err, localappkernel.ErrNotFound):
		nextRevision, revisionErr := s.localAppKernel.PermissionGrants().NextPermissionRequestRevision(
			ctx, caller.LocalOSUserAnchor, caller.AccountID, caller.LocalAppPrincipalID, permissionID,
		)
		if revisionErr != nil {
			return &runtimev1.RequestLocalAppPermissionResponse{Projection: unavailablePermissionProjection(permissionID, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
		}
		binding := apppermission.AuditBinding{
			OwnerSubjectID: caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID, DisplayAppID: principal.AppID,
			PermissionID: permissionID, OldPosture: apppermission.PosturePrompt, NewPosture: apppermission.PosturePending,
			Trigger: "app_request", Timestamp: s.now().UTC(), OwnerRevision: nextRevision,
		}
		if err := apppermission.NewAuditEmitter(s.auditStore).EmitPendingRequestTransition(ctx, binding); err != nil {
			return &runtimev1.RequestLocalAppPermissionResponse{Projection: unavailablePermissionProjection(permissionID, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)}, nil
		}
		request, err = s.localAppKernel.PermissionGrants().CreatePendingRequest(ctx, localappkernel.CreatePermissionRequestInput{
			LocalOSUserAnchor: caller.LocalOSUserAnchor, AccountID: caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID,
			PermissionID: permissionID, RequestID: requestID, DisplayAppID: principal.AppID, Reason: reason,
		})
	case err == nil:
		request, err = s.localAppKernel.PermissionGrants().RefreshPendingRequest(ctx, localappkernel.RefreshPermissionRequestInput{
			LocalOSUserAnchor: caller.LocalOSUserAnchor, AccountID: caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID,
			PermissionID: permissionID, RequestID: requestID, DisplayAppID: principal.AppID, Reason: reason, ExpectedRevision: request.Revision,
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
		projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_UNKNOWN
		return projection
	}
	if s.permissionAdmitted == nil || !s.permissionAdmitted(permissionID) {
		if descriptor.Admission == apppermission.AdmissionReserved {
			projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED
		}
		return projection
	}
	if !descriptor.ManifestAllowed || !containsLocalAppCapability(s.currentLocalAppCapabilities(ctx, caller.AccountGeneration), permissionID) || s.localAppKernel == nil {
		return projection
	}
	request, requestErr := s.localAppKernel.PermissionGrants().GetPendingRequest(
		ctx, caller.LocalOSUserAnchor, caller.AccountID, caller.LocalAppPrincipalID, permissionID,
	)
	if requestErr == nil && request.Revision > 0 {
		projection.Posture = runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING
		projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED
		return projection
	}
	if requestErr != nil && !errors.Is(requestErr, localappkernel.ErrNotFound) {
		return projection
	}
	accountScopeDigest := localappkernel.AgentAccountScopeDigest(caller.AccountID)
	grantKey := localappkernel.PermissionGrantKey{
		LocalOSUserAnchor: caller.LocalOSUserAnchor,
		AccountID:         caller.AccountID, LocalAppPrincipalID: caller.LocalAppPrincipalID,
		PermissionID: permissionID, OwnerSelectorDigest: accountScopeDigest,
	}
	grant, grantErr := s.localAppKernel.PermissionGrants().Get(ctx, grantKey)
	if errors.Is(grantErr, localappkernel.ErrNotFound) {
		projection.Posture = runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT
		projection.CanRequest = true
		projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED
		return projection
	}
	if grantErr != nil {
		return projection
	}
	evaluation := apppermission.EvaluatePosture(s.now().UTC(), true, true, grantKey, &grant)
	if !evaluation.Usable {
		projection.Posture = runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT
		projection.CanRequest = true
		projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED
		return projection
	}
	projection.Posture = runtimePermissionPosture(evaluation.Posture)
	if evaluation.Posture == apppermission.PostureGranted && permissionID == "agents.configure" {
		interactKey := grantKey
		interactKey.PermissionID = localAppAgentPermissionID
		interactGrant, interactErr := s.localAppKernel.PermissionGrants().Get(ctx, interactKey)
		if interactErr != nil {
			projection.Posture = runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT
			projection.CanRequest = true
			projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED
			return projection
		}
		interactEvaluation := apppermission.EvaluatePosture(s.now().UTC(), true, true, interactKey, &interactGrant)
		if !interactEvaluation.Usable {
			projection.Posture = runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT
			projection.CanRequest = true
			projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED
			return projection
		}
	}
	if evaluation.Posture == apppermission.PostureGranted {
		agents, materializeErr := s.materializeAccountAgentHandles(ctx, caller, permissionID, accountScopeDigest)
		if materializeErr != nil {
			return unavailablePermissionProjection(permissionID, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		projection.Agents = make([]*runtimev1.LocalAppPermissionAgentHandle, 0, len(agents))
		for _, agent := range agents {
			projection.Agents = append(projection.Agents, &runtimev1.LocalAppPermissionAgentHandle{
				AgentHandle: agent.Handle,
				DisplayName: agent.DisplayName,
			})
		}
		latestGrant, latestGrantErr := s.localAppKernel.PermissionGrants().Get(ctx, grantKey)
		if latestGrantErr != nil {
			return unavailablePermissionProjection(permissionID, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
		}
		latestEvaluation := apppermission.EvaluatePosture(s.now().UTC(), true, true, grantKey, &latestGrant)
		if latestEvaluation.Posture != apppermission.PostureGranted {
			projection.Agents = nil
			projection.Posture = runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT
			projection.CanRequest = true
			projection.ReasonCode = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED
			return projection
		}
	}
	projection.ReasonCode = runtimePermissionReason(evaluation)
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

func runtimePermissionPosture(posture apppermission.Posture) runtimev1.LocalAppPermissionPosture {
	switch posture {
	case apppermission.PosturePrompt:
		return runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT
	case apppermission.PosturePending:
		return runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING
	case apppermission.PostureGranted:
		return runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_GRANTED
	case apppermission.PostureDenied, apppermission.PostureRevoked:
		return runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT
	default:
		return runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE
	}
}

func runtimePermissionReason(evaluation apppermission.PostureEvaluation) runtimev1.ReasonCode {
	switch evaluation.Reason {
	case apppermission.PostureReasonGranted:
		return runtimev1.ReasonCode_ACTION_EXECUTED
	case apppermission.PostureReasonGrantRevoked:
		return runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED
	case apppermission.PostureReasonOwnerDenied, apppermission.PostureReasonGrantExpired, apppermission.PostureReasonBindingInvalid:
		return runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED
	default:
		return runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED
	}
}

func unavailablePermissionProjection(permissionID string, reason runtimev1.ReasonCode) *runtimev1.LocalAppPermissionProjection {
	return &runtimev1.LocalAppPermissionProjection{
		PermissionId: permissionID, Posture: runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE,
		CanRequest: false, ReasonCode: reason,
	}
}

func localAppPermissionRequestID(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	values := md.Get("x-nimi-trace-id")
	if len(values) != 1 {
		return ""
	}
	return values[0]
}

func canonicalPermissionRequestID(value string) bool {
	return value != "" && strings.TrimSpace(value) == value && utf8.ValidString(value) && len([]byte(value)) <= localAppPermissionRequestIDMaxBytes
}

func canonicalPermissionReason(value string) bool {
	return value != "" && strings.TrimSpace(value) == value && utf8.ValidString(value) && len([]byte(value)) <= localAppPermissionReasonMaxBytes
}

func canonicalLocalAppAgentDisplayName(value string) bool {
	return value != "" && strings.TrimSpace(value) == value && utf8.ValidString(value) && len([]byte(value)) <= localAppAgentDisplayNameMaxBytes
}
