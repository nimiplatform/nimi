package grpcserver

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
)

const protectedOpenDesktopSessionMethod = "/nimi.runtime.v1.RuntimeAuthService/OpenDesktopSession"

func protectedDesktopUnaryMethodAllowed(method string) bool {
	_, allowed := protectedDesktopMethodRole(method)
	return allowed
}

func protectedDesktopStreamMethodAllowed(method string) bool {
	return method == "/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents"
}

func protectedDesktopMethodRole(method string) (protectedlocal.OriginRole, bool) {
	switch method {
	case protectedOpenDesktopSessionMethod:
		return protectedlocal.RoleVerifiedDesktopProcess, true
	case "/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus",
		"/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents",
		"/nimi.runtime.v1.RuntimeAccountService/BeginLogin",
		"/nimi.runtime.v1.RuntimeAccountService/CompleteLogin",
		"/nimi.runtime.v1.RuntimeAccountService/RequestPresenceVerification",
		"/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary",
		"/nimi.runtime.v1.RuntimeAccountService/Logout",
		"/nimi.runtime.v1.RuntimeAccountService/SwitchAccount",
		"/nimi.runtime.v1.RuntimeAccountService/IssueScopedAppBinding",
		"/nimi.runtime.v1.RuntimeAccountService/RevokeScopedAppBinding":
		return protectedlocal.RoleDesktopAccountHost, true
	case "/nimi.runtime.v1.RuntimeAppService/PrepareAppLifecycleIntent",
		"/nimi.runtime.v1.RuntimeAppService/GetAppLifecycleIntentStatus",
		"/nimi.runtime.v1.RuntimeAppService/InstallApp",
		"/nimi.runtime.v1.RuntimeAppService/UninstallApp",
		"/nimi.runtime.v1.RuntimeAppService/UpdateApp",
		"/nimi.runtime.v1.RuntimeAppService/HealthRepairApp",
		"/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppAdoption",
		"/nimi.runtime.v1.RuntimeAppService/OpenApp":
		return protectedlocal.RoleDesktopLifecycleHost, true
	default:
		return "", false
	}
}

// protectedDesktopNetConn is minted only after the native listener has
// completed OS peer verification and established a protected-local Connection.
// The private concrete type prevents an ordinary listener from supplying the
// capability to the gRPC handshake.
type protectedDesktopNetConn struct {
	net.Conn
	desktopConnection *protectedlocal.Connection
	closeOnce         sync.Once
	closeErr          error
}

func wrapProtectedDesktopNetConn(raw net.Conn, connection *protectedlocal.Connection) net.Conn {
	return &protectedDesktopNetConn{Conn: raw, desktopConnection: connection}
}

// nativeVerifiedDesktopListener accepts only the opaque connection carrier
// minted by protectedlocal after Windows peer verification. The capability is
// extracted through a package-private carrier method, so an ordinary listener
// cannot promote a raw net.Conn into protected gRPC transport authority.
type nativeVerifiedDesktopListener struct {
	net.Listener
}

func (listener *nativeVerifiedDesktopListener) Accept() (net.Conn, error) {
	if listener == nil || listener.Listener == nil {
		return nil, fmt.Errorf("verified native Desktop listener is required")
	}
	raw, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	connection, ok := protectedlocal.NativeDesktopConnectionFromNetConn(raw)
	if !ok {
		_ = raw.Close()
		return nil, fmt.Errorf("native Desktop listener returned an unverified connection")
	}
	return wrapProtectedDesktopNetConn(raw, connection), nil
}

func (connection *protectedDesktopNetConn) Close() error {
	if connection == nil {
		return nil
	}
	connection.closeOnce.Do(func() {
		var transportErr error
		if connection.Conn != nil {
			transportErr = connection.Conn.Close()
		}
		if connection.desktopConnection != nil {
			connection.desktopConnection.Revoke()
		}
		connection.closeErr = transportErr
	})
	return connection.closeErr
}

type protectedDesktopAuthInfo struct {
	connection *protectedlocal.Connection
}

func (*protectedDesktopAuthInfo) AuthType() string { return "nimi-protected-local-v1" }

type protectedDesktopTransportCredentials struct{}

func newProtectedDesktopTransportCredentials() credentials.TransportCredentials {
	return protectedDesktopTransportCredentials{}
}

func (protectedDesktopTransportCredentials) ClientHandshake(context.Context, string, net.Conn) (net.Conn, credentials.AuthInfo, error) {
	return nil, nil, fmt.Errorf("protected Desktop transport credentials are server-only")
}

func (protectedDesktopTransportCredentials) ServerHandshake(raw net.Conn) (net.Conn, credentials.AuthInfo, error) {
	connection, ok := raw.(*protectedDesktopNetConn)
	if !ok || connection == nil || connection.Conn == nil || connection.desktopConnection == nil {
		return nil, nil, fmt.Errorf("protected Desktop transport requires a native verified connection")
	}
	origin := connection.desktopConnection.Origin()
	if origin.TransportClass != protectedlocal.TransportDesktopControl || !origin.HasRole(protectedlocal.RoleVerifiedDesktopProcess) {
		return nil, nil, fmt.Errorf("protected Desktop transport requires the verified Desktop role")
	}
	return raw, &protectedDesktopAuthInfo{connection: connection.desktopConnection}, nil
}

func (protectedDesktopTransportCredentials) Info() credentials.ProtocolInfo {
	return credentials.ProtocolInfo{
		SecurityProtocol: "nimi-protected-local",
		SecurityVersion:  "1",
	}
}

func (protectedDesktopTransportCredentials) Clone() credentials.TransportCredentials {
	return protectedDesktopTransportCredentials{}
}

func (protectedDesktopTransportCredentials) OverrideServerName(string) error {
	return fmt.Errorf("protected Desktop transport has no portable server name")
}

func newProtectedDesktopRPCServer(
	authService runtimev1.RuntimeAuthServiceServer,
	accountService runtimev1.RuntimeAccountServiceServer,
	appService runtimev1.RuntimeAppServiceServer,
	desktopSessions *protectedlocal.DesktopSessionManager,
) *grpc.Server {
	server := grpc.NewServer(
		grpc.Creds(newProtectedDesktopTransportCredentials()),
		grpc.MaxRecvMsgSize(maxGRPCRecvMessageBytes),
		grpc.MaxSendMsgSize(maxGRPCSendMessageBytes),
		grpc.MaxConcurrentStreams(maxGRPCConcurrentStreams),
		grpc.ReadBufferSize(grpcIOBufferBytes),
		grpc.WriteBufferSize(grpcIOBufferBytes),
		grpc.UnaryInterceptor(newUnaryProtectedDesktopTransportInterceptor(desktopSessions)),
		grpc.StreamInterceptor(newStreamProtectedDesktopTransportInterceptor(desktopSessions)),
	)
	runtimev1.RegisterRuntimeAuthServiceServer(server, authService)
	runtimev1.RegisterRuntimeAccountServiceServer(server, accountService)
	runtimev1.RegisterRuntimeAppServiceServer(server, appService)
	return server
}

func newUnaryProtectedDesktopTransportInterceptor(desktopSessions *protectedlocal.DesktopSessionManager) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if info == nil {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		if !protectedDesktopUnaryMethodAllowed(info.FullMethod) {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		connection, err := protectedDesktopConnectionFromPeer(ctx)
		if err != nil {
			return nil, err
		}
		protectedContext := protectedlocal.ContextWithDesktopConnection(ctx, connection)
		if err := authorizeProtectedDesktopMethod(protectedContext, info.FullMethod, desktopSessions); err != nil {
			return nil, err
		}
		return handler(protectedContext, req)
	}
}

type protectedDesktopServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (stream *protectedDesktopServerStream) Context() context.Context {
	return stream.ctx
}

func newStreamProtectedDesktopTransportInterceptor(desktopSessions *protectedlocal.DesktopSessionManager) grpc.StreamServerInterceptor {
	return func(srv any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if info == nil || !protectedDesktopStreamMethodAllowed(info.FullMethod) {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		connection, err := protectedDesktopConnectionFromPeer(stream.Context())
		if err != nil {
			return err
		}
		protectedContext := protectedlocal.ContextWithDesktopConnection(stream.Context(), connection)
		if err := authorizeProtectedDesktopMethod(protectedContext, info.FullMethod, desktopSessions); err != nil {
			return err
		}
		return handler(srv, &protectedDesktopServerStream{ServerStream: stream, ctx: protectedContext})
	}
}

func authorizeProtectedDesktopMethod(ctx context.Context, method string, desktopSessions *protectedlocal.DesktopSessionManager) error {
	role, allowed := protectedDesktopMethodRole(method)
	if !allowed {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	if role == protectedlocal.RoleVerifiedDesktopProcess {
		return nil
	}
	if desktopSessions == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
	}
	if err := desktopSessions.AuthorizeContext(ctx, role); err != nil {
		return protectedDesktopSessionAuthorizationError(err)
	}
	return nil
}

func protectedDesktopSessionAuthorizationError(err error) error {
	var failure *protectedlocal.Failure
	if !errors.As(err, &failure) {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
	}
	reasonValue, ok := runtimev1.ReasonCode_value[string(failure.Reason())]
	if !ok {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
	}
	retryable := failure.Retryable()
	return grpcerr.WithReasonCodeOptions(protectedDesktopSessionAuthorizationCode(failure.Reason()), runtimev1.ReasonCode(reasonValue), grpcerr.ReasonOptions{
		ActionHint: failure.ActionHint(),
		Retryable:  &retryable,
	})
}

func protectedDesktopSessionAuthorizationCode(reason protectedlocal.Reason) codes.Code {
	switch reason {
	case protectedlocal.ReasonDesktopControlTransportRequired,
		protectedlocal.ReasonDesktopExecutableTrustFailed,
		protectedlocal.ReasonProtectedOriginRoleMismatch,
		protectedlocal.ReasonProtectedLocalRuntimePrincipalRequired:
		return codes.PermissionDenied
	case protectedlocal.ReasonDesktopProcessVerificationUnavailable:
		return codes.Unauthenticated
	case protectedlocal.ReasonProtectedLocalBootEpochMismatch:
		return codes.FailedPrecondition
	case protectedlocal.ReasonProtectedLocalLedgerRollbackDetected:
		return codes.DataLoss
	default:
		return codes.Unavailable
	}
}

func protectedDesktopConnectionFromPeer(ctx context.Context) (*protectedlocal.Connection, error) {
	peerInfo, ok := peer.FromContext(ctx)
	if !ok || peerInfo == nil {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED)
	}
	authInfo, ok := peerInfo.AuthInfo.(*protectedDesktopAuthInfo)
	if !ok || authInfo == nil || authInfo.connection == nil {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED)
	}
	origin := authInfo.connection.Origin()
	if origin.TransportClass != protectedlocal.TransportDesktopControl || !origin.HasRole(protectedlocal.RoleVerifiedDesktopProcess) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	return authInfo.connection, nil
}

var _ credentials.AuthInfo = (*protectedDesktopAuthInfo)(nil)
var _ credentials.TransportCredentials = protectedDesktopTransportCredentials{}
