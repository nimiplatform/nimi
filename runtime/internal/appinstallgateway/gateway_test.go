package appinstallgateway

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
)

type downloaderFunc func(context.Context, appreleasecatalog.Descriptor) ([]byte, error)

func (fn downloaderFunc) Download(ctx context.Context, descriptor appreleasecatalog.Descriptor) ([]byte, error) {
	return fn(ctx, descriptor)
}

type recordingUnpacker struct {
	called bool
	plan   appstorage.Plan
}

func (u *recordingUnpacker) Unpack(_ context.Context, artifact VerifiedArtifact, plan appstorage.Plan) error {
	u.called = true
	u.plan = plan
	return os.WriteFile(filepath.Join(plan.ReleaseRoot, "package.bin"), artifact.Payload, 0o600)
}

type recordingPlanner struct {
	dataRoot string
	called   bool
}

func (p *recordingPlanner) Plan(_ context.Context, descriptor appreleasecatalog.Descriptor) (appstorage.Plan, error) {
	p.called = true
	return appstorage.Resolve(p.dataRoot, descriptor.AppID, descriptor.Version, descriptor.StoragePolicyRef)
}

type fileEvidenceWriter struct{}

func (fileEvidenceWriter) WriteInstallEvidence(
	ctx context.Context,
	plan appstorage.Plan,
	descriptor appreleasecatalog.Descriptor,
	artifact VerifiedArtifact,
	verificationState VerificationState,
) (appstorage.InstallEvidence, error) {
	return FileEvidenceWriter{}.WriteInstallEvidence(ctx, plan, descriptor, artifact, verificationState)
}

type recordingReleaseRemover struct {
	called bool
}

func (r *recordingReleaseRemover) Uninstall(_ context.Context, plan appstorage.Plan, options appstorage.UninstallOptions) error {
	r.called = true
	return appstorage.Uninstall(plan, options)
}

func testGateway(t *testing.T, payload []byte, unpacker *recordingUnpacker) (*Gateway, *recordingPlanner) {
	t.Helper()
	planner := &recordingPlanner{dataRoot: t.TempDir()}
	gateway := New(downloaderFunc(func(context.Context, appreleasecatalog.Descriptor) ([]byte, error) {
		return payload, nil
	}), unpacker, WithStoragePlanner(planner), WithEvidenceWriter(fileEvidenceWriter{}))
	return gateway, planner
}

func TestGatewayInstallRequiresStoragePlannerAfterDigestVerification(t *testing.T) {
	payload := []byte("nimi app package")
	descriptor := externalDescriptor(payload)
	unpacker := &recordingUnpacker{}
	gateway := New(downloaderFunc(func(context.Context, appreleasecatalog.Descriptor) ([]byte, error) {
		return payload, nil
	}), unpacker)

	_, err := gateway.Install(context.Background(), descriptor)
	if !errors.Is(err, ErrStoragePlannerRequired) {
		t.Fatalf("Install error = %v, want ErrStoragePlannerRequired", err)
	}
	if unpacker.called {
		t.Fatal("unpacker must not run without storage plan")
	}
}

func TestGatewayInstallRequiresEvidenceWriterAfterUnpack(t *testing.T) {
	payload := []byte("nimi app package")
	descriptor := externalDescriptor(payload)
	unpacker := &recordingUnpacker{}
	planner := &recordingPlanner{dataRoot: t.TempDir()}
	gateway := New(downloaderFunc(func(context.Context, appreleasecatalog.Descriptor) ([]byte, error) {
		return payload, nil
	}), unpacker, WithStoragePlanner(planner))

	_, err := gateway.Install(context.Background(), descriptor)
	if !errors.Is(err, ErrEvidenceWriterRequired) {
		t.Fatalf("Install error = %v, want ErrEvidenceWriterRequired", err)
	}
	if !unpacker.called {
		t.Fatal("unpacker should run before missing evidence writer is reported")
	}
}

func TestGatewayUninstallRemovesReleaseAndPreservesDurableData(t *testing.T) {
	payload := []byte("nimi app package")
	descriptor := externalDescriptor(payload)
	unpacker := &recordingUnpacker{}
	gateway, _ := testGateway(t, payload, unpacker)

	installed, err := gateway.Install(context.Background(), descriptor)
	if err != nil {
		t.Fatalf("Install: %v", err)
	}
	durableFile := filepath.Join(installed.Plan.DurableDataRoot, "user.db")
	if err := os.WriteFile(durableFile, []byte("durable"), 0o600); err != nil {
		t.Fatalf("write durable data: %v", err)
	}
	if err := gateway.Uninstall(context.Background(), installed.Plan, appstorage.UninstallOptions{}); err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	if _, err := os.Stat(installed.Plan.ReleaseRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("release root stat error = %v, want not exist", err)
	}
	if _, err := os.Stat(durableFile); err != nil {
		t.Fatalf("durable data should remain: %v", err)
	}
}

func TestGatewayUninstallRejectsImplicitDurableDataDelete(t *testing.T) {
	descriptor := externalDescriptor([]byte("nimi app package"))
	plan, err := appstorage.Resolve(t.TempDir(), descriptor.AppID, descriptor.Version, descriptor.StoragePolicyRef)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	gateway := New(nil, nil)

	err = gateway.Uninstall(context.Background(), plan, appstorage.UninstallOptions{DeleteDurableData: true})
	if !errors.Is(err, appstorage.ErrDestructiveDeleteConfirmation) {
		t.Fatalf("Uninstall error = %v, want destructive confirmation", err)
	}
}

func (u *recordingUnpacker) reset() {
	u.called = false
	u.plan = appstorage.Plan{}
}

func (u *recordingUnpacker) assertPlan(t *testing.T, descriptor appreleasecatalog.Descriptor) {
	t.Helper()
	if u.plan.AppID != descriptor.AppID || u.plan.Version != descriptor.Version {
		t.Fatalf("unpack plan = %+v, descriptor = %+v", u.plan, descriptor)
	}
	if u.plan.ReleaseRoot == "" || u.plan.DurableDataRoot == "" || u.plan.CacheRoot == "" || u.plan.TempRoot == "" {
		t.Fatalf("unpack plan missing roots: %+v", u.plan)
	}
	if _, err := os.Stat(filepath.Join(u.plan.ReleaseRoot, "package.bin")); err != nil {
		t.Fatalf("unpacked payload missing: %v", err)
	}
}

func (r *recordingReleaseRemover) reset() {
	r.called = false
}

func noopMaterialize(appstorage.Plan) error {
	return nil
}

func TestGatewayInstallVerifiesDigestBeforeUnpack(t *testing.T) {
	payload := []byte("nimi app package")
	descriptor := externalDescriptor(payload)
	unpacker := &recordingUnpacker{}
	planner := &recordingPlanner{dataRoot: t.TempDir()}
	gateway := New(downloaderFunc(func(_ context.Context, got appreleasecatalog.Descriptor) ([]byte, error) {
		if got.DescriptorID != descriptor.DescriptorID {
			t.Fatalf("download descriptor = %q, want %q", got.DescriptorID, descriptor.DescriptorID)
		}
		return payload, nil
	}), unpacker, WithStoragePlanner(planner), WithEvidenceWriter(fileEvidenceWriter{}))

	installed, err := gateway.Install(context.Background(), descriptor)
	if err != nil {
		t.Fatalf("Install: %v", err)
	}
	if !planner.called {
		t.Fatal("expected storage planner to run after digest verification")
	}
	if !unpacker.called {
		t.Fatal("expected unpacker to run after digest verification")
	}
	unpacker.assertPlan(t, descriptor)
	if installed.Artifact.SHA256 != descriptor.Artifact.SHA256 {
		t.Fatalf("artifact SHA256 = %q, want %q", installed.Artifact.SHA256, descriptor.Artifact.SHA256)
	}
	if installed.Evidence.VerificationState != "digest-verified" || installed.Evidence.ReleaseRoot != installed.Plan.ReleaseRoot {
		t.Fatalf("install evidence = %+v, plan = %+v", installed.Evidence, installed.Plan)
	}
}

func TestGatewayDigestMismatchFailsBeforeUnpack(t *testing.T) {
	descriptor := externalDescriptor([]byte("expected"))
	unpacker := &recordingUnpacker{}
	planner := &recordingPlanner{dataRoot: t.TempDir()}
	gateway := New(downloaderFunc(func(context.Context, appreleasecatalog.Descriptor) ([]byte, error) {
		return []byte("tampered"), nil
	}), unpacker, WithStoragePlanner(planner), WithEvidenceWriter(fileEvidenceWriter{}))

	_, err := gateway.Install(context.Background(), descriptor)
	if err == nil {
		t.Fatal("expected digest mismatch")
	}
	if !errors.Is(err, ErrDigestMismatch) {
		t.Fatalf("error = %v, want ErrDigestMismatch", err)
	}
	if unpacker.called {
		t.Fatal("unpacker must not run after digest mismatch")
	}
	if planner.called {
		t.Fatal("storage planner must not run after digest mismatch")
	}
}

func TestGatewayRejectsMutableSourceBeforeDownload(t *testing.T) {
	descriptor := externalDescriptor([]byte("payload"))
	descriptor.Source.Ref = "latest"
	downloadCalled := false
	gateway := New(downloaderFunc(func(context.Context, appreleasecatalog.Descriptor) ([]byte, error) {
		downloadCalled = true
		return []byte("payload"), nil
	}), &recordingUnpacker{}, WithStoragePlanner(&recordingPlanner{dataRoot: t.TempDir()}), WithEvidenceWriter(fileEvidenceWriter{}))

	_, err := gateway.Install(context.Background(), descriptor)
	if err == nil {
		t.Fatal("expected mutable source rejection")
	}
	if downloadCalled {
		t.Fatal("download must not run for mutable source descriptor")
	}
}

func TestGatewayRejectsBundledDescriptorAsExternalInstall(t *testing.T) {
	descriptor := externalDescriptor([]byte("payload"))
	descriptor.DescriptorClass = appreleasecatalog.DescriptorClassBundledWithNimi
	descriptor.Source.Kind = appreleasecatalog.SourceKindNimiBundle
	descriptor.Source.Ref = "current-atomic-nimi-release"
	downloadCalled := false
	gateway := New(downloaderFunc(func(context.Context, appreleasecatalog.Descriptor) ([]byte, error) {
		downloadCalled = true
		return []byte("payload"), nil
	}), &recordingUnpacker{}, WithStoragePlanner(&recordingPlanner{dataRoot: t.TempDir()}), WithEvidenceWriter(fileEvidenceWriter{}))

	_, err := gateway.Install(context.Background(), descriptor)
	if err == nil {
		t.Fatal("expected bundled descriptor rejection without a bundled source")
	}
	if !errors.Is(err, ErrBundledSourceRequired) {
		t.Fatalf("error = %v, want ErrBundledSourceRequired", err)
	}
	if downloadCalled {
		t.Fatal("bundled descriptor must not invoke external downloader")
	}
}

func TestGatewaySizeMismatchFailsBeforeUnpack(t *testing.T) {
	descriptor := externalDescriptor([]byte("payload"))
	descriptor.Artifact.Size = "999"
	unpacker := &recordingUnpacker{}
	planner := &recordingPlanner{dataRoot: t.TempDir()}
	gateway := New(downloaderFunc(func(context.Context, appreleasecatalog.Descriptor) ([]byte, error) {
		return []byte("payload"), nil
	}), unpacker, WithStoragePlanner(planner), WithEvidenceWriter(fileEvidenceWriter{}))

	_, err := gateway.Install(context.Background(), descriptor)
	if err == nil {
		t.Fatal("expected size mismatch")
	}
	if !errors.Is(err, ErrSizeMismatch) {
		t.Fatalf("error = %v, want ErrSizeMismatch", err)
	}
	if unpacker.called {
		t.Fatal("unpacker must not run after size mismatch")
	}
	if planner.called {
		t.Fatal("storage planner must not run after size mismatch")
	}
}

func externalDescriptor(payload []byte) appreleasecatalog.Descriptor {
	sum := sha256.Sum256(payload)
	return appreleasecatalog.Descriptor{
		DescriptorID:    "community.clock.v1",
		AppID:           "community.clock",
		Version:         "1.0.0",
		DescriptorClass: appreleasecatalog.DescriptorClassExternalImmutableArtifact,
		Source: appreleasecatalog.Source{
			Kind: appreleasecatalog.SourceKindGitHubRelease,
			Ref:  "github.com/example/clock/releases/download/v1.0.0/clock.tgz",
		},
		Artifact: appreleasecatalog.Artifact{
			Locator:                  "github-release-asset:clock.tgz",
			DigestAlgorithm:          "sha256",
			SHA256:                   hex.EncodeToString(sum[:]),
			Size:                     "16",
			SignatureOrProvenanceRef: "community-review-record",
		},
		Runtime: appreleasecatalog.Runtime{
			PackageKind: "nimi-app",
			EntryRef:    "clock-runtime-registration",
			SandboxRef:  "third-party-app-sandbox",
		},
		PermissionsRef:   "community.clock.permission_scope_ref",
		StoragePolicyRef: "nimi-data-app-roots",
		Review: appreleasecatalog.Review{
			AdmissionPath:                     "third-party-pr-reviewed-release",
			MutableSourceAllowed:              false,
			InstallDigestVerificationRequired: "sha256_must_match_descriptor",
		},
		SourceRule: "P-NAPP-014",
	}
}

// externalDescriptorVersion builds an external-immutable-artifact descriptor
// for community.clock at an explicit version with a payload of any size.
func externalDescriptorVersion(version string, payload []byte) appreleasecatalog.Descriptor {
	sum := sha256.Sum256(payload)
	d := externalDescriptor(payload)
	d.DescriptorID = "community.clock." + version
	d.Version = version
	d.Artifact.SHA256 = hex.EncodeToString(sum[:])
	d.Artifact.Size = strconvItoa(len(payload))
	return d
}

func strconvItoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}

func TestGatewayUpdateAtomicSwapKeepsDurableData(t *testing.T) {
	dataRoot := t.TempDir()
	v1 := []byte("clock release v1")
	v2 := []byte("clock release v2 payload")

	gateway := New(downloaderFunc(func(_ context.Context, d appreleasecatalog.Descriptor) ([]byte, error) {
		if d.Version == "1.0.0" {
			return v1, nil
		}
		return v2, nil
	}), &recordingUnpacker{}, WithStoragePlanner(&recordingPlanner{dataRoot: dataRoot}), WithEvidenceWriter(fileEvidenceWriter{}))

	// Install v1.
	installed, err := gateway.Install(context.Background(), externalDescriptorVersion("1.0.0", v1))
	if err != nil {
		t.Fatalf("install v1: %v", err)
	}
	// Write durable data that an update must preserve.
	durableFile := filepath.Join(installed.Plan.DurableDataRoot, "user-state.json")
	if err := os.WriteFile(durableFile, []byte(`{"k":"v"}`), 0o600); err != nil {
		t.Fatalf("write durable data: %v", err)
	}
	pointerBefore, err := appstorage.ReadActiveRelease(installed.Plan)
	if err != nil {
		t.Fatalf("read active release after install: %v", err)
	}
	if pointerBefore.ActiveVersion != "1.0.0" {
		t.Fatalf("active version = %q, want 1.0.0", pointerBefore.ActiveVersion)
	}

	// Update to v2.
	updated, err := gateway.UpdateApp(context.Background(), externalDescriptorVersion("2.0.0", v2), nil)
	if err != nil {
		t.Fatalf("update to v2: %v", err)
	}
	if updated.Artifact.Version != "2.0.0" {
		t.Fatalf("updated version = %q, want 2.0.0", updated.Artifact.Version)
	}
	pointerAfter, err := appstorage.ReadActiveRelease(updated.Plan)
	if err != nil {
		t.Fatalf("read active release after update: %v", err)
	}
	if pointerAfter.ActiveVersion != "2.0.0" {
		t.Fatalf("active version after update = %q, want 2.0.0", pointerAfter.ActiveVersion)
	}
	// Durable data must survive the update.
	if _, err := os.Stat(durableFile); err != nil {
		t.Fatalf("durable data must survive update: %v", err)
	}
	// Old release must still exist on disk (atomic swap, no destruction).
	if _, err := os.Stat(installed.Plan.ReleaseRoot); err != nil {
		t.Fatalf("old release should remain usable after update: %v", err)
	}
}

func TestGatewayUpdateFailureKeepsOldReleaseUsable(t *testing.T) {
	dataRoot := t.TempDir()
	v1 := []byte("clock release v1")
	v2 := []byte("clock release v2 payload")

	gateway := New(downloaderFunc(func(_ context.Context, d appreleasecatalog.Descriptor) ([]byte, error) {
		if d.Version == "1.0.0" {
			return v1, nil
		}
		// Return bytes that do not match the v2 descriptor digest.
		return []byte("corrupted update bytes"), nil
	}), &recordingUnpacker{}, WithStoragePlanner(&recordingPlanner{dataRoot: dataRoot}), WithEvidenceWriter(fileEvidenceWriter{}))

	installed, err := gateway.Install(context.Background(), externalDescriptorVersion("1.0.0", v1))
	if err != nil {
		t.Fatalf("install v1: %v", err)
	}

	_, err = gateway.UpdateApp(context.Background(), externalDescriptorVersion("2.0.0", v2), nil)
	if !errors.Is(err, ErrDigestMismatch) {
		t.Fatalf("update error = %v, want ErrDigestMismatch", err)
	}
	// The active release pointer must still point at v1.
	pointer, err := appstorage.ReadActiveRelease(installed.Plan)
	if err != nil {
		t.Fatalf("read active release: %v", err)
	}
	if pointer.ActiveVersion != "1.0.0" {
		t.Fatalf("failed update must not advance active version, got %q", pointer.ActiveVersion)
	}
	if _, err := os.Stat(installed.Plan.ReleaseRoot); err != nil {
		t.Fatalf("old release must remain usable after failed update: %v", err)
	}
}

func TestGatewayRepairRematerializesReleaseKeepsData(t *testing.T) {
	dataRoot := t.TempDir()
	payload := []byte("clock release payload")

	gateway := New(downloaderFunc(func(context.Context, appreleasecatalog.Descriptor) ([]byte, error) {
		return payload, nil
	}), &recordingUnpacker{}, WithStoragePlanner(&recordingPlanner{dataRoot: dataRoot}), WithEvidenceWriter(fileEvidenceWriter{}))

	installed, err := gateway.Install(context.Background(), externalDescriptorVersion("1.0.0", payload))
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	durableFile := filepath.Join(installed.Plan.DurableDataRoot, "user-state.json")
	if err := os.WriteFile(durableFile, []byte(`{"k":"v"}`), 0o600); err != nil {
		t.Fatalf("write durable data: %v", err)
	}
	// Damage the release payload.
	if err := os.WriteFile(filepath.Join(installed.Plan.ReleaseRoot, "package.bin"), []byte("damaged"), 0o600); err != nil {
		t.Fatalf("damage release: %v", err)
	}

	repaired, err := gateway.RepairApp(context.Background(), externalDescriptorVersion("1.0.0", payload), nil)
	if err != nil {
		t.Fatalf("repair: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(repaired.Plan.ReleaseRoot, "package.bin"))
	if err != nil {
		t.Fatalf("read repaired payload: %v", err)
	}
	if string(got) != string(payload) {
		t.Fatalf("repair must re-materialize a clean release payload")
	}
	if _, err := os.Stat(durableFile); err != nil {
		t.Fatalf("repair must keep durable data: %v", err)
	}
}
