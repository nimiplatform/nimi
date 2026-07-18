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
	// No public permission is currently admitted. A future positive request
	// path must be added atomically with its owner selector, enforcement,
	// approval UI, audit, revoke, and evidence slice.
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
	if _, err := s.AuthorizeLocalAppCaller(ctx); err != nil {
		projection.ReasonCode = LocalAppCallerAuthorizationReason(err)
		return projection
	}
	if _, known := apppermission.Lookup(permissionID); !known {
		projection.ReasonCode = runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
		return projection
	}
	if !apppermission.IsAdmitted(permissionID) {
		return projection
	}
	// Admission is intentionally closed until a complete positive slice exists.
	return projection
}

func canonicalPermissionReason(value string) bool {
	return value != "" && strings.TrimSpace(value) == value && utf8.ValidString(value) && len([]byte(value)) <= localAppPermissionReasonMaxBytes
}
