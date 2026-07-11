package app

import (
	"context"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
)

type allowOpenReadinessVerifier struct{}

func (allowOpenReadinessVerifier) VerifyOpenAccountInventory(context.Context, appregistrycatalog.App) (OpenAppReadinessDecision, error) {
	return OpenAppReadinessDecision{Allowed: true}, nil
}

func (allowOpenReadinessVerifier) VerifyOpenPermissions(context.Context, appregistrycatalog.App) (OpenAppReadinessDecision, error) {
	return OpenAppReadinessDecision{Allowed: true}, nil
}

type testOpenReadinessVerifier struct {
	inventory  OpenAppReadinessDecision
	permission OpenAppReadinessDecision
}

func (v testOpenReadinessVerifier) VerifyOpenAccountInventory(context.Context, appregistrycatalog.App) (OpenAppReadinessDecision, error) {
	return v.inventory, nil
}

func (v testOpenReadinessVerifier) VerifyOpenPermissions(context.Context, appregistrycatalog.App) (OpenAppReadinessDecision, error) {
	return v.permission, nil
}

// installBundledAppForOpen installs the bundled fixture app so the Open flow
// has a verified, active release to launch.
func installBundledAppForOpen(t *testing.T, svc *Service) {
	t.Helper()
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	job := waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("install job state = %v detail=%q, want INSTALLED", job.GetState(), job.GetFailureDetail())
	}
}

func appOpenScope(appID string) *runtimev1.AppOpenScopeRef {
	return &runtimev1.AppOpenScopeRef{Kind: "app", OwnerId: appID}
}

func TestOpenAppWaitsForNativeLaunchStoreBeforeInstalledSuccess(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installBundledAppForOpen(t, svc)

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.example-app",
		Scope: appOpenScope("nimi.example-app"),
	})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	proj := resp.GetProjection()
	if proj.GetState() == runtimev1.AppOpenState_APP_OPEN_STATE_BLOCKED {
		if proj.GetReachedStep() != runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_LAUNCH || proj.GetReasonCode() != runtimev1.ReasonCode_PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED {
			t.Fatalf("unexpected A.1 fail-close projection: %+v", proj)
		}
		return
	}
	if proj.GetState() != runtimev1.AppOpenState_APP_OPEN_STATE_LAUNCHED {
		t.Fatalf("open state = %v detail=%q, want LAUNCHED", proj.GetState(), proj.GetDetail())
	}
	if !proj.GetLaunched() {
		t.Fatal("expected launched=true")
	}
	if proj.GetReachedStep() != runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_LAUNCH {
		t.Fatalf("reached step = %v, want LAUNCH", proj.GetReachedStep())
	}
	if proj.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("reason code = %v, want ACTION_EXECUTED", proj.GetReasonCode())
	}
	if proj.GetScope().GetKind() != "app" || proj.GetScope().GetOwnerId() != "nimi.example-app" {
		t.Fatalf("scope = %v, want app/nimi.example-app", proj.GetScope())
	}
	if proj.GetActiveVersion() == "" {
		t.Fatal("expected resolved active version")
	}
}

func TestOpenAppCreatesRuntimeOwnedLaunchRecordWithoutClaimingChildSuccess(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installBundledAppForOpen(t, svc)
	boot := protectedlocal.Identifier{1}
	store, err := authservice.OpenInstalledLaunchStore(filepath.Join(t.TempDir(), "installed-launch.db"), boot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	svc.installedLaunches = store
	svc.accountSecurity = &lifecycleIntentTestAccount{generation: 7}

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{AppId: "nimi.example-app", Scope: appOpenScope("nimi.example-app")})
	if err != nil {
		t.Fatal(err)
	}
	projection := resp.GetProjection()
	if projection.GetState() != runtimev1.AppOpenState_APP_OPEN_STATE_LAUNCH_PREPARED || projection.GetLaunched() || len(projection.GetLaunchId()) != protectedlocal.IdentifierBytes {
		t.Fatalf("invalid launch-prepared projection: %+v", projection)
	}
	_, descriptor, err := svc.installRuntime.resolveDescriptor("nimi.example-app")
	if err != nil {
		t.Fatal(err)
	}
	plan, err := svc.installRuntime.plan(descriptor)
	if err != nil {
		t.Fatal(err)
	}
	resolved, blocked := verifyOpenPackage(svc.installRuntime, plan, descriptor)
	if blocked != nil {
		t.Fatal(blocked)
	}
	digest, err := installedReleaseDigest(resolved.Evidence.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	var launchID protectedlocal.Identifier
	copy(launchID[:], projection.GetLaunchId())
	session, err := store.Consume(context.Background(), authservice.InstalledLaunchProcess{LaunchID: launchID, PID: 4401, CreationMarker: "01dc-installed", ReleaseDigest: digest, AccountGeneration: 7})
	if err != nil || session.AppID != "nimi.example-app" || session.RuntimeBootEpoch != boot {
		t.Fatalf("atomic installed session = %+v, error = %v", session, err)
	}
}

func TestOpenAppLaunchesSandboxFixtureWithRuntimeAttestedResolution(t *testing.T) {
	payload := zipFixturePayload(t)
	svc, runtimeAppRegistry, _, _ := newExternalFixtureInstallServiceWithRuntimeAppRegistry(t, payload, payload, "developer-only")
	installResp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{
		AppId:     "community.nimi.fixture.platform-proof",
		Confirmed: true,
	})
	if err != nil {
		t.Fatalf("InstallApp sandbox fixture: %v", err)
	}
	job := waitForTerminalJob(t, svc, installResp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("install job state = %v detail=%q, want INSTALLED", job.GetState(), job.GetFailureDetail())
	}

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "community.nimi.fixture.platform-proof",
		Scope: appOpenScope("community.nimi.fixture.platform-proof"),
	})
	if err != nil {
		t.Fatalf("OpenApp sandbox fixture: %v", err)
	}
	proj := resp.GetProjection()
	if proj.GetState() == runtimev1.AppOpenState_APP_OPEN_STATE_BLOCKED {
		if proj.GetReachedStep() != runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_LAUNCH || proj.GetReasonCode() != runtimev1.ReasonCode_PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED {
			t.Fatalf("unexpected A.1 fail-close projection: %+v", proj)
		}
		return
	}
	if proj.GetState() != runtimev1.AppOpenState_APP_OPEN_STATE_LAUNCHED {
		t.Fatalf("open state = %v detail=%q, want LAUNCHED", proj.GetState(), proj.GetDetail())
	}
	if proj.GetReleaseDescriptorRef() != "community.nimi.fixture.platform-proof.0.1.0-sandbox" {
		t.Fatalf("descriptor ref = %q", proj.GetReleaseDescriptorRef())
	}
	if proj.GetDescriptorClass() != "external-immutable-artifact" ||
		proj.GetAdmissionTrack() != "admission-sandbox-ci" ||
		proj.GetSourceKind() != "admission-sandbox-https-artifact" ||
		proj.GetOrdinaryVisibility() != "developer-only" {
		t.Fatalf("launch descriptor projection = class=%q track=%q source=%q visibility=%q",
			proj.GetDescriptorClass(), proj.GetAdmissionTrack(), proj.GetSourceKind(), proj.GetOrdinaryVisibility())
	}
	if proj.GetProductReadinessClaimAllowed() {
		t.Fatal("sandbox CI launch must not claim ordinary product readiness")
	}
	if proj.GetDigestVerificationState() != "digest-verified" {
		t.Fatalf("digest verification = %q, want digest-verified", proj.GetDigestVerificationState())
	}
	if proj.GetRuntimeEntryRef() != "dist/index.html" {
		t.Fatalf("runtime entry ref = %q", proj.GetRuntimeEntryRef())
	}
	if proj.GetActiveReleaseRoot() == "" || proj.GetStorage().GetReleaseRoot() != proj.GetActiveReleaseRoot() {
		t.Fatalf("active release root/storage mismatch: active=%q storage=%+v", proj.GetActiveReleaseRoot(), proj.GetStorage())
	}
	if proj.GetStorage().GetDurableDataRoot() == "" || proj.GetStorage().GetCacheRoot() == "" || proj.GetStorage().GetTempRoot() == "" {
		t.Fatalf("storage handles incomplete: %+v", proj.GetStorage())
	}
	if proj.GetShellCapabilitySetRef() != "installed-nimi-app-standard-shell-v1" {
		t.Fatalf("shell capability set = %q", proj.GetShellCapabilitySetRef())
	}
	if proj.GetCallerMode() != "desktop-launched-nimi-app" {
		t.Fatalf("caller mode = %q", proj.GetCallerMode())
	}
	if len(proj.GetLaunchId()) != 32 {
		t.Fatal("launch id must be a 32-byte Runtime correlation")
	}
	if !runtimeAppRegistry.AdmitDesktopLaunchedNimiAppInstance(
		"community.nimi.fixture.platform-proof",
		"community.nimi.fixture.platform-proof.desktop-host",
		"desktop-installed-app-host-device",
		appregistry.DesktopInstalledAppLaunchHostID,
		hex.EncodeToString(proj.GetLaunchId()),
		proj.GetReleaseDescriptorRef(),
	) {
		t.Fatal("OpenApp must record Runtime launch-resolution evidence for installed app account admission")
	}
}

func TestOpenAppFailsClosedWithoutAccountLibraryVerifier(t *testing.T) {
	svc, _ := newBundledInstallServiceWithOpenReadiness(t, nil)
	installBundledAppForOpen(t, svc)

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.example-app",
		Scope: appOpenScope("nimi.example-app"),
	})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	proj := resp.GetProjection()
	if proj.GetState() != runtimev1.AppOpenState_APP_OPEN_STATE_BLOCKED || proj.GetLaunched() {
		t.Fatalf("expected blocked open, got state=%v launched=%v", proj.GetState(), proj.GetLaunched())
	}
	if proj.GetReachedStep() != runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_LIBRARY {
		t.Fatalf("reached step = %v, want VERIFY_LIBRARY", proj.GetReachedStep())
	}
	if proj.GetReasonCode() != runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID {
		t.Fatalf("reason code = %v, want APP_OPEN_LIBRARY_STATE_INVALID", proj.GetReasonCode())
	}
}

func TestOpenAppFailsClosedWhenAccountLibraryVerifierBlocks(t *testing.T) {
	svc, _ := newBundledInstallServiceWithOpenReadiness(t, testOpenReadinessVerifier{
		inventory: OpenAppReadinessDecision{Allowed: false, Detail: "inventory row is removed"},
	})
	installBundledAppForOpen(t, svc)

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.example-app",
		Scope: appOpenScope("nimi.example-app"),
	})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	proj := resp.GetProjection()
	if proj.GetReachedStep() != runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_LIBRARY {
		t.Fatalf("reached step = %v, want VERIFY_LIBRARY", proj.GetReachedStep())
	}
	if proj.GetReasonCode() != runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID {
		t.Fatalf("reason code = %v, want APP_OPEN_LIBRARY_STATE_INVALID", proj.GetReasonCode())
	}
	if !strings.Contains(proj.GetDetail(), "inventory row is removed") {
		t.Fatalf("detail = %q, want verifier detail", proj.GetDetail())
	}
}

func TestOpenAppFailsClosedWhenPermissionVerifierBlocks(t *testing.T) {
	svc, _ := newBundledInstallServiceWithRegistry(t, bundledRegistryWithPermission(t), testOpenReadinessVerifier{
		inventory:  OpenAppReadinessDecision{Allowed: true},
		permission: OpenAppReadinessDecision{Allowed: false, Detail: "grant is revoked"},
	})
	installBundledAppForOpen(t, svc)

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.example-app",
		Scope: appOpenScope("nimi.example-app"),
	})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	proj := resp.GetProjection()
	if proj.GetReachedStep() != runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PERMISSIONS {
		t.Fatalf("reached step = %v, want VERIFY_PERMISSIONS", proj.GetReachedStep())
	}
	if proj.GetReasonCode() != runtimev1.ReasonCode_APP_OPEN_PERMISSION_NOT_GRANTED {
		t.Fatalf("reason code = %v, want APP_OPEN_PERMISSION_NOT_GRANTED", proj.GetReasonCode())
	}
	if !strings.Contains(proj.GetDetail(), "grant is revoked") {
		t.Fatalf("detail = %q, want verifier detail", proj.GetDetail())
	}
}

func TestOpenAppFailsClosedWithoutScopeRef(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installBundledAppForOpen(t, svc)

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{AppId: "nimi.example-app"})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	proj := resp.GetProjection()
	if proj.GetState() != runtimev1.AppOpenState_APP_OPEN_STATE_BLOCKED || proj.GetLaunched() {
		t.Fatalf("expected blocked open, got state=%v launched=%v", proj.GetState(), proj.GetLaunched())
	}
	if proj.GetReasonCode() != runtimev1.ReasonCode_APP_OPEN_SCOPE_REF_REQUIRED {
		t.Fatalf("reason code = %v, want APP_OPEN_SCOPE_REF_REQUIRED", proj.GetReasonCode())
	}
	if proj.GetReachedStep() != runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_ENSURE_AICONFIG {
		t.Fatalf("reached step = %v, want ENSURE_AICONFIG", proj.GetReachedStep())
	}
}

func TestOpenAppFailsClosedOnNonAppScopeKind(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installBundledAppForOpen(t, svc)

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.example-app",
		Scope: &runtimev1.AppOpenScopeRef{Kind: "account", OwnerId: "nimi.example-app"},
	})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	proj := resp.GetProjection()
	if proj.GetReasonCode() != runtimev1.ReasonCode_APP_OPEN_SCOPE_REF_INVALID {
		t.Fatalf("reason code = %v, want APP_OPEN_SCOPE_REF_INVALID", proj.GetReasonCode())
	}
	if proj.GetLaunched() {
		t.Fatal("expected no launch on a non-app scope kind")
	}
}

func TestOpenAppFailsClosedOnScopeOwnerMismatch(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installBundledAppForOpen(t, svc)

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.example-app",
		Scope: &runtimev1.AppOpenScopeRef{Kind: "app", OwnerId: "nimi.other"},
	})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	if resp.GetProjection().GetReasonCode() != runtimev1.ReasonCode_APP_OPEN_SCOPE_REF_INVALID {
		t.Fatalf("reason code = %v, want APP_OPEN_SCOPE_REF_INVALID", resp.GetProjection().GetReasonCode())
	}
}

func TestOpenAppFailsClosedOnUnknownApp(t *testing.T) {
	svc, _ := newBundledInstallService(t)

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.unknown",
		Scope: appOpenScope("nimi.unknown"),
	})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	proj := resp.GetProjection()
	if proj.GetState() != runtimev1.AppOpenState_APP_OPEN_STATE_BLOCKED {
		t.Fatalf("expected blocked open for unknown app, got %v", proj.GetState())
	}
	if proj.GetReachedStep() != runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_RESOLVE_REGISTRY {
		t.Fatalf("reached step = %v, want RESOLVE_REGISTRY", proj.GetReachedStep())
	}
	if proj.GetReasonCode() != runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND {
		t.Fatalf("reason code = %v, want APP_INSTALL_DESCRIPTOR_NOT_FOUND", proj.GetReasonCode())
	}
}

func TestOpenAppFailsClosedWhenPackageNotInstalled(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	// No install: the app has no active release.

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.example-app",
		Scope: appOpenScope("nimi.example-app"),
	})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	proj := resp.GetProjection()
	if proj.GetState() != runtimev1.AppOpenState_APP_OPEN_STATE_BLOCKED || proj.GetLaunched() {
		t.Fatalf("expected blocked open, got state=%v launched=%v", proj.GetState(), proj.GetLaunched())
	}
	if proj.GetReachedStep() != runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_PACKAGE {
		t.Fatalf("reached step = %v, want VERIFY_PACKAGE", proj.GetReachedStep())
	}
	if proj.GetReasonCode() != runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED {
		t.Fatalf("reason code = %v, want APP_OPEN_PACKAGE_NOT_VERIFIED", proj.GetReasonCode())
	}
}

func TestOpenAppFailsClosedOnCorruptedAppData(t *testing.T) {
	svc, dataRoot := newBundledInstallService(t)
	installBundledAppForOpen(t, svc)

	// Corrupt the durable app-data root: replace it with a non-directory.
	durableRoot := filepath.Join(dataRoot, "apps", "nimi.example-app", "data")
	if err := os.RemoveAll(durableRoot); err != nil {
		t.Fatalf("remove durable data root: %v", err)
	}
	if err := os.WriteFile(durableRoot, []byte("not a dir"), 0o644); err != nil {
		t.Fatalf("write corrupt durable data file: %v", err)
	}

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.example-app",
		Scope: appOpenScope("nimi.example-app"),
	})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	proj := resp.GetProjection()
	if proj.GetReachedStep() != runtimev1.AppOpenFlowStep_APP_OPEN_FLOW_STEP_VERIFY_APP_DATA {
		t.Fatalf("reached step = %v, want VERIFY_APP_DATA", proj.GetReachedStep())
	}
	if proj.GetReasonCode() != runtimev1.ReasonCode_APP_OPEN_APP_DATA_INVALID {
		t.Fatalf("reason code = %v, want APP_OPEN_APP_DATA_INVALID", proj.GetReasonCode())
	}
}

func TestOpenAppRequiresInstallRuntime(t *testing.T) {
	svc := New(testLogger())
	_, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.example-app",
		Scope: appOpenScope("nimi.example-app"),
	})
	if err == nil {
		t.Fatal("expected fail-closed without install runtime")
	}
}

func TestOpenAppRejectsEmptyAppID(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	_, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		Scope: appOpenScope(""),
	})
	if err == nil {
		t.Fatal("expected rejection of empty app_id")
	}
}
