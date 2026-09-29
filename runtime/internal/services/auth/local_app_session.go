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
func (s *Service) OpenLocalAppSession(ctx context.Context, req *runtimev1.OpenLocalAppSessionRequest) (_ *runtimev1.OpenLocalAppSessionResponse, err error) {
	const operation = "OpenLocalAppSession"
	defer func() { s.recordLocalAppSessionRefusal(ctx, operation, err) }()
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
	if !localAppSessionConnectionAllowed(connection) {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	projection, err := s.localAppOpener.OpenLocalAppSessionProjection(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.recordLocalAppSessionEstablished(ctx, operation, connection, projection); err != nil {
		return nil, err
	}
	return localAppSessionResponse(projection), nil
}

// RenewLocalAppSession extends only the same live, unexpired technical session.
// The empty request cannot select a session, process, account, or recovery path.
func (s *Service) RenewLocalAppSession(ctx context.Context, req *runtimev1.RenewLocalAppSessionRequest) (_ *runtimev1.OpenLocalAppSessionResponse, err error) {
	const operation = "RenewLocalAppSession"
	defer func() { s.recordLocalAppSessionRefusal(ctx, operation, err) }()
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
	if !localAppSessionConnectionAllowed(connection) {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	projection, err := s.localAppOpener.RenewLocalAppSessionProjection(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.recordLocalAppSessionEstablished(ctx, operation, connection, projection); err != nil {
		return nil, err
	}
	return localAppSessionResponse(projection), nil
}

// RebindLocalAppSession revalidates the original verified connection after
// scope invalidation. It cannot bootstrap an unknown or replacement connection.
func (s *Service) RebindLocalAppSession(ctx context.Context, req *runtimev1.RebindLocalAppSessionRequest) (_ *runtimev1.OpenLocalAppSessionResponse, err error) {
	const operation = "RebindLocalAppSession"
	defer func() { s.recordLocalAppSessionRefusal(ctx, operation, err) }()
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	if s == nil || s.accountSecurity == nil || s.localAppOpener == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED)
	}
	connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok || !localAppSessionConnectionAllowed(connection) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	projection, err := s.localAppOpener.RebindLocalAppSessionProjection(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.recordLocalAppSessionEstablished(ctx, operation, connection, projection); err != nil {
		return nil, err
	}
	return localAppSessionResponse(projection), nil
}

// recordLocalAppSessionEstablished records a session method's success before
// the session is handed out. The session exists only in process memory, so an
// unrecordable result invalidates it (as expiry would) and fails closed; the
// App recovers through Rebind once the audit plane is writable.
func (s *Service) recordLocalAppSessionEstablished(ctx context.Context, operation string, connection *protectedlocal.LocalAppConnection, projection LocalAppSessionProjection) error {
	handle, bound := connection.Session()
	payload := map[string]any{"trust_class": string(connection.TrustClass())}
	if bound {
		payload["session_ref"] = sessionReference("lsr", handle.SessionID[:])
	}
	auditErr := s.recordSessionEstablished(ctx, operation, projection.AppID, projection.AccountID, payload)
	if auditErr == nil {
		return nil
	}
	if bound {
		connection.InvalidateSession(handle)
	}
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, auditErr, grpcerr.ReasonOptions{
		Message:  "local-app session could not be recorded",
		Metadata: map[string]string{"audit_disposition": "unrecorded"},
	})
}

func (s *Service) recordLocalAppSessionRefusal(ctx context.Context, operation string, cause error) {
	if cause == nil {
		return
	}
	payload := map[string]any{}
	if connection, ok := protectedlocal.LocalAppConnectionFromContext(ctx); ok && connection != nil {
		payload["trust_class"] = string(connection.TrustClass())
	}
	s.recordSessionRefusal(ctx, operation, "", cause, payload)
}

func localAppSessionConnectionAllowed(connection *protectedlocal.LocalAppConnection) bool {
	if connection == nil {
		return false
	}
	if connection.TrustClass() == protectedlocal.LocalAppTrustLocalDevelopment {
		return true
	}
	_, installed := connection.InstalledRegistrationHandle()
	return installed && (connection.TrustClass() == protectedlocal.LocalAppTrustBuiltIn ||
		connection.TrustClass() == protectedlocal.LocalAppTrustVerified ||
		connection.TrustClass() == protectedlocal.LocalAppTrustUserImported)
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
