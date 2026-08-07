package grpcserver

import (
	"context"
	"net"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
)

func TestProtectedLocalAppTransportRejectsOrdinaryConnection(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer func() { _ = serverSide.Close() }()
	defer func() { _ = clientSide.Close() }()
	if _, _, err := (protectedLocalAppTransportCredentials{}).ServerHandshake(serverSide); err == nil {
		t.Fatal("ordinary net.Conn passed protected local-app handshake")
	}
}

func TestProtectedLocalAppOperationsFailClosedBeforeOwnerDispatch(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x31)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x32), SessionProof: grpcLocalAppIdentifier(0x33)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	handlerCalled := false
	_, err := newUnaryProtectedLocalAppTransportInterceptor()(ctx, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state.json"}, &grpc.UnaryServerInfo{FullMethod: protectedReadLocalAppStorageJSONMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return &runtimev1.ReadLocalAppStorageJsonResponse{}, nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("protected operation = called:%v reason:%v", handlerCalled, localAppTransportReason(err))
	}
}

func TestProtectedLocalAppStreamFailsClosedBeforeOwnerDispatch(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x41)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x42), SessionProof: grpcLocalAppIdentifier(0x43)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	handlerCalled := false
	err := newStreamProtectedLocalAppTransportInterceptor()(nil, &localAppTransportTestStream{ctx: ctx}, &grpc.StreamServerInfo{FullMethod: protectedSubscribeConversationMethod}, func(any, grpc.ServerStream) error {
		handlerCalled = true
		return nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("protected stream = called:%v reason:%v", handlerCalled, localAppTransportReason(err))
	}
}

type localAppTransportTestStream struct{ ctx context.Context }

func (*localAppTransportTestStream) SetHeader(metadata.MD) error     { return nil }
func (*localAppTransportTestStream) SendHeader(metadata.MD) error    { return nil }
func (*localAppTransportTestStream) SetTrailer(metadata.MD)          {}
func (stream *localAppTransportTestStream) Context() context.Context { return stream.ctx }
func (*localAppTransportTestStream) SendMsg(any) error               { return nil }
func (*localAppTransportTestStream) RecvMsg(any) error               { return nil }

type grpcLocalAppVerifier struct {
	peer protectedlocal.VerifiedLocalAppLaunchPeer
}

func (verifier grpcLocalAppVerifier) VerifyLocalAppLaunchPeer(context.Context) (protectedlocal.VerifiedLocalAppLaunchPeer, error) {
	return verifier.peer, nil
}

type grpcLocalAppLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func (liveness *grpcLocalAppLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *grpcLocalAppLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

func newGRPCLocalAppConnection(t testing.TB, seed byte) *protectedlocal.LocalAppConnection {
	t.Helper()
	liveness := &grpcLocalAppLiveness{revoked: make(chan struct{})}
	process := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: uint32(seed) + 2000, CreationMarker: "grpc-local-app-start",
		OSLoginSession: "grpc-local-app-logon", SecurityPrincipal: "grpc-local-app-user",
		CanonicalExecutableIdentity: "grpc-local-app-file", ExecutableDigest: grpcLocalAppIdentifier(seed + 1),
		ExecutableTrustSetID: "grpc-local-app-trust",
	}
	connection, err := protectedlocal.EstablishLocalAppConnection(context.Background(), grpcLocalAppVerifier{peer: protectedlocal.VerifiedLocalAppLaunchPeer{
		LaunchID: grpcLocalAppIdentifier(seed), Process: process, RuntimeBootEpoch: grpcLocalAppIdentifier(seed + 2),
		ProcessLiveness: liveness, TrustClass: protectedlocal.LocalAppTrustLocalDevelopment,
	}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	return connection
}

func grpcLocalAppIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func localAppTransportReason(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}
