package account

import (
	"context"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/apppermission"
)

const localAppPermissionReasonMaxBytes = 240

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
	}
	// The app can request owner UX but cannot mint a selector or decision. The
	// protected desktop picker creates pending/granted owner truth through the
	// management RPCs; until then the posture remains prompt.
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

func canonicalPermissionReason(value string) bool {
	return value != "" && strings.TrimSpace(value) == value && utf8.ValidString(value) && len([]byte(value)) <= localAppPermissionReasonMaxBytes
}
