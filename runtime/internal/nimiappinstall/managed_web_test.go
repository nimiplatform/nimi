package nimiappinstall

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

func buildManagedWebTestArchive(t *testing.T, version string) string {
	t.Helper()
	icon := image.NewNRGBA(image.Rect(0, 0, 128, 128))
	icon.Set(64, 64, color.NRGBA{R: 35, G: 165, B: 220, A: 255})
	var iconBytes bytes.Buffer
	if err := png.Encode(&iconBytes, icon); err != nil {
		t.Fatal(err)
	}
	manifest, err := json.Marshal(map[string]any{
		"format":        "nimi.app-package/v2",
		"app_id":        "publisher.managed-demo",
		"version":       version,
		"target_id":     nimiapppackage.ManagedWebTargetID,
		"os":            "any",
		"arch":          "any",
		"runtime_entry": nimiapppackage.ManagedWebRuntimeEntry,
		"native_trust": map[string]any{
			"posture":             "nimi-managed-carrier",
			"certificate_subject": nil,
		},
		"execution_profile": map[string]any{
			"launch_mode": nimiapppackage.ManagedWebExecutionProfileRef,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	appInfo, err := json.Marshal(map[string]any{
		"format":                             "nimi.app-info/v1",
		"app_id":                             "publisher.managed-demo",
		"version":                            version,
		"target_id":                          nimiapppackage.ManagedWebTargetID,
		"display_name":                       "Managed Demo",
		"summary":                            "Managed web test app.",
		"icon":                               map[string]any{"media_type": "image/png", "data_base64": base64.StdEncoding.EncodeToString(iconBytes.Bytes())},
		"readme_markdown":                    "Use managed demo.",
		"release_notes_markdown":             "Release " + version,
		"license":                            map[string]any{"identifier": "MIT", "text": "MIT\n"},
		"app_access":                         []string{"runtime.consume"},
		"capability_contract_refs":           []string{},
		"required_standardized_feature_refs": []string{},
		"storage_policy":                     map[string]any{"kind": "nimi-mediated-default"},
	})
	if err != nil {
		t.Fatal(err)
	}
	declaration := []byte(
		"app_id: publisher.managed-demo\n" +
			"version: " + version + "\n" +
			"display_name: Managed Demo\n" +
			"capability_contract_refs: []\n" +
			"required_standardized_feature_refs: []\n" +
			"storage_policy: { kind: nimi-mediated-default }\n" +
			"app_access:\n  - runtime.consume\n" +
			"desktop:\n  window:\n    width: 1320\n    height: 900\n    min_width: 390\n    min_height: 620\n    title_bar_style: hidden\n",
	)
	entries := []struct {
		name string
		data []byte
	}{
		{"LICENSE", []byte("MIT\n")},
		{"app-info.json", appInfo},
		{"manifest.json", manifest},
		{"nimi.app.yaml", declaration},
		{"payload/assets/app.js", []byte("console.log('ok');\n")},
		{nimiapppackage.ManagedWebRuntimeEntry, []byte("<!doctype html><html><body>managed</body></html>")},
	}
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, entry := range entries {
		header := &zip.FileHeader{
			Name:             entry.name,
			Method:           zip.Store,
			Flags:            0x800,
			CreatorVersion:   (3 << 8) | 20,
			ReaderVersion:    20,
			CRC32:            crc32.ChecksumIEEE(entry.data),
			CompressedSize:   uint32(len(entry.data)),
			UncompressedSize: uint32(len(entry.data)),
			CompressedSize64: uint64(len(entry.data)),
			UncompressedSize64: uint64(len(entry.data)),
			ExternalAttrs:    (0o100644) << 16,
		}
		w, err := writer.CreateRaw(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "managed-demo-"+version+".nimiapp")
	if err := os.WriteFile(path, output.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestManagedWebLocalImportAndCarrierCohortUpgradeSurvival(t *testing.T) {
	if _, _, _, err := publicappregistry.CurrentPlatformTarget(); err != nil {
		t.Skip("requires admitted desktop platform")
	}
	ctx := context.Background()
	root := t.TempDir()
	identity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	dbPath, err := localappkernel.CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, dbPath, identity, localappkernel.Options{
		HostInstallID: "managed-web-cohort-test", DataRoot: root,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = kernel.Close() }()

	coordinator, err := openPackageOwner(kernel)
	if err != nil {
		t.Fatal(err)
	}
	coordinator.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	coordinator.audit = auditlog.New(64, 16)
	defer func() { _ = coordinator.Close() }()

	archivePath := buildManagedWebTestArchive(t, "0.1.12")
	preview, err := coordinator.PrepareLocalPackage(ctx, archivePath)
	if err != nil {
		t.Fatalf("PrepareLocalPackage managed-web: %v", err)
	}
	if preview.Metadata.Expected.OS != "any" || preview.Metadata.Expected.Arch != "any" ||
		preview.Metadata.Expected.TargetID != nimiapppackage.ManagedWebTargetID ||
		preview.Metadata.Expected.ExecutionProfileRef != nimiapppackage.ManagedWebExecutionProfileRef {
		t.Fatalf("unexpected local preview expected: %+v", preview.Metadata.Expected)
	}
	job, err := coordinator.StartLocalPackage(ctx, preview.Selector, "", "", nil)
	if err != nil {
		t.Fatalf("StartLocalPackage: %v", err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		current, err := coordinator.GetJob(ctx, job.JobID)
		if err != nil {
			t.Fatal(err)
		}
		if current.Phase == localappkernel.PackageJobCompleted {
			break
		}
		if current.Phase == localappkernel.PackageJobFailed {
			t.Fatalf("managed-web local install failed: %s", current.ReasonCode)
		}
		time.Sleep(15 * time.Millisecond)
	}
	release, err := kernel.PackageLifecycle().GetCommittedRelease(ctx, "publisher.managed-demo", localappkernel.SourceClassUserImported)
	if err != nil {
		t.Fatalf("GetCommittedRelease: %v", err)
	}
	originalHostDigest := release.HostExecutableDigest

	// Cohort 1: verify PrepareInstalledLaunch resolves Nimi carrier v1.
	var digestV1 protectedlocal.Identifier
	digestV1[0] = 0x11
	carrierV1 := protectedlocal.ManagedWebCarrier{
		ExecutablePath:   filepath.Join(root, "Product", "0.3.0", "NimiAppHost.exe"),
		ExecutableDigest: digestV1,
	}
	coordinator.SetManagedWebCarrierResolver(protectedlocal.ManagedWebCarrierResolverFunc(func(context.Context) (protectedlocal.ManagedWebCarrier, error) {
		return carrierV1, nil
	}))
	var launchV1 InstalledLaunch
	if err := coordinator.PrepareInstalledLaunch(ctx, release.RegistrationHandle, func(l InstalledLaunch) error {
		launchV1 = l
		return nil
	}); err != nil {
		t.Fatalf("PrepareInstalledLaunch cohort 1: %v", err)
	}
	if launchV1.CarrierExecutablePath != carrierV1.ExecutablePath || launchV1.CarrierExecutableDigest != digestV1 ||
		launchV1.WorkingDirectory != launchV1.Registration.ProjectRoot ||
		len(launchV1.Arguments) != 2 || launchV1.Arguments[0] != protectedlocal.ManagedWebLaunchArgument ||
		!strings.HasPrefix(launchV1.Arguments[1], protectedlocal.ManagedWebPayloadDigestArgPrefix+release.PayloadRootDigest) {
		t.Fatalf("unexpected cohort 1 launch: %+v", launchV1)
	}

	// Cohort 2: simulate Nimi upgrade without re-installing the App or touching SQLite!
	var digestV2 protectedlocal.Identifier
	digestV2[0] = 0x22
	carrierV2 := protectedlocal.ManagedWebCarrier{
		ExecutablePath:   filepath.Join(root, "Product", "0.4.0", "NimiAppHost.exe"),
		ExecutableDigest: digestV2,
	}
	coordinator.SetManagedWebCarrierResolver(protectedlocal.ManagedWebCarrierResolverFunc(func(context.Context) (protectedlocal.ManagedWebCarrier, error) {
		return carrierV2, nil
	}))
	var launchV2 InstalledLaunch
	if err := coordinator.WithInstalledLaunch(ctx, release.RegistrationHandle, func(l InstalledLaunch) error {
		launchV2 = l
		return nil
	}); err != nil {
		t.Fatalf("WithInstalledLaunch cohort 2 after Nimi upgrade: %v", err)
	}
	if launchV2.CarrierExecutablePath != carrierV2.ExecutablePath || launchV2.CarrierExecutableDigest != digestV2 {
		t.Fatalf("cohort 2 did not bind new carrier: %+v", launchV2)
	}
	if launchV2.Release.HostExecutableDigest != originalHostDigest {
		t.Fatalf("persisted HostExecutableDigest mutated across Nimi upgrade")
	}
}
