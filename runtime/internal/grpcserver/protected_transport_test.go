package grpcserver

import (
	"bytes"
	"context"
	"crypto/rand"
	"io"
	"log/slog"
	"net"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

func TestProtectedDesktopRPCTransportRejectsOrdinaryConnection(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer serverSide.Close()
	defer clientSide.Close()
	if _, _, err := newProtectedDesktopTransportCredentials().ServerHandshake(serverSide); err == nil {
		t.Fatal("ordinary net.Conn passed protected Desktop transport handshake")
	}
}

func TestNativeVerifiedDesktopListenerRejectsOrdinaryConnection(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer clientSide.Close()
	listener := &nativeVerifiedDesktopListener{Listener: &protectedDesktopOneShotListener{connection: serverSide}}
	accepted, err := listener.Accept()
	if accepted != nil {
		_ = accepted.Close()
		t.Fatal("ordinary net.Conn was promoted to a verified native Desktop connection")
	}
	if err == nil {
		t.Fatal("ordinary net.Conn passed native verified Desktop listener")
	}
}

func TestProtectedDesktopRPCTransportBindsVerifiedConnectionAndGatesAdmittedServices(t *testing.T) {
	manager, connection := newProtectedRPCFixture(t)
	authService := authservice.NewWithDependencies(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		nil,
		60,
		86400,
		authservice.WithDesktopSessionManager(manager),
	)
	accountService := &protectedDesktopAccountTestService{}
	appService := &protectedDesktopAppTestService{}
	server := newProtectedDesktopRPCServer(authService, accountService, appService, manager)
	baseListener := bufconn.Listen(1024 * 1024)
	listener := &protectedDesktopTestListener{Listener: baseListener, connection: connection}
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()
	t.Cleanup(func() {
		server.Stop()
		_ = baseListener.Close()
		<-serveDone
	})

	clientConn, err := grpc.DialContext(
		context.Background(),
		"passthrough:///protected-desktop-test",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return baseListener.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial protected Desktop transport: %v", err)
	}
	t.Cleanup(func() { _ = clientConn.Close() })
	client := runtimev1.NewRuntimeAuthServiceClient(clientConn)
	accountClient := runtimev1.NewRuntimeAccountServiceClient(clientConn)

	_, err = accountClient.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("account request without Desktop session reason = %v (present=%v), err=%v", reason, ok, err)
	}

	response, err := client.OpenDesktopSession(context.Background(), &runtimev1.OpenDesktopSessionRequest{})
	if err != nil {
		t.Fatalf("OpenDesktopSession over protected transport: %v", err)
	}
	if len(response.GetDesktopSessionId()) != protectedlocal.IdentifierBytes || len(response.GetRuntimeBootEpoch()) != protectedlocal.IdentifierBytes {
		t.Fatalf("protected response lengths: session=%d epoch=%d", len(response.GetDesktopSessionId()), len(response.GetRuntimeBootEpoch()))
	}

	_, err = client.RegisterApp(context.Background(), &runtimev1.RegisterAppRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("non-allowlisted protected RPC reason = %v (present=%v), err=%v", reason, ok, err)
	}
	statusResponse, err := accountClient.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{})
	if err != nil || statusResponse.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || !accountService.statusBound {
		t.Fatalf("GetAccountSessionStatus protected carrier = (%+v, %v), bound=%v", statusResponse, err, accountService.statusBound)
	}
	accountStream, err := accountClient.SubscribeAccountSessionEvents(context.Background(), &runtimev1.SubscribeAccountSessionEventsRequest{})
	if err != nil {
		t.Fatalf("SubscribeAccountSessionEvents protected carrier: %v", err)
	}
	if _, err := accountStream.Recv(); err != nil || !accountService.subscriptionBound {
		t.Fatalf("SubscribeAccountSessionEvents protected carrier = (%v), bound=%v", err, accountService.subscriptionBound)
	}
	_, err = accountClient.IssueWorkspaceBinding(context.Background(), &runtimev1.IssueWorkspaceBindingRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH || accountService.workspaceBindingCalled {
		t.Fatalf("workspace binding escaped protected deny-only posture: reason=%v present=%v called=%v err=%v", reason, ok, accountService.workspaceBindingCalled, err)
	}

	appClient := runtimev1.NewRuntimeAppServiceClient(clientConn)
	prepare, err := appClient.PrepareAppLifecycleIntent(context.Background(), &runtimev1.PrepareAppLifecycleIntentRequest{})
	if err != nil || prepare.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || !appService.prepareBound {
		t.Fatalf("PrepareAppLifecycleIntent protected carrier = (%+v, %v), bound=%v", prepare, err, appService.prepareBound)
	}
	lifecycleStatusResponse, err := appClient.GetAppLifecycleIntentStatus(context.Background(), &runtimev1.GetAppLifecycleIntentStatusRequest{})
	if err != nil || lifecycleStatusResponse.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || !appService.statusBound {
		t.Fatalf("GetAppLifecycleIntentStatus protected carrier = (%+v, %v), bound=%v", lifecycleStatusResponse, err, appService.statusBound)
	}
	_, err = appClient.InstallApp(context.Background(), &runtimev1.InstallAppRequest{})
	if err != nil || !appService.installBound {
		t.Fatalf("InstallApp protected carrier = (%v), bound=%v", err, appService.installBound)
	}
	_, err = appClient.OpenApp(context.Background(), &runtimev1.OpenAppRequest{})
	if err != nil || !appService.openBound {
		t.Fatalf("OpenApp protected carrier = (%v), bound=%v", err, appService.openBound)
	}
	if err := clientConn.Close(); err != nil {
		t.Fatalf("close protected Desktop client: %v", err)
	}
	revokedContext := protectedlocal.ContextWithDesktopConnection(context.Background(), connection)
	deadline := time.Now().Add(2 * time.Second)
	for {
		err := manager.AuthorizeContext(revokedContext, protectedlocal.RoleDesktopAccountHost)
		if protectedlocal.IsReason(err, protectedlocal.ReasonDesktopProcessVerificationUnavailable) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("protected connection remained authorized after transport close: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

type protectedDesktopAccountTestService struct {
	runtimev1.UnimplementedRuntimeAccountServiceServer
	statusBound            bool
	subscriptionBound      bool
	workspaceBindingCalled bool
}

func (service *protectedDesktopAccountTestService) GetAccountSessionStatus(ctx context.Context, _ *runtimev1.GetAccountSessionStatusRequest) (*runtimev1.GetAccountSessionStatusResponse, error) {
	_, service.statusBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.GetAccountSessionStatusResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (service *protectedDesktopAccountTestService) SubscribeAccountSessionEvents(_ *runtimev1.SubscribeAccountSessionEventsRequest, stream runtimev1.RuntimeAccountService_SubscribeAccountSessionEventsServer) error {
	_, service.subscriptionBound = protectedlocal.DesktopConnectionFromContext(stream.Context())
	return stream.Send(&runtimev1.AccountSessionEvent{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED})
}

func (service *protectedDesktopAccountTestService) IssueWorkspaceBinding(context.Context, *runtimev1.IssueWorkspaceBindingRequest) (*runtimev1.IssueWorkspaceBindingResponse, error) {
	service.workspaceBindingCalled = true
	return &runtimev1.IssueWorkspaceBindingResponse{}, nil
}

type protectedDesktopAppTestService struct {
	runtimev1.UnimplementedRuntimeAppServiceServer
	prepareBound bool
	statusBound  bool
	installBound bool
	openBound    bool
}

func (service *protectedDesktopAppTestService) PrepareAppLifecycleIntent(ctx context.Context, _ *runtimev1.PrepareAppLifecycleIntentRequest) (*runtimev1.PrepareAppLifecycleIntentResponse, error) {
	_, service.prepareBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.PrepareAppLifecycleIntentResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (service *protectedDesktopAppTestService) GetAppLifecycleIntentStatus(ctx context.Context, _ *runtimev1.GetAppLifecycleIntentStatusRequest) (*runtimev1.GetAppLifecycleIntentStatusResponse, error) {
	_, service.statusBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.GetAppLifecycleIntentStatusResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (service *protectedDesktopAppTestService) InstallApp(ctx context.Context, _ *runtimev1.InstallAppRequest) (*runtimev1.InstallAppResponse, error) {
	_, service.installBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.InstallAppResponse{}, nil
}

func (service *protectedDesktopAppTestService) OpenApp(ctx context.Context, _ *runtimev1.OpenAppRequest) (*runtimev1.OpenAppResponse, error) {
	_, service.openBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.OpenAppResponse{}, nil
}

type protectedDesktopTestListener struct {
	*bufconn.Listener
	connection *protectedlocal.Connection
}

func (listener *protectedDesktopTestListener) Accept() (net.Conn, error) {
	connection, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return wrapProtectedDesktopNetConn(connection, listener.connection), nil
}

type protectedDesktopOneShotListener struct {
	connection net.Conn
	closed     bool
}

func (listener *protectedDesktopOneShotListener) Accept() (net.Conn, error) {
	if listener.closed || listener.connection == nil {
		return nil, net.ErrClosed
	}
	listener.closed = true
	return listener.connection, nil
}

func (listener *protectedDesktopOneShotListener) Close() error {
	listener.closed = true
	if listener.connection == nil {
		return nil
	}
	return listener.connection.Close()
}

func (*protectedDesktopOneShotListener) Addr() net.Addr {
	return protectedDesktopTestAddress("ordinary-test-listener")
}

type protectedDesktopTestAddress string

func (address protectedDesktopTestAddress) Network() string { return "protected-desktop-test" }
func (address protectedDesktopTestAddress) String() string  { return string(address) }

type protectedRPCFixtureLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func (liveness *protectedRPCFixtureLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *protectedRPCFixtureLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

type protectedRPCFixtureVerifier struct {
	peers protectedlocal.VerifiedDesktopPeers
}

func (verifier protectedRPCFixtureVerifier) VerifyDesktopPeers(context.Context) (protectedlocal.VerifiedDesktopPeers, error) {
	return verifier.peers, nil
}

func newProtectedRPCFixture(t *testing.T) (*protectedlocal.DesktopSessionManager, *protectedlocal.Connection) {
	t.Helper()
	directory := t.TempDir()
	anchor, err := protectedlocal.NewFileAnchorStore(
		filepath.Join(directory, "protected_local.anchor"),
		bytes.Repeat([]byte{0xc1}, protectedlocal.IdentifierBytes),
	)
	if err != nil {
		t.Fatalf("new protected transport anchor: %v", err)
	}
	ledger, err := protectedlocal.OpenLedger(context.Background(), protectedlocal.LedgerOptions{
		Path:         filepath.Join(directory, protectedlocal.LedgerFilename),
		AnchorStore:  anchor,
		RecordMACKey: bytes.Repeat([]byte{0xc2}, protectedlocal.IdentifierBytes),
		Random:       rand.Reader,
	})
	if err != nil {
		t.Fatalf("open protected transport ledger: %v", err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	bootEpoch, err := ledger.StartRuntime(context.Background())
	if err != nil {
		t.Fatalf("start protected transport Runtime: %v", err)
	}
	manager, err := protectedlocal.NewDesktopSessionManager(bootEpoch, rand.Reader)
	if err != nil {
		t.Fatalf("new protected transport session manager: %v", err)
	}
	liveness := &protectedRPCFixtureLiveness{revoked: make(chan struct{})}
	connection, err := protectedlocal.EstablishDesktopConnection(context.Background(), protectedRPCFixtureVerifier{peers: protectedlocal.VerifiedDesktopPeers{
		Client: protectedlocal.ProcessTuple{
			OS:                          protectedlocal.OSWindows,
			PID:                         7301,
			CreationMarker:              "protected-transport-desktop",
			OSLoginSession:              "protected-transport-logon",
			SecurityPrincipal:           "protected-transport-user",
			CanonicalExecutableIdentity: "protected-transport-desktop-file",
			ExecutableDigest:            protectedTestIdentifier(0xc3),
			ExecutableTrustSetID:        "nimi-desktop-protected-transport-test-v1",
		},
		Server: protectedlocal.ProcessTuple{
			OS:                          protectedlocal.OSWindows,
			PID:                         8301,
			CreationMarker:              "protected-transport-runtime",
			OSLoginSession:              "service-session-0",
			SecurityPrincipal:           "NT SERVICE/NimiRuntimeProtectedTransportTest",
			CanonicalExecutableIdentity: "protected-transport-runtime-file",
			ExecutableDigest:            protectedTestIdentifier(0xc4),
			ExecutableTrustSetID:        "nimi-runtime-protected-transport-test-v1",
		},
		ClientLiveness:     liveness,
		RuntimeBootEpoch:   bootEpoch,
		EndpointInstanceID: protectedTestIdentifier(0xc5),
		TranscriptNonce:    protectedTestIdentifier(0xc6),
	}}, rand.Reader)
	if err != nil {
		t.Fatalf("establish protected transport connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	return manager, connection
}

func protectedTestIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

var _ net.Listener = (*protectedDesktopTestListener)(nil)
