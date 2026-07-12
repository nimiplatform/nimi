package grpcserver

import (
	"context"
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

const (
	protectedOpenInstalledSessionMethod   = "/nimi.runtime.v1.RuntimeAuthService/OpenDesktopLaunchedAppSession"
	protectedReadArtifactBytesMethod      = "/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes"
	protectedOpenDevelopmentSessionMethod = "/nimi.runtime.v1.RuntimeDevelopmentService/OpenLocalDevelopmentAppSession"
	protectedGetDevelopmentStatusMethod   = "/nimi.runtime.v1.RuntimeDevelopmentService/GetLocalDevelopmentSessionStatus"
)

type protectedInstalledMethodPolicy struct {
	requiredRoles     []protectedlocal.OriginRole
	missingRoleReason runtimev1.ReasonCode
}

var protectedInstalledMethodPolicies = map[string]protectedInstalledMethodPolicy{
	protectedOpenInstalledSessionMethod: {
		requiredRoles:     []protectedlocal.OriginRole{protectedlocal.RoleVerifiedInstalledProcess},
		missingRoleReason: runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	},
	protectedOpenDevelopmentSessionMethod: {
		requiredRoles:     []protectedlocal.OriginRole{protectedlocal.RoleVerifiedLocalDevelopmentProcess},
		missingRoleReason: runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED,
	},
	protectedGetDevelopmentStatusMethod: {
		requiredRoles:     []protectedlocal.OriginRole{protectedlocal.RoleLocalDevelopmentHostSession},
		missingRoleReason: runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SESSION_REVOKED,
	},
	protectedReadArtifactBytesMethod: {
		requiredRoles:     []protectedlocal.OriginRole{protectedlocal.RoleInstalledHostSession, protectedlocal.RoleLocalDevelopmentHostSession},
		missingRoleReason: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
	},
}

func protectedInstalledUnaryMethodAllowed(method string) bool {
	_, allowed := protectedInstalledMethodPolicies[method]
	return allowed
}

type protectedInstalledNetConn struct {
	net.Conn
	connection *protectedlocal.InstalledLaunchConnection
	closeOnce  sync.Once
	closeErr   error
}

func (connection *protectedInstalledNetConn) Close() error {
	if connection == nil {
		return nil
	}
	connection.closeOnce.Do(func() {
		if connection.Conn != nil {
			connection.closeErr = connection.Conn.Close()
		}
		if connection.connection != nil {
			connection.connection.Revoke()
		}
	})
	return connection.closeErr
}

type nativeVerifiedInstalledListener struct{ net.Listener }

func (listener *nativeVerifiedInstalledListener) Accept() (net.Conn, error) {
	if listener == nil || listener.Listener == nil {
		return nil, fmt.Errorf("verified native installed listener is required")
	}
	raw, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	connection, ok := protectedlocal.NativeInstalledConnectionFromNetConn(raw)
	if !ok {
		_ = raw.Close()
		return nil, fmt.Errorf("native installed listener returned an unverified connection")
	}
	return &protectedInstalledNetConn{Conn: raw, connection: connection}, nil
}

type protectedInstalledAuthInfo struct {
	connection *protectedlocal.InstalledLaunchConnection
}

func (*protectedInstalledAuthInfo) AuthType() string { return "nimi-protected-installed-v1" }

type protectedInstalledTransportCredentials struct{}

func (protectedInstalledTransportCredentials) ClientHandshake(context.Context, string, net.Conn) (net.Conn, credentials.AuthInfo, error) {
	return nil, nil, fmt.Errorf("protected installed transport credentials are server-only")
}

func (protectedInstalledTransportCredentials) ServerHandshake(raw net.Conn) (net.Conn, credentials.AuthInfo, error) {
	connection, ok := raw.(*protectedInstalledNetConn)
	if !ok || connection == nil || connection.Conn == nil || connection.connection == nil || !connection.connection.Live() {
		return nil, nil, fmt.Errorf("protected installed transport requires a live native verified connection")
	}
	return raw, &protectedInstalledAuthInfo{connection: connection.connection}, nil
}

func (protectedInstalledTransportCredentials) Info() credentials.ProtocolInfo {
	return credentials.ProtocolInfo{SecurityProtocol: "nimi-protected-installed", SecurityVersion: "1"}
}
func (protectedInstalledTransportCredentials) Clone() credentials.TransportCredentials {
	return protectedInstalledTransportCredentials{}
}
func (protectedInstalledTransportCredentials) OverrideServerName(string) error {
	return fmt.Errorf("protected installed transport has no portable server name")
}

func newProtectedInstalledRPCServer(authService runtimev1.RuntimeAuthServiceServer, developmentService runtimev1.RuntimeDevelopmentServiceServer, artifactService runtimev1.RuntimeArtifactServiceServer) *grpc.Server {
	server := grpc.NewServer(
		grpc.Creds(protectedInstalledTransportCredentials{}),
		grpc.MaxRecvMsgSize(maxGRPCRecvMessageBytes),
		grpc.MaxSendMsgSize(maxGRPCSendMessageBytes),
		grpc.MaxConcurrentStreams(maxGRPCConcurrentStreams),
		grpc.UnaryInterceptor(newUnaryProtectedInstalledTransportInterceptor()),
	)
	runtimev1.RegisterRuntimeAuthServiceServer(server, authService)
	runtimev1.RegisterRuntimeDevelopmentServiceServer(server, developmentService)
	runtimev1.RegisterRuntimeArtifactServiceServer(server, artifactService)
	return server
}

func newUnaryProtectedInstalledTransportInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if info == nil {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		policy, allowed := protectedInstalledMethodPolicies[info.FullMethod]
		if !allowed {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		peerInfo, ok := peer.FromContext(ctx)
		if !ok || peerInfo == nil {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		authInfo, ok := peerInfo.AuthInfo.(*protectedInstalledAuthInfo)
		if !ok || authInfo == nil || authInfo.connection == nil || !authInfo.connection.Live() {
			return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_DESKTOP_PROCESS_VERIFICATION_UNAVAILABLE)
		}
		origin := authInfo.connection.Origin()
		roleAllowed := origin.TransportClass == protectedlocal.TransportInstalledHost
		if roleAllowed {
			roleAllowed = false
			for _, role := range policy.requiredRoles {
				if origin.HasRole(role) {
					roleAllowed = true
					break
				}
			}
		}
		if !roleAllowed {
			code := codes.PermissionDenied
			if policy.missingRoleReason == runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED || policy.missingRoleReason == runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SESSION_REVOKED {
				code = codes.Unauthenticated
			}
			return nil, grpcerr.WithReasonCode(code, policy.missingRoleReason)
		}
		return handler(protectedlocal.ContextWithInstalledLaunchConnection(ctx, authInfo.connection), req)
	}
}

var _ credentials.AuthInfo = (*protectedInstalledAuthInfo)(nil)
var _ credentials.TransportCredentials = protectedInstalledTransportCredentials{}
