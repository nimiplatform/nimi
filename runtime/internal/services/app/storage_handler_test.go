package app

import (
	"context"
	"io"
	"log/slog"
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

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

type allowingAppSessionValidator struct{}

func (allowingAppSessionValidator) ValidateAppSession(string, string, string) (runtimev1.ReasonCode, bool) {
	return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, true
}

func (rejectingAppSessionValidator) ValidateAppSession(string, string, string) (runtimev1.ReasonCode, bool) {
	return runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, false
}

func TestGetAppStorageMaterializesOnlyPrivateDataRoots(t *testing.T) {
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

func TestGetAppStorageFailsClosedWithoutDataRoot(t *testing.T) {
	svc := New(testLogger(), WithSessionValidator(allowingAppSessionValidator{}))
	resp, err := svc.GetAppStorage(context.Background(), &runtimev1.GetAppStorageRequest{AppId: "dev.nimi.tester"})
	if err != nil {
		t.Fatalf("GetAppStorage: %v", err)
	}
	if resp.GetProjection().GetState() != runtimev1.AppStorageState_APP_STORAGE_STATE_STORAGE_UNAVAILABLE ||
		resp.GetProjection().GetReasonCode() != runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE {
		t.Fatalf("projection = %+v, want STORAGE_UNAVAILABLE", resp.GetProjection())
	}
}

func TestGetAppStorageAllowsDesktopCoreAvatarTargetProjection(t *testing.T) {
	dataRoot := t.TempDir()
	svc := New(testLogger(), WithAppStorageDataRoot(dataRoot), WithSessionValidator(rejectingAppSessionValidator{}))
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop"))
	ctx = envelope.WithMetadata(ctx, envelope.Metadata{AppID: "nimi.desktop", CallerKind: "desktop-core", CallerID: "desktop.avatar-handoff"})

	resp, err := svc.GetAppStorage(ctx, &runtimev1.GetAppStorageRequest{AppId: "nimi.avatar"})
	if err != nil {
		t.Fatalf("desktop-core avatar storage projection: %v", err)
	}
	projection := resp.GetProjection()
	if projection.GetState() != runtimev1.AppStorageState_APP_STORAGE_STATE_READY {
		t.Fatalf("avatar storage projection = %+v", projection)
	}
}

func TestGetAppStorageRejectsNonDesktopCrossAppTargetProjection(t *testing.T) {
	svc := New(testLogger(), WithAppStorageDataRoot(t.TempDir()), WithSessionValidator(allowingAppSessionValidator{}))
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop"))
	ctx = envelope.WithMetadata(ctx, envelope.Metadata{AppID: "nimi.desktop", CallerKind: "third-party-app", CallerID: "not-desktop-core"})

	_, err := svc.GetAppStorage(ctx, &runtimev1.GetAppStorageRequest{AppId: "nimi.avatar"})
	if st := status.Convert(err); st.Code() != codes.PermissionDenied || st.Message() != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN.String() {
		t.Fatalf("error = %v, want permission denied APP_SCOPE_FORBIDDEN", err)
	}
}
