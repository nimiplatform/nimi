package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestLocalDevelopmentStoreConsumesAllowDecisionWhenAccountChangesAfterEvaluation(t *testing.T) {
	ctx := context.Background()
	store := openLocalDevelopmentStoreForTest(t, time.Date(2026, time.July, 12, 10, 0, 0, 0, time.UTC))
	project := localDevelopmentTestProject(t)
	evaluation, err := store.Evaluate(ctx, project, localDevelopmentTestIdentifier(0x09))
	if err != nil {
		t.Fatalf("Evaluate project: %v", err)
	}
	if _, err := store.Decide(
		ctx,
		evaluation.EvaluationID,
		runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_PROJECT,
		"account-b",
		project.AccountGeneration+1,
	); !errors.Is(err, errLocalDevelopmentReapproval) {
		t.Fatalf("allow decision after account switch must require reapproval, got %v", err)
	}
	if _, err := store.Decide(
		ctx,
		evaluation.EvaluationID,
		runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_PROJECT,
		project.AccountID,
		project.AccountGeneration,
	); !errors.Is(err, errLocalDevelopmentEvaluationExpired) {
		t.Fatalf("account-mismatched evaluation must be consumed permanently, got %v", err)
	}
}

func TestLocalDevelopmentStoreReusesAllowedProjectAndRequiresReapprovalOnAuthorityChange(t *testing.T) {
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
	authorization, err := store.Decide(ctx, first.EvaluationID, runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_PROJECT, project.AccountID, project.AccountGeneration)
	if err != nil {
		t.Fatalf("Decide allowed project: %v", err)
	}
	if authorization.State != localDevelopmentAuthorizationActive || authorization.ID == (protectedlocal.Identifier{}) || authorization.Generation != 1 {
		t.Fatalf("allowed-project authorization not active: %#v", authorization)
	}

	second, err := store.Evaluate(ctx, project, localDevelopmentTestIdentifier(0x12))
	if err != nil {
		t.Fatalf("Evaluate allowed project: %v", err)
	}
	if second.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_ACTIVE || second.Authorization.ID != authorization.ID || second.EvaluationID != (protectedlocal.Identifier{}) {
		t.Fatalf("allowed project should reuse the authorization without confirmation: %#v", second)
	}

	permissionExpanded := project
	permissionExpanded.PermissionRequirements = []localDevelopmentPermissionRequirement{{PermissionID: "agents.interact", Reason: "Talk with an Agent selected by me."}}
	permissionExpanded.PermissionRequirementFingerprint = localDevelopmentPermissionRequirementFingerprint(permissionExpanded.PermissionRequirements)
	expanded, err := store.Evaluate(ctx, permissionExpanded, localDevelopmentTestIdentifier(0x13))
	if err != nil {
		t.Fatalf("Evaluate admitted permission requirement: %v", err)
	}
	if expanded.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_REAPPROVAL_REQUIRED || expanded.EvaluationID == (protectedlocal.Identifier{}) {
		t.Fatalf("admitted permission expansion must require reapproval: %#v", expanded)
	}

	for _, test := range []struct {
		name         string
		permissionID string
		wantReason   localDevelopmentManifestPermissionReason
	}{
		{name: "reserved", permissionID: "agents.configure", wantReason: localDevelopmentManifestPermissionReserved},
		{name: "unknown", permissionID: "runtime.agent.turn.write", wantReason: localDevelopmentManifestPermissionUnknown},
	} {
		t.Run(test.name, func(t *testing.T) {
			invalidPermission := project
			invalidPermission.PermissionRequirements = []localDevelopmentPermissionRequirement{{PermissionID: test.permissionID, Reason: "Explain this permission request."}}
			invalidPermission.PermissionRequirementFingerprint = localDevelopmentPermissionRequirementFingerprint(invalidPermission.PermissionRequirements)
			_, err := store.Evaluate(ctx, invalidPermission, localDevelopmentTestIdentifier(0x13))
			failure, ok := localDevelopmentManifestPermissionFailureFromError(err)
			if !ok || failure.Reason() != test.wantReason || failure.PermissionID() != test.permissionID {
				t.Fatalf("permission requirement failure = (%#v, %v), want reason=%s permission=%s", failure, err, test.wantReason, test.permissionID)
			}
		})
	}
	projectChanged := project
	projectChanged.ManifestPath = filepath.Join(project.ProjectRoot, "nimi.changed.yaml")
	changed, err := store.Evaluate(ctx, projectChanged, localDevelopmentTestIdentifier(0x13))
	if err != nil {
		t.Fatalf("Evaluate changed project identity: %v", err)
	}
	if changed.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_REAPPROVAL_REQUIRED || changed.EvaluationID == (protectedlocal.Identifier{}) {
		t.Fatalf("project identity change must require reapproval: %#v", changed)
	}

	accountChanged := project
	accountChanged.AccountID = "account-b"
	accountChanged.AccountGeneration = 8
	switched, err := store.Evaluate(ctx, accountChanged, localDevelopmentTestIdentifier(0x14))
	if err != nil {
		t.Fatalf("Evaluate switched account: %v", err)
	}
	if switched.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_CONFIRMATION_REQUIRED {
		t.Fatalf("a different account must require its own first approval: %#v", switched)
	}
	if err := store.RevokeAccountAuthority(ctx, project.AccountID); err != nil {
		t.Fatalf("RevokeAccountAuthority: %v", err)
	}
	if _, err := store.Decide(
		ctx,
		changed.EvaluationID,
		runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_DENY,
		"",
		0,
	); !errors.Is(err, errLocalDevelopmentEvaluationExpired) {
		t.Fatalf("logout/switch must consume pending approval evaluations, got %v", err)
	}
	afterLogout, err := store.Evaluate(ctx, project, localDevelopmentTestIdentifier(0x15))
	if err != nil {
		t.Fatalf("Evaluate after account authority revocation: %v", err)
	}
	if afterLogout.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_ACTIVE || afterLogout.Authorization.ID != authorization.ID {
		t.Fatalf("logout/switch must preserve exact account-bound project consent: %#v", afterLogout)
	}
}

func TestLocalDevelopmentStoreBindsExactControlledHostAndRevokesRun(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("positive project-Electron host fixture belongs to the Windows carrier")
	}
	ctx := context.Background()
	now := time.Date(2026, time.July, 12, 10, 0, 0, 0, time.UTC)
	store := openLocalDevelopmentStoreForTest(t, now)
	project := localDevelopmentTestProject(t)
	runID := localDevelopmentTestIdentifier(0x21)
	evaluation, err := store.Evaluate(ctx, project, runID)
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := store.Decide(ctx, evaluation.EvaluationID, runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_PROJECT, project.AccountID, project.AccountGeneration)
	if err != nil {
		t.Fatal(err)
	}
	hostPath := filepath.Join(project.ProjectRoot, "node_modules", "electron", "dist", "electron.exe")
	if err := os.MkdirAll(filepath.Dir(hostPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(hostPath, []byte("test-electron-host"), 0o700); err != nil {
		t.Fatal(err)
	}
	observedHostPath := filepath.Join(t.TempDir(), "observed-electron.exe")
	if err := os.Link(hostPath, observedHostPath); err != nil {
		t.Fatalf("create alternate observed host path: %v", err)
	}
	launch, err := store.PrepareLaunch(ctx, localDevelopmentLaunchRequest{
		AuthorizationID:    authorization.ID,
		SupervisorRunID:    runID,
		Project:            project,
		ShellKind:          project.ShellKind,
		HostExecutable:     hostPath,
		RendererOrigin:     "http://127.0.0.1:4173",
		PrincipalID:        "lap_v1_test-principal",
		RecordID:           "lar_v1_test-record",
		ProvenanceRevision: 1,
		ProjectGeneration:  1,
		PayloadDigest:      "lad_v1_payload_test",
		ExpectedHostDigest: localDevelopmentTestIdentifier(0x31),
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
		CanonicalExecutablePath:     filepath.Clean(observedHostPath),
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
	binding := localDevelopmentSessionBinding{
		SessionID: session.SessionID, SessionProof: session.SessionProof, Process: process,
		AccountGeneration: project.AccountGeneration, RuntimeBootEpoch: store.BootEpoch(),
	}
	if _, err := store.ValidateSession(ctx, binding); err != nil {
		t.Fatalf("exact session binding was rejected: %v", err)
	}
	accountChanged := binding
	accountChanged.AccountGeneration++
	if _, err := store.ValidateSession(ctx, accountChanged); !errors.Is(err, errLocalDevelopmentAccountChanged) {
		t.Fatalf("account generation drift reason = %v", err)
	}
	processChanged := binding
	processChanged.Process.PID++
	if _, err := store.ValidateSession(ctx, processChanged); !errors.Is(err, errLocalDevelopmentProcessMismatch) {
		t.Fatalf("process replacement reason = %v", err)
	}
	proofChanged := binding
	proofChanged.SessionProof[0] ^= 0xff
	if _, err := store.ValidateSession(ctx, proofChanged); !errors.Is(err, errLocalDevelopmentSessionRevoked) {
		t.Fatalf("session proof drift reason = %v", err)
	}
	bootChanged := binding
	bootChanged.RuntimeBootEpoch[0] ^= 0xff
	if _, err := store.ValidateSession(ctx, bootChanged); !errors.Is(err, errLocalDevelopmentSessionRevoked) {
		t.Fatalf("Runtime boot epoch drift reason = %v", err)
	}

	if err := store.EndRun(ctx, authorization.ID, runID); err != nil {
		t.Fatalf("EndRun: %v", err)
	}
	if _, err := store.ValidateSession(ctx, binding); err != errLocalDevelopmentSessionRevoked {
		t.Fatalf("session must revoke immediately when the supervised run ends, got %v", err)
	}
	next, err := store.Evaluate(ctx, project, localDevelopmentTestIdentifier(0x22))
	if err != nil {
		t.Fatalf("Evaluate after EndRun: %v", err)
	}
	if next.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_ACTIVE || next.Authorization.ID != authorization.ID || next.EvaluationID != (protectedlocal.Identifier{}) {
		t.Fatalf("EndRun must preserve allow-project consent while revoking technical state: %#v", next)
	}
}

func TestLocalDevelopmentStorePreservesAllowedProjectAcrossBootEpochReplacement(t *testing.T) {
	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "local-development.db")
	first, err := openLocalDevelopmentStore(databasePath, localDevelopmentTestIdentifier(0x61))
	if err != nil {
		t.Fatal(err)
	}
	project := localDevelopmentTestProject(t)
	evaluation, err := first.Evaluate(ctx, project, localDevelopmentTestIdentifier(0x62))
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := first.Decide(ctx, evaluation.EvaluationID, runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_PROJECT, project.AccountID, project.AccountGeneration)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := openLocalDevelopmentStore(databasePath, localDevelopmentTestIdentifier(0x63))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = second.Close() })
	reused, err := second.Evaluate(ctx, project, localDevelopmentTestIdentifier(0x64))
	if err != nil {
		t.Fatal(err)
	}
	if reused.State != runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_ACTIVE || reused.Authorization.ID != authorization.ID || reused.EvaluationID != (protectedlocal.Identifier{}) {
		t.Fatalf("boot epoch replacement must preserve exact allow-project consent: %#v", reused)
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
	permissionRequirements := []localDevelopmentPermissionRequirement{}
	return localDevelopmentProjectSnapshot{
		AppID:                            "sample.nimi.app",
		DisplayName:                      "Sample App",
		ProjectRoot:                      root,
		ManifestPath:                     filepath.Join(root, "nimi.app.yaml"),
		ShellKind:                        runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
		AccountID:                        "account-a",
		AccountGeneration:                7,
		PermissionRequirements:           permissionRequirements,
		PermissionRequirementFingerprint: localDevelopmentPermissionRequirementFingerprint(permissionRequirements),
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
