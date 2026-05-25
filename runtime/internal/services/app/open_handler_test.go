package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// installBundledAppForOpen installs the bundled fixture app so the Open flow
// has a verified, active release to launch.
func installBundledAppForOpen(t *testing.T, svc *Service) {
	t.Helper()
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.shijing", Confirmed: true})
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

func TestOpenAppLaunchesInstalledApp(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installBundledAppForOpen(t, svc)

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.shijing",
		Scope: appOpenScope("nimi.shijing"),
	})
	if err != nil {
		t.Fatalf("OpenApp: %v", err)
	}
	proj := resp.GetProjection()
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
	if proj.GetScope().GetKind() != "app" || proj.GetScope().GetOwnerId() != "nimi.shijing" {
		t.Fatalf("scope = %v, want app/nimi.shijing", proj.GetScope())
	}
	if proj.GetActiveVersion() == "" {
		t.Fatal("expected resolved active version")
	}
}

func TestOpenAppFailsClosedWithoutScopeRef(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installBundledAppForOpen(t, svc)

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{AppId: "nimi.shijing"})
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
		AppId: "nimi.shijing",
		Scope: &runtimev1.AppOpenScopeRef{Kind: "account", OwnerId: "nimi.shijing"},
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
		AppId: "nimi.shijing",
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
		AppId: "nimi.shijing",
		Scope: appOpenScope("nimi.shijing"),
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
	durableRoot := filepath.Join(dataRoot, "apps", "nimi.shijing", "data")
	if err := os.RemoveAll(durableRoot); err != nil {
		t.Fatalf("remove durable data root: %v", err)
	}
	if err := os.WriteFile(durableRoot, []byte("not a dir"), 0o644); err != nil {
		t.Fatalf("write corrupt durable data file: %v", err)
	}

	resp, err := svc.OpenApp(context.Background(), &runtimev1.OpenAppRequest{
		AppId: "nimi.shijing",
		Scope: appOpenScope("nimi.shijing"),
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
		AppId: "nimi.shijing",
		Scope: appOpenScope("nimi.shijing"),
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
