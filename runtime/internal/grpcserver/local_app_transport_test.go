package grpcserver

import (
	"context"
	"net"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
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

func TestProtectedLocalAppAdmissionDenialNeverDispatchesOwner(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x35)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x36), SessionProof: grpcLocalAppIdentifier(0x37)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{err: grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)}
	handlerCalled := false
	_, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state.json"}, &grpc.UnaryServerInfo{FullMethod: protectedReadLocalAppStorageJSONMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return &runtimev1.ReadLocalAppStorageJsonResponse{}, nil
	})
	if handlerCalled || admission.calls != 1 || admission.ingress != localappop.IngressStorageJSONRead || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatalf("denied operation = handler:%v admission:%+v reason:%v", handlerCalled, admission, localAppTransportReason(err))
	}
}

func TestProtectedLocalAppAdmittedImplementedOwnerDispatches(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x38)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x39), SessionProof: grpcLocalAppIdentifier(0x3a)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	handlerCalled := false
	response, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state.json"}, &grpc.UnaryServerInfo{FullMethod: protectedReadLocalAppStorageJSONMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return &runtimev1.ReadLocalAppStorageJsonResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
	})
	if err != nil || !handlerCalled || admission.calls != 1 || response.(*runtimev1.ReadLocalAppStorageJsonResponse).GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("admitted operation = handler:%v admission:%+v response:%+v error:%v", handlerCalled, admission, response, err)
	}
}

func TestProtectedLocalAppAdmittedUnimplementedOwnerReportsUnavailable(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x3e)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x3f), SessionProof: grpcLocalAppIdentifier(0x40)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	handlerCalled := false
	_, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, &runtimev1.GenerateLocalAppTextCandidateRequest{}, &grpc.UnaryServerInfo{FullMethod: protectedGenerateTextCandidateMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return &runtimev1.GenerateLocalAppTextCandidateResponse{}, nil
	})
	if handlerCalled || admission.calls != 1 || admission.ingress != localappop.IngressTextCandidateGenerate || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE {
		t.Fatalf("unimplemented owner = handler:%v admission:%+v reason:%v", handlerCalled, admission, localAppTransportReason(err))
	}
}

func TestProtectedLocalAppRealmListAndCreateDispatchToExactOwners(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x51)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x52), SessionProof: grpcLocalAppIdentifier(0x53)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	listCalled := false
	listRequest := &runtimev1.InvokeRealmUnaryRequest{MethodId: "WorldCoreController_listWorldCores", RequestJson: `{"path":{},"query":{}}`}
	_, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, listRequest, &grpc.UnaryServerInfo{FullMethod: protectedInvokeRealmUnaryMethod}, func(context.Context, any) (any, error) {
		listCalled = true
		return &runtimev1.InvokeRealmUnaryResponse{Accepted: true}, nil
	})
	if err != nil || !listCalled || admission.ingress != localappop.IngressRealmWorldCoreList {
		t.Fatalf("Realm list = called:%v admission:%+v error:%v", listCalled, admission, err)
	}

	createCalled := false
	createRequest := &runtimev1.InvokeRealmUnaryRequest{MethodId: "WorldCoreController_createWorldCore", RequestJson: `{"path":{},"query":{},"body":{}}`}
	_, err = newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, createRequest, &grpc.UnaryServerInfo{FullMethod: protectedInvokeRealmUnaryMethod}, func(context.Context, any) (any, error) {
		createCalled = true
		return &runtimev1.InvokeRealmUnaryResponse{Accepted: true}, nil
	})
	if err != nil || !createCalled || admission.ingress != localappop.IngressRealmWorldCoreCreate {
		t.Fatalf("Realm create = called:%v admission:%+v error:%v", createCalled, admission, err)
	}
}

func TestProtectedLocalAppCallerAssertionScannerHandlesRepeatedMessages(t *testing.T) {
	request := &runtimev1.GenerateLocalAppTextCandidateRequest{
		Messages:    []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "deny before dispatch"}},
		Temperature: 0,
		TopP:        1,
		MaxTokens:   1,
	}
	if protectedLocalAppRequestHasCallerAssertion(context.Background(), request) {
		t.Fatal("ordinary repeated message content was treated as a caller assertion")
	}
}

func TestProtectedLocalAppCallerAssertionRejectedBeforeAdmission(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x3b)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x3c), SessionProof: grpcLocalAppIdentifier(0x3d)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	handlerCalled := false
	_, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: "handle-1", SubjectUserId: "forged-account"}, &grpc.UnaryServerInfo{FullMethod: protectedOpenConversationMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return &runtimev1.OpenConversationAnchorResponse{}, nil
	})
	if handlerCalled || admission.calls != 0 || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatalf("caller assertion = handler:%v admission:%+v reason:%v", handlerCalled, admission, localAppTransportReason(err))
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

type localAppAdmissionStub struct {
	ingress localappop.Ingress
	calls   int
	err     error
}

func (stub *localAppAdmissionStub) AdmitLocalAppIngress(_ context.Context, ingress localappop.Ingress) error {
	stub.calls++
	stub.ingress = ingress
	return stub.err
}

func (stub *localAppAdmissionStub) AuthorizeLocalAppIngress(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
	stub.calls++
	stub.ingress = ingress
	return ctx, stub.err
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
