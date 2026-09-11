//go:build darwin && arm64

package nimiappinstall

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
)

func TestLocalPackageCommitsPrivateCopyUpdatesAndRevalidatesInstalledLaunch(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(uint32(os.Getuid()), 42)
	if err != nil {
		t.Fatal(err)
	}
	database, err := localappkernel.CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, database, identity, localappkernel.Options{HostInstallID: "local-import-test", DataRoot: root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	owner, err := openPackageOwner(kernel)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = owner.Close() })

	install := func(version string, previous *localappkernel.CommittedRelease) localappkernel.CommittedRelease {
		t.Helper()
		selected := realLocalDarwinPackage(t, version)
		preview, err := owner.PrepareLocalPackage(ctx, selected)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(selected); err != nil {
			t.Fatal(err)
		}
		handle, installedVersion := "", ""
		var stopped func(string) error
		if previous != nil {
			handle, installedVersion = previous.RegistrationHandle, previous.Version
			stopped = func(value string) error {
				if value != handle {
					t.Fatalf("wrong stop selector: %s", value)
				}
				return nil // No Host process is launched in this test.
			}
		}
		job, err := owner.StartLocalPackage(ctx, preview.Selector, handle, installedVersion, stopped)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := owner.StartLocalPackage(ctx, preview.Selector, handle, installedVersion, stopped); !errors.Is(err, ErrLocalCandidate) {
			t.Fatalf("candidate reused: %v", err)
		}
		if _, err := os.Stat(filepath.Join(root, "apps/packages/work/candidate-"+preview.Selector)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("candidate directory retained: %v", err)
		}
		owner.workersMu.Lock()
		worker := owner.workers[job.JobID]
		owner.workersMu.Unlock()
		if worker != nil {
			select {
			case <-worker.done:
			case <-time.After(15 * time.Second):
				t.Fatal("local import did not complete")
			}
		}
		finished, err := owner.lifecycle.GetJob(ctx, job.JobID)
		if err != nil || finished.Phase != localappkernel.PackageJobCompleted {
			t.Fatalf("local import failed: %+v %v", finished, err)
		}
		release, err := owner.lifecycle.GetCommittedRelease(ctx, preview.Metadata.Expected.AppID, localappkernel.SourceClassUserImported)
		if err != nil || release.Version != version {
			t.Fatalf("committed release: %+v %v", release, err)
		}
		raw, err := owner.lifecycle.ReadAppInfo(ctx, release.RegistrationHandle, release.ReleaseRef)
		if err != nil {
			t.Fatal(err)
		}
		info, err := nimiapppackage.ParseAppInfo(raw)
		if err != nil || info.Version != version {
			t.Fatalf("offline info: %+v %v", info, err)
		}
		called := false
		if err := owner.WithInstalledLaunch(ctx, release.RegistrationHandle, func(launch InstalledLaunch) error {
			called = true
			if launch.Release.Version != version || launch.Registration.SourceClass != localappkernel.SourceClassUserImported {
				t.Fatalf("wrong launch source: %+v", launch)
			}
			return nil
		}); err != nil || !called {
			t.Fatalf("installed launch verification: %v", err)
		}
		return release
	}
	first := install("1.0.0", nil)
	second := install("1.1.0", &first)
	if _, err := owner.lifecycle.ReadAppInfo(ctx, first.RegistrationHandle, first.ReleaseRef); !errors.Is(err, localappkernel.ErrCommittedReleaseNotFound) {
		t.Fatalf("old information selector remained valid: %v", err)
	}
	registration, err := kernel.Registrations().GetByHandle(ctx, second.RegistrationHandle)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(registration.ProjectRoot, "payload/Example.app/Contents/Resources/text.txt"), []byte("tampered"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := owner.WithInstalledLaunch(ctx, second.RegistrationHandle, func(InstalledLaunch) error { t.Fatal("tampered package reached launch binding"); return nil }); err == nil {
		t.Fatal("tampered installed package accepted")
	}
}

// The fixture contains a real arm64 executable and ad-hoc signature. Native
// inspection runs normally; this does not launch an App or create a Registry.
func realLocalDarwinPackage(t *testing.T, version string) string {
	t.Helper()
	root := t.TempDir()
	bundle := filepath.Join(root, "Example.app")
	contents := filepath.Join(bundle, "Contents")
	for _, name := range []string{"MacOS", "Resources"} {
		if err := os.MkdirAll(filepath.Join(contents, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	write := func(name string, raw []byte) {
		t.Helper()
		if err := os.WriteFile(name, raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	binary := filepath.Join(contents, "MacOS/example")
	write(filepath.Join(root, "main.c"), []byte("int main(void) { return 0; }\n"))
	write(filepath.Join(contents, "Info.plist"), []byte(`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>test.nimi.imported</string><key>CFBundleExecutable</key><string>example</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`))
	write(filepath.Join(contents, "Resources/text.txt"), []byte(version))
	for _, command := range [][]string{{"/usr/bin/xcrun", "clang", "-arch", "arm64", filepath.Join(root, "main.c"), "-o", binary}, {"/usr/bin/codesign", "--force", "--sign", "-", bundle}} {
		if output, err := exec.Command(command[0], command[1:]...).CombinedOutput(); err != nil {
			t.Fatalf("native fixture: %v: %s", err, output)
		}
	}
	art := image.NewNRGBA(image.Rect(0, 0, 128, 128))
	draw.Draw(art, art.Bounds(), image.NewUniform(color.NRGBA{R: 30, G: 170, B: 150, A: 255}), image.Point{}, draw.Src)
	var icon bytes.Buffer
	if err := png.Encode(&icon, art); err != nil {
		t.Fatal(err)
	}
	info := nimiapppackage.AppInfo{Format: "nimi.app-info/v1", AppID: "test.imported", Version: version, TargetID: "macos-aarch64", DisplayName: "Local example", Summary: "Local import fixture",
		Icon: nimiapppackage.AppInfoIcon{MediaType: "image/png", DataBase64: base64.StdEncoding.EncodeToString(icon.Bytes())}, License: nimiapppackage.AppInfoLicense{Identifier: "MIT", Text: "MIT\n"},
		AppAccess: []string{}, CapabilityContractRefs: []string{}, RequiredStandardizedFeatureRefs: []string{}, StoragePolicy: nimiapppackage.AppInfoStoragePolicy{Kind: "nimi-mediated-default"}}
	marshal := func(value any) []byte {
		t.Helper()
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	type entry struct {
		name string
		data []byte
		mode uint32
	}
	entries := []entry{
		{"LICENSE", []byte("MIT\n"), 0o644}, {"app-info.json", marshal(info), 0o644},
		{"nimi.app.yaml", []byte("app_id: test.imported\nversion: " + version + "\ndisplay_name: Local example\napp_access: []\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy: {kind: nimi-mediated-default}\n"), 0o644},
		{"manifest.json", marshal(map[string]any{"format": "nimi.app-package/v2", "app_id": info.AppID, "version": version, "target_id": info.TargetID, "os": "macos", "arch": "arm64", "runtime_entry": "payload/Example.app/Contents/MacOS/example",
			"native_trust": map[string]any{"posture": "production-unsigned", "macos_developer_id": "absent", "macos_notarization": "absent", "certificate_subject": nil}, "execution_profile": map[string]any{"launch_mode": "current-user"}}), 0o644},
	}
	err := filepath.WalkDir(bundle, func(name string, item os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if item.IsDir() {
			return nil
		}
		raw, err := os.ReadFile(name)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, name)
		if err != nil {
			return err
		}
		mode := uint32(0o644)
		if name == binary {
			mode = 0o755
		}
		entries = append(entries, entry{"payload/" + filepath.ToSlash(relative), raw, mode})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Slice(entries, func(i, j int) bool { return strings.Compare(entries[i].name, entries[j].name) < 0 })
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for _, item := range entries {
		header := &zip.FileHeader{Name: item.name, Method: zip.Store, Flags: 0x0800, CreatorVersion: 0x0314, ReaderVersion: 20,
			CRC32: crc32.ChecksumIEEE(item.data), CompressedSize: uint32(len(item.data)), UncompressedSize: uint32(len(item.data)),
			CompressedSize64: uint64(len(item.data)), UncompressedSize64: uint64(len(item.data)), ExternalAttrs: (0o100000 | item.mode) << 16}
		out, err := writer.CreateRaw(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := out.Write(item.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "local.nimiapp")
	write(file, archive.Bytes())
	return file
}
