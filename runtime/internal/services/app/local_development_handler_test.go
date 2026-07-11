package app

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	runtimeartifactservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func TestLocalDevelopmentHandlerCompletesBootstrapAndRevokesTechnicalSessionWithDesktopSupervisor(t *testing.T) {
	ctx := context.Background()
	boot := localDevelopmentTestIdentifier(0x91)
	store, err := openLocalDevelopmentStore(filepath.Join(t.TempDir(), "local-development.db"), boot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	artifacts := runtimeartifactservice.NewMemoryStore()
	registry, err := protectedlocal.NewInstalledLaunchRegistry(boot)
	if err != nil {
		t.Fatal(err)
	}
	projectRoot := filepath.Join(t.TempDir(), "sample-app")
	if err := os.MkdirAll(projectRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	manifest := `app_id: sample.nimi.app
display_name: Sample App
permissions:
  declared_nimi_api_scopes:
    - scope: data.scope.read
      qualifier: runtime.artifacts
      purpose: Read Runtime artifacts during local development.
`
	if err := os.WriteFile(filepath.Join(projectRoot, "nimi.app.yaml"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	hostPath := filepath.Join(projectRoot, "node_modules", "electron", "dist", "electron.exe")
	if err := os.MkdirAll(filepath.Dir(hostPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(hostPath, []byte("test-electron-host"), 0o700); err != nil {
		t.Fatal(err)
	}
	process := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: 9101, CreationMarker: "development-handler-created",
		OSLoginSession: "development-handler-logon", SecurityPrincipal: "development-handler-user",
		CanonicalExecutableIdentity: "development-handler-file", CanonicalExecutablePath: filepath.Clean(hostPath),
		ExecutableDigest: localDevelopmentTestIdentifier(0x92), ExecutableTrustSetID: protectedlocal.WindowsLocalDevelopmentTrustSetID,
	}
	processVerifier := &localDevelopmentHandlerProcessVerifier{process: process, liveness: newLocalDevelopmentHandlerLiveness()}
	account := localDevelopmentHandlerAccount{generation: 12}
	service := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithRuntimeAccountProjectionProvider(account),
		WithLocalDevelopmentAuthority(store, registry, processVerifier, artifacts),
	)
	desktopConnection := newLocalDevelopmentHandlerDesktopConnection(t, boot)
	t.Cleanup(desktopConnection.Revoke)
	desktopContext := protectedlocal.ContextWithDesktopConnection(ctx, desktopConnection)
	runID := localDevelopmentTestIdentifier(0x93)

	evaluation, err := service.EvaluateLocalDevelopmentProject(desktopContext, &runtimev1.EvaluateLocalDevelopmentProjectRequest{
		ExpectedAppId: "sample.nimi.app", ProjectRoot: projectRoot,
		ShellKind:       runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
		SupervisorRunId: runID[:],
	})
	if err != nil {
		t.Fatalf("EvaluateLocalDevelopmentProject: %v", err)
	}
	if !evaluation.GetConfirmationRequired() || evaluation.GetProject().GetCanonicalProjectRoot() != filepath.Clean(projectRoot) || len(evaluation.GetEvaluationId()) != protectedlocal.IdentifierBytes {
		t.Fatalf("unexpected development evaluation: %+v", evaluation)
	}
	decision, err := service.DecideLocalDevelopmentProject(desktopContext, &runtimev1.DecideLocalDevelopmentProjectRequest{
		EvaluationId: evaluation.GetEvaluationId(), Decision: runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_REMEMBER_PROJECT,
	})
	if err != nil {
		t.Fatalf("DecideLocalDevelopmentProject: %v", err)
	}
	authorizationID := decision.GetAuthorization().GetAuthorizationId()
	prepared, err := service.PrepareLocalDevelopmentLaunch(desktopContext, &runtimev1.PrepareLocalDevelopmentLaunchRequest{
		AuthorizationId: authorizationID, SupervisorRunId: runID[:],
		ShellKind:          runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
		HostExecutablePath: hostPath, RendererOrigin: "http://127.0.0.1:4173",
	})
	if err != nil {
		t.Fatalf("PrepareLocalDevelopmentLaunch: %v", err)
	}
	if _, err := service.BindLocalDevelopmentHostProcess(desktopContext, &runtimev1.BindLocalDevelopmentHostProcessRequest{LaunchId: prepared.GetLaunchId(), ChildProcessId: process.PID}); err != nil {
		t.Fatalf("BindLocalDevelopmentHostProcess: %v", err)
	}
	pipeLiveness := newLocalDevelopmentHandlerLiveness()
	promoted, err := registry.Promote(process, pipeLiveness)
	if err != nil {
		t.Fatalf("promote exact development host: %v", err)
	}
	hostConnection, err := protectedlocal.EstablishInstalledLaunchConnection(ctx, localDevelopmentHandlerInstalledPeer{peer: promoted})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(hostConnection.Revoke)
	hostContext := protectedlocal.ContextWithInstalledLaunchConnection(ctx, hostConnection)
	opened, err := service.OpenLocalDevelopmentAppSession(hostContext, &runtimev1.OpenLocalDevelopmentAppSessionRequest{})
	if err != nil {
		t.Fatalf("OpenLocalDevelopmentAppSession: %v", err)
	}
	if opened.GetState() != runtimev1.LocalDevelopmentBootstrapState_LOCAL_DEVELOPMENT_BOOTSTRAP_STATE_READY || opened.GetAppId() != "sample.nimi.app" || opened.GetBootstrapArtifactId() == "" {
		t.Fatalf("unexpected development bootstrap: %+v", opened)
	}
	record, exists := artifacts.Get(opened.GetBootstrapArtifactId())
	if !exists || string(record.Bytes) == "" || record.Audience == nil || record.Audience.TrustClass != localDevelopmentTrustClass {
		t.Fatalf("Runtime bootstrap artifact was not written with a development audience: %#v", record)
	}
	if _, err := service.GetLocalDevelopmentSessionStatus(hostContext, &runtimev1.GetLocalDevelopmentSessionStatusRequest{}); err != nil {
		t.Fatalf("GetLocalDevelopmentSessionStatus: %v", err)
	}
	rotated, err := service.OpenLocalDevelopmentAppSession(hostContext, &runtimev1.OpenLocalDevelopmentAppSessionRequest{})
	if err != nil {
		t.Fatalf("rotate local-development technical session: %v", err)
	}
	if rotated.GetBootstrapArtifactId() == opened.GetBootstrapArtifactId() || rotated.GetState() != runtimev1.LocalDevelopmentBootstrapState_LOCAL_DEVELOPMENT_BOOTSTRAP_STATE_READY {
		t.Fatalf("session rotation must mint a new audience-bound bootstrap without reapproval: before=%+v after=%+v", opened, rotated)
	}
	desktopConnection.Revoke()
	if _, err := service.GetLocalDevelopmentSessionStatus(hostContext, &runtimev1.GetLocalDevelopmentSessionStatusRequest{}); err == nil {
		t.Fatal("verified Desktop supervisor exit must revoke the local-development technical session")
	}

	nextDesktopConnection := newLocalDevelopmentHandlerDesktopConnection(t, boot)
	t.Cleanup(nextDesktopConnection.Revoke)
	nextDesktopContext := protectedlocal.ContextWithDesktopConnection(ctx, nextDesktopConnection)
	nextRunID := localDevelopmentTestIdentifier(0x94)
	nextEvaluation, err := service.EvaluateLocalDevelopmentProject(nextDesktopContext, &runtimev1.EvaluateLocalDevelopmentProjectRequest{
		ExpectedAppId: "sample.nimi.app", ProjectRoot: projectRoot,
		ShellKind:       runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
		SupervisorRunId: nextRunID[:],
	})
	if err != nil {
		t.Fatalf("EvaluateLocalDevelopmentProject after supervisor restart: %v", err)
	}
	if nextEvaluation.GetConfirmationRequired() || nextEvaluation.GetAuthorization().GetState() != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_ACTIVE {
		t.Fatalf("remember-project authorization must survive supervisor exit while technical state is replaced: %+v", nextEvaluation)
	}
	hostConnection.Revoke()
	if _, err := service.GetLocalDevelopmentSessionStatus(hostContext, &runtimev1.GetLocalDevelopmentSessionStatusRequest{}); err == nil {
		t.Fatal("revoked host connection must invalidate local-development status")
	}
}

type localDevelopmentHandlerAccount struct{ generation uint64 }

func (account localDevelopmentHandlerAccount) AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool) {
	return &runtimev1.AccountProjection{AccountId: "account-development", RealmEnvironmentId: "realm-development"}, true
}

func (account localDevelopmentHandlerAccount) AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	projection, ok := account.AuthenticatedRuntimeProjection(context.Background())
	return projection, account.generation, ok
}

type localDevelopmentHandlerProcessVerifier struct {
	process  protectedlocal.ProcessTuple
	liveness *localDevelopmentHandlerLiveness
}

func (verifier *localDevelopmentHandlerProcessVerifier) VerifyLocalDevelopmentProcess(_ context.Context, pid uint32, policy protectedlocal.LocalDevelopmentProcessPolicy) (protectedlocal.ProcessTuple, protectedlocal.DesktopProcessLiveness, error) {
	if pid != verifier.process.PID || policy.HostExecutablePath != verifier.process.CanonicalExecutablePath {
		return protectedlocal.ProcessTuple{}, nil, errLocalDevelopmentLaunchMismatch
	}
	return verifier.process, verifier.liveness, nil
}

type localDevelopmentHandlerInstalledPeer struct {
	peer protectedlocal.VerifiedInstalledLaunchPeer
}

func (verifier localDevelopmentHandlerInstalledPeer) VerifyInstalledLaunchPeer(context.Context) (protectedlocal.VerifiedInstalledLaunchPeer, error) {
	return verifier.peer, nil
}

type localDevelopmentHandlerDesktopPeer struct {
	peers protectedlocal.VerifiedDesktopPeers
}

func (verifier localDevelopmentHandlerDesktopPeer) VerifyDesktopPeers(context.Context) (protectedlocal.VerifiedDesktopPeers, error) {
	return verifier.peers, nil
}

func newLocalDevelopmentHandlerDesktopConnection(t *testing.T, boot protectedlocal.Identifier) *protectedlocal.Connection {
	t.Helper()
	liveness := newLocalDevelopmentHandlerLiveness()
	clientDigest := localDevelopmentTestIdentifier(0xa1)
	serverDigest := localDevelopmentTestIdentifier(0xa2)
	connection, err := protectedlocal.EstablishDesktopConnection(context.Background(), localDevelopmentHandlerDesktopPeer{peers: protectedlocal.VerifiedDesktopPeers{
		Client:         protectedlocal.ProcessTuple{OS: protectedlocal.OSWindows, PID: 9201, CreationMarker: "desktop-created", OSLoginSession: "desktop-logon", SecurityPrincipal: "desktop-user", CanonicalExecutableIdentity: "desktop-file", ExecutableDigest: clientDigest, ExecutableTrustSetID: "desktop-test-trust"},
		Server:         protectedlocal.ProcessTuple{OS: protectedlocal.OSWindows, PID: 9202, CreationMarker: "runtime-created", OSLoginSession: "service-logon", SecurityPrincipal: "runtime-service", CanonicalExecutableIdentity: "runtime-file", ExecutableDigest: serverDigest, ExecutableTrustSetID: "runtime-test-trust"},
		ClientLiveness: liveness, RuntimeBootEpoch: boot,
		EndpointInstanceID: localDevelopmentTestIdentifier(0xa3), TranscriptNonce: localDevelopmentTestIdentifier(0xa4),
	}}, &localDevelopmentTestReader{next: 0xb1})
	if err != nil {
		t.Fatal(err)
	}
	return connection
}

type localDevelopmentHandlerLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func newLocalDevelopmentHandlerLiveness() *localDevelopmentHandlerLiveness {
	return &localDevelopmentHandlerLiveness{revoked: make(chan struct{})}
}

func (liveness *localDevelopmentHandlerLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *localDevelopmentHandlerLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}
