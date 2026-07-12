package grpcserver

import (
	"context"
	"log/slog"
	"net"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	runtimeartifactservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/test/bufconn"
)

func TestProtectedInstalledTransportRejectsOrdinaryConnection(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer serverSide.Close()
	defer clientSide.Close()
	if _, _, err := (protectedInstalledTransportCredentials{}).ServerHandshake(serverSide); err == nil {
		t.Fatal("ordinary net.Conn passed protected installed handshake")
	}
	listener := &nativeVerifiedInstalledListener{Listener: &protectedDesktopOneShotListener{connection: serverSide}}
	if accepted, err := listener.Accept(); err == nil || accepted != nil {
		if accepted != nil {
			_ = accepted.Close()
		}
		t.Fatal("ordinary listener connection was promoted to installed authority")
	}
}

func TestProtectedInstalledTransportRejectsCrossTrustClassMethodsBeforeHandlers(t *testing.T) {
	production := newGRPCNativeAppHostConnection(t, protectedlocal.NativeAppHostTrustProductionInstalled, 0xa1)
	development := newGRPCNativeAppHostConnection(t, protectedlocal.NativeAppHostTrustLocalDevelopment, 0xa5)
	interceptor := newUnaryProtectedInstalledTransportInterceptor()
	tests := []struct {
		name       string
		connection *protectedlocal.InstalledLaunchConnection
		method     string
		reason     runtimev1.ReasonCode
	}{
		{name: "production-to-development", connection: production, method: protectedOpenDevelopmentSessionMethod, reason: runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED},
		{name: "development-to-production", connection: development, method: protectedOpenInstalledSessionMethod, reason: runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedInstalledAuthInfo{connection: testCase.connection}})
			handlerCalled := false
			_, err := interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: testCase.method}, func(context.Context, any) (any, error) {
				handlerCalled = true
				return nil, nil
			})
			if handlerCalled || grpcInstalledReason(err) != testCase.reason {
				t.Fatalf("cross-trust method reached handler=%v reason=%v err=%v", handlerCalled, grpcInstalledReason(err), err)
			}
		})
	}
}

func TestProtectedInstalledTransportOpensOnlyProcessBoundSession(t *testing.T) {
	boot := grpcInstalledIdentifier(0xb1)
	store, err := authservice.OpenInstalledLaunchStore(filepath.Join(t.TempDir(), "installed-launch.db"), boot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	release := grpcInstalledIdentifier(0xb2)
	ticket, err := store.Issue(context.Background(), authservice.InstalledLaunchIssue{AppID: "world.nimi.app", ReleaseDigest: release, AccountGeneration: 12})
	if err != nil {
		t.Fatal(err)
	}
	process := protectedlocal.ProcessTuple{OS: protectedlocal.OSWindows, PID: 12001, CreationMarker: "installed-grpc-start", OSLoginSession: "installed-grpc-logon", SecurityPrincipal: "installed-grpc-user", CanonicalExecutableIdentity: "installed-grpc-file", ExecutableDigest: release, ExecutableTrustSetID: "installed-grpc-release-policy"}
	if _, err := store.BindProcess(context.Background(), authservice.InstalledLaunchProcess{LaunchID: ticket.LaunchID, PID: process.PID, CreationMarker: process.CreationMarker, ReleaseDigest: release, AccountGeneration: 12}); err != nil {
		t.Fatal(err)
	}
	liveness := newGRPCInstalledLiveness()
	connection, err := protectedlocal.EstablishInstalledLaunchConnection(context.Background(), grpcInstalledVerifier{peer: protectedlocal.VerifiedInstalledLaunchPeer{LaunchID: ticket.LaunchID, Process: process, RuntimeBootEpoch: boot, ProcessLiveness: liveness, TrustClass: protectedlocal.NativeAppHostTrustProductionInstalled}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	authService := authservice.NewWithDependencies(slog.Default(), nil, nil, 60, 86400, authservice.WithInstalledLaunchStore(store))
	authService.SetRuntimeAccountSecurityContextProvider(grpcInstalledAccount{})
	artifactStore := runtimeartifactservice.NewMemoryStore()
	artifactAuthorizer := &grpcInstalledArtifactAuthorizer{}
	artifactService := runtimeartifactservice.New(artifactStore, slog.Default(), runtimeartifactservice.WithInstalledOperationAuthorizer(artifactAuthorizer))
	server := newProtectedInstalledRPCServer(authService, &runtimev1.UnimplementedRuntimeDevelopmentServiceServer{}, artifactService)
	baseListener := bufconn.Listen(1024 * 1024)
	listener := &protectedInstalledTestListener{Listener: baseListener, connection: connection}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	t.Cleanup(func() {
		server.Stop()
		_ = baseListener.Close()
		<-done
	})
	clientConn, err := grpc.DialContext(context.Background(), "passthrough:///installed-test", grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return baseListener.Dial() }), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = clientConn.Close() })
	artifactClient := runtimev1.NewRuntimeArtifactServiceClient(clientConn)
	if _, err := artifactClient.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-installed"}); grpcInstalledReason(err) != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
		t.Fatalf("artifact read before installed session reason=%v err=%v", grpcInstalledReason(err), err)
	}
	developmentClient := runtimev1.NewRuntimeDevelopmentServiceClient(clientConn)
	if _, err := developmentClient.OpenLocalDevelopmentAppSession(context.Background(), &runtimev1.OpenLocalDevelopmentAppSessionRequest{}); grpcInstalledReason(err) != runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED {
		t.Fatalf("production-installed origin reached local-development bootstrap reason=%v err=%v", grpcInstalledReason(err), err)
	}
	client := runtimev1.NewRuntimeAuthServiceClient(clientConn)
	response, err := client.OpenDesktopLaunchedAppSession(context.Background(), &runtimev1.OpenDesktopLaunchedAppSessionRequest{})
	if err != nil {
		t.Fatalf("open process-bound installed session: %v", err)
	}
	if response.GetAppId() != "world.nimi.app" || response.GetAccountGeneration() != 12 || len(response.GetInstalledSessionId()) != protectedlocal.IdentifierBytes {
		t.Fatalf("unexpected installed session: %+v", response)
	}
	var sessionID protectedlocal.Identifier
	copy(sessionID[:], response.GetInstalledSessionId())
	expiresAt := time.Now().UTC().Add(time.Hour)
	artifactAuthorizer.decision = accountservice.InstalledCallerDecision{
		SessionID:          sessionID,
		AppID:              "world.nimi.app",
		ReleaseDigest:      release,
		AccountID:          "account-installed",
		RealmEnvironmentID: "realm-installed",
		AccountGeneration:  12,
		RuntimeBootEpoch:   boot,
		Process:            process,
		ExpiresAt:          expiresAt,
		Operation:          accountservice.InstalledOperationReadArtifactBytes,
		PermissionScope:    "data.scope.read#runtime.artifacts",
		CatalogVersion:     1,
		GrantID:            "grant-installed-artifact",
		GrantVersion:       1,
		TrustClass:         accountservice.InstalledTrustClassProductionInstalled,
	}
	if err := artifactStore.Put("artifact-installed", runtimeartifactservice.ArtifactRecord{
		Bytes: []byte("installed-artifact"), MimeType: "text/plain", CreatedAt: time.Now().UTC(),
		Audience: &runtimeartifactservice.ArtifactAudience{
			ProducerJobID: "job-installed", OwnerAccountID: "account-installed", AppID: "world.nimi.app",
			ReleaseDigest: release, SessionID: sessionID, AccountGeneration: 12,
			AllowedUse: runtimeartifactservice.ArtifactUseReadBytes, ExpiresAt: expiresAt,
			TrustClass: "production-installed",
		},
	}); err != nil {
		t.Fatal(err)
	}
	artifactResponse, err := artifactClient.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-installed"})
	if err != nil || string(artifactResponse.GetBytes()) != "installed-artifact" {
		t.Fatalf("read artifact over installed transport = (%+v, %v)", artifactResponse, err)
	}
	if _, err := developmentClient.OpenLocalDevelopmentAppSession(context.Background(), &runtimev1.OpenLocalDevelopmentAppSessionRequest{}); grpcInstalledReason(err) != runtimev1.ReasonCode_LOCAL_DEVELOPMENT_SUPERVISOR_REQUIRED {
		t.Fatalf("production-installed session converted to local-development bootstrap reason=%v err=%v", grpcInstalledReason(err), err)
	}
	if _, err := artifactClient.CleanupGeneratedVoiceArtifacts(context.Background(), &runtimev1.CleanupGeneratedVoiceArtifactsRequest{AgentId: "agent-1"}); grpcInstalledReason(err) != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("non-allowlisted artifact RPC reason=%v err=%v", grpcInstalledReason(err), err)
	}
	if _, err := client.RegisterApp(context.Background(), &runtimev1.RegisterAppRequest{}); grpcInstalledReason(err) != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("non-allowlisted RPC reason=%v err=%v", grpcInstalledReason(err), err)
	}
}

type grpcInstalledArtifactAuthorizer struct {
	decision accountservice.InstalledCallerDecision
}

func (authorizer *grpcInstalledArtifactAuthorizer) AuthorizeInstalledOperation(_ context.Context, operation accountservice.InstalledOperation) (accountservice.InstalledCallerDecision, error) {
	if operation != accountservice.InstalledOperationReadArtifactBytes {
		return accountservice.InstalledCallerDecision{}, accountservice.ErrInstalledOperationNotAdmitted
	}
	return authorizer.decision, nil
}

type protectedInstalledTestListener struct {
	*bufconn.Listener
	connection *protectedlocal.InstalledLaunchConnection
}

func (listener *protectedInstalledTestListener) Accept() (net.Conn, error) {
	raw, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &protectedInstalledNetConn{Conn: raw, connection: listener.connection}, nil
}

type grpcInstalledVerifier struct {
	peer protectedlocal.VerifiedInstalledLaunchPeer
}

func (verifier grpcInstalledVerifier) VerifyInstalledLaunchPeer(context.Context) (protectedlocal.VerifiedInstalledLaunchPeer, error) {
	return verifier.peer, nil
}

type grpcInstalledAccount struct{}

func (grpcInstalledAccount) AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	return &runtimev1.AccountProjection{AccountId: "account-installed", RealmEnvironmentId: "realm-installed"}, 12, true
}

type grpcInstalledLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func newGRPCInstalledLiveness() *grpcInstalledLiveness {
	return &grpcInstalledLiveness{revoked: make(chan struct{})}
}
func (liveness *grpcInstalledLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *grpcInstalledLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

func grpcInstalledIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func grpcInstalledReason(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}

func newGRPCNativeAppHostConnection(t testing.TB, trustClass protectedlocal.NativeAppHostTrustClass, seed byte) *protectedlocal.InstalledLaunchConnection {
	t.Helper()
	liveness := newGRPCInstalledLiveness()
	process := protectedlocal.ProcessTuple{OS: protectedlocal.OSWindows, PID: uint32(seed) + 2000, CreationMarker: "grpc-native-app-host", OSLoginSession: "grpc-native-logon", SecurityPrincipal: "grpc-native-user", CanonicalExecutableIdentity: "grpc-native-file", ExecutableDigest: grpcInstalledIdentifier(seed + 1), ExecutableTrustSetID: "grpc-native-trust"}
	connection, err := protectedlocal.EstablishInstalledLaunchConnection(context.Background(), grpcInstalledVerifier{peer: protectedlocal.VerifiedInstalledLaunchPeer{
		LaunchID: grpcInstalledIdentifier(seed), Process: process, RuntimeBootEpoch: grpcInstalledIdentifier(seed + 2), ProcessLiveness: liveness, TrustClass: trustClass,
	}})
	if err != nil {
		t.Fatalf("establish gRPC native app-host connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	return connection
}
