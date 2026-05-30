package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestGetAppStorageMaterializesDeveloperAppRoots(t *testing.T) {
	dataRoot := t.TempDir()
	svc := New(testLogger(), WithAppStorageDataRoot(dataRoot))

	resp, err := svc.GetAppStorage(context.Background(), &runtimev1.GetAppStorageRequest{AppId: "dev.nimi.tester"})
	if err != nil {
		t.Fatalf("GetAppStorage: %v", err)
	}
	projection := resp.GetProjection()
	if projection.GetState() != runtimev1.AppStorageState_APP_STORAGE_STATE_READY {
		t.Fatalf("state = %v detail=%q, want READY", projection.GetState(), projection.GetDetail())
	}
	if projection.GetActiveReleaseRoot() != "" {
		t.Fatalf("developer app must not synthesize active release root: %q", projection.GetActiveReleaseRoot())
	}
	for _, root := range []string{projection.GetDurableDataRoot(), projection.GetCacheRoot(), projection.GetTempRoot()} {
		info, err := os.Stat(root)
		if err != nil {
			t.Fatalf("expected materialized app storage root %s: %v", root, err)
		}
		if !info.IsDir() {
			t.Fatalf("expected directory root %s", root)
		}
	}
	if want := filepath.Join(dataRoot, "apps", "dev.nimi.tester", "data"); projection.GetDurableDataRoot() != want {
		t.Fatalf("durable data root = %q, want %q", projection.GetDurableDataRoot(), want)
	}
}

func TestGetAppStorageOrdinaryAppRequiresInstallBeforeActiveRelease(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.GetAppStorage(context.Background(), &runtimev1.GetAppStorageRequest{AppId: "nimi.example-app"})
	if err != nil {
		t.Fatalf("GetAppStorage: %v", err)
	}
	if resp.GetProjection().GetState() != runtimev1.AppStorageState_APP_STORAGE_STATE_INSTALL_REQUIRED {
		t.Fatalf("state = %v detail=%q, want INSTALL_REQUIRED", resp.GetProjection().GetState(), resp.GetProjection().GetDetail())
	}
	if resp.GetProjection().GetDurableDataRoot() == "" {
		t.Fatal("install-required projection must still carry app data roots")
	}
}

func TestGetAppStorageReportsActiveReleaseAfterInstall(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	installResp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	job := waitForTerminalJob(t, svc, installResp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("install state = %v detail=%q", job.GetState(), job.GetFailureDetail())
	}

	resp, err := svc.GetAppStorage(context.Background(), &runtimev1.GetAppStorageRequest{AppId: "nimi.example-app"})
	if err != nil {
		t.Fatalf("GetAppStorage: %v", err)
	}
	projection := resp.GetProjection()
	if projection.GetState() != runtimev1.AppStorageState_APP_STORAGE_STATE_READY {
		t.Fatalf("state = %v detail=%q, want READY", projection.GetState(), projection.GetDetail())
	}
	if projection.GetActiveReleaseRoot() != job.GetStorage().GetReleaseRoot() {
		t.Fatalf("active release root = %q, want %q", projection.GetActiveReleaseRoot(), job.GetStorage().GetReleaseRoot())
	}
}

func TestGetAppStorageFailsClosedWithoutDataRoot(t *testing.T) {
	svc := New(testLogger())
	resp, err := svc.GetAppStorage(context.Background(), &runtimev1.GetAppStorageRequest{AppId: "dev.nimi.tester"})
	if err != nil {
		t.Fatalf("GetAppStorage: %v", err)
	}
	if resp.GetProjection().GetState() != runtimev1.AppStorageState_APP_STORAGE_STATE_STORAGE_UNAVAILABLE {
		t.Fatalf("state = %v, want STORAGE_UNAVAILABLE", resp.GetProjection().GetState())
	}
	if resp.GetProjection().GetReasonCode() != runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION {
		t.Fatalf("reason = %v, want APP_INSTALL_STORAGE_VIOLATION", resp.GetProjection().GetReasonCode())
	}
}
