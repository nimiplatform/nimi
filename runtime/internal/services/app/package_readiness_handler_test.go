package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestGetAppPackageReadinessAlwaysReturnsOpaqueUnavailableProjection(t *testing.T) {
	dataRoot := t.TempDir()
	legacyTruthRoot := filepath.Join(dataRoot, "apps", "caller-selected", ".nimi")
	if err := os.MkdirAll(legacyTruthRoot, 0o755); err != nil {
		t.Fatalf("mkdir legacy package truth fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyTruthRoot, "active-release.json"), []byte(`{"activeVersion":"v1","releaseRoot":"forbidden"}`), 0o644); err != nil {
		t.Fatalf("write legacy active release fixture: %v", err)
	}

	svc := New(testLogger(), WithAppStorageDataRoot(dataRoot), WithSessionValidator(allowingAppSessionValidator{}))
	response, err := svc.GetAppPackageReadiness(context.Background(), &runtimev1.GetAppPackageReadinessRequest{AppId: "caller-selected"})
	if err != nil {
		t.Fatalf("GetAppPackageReadiness: %v", err)
	}
	assertOpaqueImmutablePackageUnavailable(t, response.GetProjection())
}

func TestGetAppPackageReadinessIsSelectorIndependent(t *testing.T) {
	svc := New(testLogger())
	withoutRequest, err := svc.GetAppPackageReadiness(context.Background(), nil)
	if err != nil {
		t.Fatalf("nil readiness request: %v", err)
	}
	withCallerTarget, err := svc.GetAppPackageReadiness(context.Background(), &runtimev1.GetAppPackageReadinessRequest{AppId: "  caller/path/../selected  "})
	if err != nil {
		t.Fatalf("caller-targeted readiness request: %v", err)
	}
	if !proto.Equal(withoutRequest, withCallerTarget) {
		t.Fatalf("0K readiness changed with caller selector: nil=%+v targeted=%+v", withoutRequest, withCallerTarget)
	}
}

func assertOpaqueImmutablePackageUnavailable(t *testing.T, projection *runtimev1.AppPackageReadinessProjection) {
	t.Helper()
	if projection == nil {
		t.Fatal("readiness projection is nil")
	}
	if projection.GetState() != runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_BLOCKED ||
		projection.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE ||
		projection.GetDetail() != immutableProfileUnavailableDetail {
		t.Fatalf("readiness = %+v, want blocked immutable_profile_unavailable", projection)
	}
	if projection.GetAppId() != "" || projection.GetReleaseDescriptorRef() != "" || projection.GetStoragePolicyRef() != "" ||
		projection.GetExpectedVersion() != "" || projection.GetActiveVersion() != "" || projection.GetInstalledVersion() != "" ||
		projection.GetSha256() != "" || projection.GetVerificationState() != "" {
		t.Fatalf("0K readiness leaked package truth: %+v", projection)
	}
}
