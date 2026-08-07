package auth

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/codes"
)

// OpenLocalAppSession is the one request-empty local-app session bootstrap.
// The exact connection, lease, process, principal/record and account facts are
// resolved privately. Immutable package profiles remain unavailable in 0K.
func (s *Service) OpenLocalAppSession(ctx context.Context, req *runtimev1.OpenLocalAppSessionRequest) (*runtimev1.OpenLocalAppSessionResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	if s == nil || s.accountSecurity == nil || s.localAppOpener == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED)
	}
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	if connection.TrustClass() != protectedlocal.LocalAppTrustLocalDevelopment {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	projection, err := s.localAppOpener.OpenLocalAppSessionProjection(ctx)
	if err != nil {
		return nil, err
	}
	return localAppSessionResponse(projection), nil
}

// RenewLocalAppSession atomically replaces one short-lived technical session
// on the exact already-promoted local_app_host connection. The empty request
// cannot select a session, process, account, or recovery path.
func (s *Service) RenewLocalAppSession(ctx context.Context, req *runtimev1.RenewLocalAppSessionRequest) (*runtimev1.OpenLocalAppSessionResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	if s == nil || s.accountSecurity == nil || s.localAppOpener == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED)
	}
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	if connection.TrustClass() != protectedlocal.LocalAppTrustLocalDevelopment {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	projection, err := s.localAppOpener.RenewLocalAppSessionProjection(ctx)
	if err != nil {
		return nil, err
	}
	return localAppSessionResponse(projection), nil
}

func localAppSessionResponse(projection LocalAppSessionProjection) *runtimev1.OpenLocalAppSessionResponse {
	currentUser := projection.CurrentUser
	currentReason := projection.CurrentUserReasonCode
	if currentUser == nil || currentUser.GetHandle() == "" || currentUser.GetDisplayName() == "" ||
		currentReason != runtimev1.ReasonCode_ACTION_EXECUTED {
		currentUser = nil
		currentReason = runtimev1.ReasonCode_CURRENT_USER_DISPLAY_UNAVAILABLE
	}
	return &runtimev1.OpenLocalAppSessionResponse{
		State:                 runtimev1.LocalAppSessionState_LOCAL_APP_SESSION_STATE_READY,
		ReasonCode:            runtimev1.ReasonCode_ACTION_EXECUTED,
		CurrentUser:           currentUser,
		CurrentUserReasonCode: currentReason,
	}
}
