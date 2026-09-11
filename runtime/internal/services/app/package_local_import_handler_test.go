package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappnative"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func packageHandlerFixture(t *testing.T) (context.Context, *Service, *localappkernel.Kernel) {
	t.Helper()
	root := t.TempDir()
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 42)
	if err != nil {
		t.Fatal(err)
	}
	database, err := localappkernel.CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(context.Background(), database, identity, localappkernel.Options{HostInstallID: "package-handler", DataRoot: root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	coordinator, err := nimiappinstall.NewCoordinator(publicappregistry.NewCanonicalClient(), kernel, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = coordinator.Close() })
	client := protectedlocal.ProcessTuple{OS: protectedlocal.OSWindows, PID: 4101, CreationMarker: "desktop-start", OSLoginSession: "interactive-login", SecurityPrincipal: "interactive-user", CanonicalExecutableIdentity: "desktop", ExecutableDigest: localAppSessionTestIdentifier(0x82), ExecutableTrustSetID: "desktop-release"}
	server := protectedlocal.ProcessTuple{OS: protectedlocal.OSWindows, PID: 4102, CreationMarker: "runtime-start", OSLoginSession: "service-login", SecurityPrincipal: "runtime-service", CanonicalExecutableIdentity: "runtime", ExecutableDigest: localAppSessionTestIdentifier(0x83), ExecutableTrustSetID: "runtime-release"}
	desktop, err := protectedlocal.EstablishDesktopConnection(context.Background(), builtInDesktopVerifier{peers: protectedlocal.VerifiedDesktopPeers{
		Client: client, Server: server, ClientLiveness: &localAppSessionTestLiveness{revoked: make(chan struct{})}, RuntimeBootEpoch: localAppSessionTestIdentifier(0x81), EndpointInstanceID: localAppSessionTestIdentifier(0x84), TranscriptNonce: localAppSessionTestIdentifier(0x85),
	}}, bytes.NewReader(bytes.Repeat([]byte{0x86}, 64)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(desktop.Revoke)
	return protectedlocal.ContextWithDesktopConnection(context.Background(), desktop), New(nil, WithLocalAppKernel(kernel), WithAppInstallCoordinator(coordinator)), kernel
}

func assertPackageHandlerReason(t *testing.T, err error, code codes.Code, want runtimev1.ReasonCode) {
	t.Helper()
	reason, _ := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != code || reason != want {
		t.Fatalf("code=%v reason=%v error=%v; want %v / %v", status.Code(err), reason, err, code, want)
	}
}

func TestLocalPackageHandlersRequireDesktopAndRejectInvalidSelections(t *testing.T) {
	ctx, service, _ := packageHandlerFixture(t)
	calls := []struct {
		name   string
		call   func(context.Context) error
		code   codes.Code
		reason runtimev1.ReasonCode
	}{
		{"prepare", func(c context.Context) error { _, e := service.PrepareLocalAppPackage(c, nil); return e }, codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID},
		{"discard", func(c context.Context) error { _, e := service.DiscardLocalAppPackage(c, nil); return e }, codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_STALE},
		{"install", func(c context.Context) error { _, e := service.StartLocalAppPackageInstall(c, nil); return e }, codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_STALE},
		{"update", func(c context.Context) error { _, e := service.StartLocalAppPackageUpdate(c, nil); return e }, codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID},
		{"info", func(c context.Context) error { _, e := service.GetAppPackageInfo(c, nil); return e }, codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID},
	}
	for _, item := range calls {
		t.Run(item.name, func(t *testing.T) {
			assertPackageHandlerReason(t, item.call(context.Background()), codes.PermissionDenied, runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED)
			assertPackageHandlerReason(t, item.call(ctx), item.code, item.reason)
		})
	}
	selector := []byte(strings.Repeat("a", 48))
	_, err := service.StartLocalAppPackageInstall(ctx, &runtimev1.StartLocalAppPackageInstallRequest{CandidateSelector: selector})
	assertPackageHandlerReason(t, err, codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_STALE)
	discarded, err := service.DiscardLocalAppPackage(ctx, &runtimev1.DiscardLocalAppPackageRequest{CandidateSelector: selector})
	if err != nil || discarded.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("discard of an already-absent candidate must be idempotent: %+v %v", discarded, err)
	}
	_, err = service.StartLocalAppPackageUpdate(ctx, &runtimev1.StartLocalAppPackageUpdateRequest{CandidateSelector: selector, LaunchSelector: []byte("installed"), InstalledVersion: "1.0.0"})
	assertPackageHandlerReason(t, err, codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_STALE)
	if _, _, _, err := publicappregistry.CurrentPlatformTarget(); err == nil {
		_, err = service.PrepareLocalAppPackage(ctx, &runtimev1.PrepareLocalAppPackageRequest{SourcePath: filepath.Join(t.TempDir(), "missing.nimiapp")})
		assertPackageHandlerReason(t, err, codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID)
		metadata, _ := grpcerr.ExtractReasonMetadata(err)
		if metadata["local_import_reason"] != "local-file-unavailable" {
			t.Fatalf("lost recovery reason: %v", metadata)
		}
	}
}

func TestLocalPackageErrorMappingKeepsRecoveryReasons(t *testing.T) {
	for _, item := range []struct {
		cause  error
		reason string
	}{
		{nimiapppackage.ErrUnsupportedTarget, "unsupported-target"}, {nimiappinstall.ErrUnsupportedInstallPlatform, "unsupported-target"},
		{nimiappnative.ErrNativeVerification, "native-verification-failed"}, {nimiappnative.ErrNativePostureMismatch, "native-verification-failed"},
		{nimiapppackage.ErrInvalidPackage, "invalid-package"}, {nimiapppackage.ErrPackageIntegrity, "invalid-package"},
		{os.ErrNotExist, "local-file-unavailable"}, {os.ErrPermission, "local-file-unavailable"},
	} {
		err := localPackageError(item.cause)
		assertPackageHandlerReason(t, err, codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID)
		metadata, _ := grpcerr.ExtractReasonMetadata(err)
		if metadata["local_import_reason"] != item.reason {
			t.Fatalf("reason metadata: %v", metadata)
		}
	}
}

func TestPackageInfoSelectorsAndInstalledSnapshot(t *testing.T) {
	ctx, service, kernel := packageHandlerFixture(t)
	for _, req := range []*runtimev1.GetAppPackageInfoRequest{
		{}, {ApprovedTargetSelector: []byte("catalog"), LaunchSelector: []byte("installed"), InstalledReleaseRef: "release"},
		{ApprovedTargetSelector: []byte("catalog"), InstalledReleaseRef: "release"}, {LaunchSelector: []byte("installed")},
		{InstalledReleaseRef: "release"}, {ApprovedTargetSelector: []byte("malformed")},
	} {
		_, err := service.GetAppPackageInfo(ctx, req)
		assertPackageHandlerReason(t, err, codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID)
	}
	imageData := image.NewNRGBA(image.Rect(0, 0, 128, 128))
	imageData.Set(64, 64, color.NRGBA{R: 30, G: 180, B: 160, A: 255})
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, imageData); err != nil {
		t.Fatal(err)
	}
	info := nimiapppackage.AppInfo{Format: "nimi.app-info/v1", AppID: "test.info", Version: "1.0.0", TargetID: "macos-aarch64", DisplayName: "Info App", Summary: "Installed snapshot",
		Icon: nimiapppackage.AppInfoIcon{MediaType: "image/png", DataBase64: base64.StdEncoding.EncodeToString(imageBytes.Bytes())}, License: nimiapppackage.AppInfoLicense{Identifier: "MIT", Text: "MIT\n"}, AppAccess: []string{}, CapabilityContractRefs: []string{}, RequiredStandardizedFeatureRefs: []string{}, StoragePolicy: nimiapppackage.AppInfoStoragePolicy{Kind: "nimi-mediated-default"}}
	raw, err := json.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	store := kernel.PackageLifecycle()
	job, err := store.Begin(ctx, localappkernel.BeginPackageJobInput{AppID: info.AppID, SourceClass: localappkernel.SourceClassUserImported, Kind: localappkernel.PackageJobInstall, TargetRef: "local-package:v1:info:1.0.0", ProgressBasis: localappkernel.PackageProgressIndeterminate})
	if err != nil {
		t.Fatal(err)
	}
	for _, phase := range []localappkernel.PackageJobPhase{localappkernel.PackageJobReadingLocal, localappkernel.PackageJobVerifying, localappkernel.PackageJobStaging, localappkernel.PackageJobCommitting} {
		job, err = store.Advance(ctx, job.JobID, job.Phase, phase, localappkernel.PackageJobProgress{})
		if err != nil {
			t.Fatal(err)
		}
	}
	appRoot := filepath.Join(kernel.DataRoot(), "test-release")
	committed, err := store.CommitPackageRelease(ctx, localappkernel.CommitPackageReleaseInput{JobID: job.JobID, Version: info.Version, AppInfoJSON: raw, Registration: localappkernel.RegisterInstalledInput{
		AppID: info.AppID, DisplayName: info.DisplayName, SourceClass: localappkernel.SourceClassUserImported, SourceRef: "local-package-app:v1:test.info", ProjectRoot: appRoot, ManifestPath: filepath.Join(appRoot, "nimi.app.yaml"), RawDeclaration: []string{}, ImmutableLineageID: job.TargetRef, ProvenanceRevision: 1, ExecutionProfileRef: "macos-current-user-v1", HostExecutableDigest: "host:test", PayloadRootDigest: "payload:test",
	}})
	if err != nil {
		t.Fatal(err)
	}
	req := &runtimev1.GetAppPackageInfoRequest{LaunchSelector: []byte(committed.Registration.RegistrationHandle), InstalledReleaseRef: committed.Release.ReleaseRef}
	response, err := service.GetAppPackageInfo(ctx, req)
	if err != nil || response.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || !reflect.DeepEqual(response.Info, appPackageInfoProjection(info)) {
		t.Fatalf("stored info projection: %+v %v", response, err)
	}
	req.InstalledReleaseRef = "old-release"
	_, err = service.GetAppPackageInfo(ctx, req)
	assertPackageHandlerReason(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INFO_UNAVAILABLE)
}
