package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestLocalDevelopmentAuthoritySummaryIsProtectedBoundedAndSideEffectFree(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, time.July, 17, 3, 0, 0, 0, time.UTC)
	store := openLocalDevelopmentStoreForTest(t, now)
	project := localDevelopmentTestProject(t)
	if _, err := store.SetDeveloperMode(ctx, true, project.AccountID, project.AccountGeneration); err != nil {
		t.Fatal(err)
	}
	evaluation, err := store.Evaluate(ctx, project, localDevelopmentTestIdentifier(0x51))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Decide(ctx, evaluation.EvaluationID, runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_PROJECT, project.AccountID, project.AccountGeneration); err != nil {
		t.Fatal(err)
	}
	account := &localDevelopmentHandlerAccount{accountID: project.AccountID, generation: project.AccountGeneration}
	service := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithRuntimeAccountProjectionProvider(account),
		WithLocalDevelopmentAuthority(store, nil, nil, nil),
	)
	if _, err := service.GetLocalDevelopmentAuthoritySummary(ctx, &runtimev1.GetLocalDevelopmentAuthoritySummaryRequest{}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("unprotected summary read error = %v", err)
	}
	boot := localDevelopmentTestIdentifier(0x52)
	desktopConnection := newLocalDevelopmentHandlerDesktopConnection(t, boot)
	t.Cleanup(desktopConnection.Revoke)
	response, err := service.GetLocalDevelopmentAuthoritySummary(
		protectedlocal.ContextWithDesktopConnection(ctx, desktopConnection),
		&runtimev1.GetLocalDevelopmentAuthoritySummaryRequest{},
	)
	if err != nil {
		t.Fatal(err)
	}
	available := runtimev1.LocalDevelopmentSummaryAvailability_LOCAL_DEVELOPMENT_SUMMARY_AVAILABILITY_AVAILABLE
	if response.GetDeveloperMode().GetAvailability() != available || response.GetDeveloperMode().GetState() != runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_ENABLED {
		t.Fatalf("developer mode summary = %#v", response.GetDeveloperMode())
	}
	if response.GetProjectAuthorization().GetAvailability() != available || response.GetProjectAuthorization().GetActiveCount() != 1 {
		t.Fatalf("project authorization summary = %#v", response.GetProjectAuthorization())
	}
	encoded, err := protojson.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{
		"accountId", "projectRoot", "principalId", "authorizationId", "grantId",
		"requestId", "operationId", "resourceRef", "token", "sessionId", "bootEpoch",
	} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("bounded summary leaked %s: %s", forbidden, encoded)
		}
	}
}

func TestLocalDevelopmentHandlerSurfacesManifestPermissionFailuresTruthfully(t *testing.T) {
	for index, test := range []struct {
		name          string
		permissionID  string
		wantReason    localDevelopmentManifestPermissionReason
		wantAdmission string
		wantMessage   string
	}{
		{
			name:          "reserved",
			permissionID:  "agents.configure",
			wantReason:    localDevelopmentManifestPermissionReserved,
			wantAdmission: "reserved",
			wantMessage:   "reserved pending admission",
		},
		{
			name:          "unknown",
			permissionID:  "runtime.agent.turn.write",
			wantReason:    localDevelopmentManifestPermissionUnknown,
			wantAdmission: "unknown",
			wantMessage:   "unknown to the public catalog",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			boot := localDevelopmentTestIdentifier(byte(0xa1 + index))
			store, err := openLocalDevelopmentStore(filepath.Join(t.TempDir(), "local-development.db"), boot)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = store.Close() })

			projectRoot := filepath.Join(t.TempDir(), "permission-failure-app")
			if err := os.MkdirAll(projectRoot, 0o700); err != nil {
				t.Fatal(err)
			}
			manifest := "app_id: permission.failure.app\ndisplay_name: Permission Failure App\npermissions:\n  - id: " + test.permissionID + "\n    reason: Explain this permission request\n"
			if err := os.WriteFile(filepath.Join(projectRoot, "nimi.app.yaml"), []byte(manifest), 0o600); err != nil {
				t.Fatal(err)
			}

			account := &localDevelopmentHandlerAccount{accountID: "account-development", generation: 12}
			service := New(
				slog.New(slog.NewTextHandler(io.Discard, nil)),
				WithRuntimeAccountProjectionProvider(account),
				WithLocalDevelopmentAuthority(store, nil, &localDevelopmentHandlerProcessVerifier{}, nil),
			)
			if _, err := store.SetDeveloperMode(ctx, true, account.accountID, account.generation); err != nil {
				t.Fatalf("enable Developer Mode: %v", err)
			}
			desktopConnection := newLocalDevelopmentHandlerDesktopConnection(t, boot)
			t.Cleanup(desktopConnection.Revoke)
			desktopContext := protectedlocal.ContextWithDesktopConnection(ctx, desktopConnection)
			runID := localDevelopmentTestIdentifier(byte(0xb1 + index))

			_, err = service.EvaluateLocalDevelopmentProject(desktopContext, &runtimev1.EvaluateLocalDevelopmentProjectRequest{
				ExpectedAppId:   "permission.failure.app",
				ProjectRoot:     projectRoot,
				ShellKind:       runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
				SupervisorRunId: runID[:],
			})
			var typedFailure *localDevelopmentManifestPermissionError
			if !errors.As(err, &typedFailure) || typedFailure.Reason() != test.wantReason || typedFailure.PermissionID() != test.permissionID {
				t.Fatalf("handler cause = (%#v, %v), want reason=%s permission=%s", typedFailure, err, test.wantReason, test.permissionID)
			}
			reason, reasonOK := grpcerr.ExtractReasonCode(err)
			if status.Code(err) != codes.FailedPrecondition || !reasonOK || reason != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED {
				t.Fatalf("handler status = code=%s reason=%s present=%v error=%v", status.Code(err), reason, reasonOK, err)
			}
			metadata, metadataOK := grpcerr.ExtractReasonMetadata(err)
			if !metadataOK || metadata["local_development_reason_code"] != string(test.wantReason) ||
				metadata["permission_id"] != test.permissionID || metadata["permission_admission"] != test.wantAdmission ||
				metadata["diagnostic_stage"] != "manifest-permission" {
				t.Fatalf("handler metadata = %#v present=%v", metadata, metadataOK)
			}
			message, messageOK := grpcerr.ExtractPublicMessage(err)
			if !messageOK || !strings.Contains(message, test.permissionID) || !strings.Contains(message, test.wantMessage) {
				t.Fatalf("handler public message = %q present=%v", message, messageOK)
			}
		})
	}
}

func TestLocalDevelopmentHandlerRejectsAllowAfterAccountSwitchAndConsumesEvaluation(t *testing.T) {
	ctx := context.Background()
	boot := localDevelopmentTestIdentifier(0x81)
	store, err := openLocalDevelopmentStore(filepath.Join(t.TempDir(), "local-development.db"), boot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	registry, err := protectedlocal.NewLocalAppLaunchRegistry(boot)
	if err != nil {
		t.Fatal(err)
	}
	projectRoot := filepath.Join(t.TempDir(), "account-switch-app")
	if err := os.MkdirAll(projectRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projectRoot, "nimi.app.yaml"), []byte(`app_id: account.switch.app
display_name: Account Switch App
permissions: []
`), 0o600); err != nil {
		t.Fatal(err)
	}
	account := &localDevelopmentHandlerAccount{accountID: "account-development", generation: 12}
	service := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithRuntimeAccountProjectionProvider(account),
		WithLocalDevelopmentAuthority(store, registry, &localDevelopmentHandlerProcessVerifier{}, nil),
	)
	if _, err := store.SetDeveloperMode(ctx, true, account.accountID, account.generation); err != nil {
		t.Fatalf("enable Developer Mode: %v", err)
	}
	desktopConnection := newLocalDevelopmentHandlerDesktopConnection(t, boot)
	t.Cleanup(desktopConnection.Revoke)
	desktopContext := protectedlocal.ContextWithDesktopConnection(ctx, desktopConnection)
	runID := localDevelopmentTestIdentifier(0x82)
	evaluation, err := service.EvaluateLocalDevelopmentProject(desktopContext, &runtimev1.EvaluateLocalDevelopmentProjectRequest{
		ExpectedAppId: "account.switch.app", ProjectRoot: projectRoot,
		ShellKind:       runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
		SupervisorRunId: runID[:],
	})
	if err != nil {
		t.Fatalf("EvaluateLocalDevelopmentProject: %v", err)
	}
	account.accountID = "account-after-switch"
	account.generation++
	if err := service.RevokeAccountAuthority(ctx, "account-development"); err != nil {
		t.Fatalf("revoke switched account authority: %v", err)
	}
	_, err = service.DecideLocalDevelopmentProject(desktopContext, &runtimev1.DecideLocalDevelopmentProjectRequest{
		EvaluationId:               evaluation.GetEvaluationId(),
		Decision:                   runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_PROJECT,
		RiskDisclosureAcknowledged: true,
	})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.FailedPrecondition || !ok || reason != runtimev1.ReasonCode_LOCAL_APP_DEVELOPER_MODE_DISABLED {
		t.Fatalf("account switch must disable the previous account's Developer Mode, got %v", err)
	}
	account.accountID = "account-development"
	account.generation = 12
	if _, err := store.SetDeveloperMode(ctx, true, account.accountID, account.generation); err != nil {
		t.Fatalf("re-enable Developer Mode after switching back: %v", err)
	}
	_, err = service.DecideLocalDevelopmentProject(desktopContext, &runtimev1.DecideLocalDevelopmentProjectRequest{
		EvaluationId:               evaluation.GetEvaluationId(),
		Decision:                   runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_PROJECT,
		RiskDisclosureAcknowledged: true,
	})
	staleReason, staleReasonOK := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.PermissionDenied || !staleReasonOK || staleReason != runtimev1.ReasonCode_LOCAL_APP_RECORD_NOT_FOUND {
		t.Fatalf("stale evaluation must remain consumed after switching back, got %v", err)
	}
}

func TestLocalDevelopmentStartupReconciliationRebuildsExactConsentAndTombstonesOrphans(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("positive project-Electron projection repair belongs to the Windows carrier")
	}
	ctx := context.Background()
	store := openLocalDevelopmentStoreForTest(t, time.Date(2026, time.July, 13, 8, 0, 0, 0, time.UTC))
	project := localDevelopmentTestProject(t)
	materializeLocalDevelopmentHandlerProject(t, project)
	evaluation, err := store.Evaluate(ctx, project, localDevelopmentTestIdentifier(0x41))
	if err != nil {
		t.Fatalf("evaluate project: %v", err)
	}
	authorization, err := store.Decide(ctx, evaluation.EvaluationID, runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_PROJECT, project.AccountID, project.AccountGeneration)
	if err != nil {
		t.Fatalf("decide project: %v", err)
	}
	verifiedSID, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, filepath.Join(t.TempDir(), "local-app-kernel.db"), verifiedSID, localappkernel.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	orphan, err := kernel.Principals().Create(ctx, localappkernel.CreatePrincipalInput{
		Kind:                       localappkernel.PrincipalKindDevelopment,
		AppID:                      "orphan.nimi.app",
		DevelopmentAuthorizationID: "lda_v1_orphan-authority",
		CanonicalProjectFileID:     "project-file-orphan",
	})
	if err != nil {
		t.Fatalf("create orphan principal: %v", err)
	}
	service := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithLocalDevelopmentAuthority(store, nil, nil, nil),
		WithLocalAppKernel(kernel),
	)
	if err := service.ReconcileLocalDevelopmentKernel(ctx); err != nil {
		t.Fatalf("reconcile local-development stores: %v", err)
	}
	current, err := store.GetAuthorization(ctx, authorization.ID)
	if err != nil {
		t.Fatalf("read reconciled authorization: %v", err)
	}
	if current.State != localDevelopmentAuthorizationActive {
		t.Fatalf("exact durable consent state = %s, want active", current.State)
	}
	authorizationRef := localDevelopmentAuthorizationRef(authorization.ID)
	firstProjection, err := kernel.Principals().GetByDevelopmentAuthorizationID(ctx, authorizationRef)
	if err != nil || firstProjection.State != localappkernel.PrincipalStateActive {
		t.Fatalf("rebuilt exact-consent principal = (%+v, %v)", firstProjection, err)
	}
	firstRecord, err := kernel.Records().GetByPrincipalID(ctx, firstProjection.LocalAppPrincipalID)
	if err != nil {
		t.Fatalf("rebuilt exact-consent record: %v", err)
	}
	observation, err := service.observeLocalDevelopmentExecution(project)
	if err != nil {
		t.Fatalf("observe exact-consent project: %v", err)
	}
	if _, err := kernel.Records().UpdateDevelopment(ctx, localappkernel.UpdateDevelopmentRecordInput{
		LocalAppPrincipalID:       firstProjection.LocalAppPrincipalID,
		LocalAppRecordID:          firstRecord.LocalAppRecordID,
		ExpectedProjectGeneration: firstRecord.InstallOrProjectGeneration,
		HostExecutableDigest:      firstRecord.HostExecutableDigest,
		PayloadRootDigest:         firstRecord.PayloadRootDigest + "-concurrent",
		LifecycleState:            localappkernel.LifecycleStateActive,
	}); err != nil {
		t.Fatalf("advance concurrent project generation: %v", err)
	}
	if _, err := service.updateLocalDevelopmentRecord(ctx, firstProjection, firstRecord, observation); !errors.Is(err, localappkernel.ErrRevisionConflict) {
		t.Fatalf("stale project generation must fail after one conflict reread, got %v", err)
	}
	if _, err := kernel.Principals().Tombstone(ctx, firstProjection.LocalAppPrincipalID); err != nil {
		t.Fatalf("tombstone candidate projection: %v", err)
	}
	if err := service.ReconcileLocalDevelopmentKernel(ctx); err != nil {
		t.Fatalf("reconcile retained consent after candidate replacement: %v", err)
	}
	rebuiltProjection, err := kernel.Principals().GetByDevelopmentAuthorizationID(ctx, authorizationRef)
	if err != nil || rebuiltProjection.State != localappkernel.PrincipalStateActive {
		t.Fatalf("replacement exact-consent principal = (%+v, %v)", rebuiltProjection, err)
	}
	if rebuiltProjection.LocalAppPrincipalID == firstProjection.LocalAppPrincipalID {
		t.Fatal("candidate projection rebuild reused a tombstoned principal")
	}
	current, err = store.GetAuthorization(ctx, authorization.ID)
	if err != nil || current.State != localDevelopmentAuthorizationActive {
		t.Fatalf("candidate projection replacement changed durable consent = (%+v, %v)", current, err)
	}
	currentOrphan, err := kernel.Principals().Get(ctx, orphan.LocalAppPrincipalID)
	if err != nil {
		t.Fatalf("read reconciled orphan: %v", err)
	}
	if currentOrphan.State != localappkernel.PrincipalStateTombstoned {
		t.Fatalf("orphan state = %s, want tombstoned", currentOrphan.State)
	}
}

func TestLocalDevelopmentPreparationInvalidationPreservesTransientOwnerState(t *testing.T) {
	if !localDevelopmentPreparationInvalidatesAuthorization(errLocalDevelopmentProjectChanged) {
		t.Fatal("project authority mismatch must invalidate durable authorization")
	}
	for name, err := range map[string]error{
		"controlled rebuild": errLocalDevelopmentProjectUnstable,
		"revision conflict":  localappkernel.ErrRevisionConflict,
		"temporary I/O":      os.ErrNotExist,
	} {
		if localDevelopmentPreparationInvalidatesAuthorization(err) {
			t.Fatalf("%s must preserve exact durable authorization", name)
		}
	}
}

func TestLocalDevelopmentSessionOpenErrorPreservesFailureClass(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		code   codes.Code
		reason runtimev1.ReasonCode
	}{
		{name: "launch expired", err: errLocalDevelopmentLaunchExpired, code: codes.Unauthenticated, reason: runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED},
		{name: "authorization revoked", err: errLocalDevelopmentAuthorization, code: codes.Unauthenticated, reason: runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED},
		{name: "process mismatch", err: errLocalDevelopmentLaunchMismatch, code: codes.PermissionDenied, reason: runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH},
		{name: "account changed", err: errLocalDevelopmentAccountChanged, code: codes.Unauthenticated, reason: runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED},
		{name: "store unavailable", err: errors.New("store unavailable"), code: codes.FailedPrecondition, reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			failure := status.Convert(localDevelopmentSessionOpenError(test.err))
			reason, ok := grpcerr.ExtractReasonCode(localDevelopmentSessionOpenError(test.err))
			if failure.Code() != test.code || !ok || reason != test.reason {
				t.Fatalf("session-open failure = %s/%s (present=%v), want %s/%s", failure.Code(), reason, ok, test.code, test.reason)
			}
		})
	}
}

func TestLocalDevelopmentHandlerCompletesBootstrapAndRevokesTechnicalSessionWithDesktopSupervisor(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("positive project-Electron host flow is the Windows carrier contract")
	}
	ctx := context.Background()
	boot := localDevelopmentTestIdentifier(0x91)
	store, err := openLocalDevelopmentStore(filepath.Join(t.TempDir(), "local-development.db"), boot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	registry, err := protectedlocal.NewLocalAppLaunchRegistry(boot)
	if err != nil {
		t.Fatal(err)
	}
	projectRoot := filepath.Join(t.TempDir(), "sample-app")
	if err := os.MkdirAll(projectRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	manifest := `app_id: sample.nimi.app
display_name: Sample App
permissions: []
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
	hostDigest, err := localDevelopmentFileDigest(hostPath)
	if err != nil {
		t.Fatal(err)
	}
	process := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: 9101, CreationMarker: "development-handler-created",
		OSLoginSession: "development-handler-logon", SecurityPrincipal: "development-handler-user",
		CanonicalExecutableIdentity: "development-handler-file", CanonicalExecutablePath: filepath.Clean(hostPath),
		ExecutableDigest: hostDigest, ExecutableTrustSetID: protectedlocal.WindowsLocalDevelopmentTrustSetID,
	}
	processVerifier := &localDevelopmentHandlerProcessVerifier{process: process, liveness: newLocalDevelopmentHandlerLiveness()}
	account := &localDevelopmentHandlerAccount{accountID: "account-development", generation: 12}
	verifiedSID, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, filepath.Join(t.TempDir(), "local-app-kernel.db"), verifiedSID, localappkernel.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	service := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithRuntimeAccountProjectionProvider(account),
		WithLocalDevelopmentAuthority(store, registry, processVerifier, nil),
		WithLocalAppKernel(kernel),
	)
	if _, err := store.SetDeveloperMode(ctx, true, account.accountID, account.generation); err != nil {
		t.Fatalf("enable Developer Mode: %v", err)
	}
	desktopConnection := newLocalDevelopmentHandlerDesktopConnection(t, boot)
	t.Cleanup(desktopConnection.Revoke)
	desktopContext := protectedlocal.ContextWithDesktopConnection(ctx, desktopConnection)
	runID := localDevelopmentTestIdentifier(0x93)
	immutableHandle := localDevelopmentTestIdentifier(0x90)
	_, err = service.PrepareLocalAppLaunch(desktopContext, &runtimev1.PrepareLocalAppLaunchRequest{
		LocalAppHandle:  immutableHandle[:],
		SupervisorRunId: runID[:],
	})
	launchReason, reasonOK := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.FailedPrecondition || !reasonOK || launchReason != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("unadmitted immutable local-app handle must remain typed unavailable, got %v", err)
	}

	evaluation, err := service.EvaluateLocalDevelopmentProject(desktopContext, &runtimev1.EvaluateLocalDevelopmentProjectRequest{
		ExpectedAppId: "sample.nimi.app", ProjectRoot: projectRoot,
		ShellKind:       runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON,
		SupervisorRunId: runID[:],
	})
	if err != nil {
		t.Fatalf("EvaluateLocalDevelopmentProject: %v", err)
	}
	canonicalProjectRoot, err := filepath.EvalSymlinks(projectRoot)
	if err != nil {
		t.Fatalf("canonicalize project root: %v", err)
	}
	if !evaluation.GetConfirmationRequired() || evaluation.GetProject().GetCanonicalProjectRoot() != canonicalProjectRoot || len(evaluation.GetEvaluationId()) != protectedlocal.IdentifierBytes {
		t.Fatalf("unexpected development evaluation: %+v", evaluation)
	}
	decision, err := service.DecideLocalDevelopmentProject(desktopContext, &runtimev1.DecideLocalDevelopmentProjectRequest{
		EvaluationId: evaluation.GetEvaluationId(), Decision: runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_PROJECT,
		RiskDisclosureAcknowledged: true,
	})
	if err != nil {
		t.Fatalf("DecideLocalDevelopmentProject: %v", err)
	}
	authorizationID := decision.GetAuthorization().GetAuthorizationId()
	prepared, err := service.PrepareLocalAppLaunch(desktopContext, &runtimev1.PrepareLocalAppLaunchRequest{
		LocalAppHandle: authorizationID, SupervisorRunId: runID[:],
	})
	if err != nil {
		t.Fatalf("PrepareLocalAppLaunch: %v", err)
	}
	if _, err := service.BindLocalAppProcess(desktopContext, &runtimev1.BindLocalAppProcessRequest{LaunchId: prepared.GetLaunchId(), ChildProcessId: process.PID}); err != nil {
		t.Fatalf("BindLocalAppProcess: %v", err)
	}
	pipeLiveness := newLocalDevelopmentHandlerLiveness()
	promoted, err := registry.Promote(process, pipeLiveness)
	if err != nil {
		t.Fatalf("promote exact development host: %v", err)
	}
	hostConnection, err := protectedlocal.EstablishLocalAppConnection(ctx, localDevelopmentHandlerInstalledPeer{peer: promoted})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(hostConnection.Revoke)
	hostContext := protectedlocal.ContextWithLocalAppConnection(ctx, hostConnection)
	opened, err := service.OpenLocalAppSessionProjection(hostContext)
	if err != nil {
		t.Fatalf("OpenLocalAppSessionProjection: %v", err)
	}
	if opened.TrustClass != runtimev1.LocalAppTrustClass_LOCAL_APP_TRUST_CLASS_LOCAL_DEVELOPMENT || opened.AccountGeneration != account.generation || opened.RuntimeBootEpoch != boot {
		t.Fatalf("unexpected development bootstrap: %+v", opened)
	}
	rotated, err := service.RenewLocalAppSessionProjection(hostContext)
	if err != nil {
		t.Fatalf("renew local-development technical session: %v", err)
	}
	if rotated != opened {
		t.Fatalf("session rotation changed the sanitized projection: before=%+v after=%+v", opened, rotated)
	}
	desktopConnection.Revoke()
	if _, err := service.OpenLocalAppSessionProjection(hostContext); err == nil {
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
		t.Fatalf("allow-project authorization must survive supervisor exit while technical state is replaced: %+v", nextEvaluation)
	}
	hostConnection.Revoke()
	if _, err := service.OpenLocalAppSessionProjection(hostContext); err == nil {
		t.Fatal("revoked host connection must invalidate local-development status")
	}
}

func materializeLocalDevelopmentHandlerProject(t *testing.T, project localDevelopmentProjectSnapshot) {
	t.Helper()
	if err := os.MkdirAll(project.ProjectRoot, 0o700); err != nil {
		t.Fatalf("create local-development project root: %v", err)
	}
	manifest := "app_id: " + project.AppID + "\ndisplay_name: " + project.DisplayName + "\npermissions: []\n"
	if err := os.WriteFile(project.ManifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatalf("write local-development manifest: %v", err)
	}
	hostPath := filepath.Join(project.ProjectRoot, "node_modules", "electron", "dist", "electron.exe")
	if err := os.MkdirAll(filepath.Dir(hostPath), 0o700); err != nil {
		t.Fatalf("create local-development host directory: %v", err)
	}
	if err := os.WriteFile(hostPath, []byte("controlled-electron-host"), 0o600); err != nil {
		t.Fatalf("write local-development host: %v", err)
	}
}

type localDevelopmentHandlerAccount struct {
	accountID  string
	generation uint64
}

func (account *localDevelopmentHandlerAccount) AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool) {
	return &runtimev1.AccountProjection{AccountId: account.accountID, RealmEnvironmentId: "realm-development"}, true
}

func (account *localDevelopmentHandlerAccount) AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool) {
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
	peer protectedlocal.VerifiedLocalAppLaunchPeer
}

func (verifier localDevelopmentHandlerInstalledPeer) VerifyLocalAppLaunchPeer(context.Context) (protectedlocal.VerifiedLocalAppLaunchPeer, error) {
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
