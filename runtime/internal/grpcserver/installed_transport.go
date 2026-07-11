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
	protectedOpenInstalledSessionMethod = "/nimi.runtime.v1.RuntimeAuthService/OpenDesktopLaunchedAppSession"
	protectedReadArtifactBytesMethod    = "/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes"
)

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

func newProtectedInstalledRPCServer(authService runtimev1.RuntimeAuthServiceServer, artifactService runtimev1.RuntimeArtifactServiceServer) *grpc.Server {
	server := grpc.NewServer(
		grpc.Creds(protectedInstalledTransportCredentials{}),
		grpc.MaxRecvMsgSize(maxGRPCRecvMessageBytes),
		grpc.MaxSendMsgSize(maxGRPCSendMessageBytes),
		grpc.MaxConcurrentStreams(maxGRPCConcurrentStreams),
		grpc.UnaryInterceptor(newUnaryProtectedInstalledTransportInterceptor()),
	)
	runtimev1.RegisterRuntimeAuthServiceServer(server, authService)
	runtimev1.RegisterRuntimeArtifactServiceServer(server, artifactService)
	return server
}

func newUnaryProtectedInstalledTransportInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if info == nil || (info.FullMethod != protectedOpenInstalledSessionMethod && info.FullMethod != protectedReadArtifactBytesMethod) {
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
		if info.FullMethod == protectedReadArtifactBytesMethod {
			if _, ok := authInfo.connection.InstalledSession(); !ok {
				return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
			}
		}
		return handler(protectedlocal.ContextWithInstalledLaunchConnection(ctx, authInfo.connection), req)
	}
}

var _ credentials.AuthInfo = (*protectedInstalledAuthInfo)(nil)
var _ credentials.TransportCredentials = protectedInstalledTransportCredentials{}
