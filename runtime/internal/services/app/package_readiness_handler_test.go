package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestGetAppPackageReadinessRequiresInstallBeforeActiveRelease(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.GetAppPackageReadiness(context.Background(), &runtimev1.GetAppPackageReadinessRequest{AppId: "nimi.example-app"})
	if err != nil {
		t.Fatalf("GetAppPackageReadiness: %v", err)
	}
	projection := resp.GetProjection()
	if projection.GetState() != runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_INSTALL_REQUIRED {
		t.Fatalf("state = %v detail=%q, want INSTALL_REQUIRED", projection.GetState(), projection.GetDetail())
	}
	if projection.GetReleaseDescriptorRef() != "nimi.example-app.bundled-with-nimi" {
		t.Fatalf("descriptor ref = %q", projection.GetReleaseDescriptorRef())
	}
}

func TestGetAppPackageReadinessReportsReadyAfterVerifiedInstall(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installResp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	job := waitForTerminalJob(t, svc, installResp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("install state = %v detail=%q", job.GetState(), job.GetFailureDetail())
	}

	resp, err := svc.GetAppPackageReadiness(context.Background(), &runtimev1.GetAppPackageReadinessRequest{AppId: "nimi.example-app"})
	if err != nil {
		t.Fatalf("GetAppPackageReadiness: %v", err)
	}
	projection := resp.GetProjection()
	if projection.GetState() != runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_READY {
		t.Fatalf("state = %v detail=%q, want READY", projection.GetState(), projection.GetDetail())
	}
	if projection.GetVerificationState() != "bundled-source" {
		t.Fatalf("verification state = %q, want bundled-source", projection.GetVerificationState())
	}
	if projection.GetActiveVersion() != projection.GetExpectedVersion() {
		t.Fatalf("active version = %q, expected version = %q", projection.GetActiveVersion(), projection.GetExpectedVersion())
	}
}

func TestGetAppPackageReadinessRepairsUnreadableEvidence(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installResp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	job := waitForTerminalJob(t, svc, installResp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("install state = %v detail=%q", job.GetState(), job.GetFailureDetail())
	}
	evidencePath := filepath.Join(job.GetStorage().GetReleaseRoot(), ".nimi", "install-evidence.json")
	if err := os.WriteFile(evidencePath, []byte("{ bad json"), 0o644); err != nil {
		t.Fatalf("corrupt evidence: %v", err)
	}

	resp, err := svc.GetAppPackageReadiness(context.Background(), &runtimev1.GetAppPackageReadinessRequest{AppId: "nimi.example-app"})
	if err != nil {
		t.Fatalf("GetAppPackageReadiness: %v", err)
	}
	projection := resp.GetProjection()
	if projection.GetState() != runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_REPAIR_REQUIRED {
		t.Fatalf("state = %v detail=%q, want REPAIR_REQUIRED", projection.GetState(), projection.GetDetail())
	}
	if projection.GetReasonCode() != runtimev1.ReasonCode_APP_OPEN_PACKAGE_NOT_VERIFIED {
		t.Fatalf("reason = %v, want APP_OPEN_PACKAGE_NOT_VERIFIED", projection.GetReasonCode())
	}
}

func TestGetAppPackageReadinessFailsClosedWithoutRuntime(t *testing.T) {
	svc := New(testLogger(), WithSessionValidator(allowingAppSessionValidator{}))
	resp, err := svc.GetAppPackageReadiness(context.Background(), &runtimev1.GetAppPackageReadinessRequest{AppId: "nimi.example-app"})
	if err != nil {
		t.Fatalf("GetAppPackageReadiness: %v", err)
	}
	projection := resp.GetProjection()
	if projection.GetState() != runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_BLOCKED {
		t.Fatalf("state = %v, want BLOCKED", projection.GetState())
	}
	if projection.GetReasonCode() != runtimev1.ReasonCode_APP_INSTALL_INTERNAL {
		t.Fatalf("reason = %v, want APP_INSTALL_INTERNAL", projection.GetReasonCode())
	}
}
