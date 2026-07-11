package app

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestLocalDevelopmentStoreReusesRememberedAuthorizationAndRequiresReapprovalOnAuthorityChange(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, time.July, 12, 10, 0, 0, 0, time.UTC)
	store := openLocalDevelopmentStoreForTest(t, now)
	project := localDevelopmentTestProject(t)
	runOne := localDevelopmentTestIdentifier(0x11)

	first, err := store.Evaluate(ctx, project, runOne)
	if err != nil {
		t.Fatalf("Evaluate first project: %v", err)
	}
	if first.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_CONFIRMATION_REQUIRED || first.EvaluationID == (protectedlocal.Identifier{}) {
		t.Fatalf("first evaluation must require confirmation, got %#v", first)
	}
	authorization, err := store.Decide(ctx, first.EvaluationID, runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_REMEMBER_PROJECT)
	if err != nil {
		t.Fatalf("Decide remembered project: %v", err)
	}
	if authorization.State != localDevelopmentAuthorizationActive || authorization.ID == (protectedlocal.Identifier{}) || authorization.Generation != 1 {
		t.Fatalf("remembered authorization not active: %#v", authorization)
	}

	second, err := store.Evaluate(ctx, project, localDevelopmentTestIdentifier(0x12))
	if err != nil {
		t.Fatalf("Evaluate remembered project: %v", err)
	}
	if second.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_ACTIVE || second.Authorization.ID != authorization.ID || second.EvaluationID != (protectedlocal.Identifier{}) {
		t.Fatalf("remembered project should reuse the authorization without confirmation: %#v", second)
	}

	capabilityExpanded := project
	capabilityExpanded.Capabilities = []string{"data.scope.read#runtime.artifacts", "account.session.read"}
	capabilityExpanded.CapabilityFingerprint = localDevelopmentCapabilityFingerprint(capabilityExpanded.Capabilities)
	expanded, err := store.Evaluate(ctx, capabilityExpanded, localDevelopmentTestIdentifier(0x13))
	if err != nil {
		t.Fatalf("Evaluate expanded capability set: %v", err)
	}
	if expanded.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_REAPPROVAL_REQUIRED || expanded.EvaluationID == (protectedlocal.Identifier{}) {
		t.Fatalf("capability expansion must require reapproval: %#v", expanded)
	}

	accountChanged := project
	accountChanged.AccountID = "account-b"
	accountChanged.AccountGeneration = 8
	switched, err := store.Evaluate(ctx, accountChanged, localDevelopmentTestIdentifier(0x14))
	if err != nil {
		t.Fatalf("Evaluate switched account: %v", err)
	}
	if switched.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_REAPPROVAL_REQUIRED {
		t.Fatalf("account switch must require reapproval: %#v", switched)
	}
	if err := store.RevokeAccountAuthority(ctx, project.AccountID); err != nil {
		t.Fatalf("RevokeAccountAuthority: %v", err)
	}
	afterLogout, err := store.Evaluate(ctx, project, localDevelopmentTestIdentifier(0x15))
	if err != nil {
		t.Fatalf("Evaluate after account authority revocation: %v", err)
	}
	if afterLogout.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_REAPPROVAL_REQUIRED || afterLogout.Authorization.ID != (protectedlocal.Identifier{}) {
		t.Fatalf("logout/switch revocation must prevent remembered authorization reuse: %#v", afterLogout)
	}
}

func TestLocalDevelopmentStoreBindsExactControlledHostAndRevokesRun(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, time.July, 12, 10, 0, 0, 0, time.UTC)
	store := openLocalDevelopmentStoreForTest(t, now)
	project := localDevelopmentTestProject(t)
	runID := localDevelopmentTestIdentifier(0x21)
	evaluation, err := store.Evaluate(ctx, project, runID)
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := store.Decide(ctx, evaluation.EvaluationID, runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE)
	if err != nil {
		t.Fatal(err)
	}
	hostPath := filepath.Join(project.ProjectRoot, "node_modules", "electron", "dist", "electron.exe")
	launch, err := store.PrepareLaunch(ctx, localDevelopmentLaunchRequest{
		AuthorizationID: authorization.ID,
		SupervisorRunID: runID,
		Project:         project,
		ShellKind:       project.ShellKind,
		HostExecutable:  hostPath,
		RendererOrigin:  "http://127.0.0.1:4173",
	})
	if err != nil {
		t.Fatalf("PrepareLaunch: %v", err)
	}
	process := protectedlocal.ProcessTuple{
		OS:                          protectedlocal.OSWindows,
		PID:                         4421,
		CreationMarker:              "windows-created-1",
		OSLoginSession:              "windows-logon-1",
		SecurityPrincipal:           "S-1-5-21-test",
		CanonicalExecutableIdentity: "windows-volume-1-file-1",
		CanonicalExecutablePath:     filepath.Clean(hostPath),
		ExecutableDigest:            localDevelopmentTestIdentifier(0x31),
		ExecutableTrustSetID:        protectedlocal.WindowsLocalDevelopmentTrustSetID,
	}
	if _, err := store.BindLaunch(ctx, launch.LaunchID, process); err != nil {
		t.Fatalf("BindLaunch: %v", err)
	}
	session, err := store.ConsumeLaunch(ctx, launch.LaunchID, process)
	if err != nil {
		t.Fatalf("ConsumeLaunch: %v", err)
	}
	if session.AppID != project.AppID || session.AuthorizationID != authorization.ID || session.SessionProof == (protectedlocal.Identifier{}) {
		t.Fatalf("unexpected local-development session: %#v", session)
	}

	if err := store.EndRun(ctx, authorization.ID, runID); err != nil {
		t.Fatalf("EndRun: %v", err)
	}
	if _, err := store.ValidateSession(ctx, localDevelopmentSessionBinding{
		SessionID:         session.SessionID,
		SessionProof:      session.SessionProof,
		Process:           process,
		AccountGeneration: project.AccountGeneration,
		RuntimeBootEpoch:  store.BootEpoch(),
	}); err != errLocalDevelopmentSessionRevoked {
		t.Fatalf("session must revoke immediately when the supervised run ends, got %v", err)
	}
}

func openLocalDevelopmentStoreForTest(t *testing.T, now time.Time) *localDevelopmentStore {
	t.Helper()
	store, err := openLocalDevelopmentStore(filepath.Join(t.TempDir(), "local-development.db"), localDevelopmentTestIdentifier(0x71))
	if err != nil {
		t.Fatalf("open local-development store: %v", err)
	}
	store.now = func() time.Time { return now }
	store.random = &localDevelopmentTestReader{next: 1}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func localDevelopmentTestProject(t *testing.T) localDevelopmentProjectSnapshot {
	t.Helper()
	root := filepath.Join(t.TempDir(), "sample-app")
	capabilities := []string{"data.scope.read#runtime.artifacts"}
	return localDevelopmentProjectSnapshot{
		AppID:                 "sample.nimi.app",
		DisplayName:           "Sample App",
		ProjectRoot:           root,
		ManifestPath:          filepath.Join(root, "nimi.app.yaml"),
		ShellKind:             runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
		AccountID:             "account-a",
		AccountGeneration:     7,
		Capabilities:          capabilities,
		CapabilityFingerprint: localDevelopmentCapabilityFingerprint(capabilities),
	}
}

func localDevelopmentTestIdentifier(fill byte) protectedlocal.Identifier {
	var value protectedlocal.Identifier
	for index := range value {
		value[index] = fill
	}
	return value
}

type localDevelopmentTestReader struct{ next byte }

func (reader *localDevelopmentTestReader) Read(target []byte) (int, error) {
	for index := range target {
		target[index] = reader.next
	}
	reader.next++
	return len(target), nil
}
