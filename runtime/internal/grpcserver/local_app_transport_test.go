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
	defer serverSide.Close()
	defer clientSide.Close()
	if _, _, err := (protectedLocalAppTransportCredentials{}).ServerHandshake(serverSide); err == nil {
		t.Fatal("ordinary net.Conn passed protected local-app handshake")
	}
	listener := &nativeVerifiedLocalAppListener{Listener: &protectedDesktopOneShotListener{connection: serverSide}}
	if accepted, err := listener.Accept(); err == nil || accepted != nil {
		if accepted != nil {
			_ = accepted.Close()
		}
		t.Fatal("ordinary listener connection was promoted to local-app authority")
	}
}

func TestProtectedLocalAppUnaryPolicyRequiresAtomicBootstrapPromotion(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0xa1)
	interceptor := newUnaryProtectedLocalAppTransportInterceptor()
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})

	handlerCalled := false
	_, err := interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedReadArtifactBytesMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return nil, nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		t.Fatalf("bootstrap reached host operation: called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
	}

	handlerCalled = false
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedOpenLocalAppSessionMethod}, func(handlerCtx context.Context, _ any) (any, error) {
		handlerCalled = true
		bound, ok := protectedlocal.LocalAppConnectionFromContext(handlerCtx)
		if !ok || bound != connection {
			t.Fatal("bootstrap handler did not receive the verified native connection")
		}
		return nil, connection.BindSession(protectedlocal.LocalAppSessionHandle{
			SessionID:    grpcLocalAppIdentifier(0xa2),
			SessionProof: grpcLocalAppIdentifier(0xa3),
		})
	})
	if err != nil || !handlerCalled {
		t.Fatalf("bootstrap did not reach session handler: called=%v err=%v", handlerCalled, err)
	}
	if origin := connection.Origin(); origin.TransportClass != protectedlocal.TransportLocalAppHost || !origin.HasRole(protectedlocal.RoleLocalAppSession) || origin.HasRole(protectedlocal.RoleLocalAppProcess) {
		t.Fatalf("session creation did not atomically promote the connection: %+v", origin)
	}

	handlerCalled = false
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedOpenLocalAppSessionMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return nil, nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH {
		t.Fatalf("promoted host reopened bootstrap: called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
	}

	handlerCalled = false
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedOpenConversationAnchorMethod}, func(handlerCtx context.Context, _ any) (any, error) {
		handlerCalled = true
		bound, ok := protectedlocal.LocalAppConnectionFromContext(handlerCtx)
		if !ok || bound != connection {
			t.Fatal("host handler did not receive the verified session connection")
		}
		return nil, nil
	})
	if err != nil || !handlerCalled {
		t.Fatalf("promoted host did not reach admitted operation: called=%v err=%v", handlerCalled, err)
	}

	connection.Revoke()
	handlerCalled = false
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedReadArtifactBytesMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return nil, nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH {
		t.Fatalf("revoked native process reached handler: called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
	}
}

func TestProtectedLocalAppPoliciesExposeOnlyFinalSelectedOperations(t *testing.T) {
	for _, method := range []string{
		protectedOpenLocalAppSessionMethod,
		protectedGetLocalAppGrantStatusMethod,
		protectedRequestLocalAppGrantMethod,
		protectedReadArtifactBytesMethod,
		protectedOpenConversationAnchorMethod,
		protectedGetPublicChatSnapshotMethod,
		protectedSendAppMessageMethod,
	} {
		if !protectedLocalAppUnaryMethodAllowed(method) {
			t.Fatalf("final unary operation is missing: %s", method)
		}
	}
	if !protectedLocalAppStreamMethodAllowed(protectedSubscribeAppMessagesMethod) {
		t.Fatal("final SubscribeAppMessages stream is missing")
	}
	for _, method := range []string{
		"/nimi.runtime.v1.RuntimeAuthService/RegisterApp",
		"/nimi.runtime.v1.RuntimeArtifactService/CleanupGeneratedVoiceArtifacts",
		"/nimi.runtime.v1.RuntimeDevelopmentService/EvaluateLocalDevelopmentProject",
	} {
		if protectedLocalAppUnaryMethodAllowed(method) || protectedLocalAppStreamMethodAllowed(method) {
			t.Fatalf("unadmitted method reached local-app transport: %s", method)
		}
	}
}

func TestProtectedLocalAppStreamRequiresCurrentSession(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0xb1)
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	interceptor := newStreamProtectedLocalAppTransportInterceptor()
	stream := &localAppTransportTestStream{ctx: ctx}
	handlerCalled := false
	err := interceptor(nil, stream, &grpc.StreamServerInfo{FullMethod: protectedSubscribeAppMessagesMethod}, func(_ any, handlerStream grpc.ServerStream) error {
		handlerCalled = true
		_, ok := protectedlocal.LocalAppConnectionFromContext(handlerStream.Context())
		if !ok {
			t.Fatal("stream handler did not receive local-app connection")
		}
		return nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		t.Fatalf("bootstrap reached host stream: called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
	}
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{
		SessionID:    grpcLocalAppIdentifier(0xb2),
		SessionProof: grpcLocalAppIdentifier(0xb3),
	}); err != nil {
		t.Fatal(err)
	}
	handlerCalled = false
	err = interceptor(nil, stream, &grpc.StreamServerInfo{FullMethod: protectedSubscribeAppMessagesMethod}, func(_ any, handlerStream grpc.ServerStream) error {
		handlerCalled = true
		bound, ok := protectedlocal.LocalAppConnectionFromContext(handlerStream.Context())
		if !ok || bound != connection {
			t.Fatal("stream handler did not receive exact local-app connection")
		}
		return nil
	})
	if err != nil || !handlerCalled {
		t.Fatalf("current local-app session did not reach admitted stream: called=%v err=%v", handlerCalled, err)
	}
}

type localAppTransportTestStream struct{ ctx context.Context }

func (*localAppTransportTestStream) SetHeader(metadata.MD) error  { return nil }
func (*localAppTransportTestStream) SendHeader(metadata.MD) error { return nil }
func (*localAppTransportTestStream) SetTrailer(metadata.MD)       {}
func (stream *localAppTransportTestStream) Context() context.Context {
	return stream.ctx
}
func (*localAppTransportTestStream) SendMsg(any) error { return nil }
func (*localAppTransportTestStream) RecvMsg(any) error { return nil }

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
		OS:                          protectedlocal.OSWindows,
		PID:                         uint32(seed) + 2000,
		CreationMarker:              "grpc-local-app-start",
		OSLoginSession:              "grpc-local-app-logon",
		SecurityPrincipal:           "grpc-local-app-user",
		CanonicalExecutableIdentity: "grpc-local-app-file",
		ExecutableDigest:            grpcLocalAppIdentifier(seed + 1),
		ExecutableTrustSetID:        "grpc-local-app-trust",
	}
	connection, err := protectedlocal.EstablishLocalAppConnection(context.Background(), grpcLocalAppVerifier{peer: protectedlocal.VerifiedLocalAppLaunchPeer{
		LaunchID:         grpcLocalAppIdentifier(seed),
		Process:          process,
		RuntimeBootEpoch: grpcLocalAppIdentifier(seed + 2),
		ProcessLiveness:  liveness,
		TrustClass:       protectedlocal.LocalAppTrustLocalDevelopment,
	}})
	if err != nil {
		t.Fatalf("establish gRPC local-app connection: %v", err)
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
