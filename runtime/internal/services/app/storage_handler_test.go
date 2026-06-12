package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type rejectingAppSessionValidator struct{}

func (rejectingAppSessionValidator) ValidateAppSession(string, string, string) (runtimev1.ReasonCode, bool) {
	return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, false
}

func TestGetAppStorageMaterializesDeveloperAppRoots(t *testing.T) {
	dataRoot := t.TempDir()
	svc := New(testLogger(), WithAppStorageDataRoot(dataRoot), WithSessionValidator(allowingAppSessionValidator{}))

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
	svc := New(testLogger(), WithSessionValidator(allowingAppSessionValidator{}))
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

func TestGetAppStorageAllowsDesktopCoreAvatarTargetProjection(t *testing.T) {
	dataRoot := t.TempDir()
	svc := New(
		testLogger(),
		WithAppStorageDataRoot(dataRoot),
		WithSessionValidator(rejectingAppSessionValidator{}),
	)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop"))
	ctx = envelope.WithMetadata(ctx, envelope.Metadata{
		AppID:      "nimi.desktop",
		CallerKind: "desktop-core",
		CallerID:   "desktop.avatar-handoff",
	})

	resp, err := svc.GetAppStorage(ctx, &runtimev1.GetAppStorageRequest{AppId: "nimi.avatar"})
	if err != nil {
		t.Fatalf("desktop-core avatar storage projection: %v", err)
	}
	projection := resp.GetProjection()
	if projection.GetState() != runtimev1.AppStorageState_APP_STORAGE_STATE_READY {
		t.Fatalf("state = %v detail=%q, want READY", projection.GetState(), projection.GetDetail())
	}
	if projection.GetAppId() != "nimi.avatar" {
		t.Fatalf("projection app id = %q, want nimi.avatar", projection.GetAppId())
	}
	if want := filepath.Join(dataRoot, "apps", "nimi.avatar", "data"); projection.GetDurableDataRoot() != want {
		t.Fatalf("durable data root = %q, want %q", projection.GetDurableDataRoot(), want)
	}
}

func TestGetAppStorageRejectsNonDesktopCrossAppTargetProjection(t *testing.T) {
	svc := New(testLogger(), WithAppStorageDataRoot(t.TempDir()), WithSessionValidator(allowingAppSessionValidator{}))
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop"))
	ctx = envelope.WithMetadata(ctx, envelope.Metadata{
		AppID:      "nimi.desktop",
		CallerKind: "third-party-app",
		CallerID:   "not-desktop-core",
	})

	_, err := svc.GetAppStorage(ctx, &runtimev1.GetAppStorageRequest{AppId: "nimi.avatar"})
	if err == nil {
		t.Fatal("non-desktop caller must not read cross-app storage projection")
	}
	st := status.Convert(err)
	if st.Code() != codes.PermissionDenied || st.Message() != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN.String() {
		t.Fatalf("error = %v, want permission denied APP_SCOPE_FORBIDDEN", err)
	}
}
