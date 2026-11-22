package nimiapppackage

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func managedWebManifest() Manifest {
	return Manifest{
		Format:       packageFormat,
		AppID:        "publisher.example-app",
		Version:      "1.2.3",
		TargetID:     ManagedWebTargetID,
		OS:           "any",
		Arch:         "any",
		RuntimeEntry: ManagedWebRuntimeEntry,
		NativeTrust: ManifestNativeTrust{
			Posture:            "nimi-managed-carrier",
			CertificateSubject: json.RawMessage("null"),
		},
		ExecutionProfile: &ManifestExecutionProfile{
			LaunchMode: ManagedWebExecutionProfileRef,
		},
	}
}

func managedWebArchiveEntries(t *testing.T, extraEntries ...archiveFixtureEntry) []archiveFixtureEntry {
	t.Helper()
	info := testAppInfo(t)
	info.TargetID = ManagedWebTargetID
	declaration := []byte(
		"app_id: publisher.example-app\n" +
			"version: 1.2.3\n" +
			"display_name: Example App\n" +
			"capability_contract_refs: []\n" +
			"required_standardized_feature_refs: []\n" +
			"storage_policy: { kind: nimi-mediated-default }\n" +
			"app_access:\n  - runtime.consume\n" +
			"desktop:\n  window:\n    width: 1320\n    height: 900\n    min_width: 390\n    min_height: 620\n    title_bar_style: hidden\n",
	)
	entries := []archiveFixtureEntry{
		canonicalFixtureEntry("LICENSE", []byte("MIT\n"), 0o644),
		canonicalFixtureEntry("manifest.json", mustJSON(t, managedWebManifest()), 0o644),
		canonicalFixtureEntry("nimi.app.yaml", declaration, 0o644),
		canonicalFixtureEntry(ManagedWebRuntimeEntry, []byte("<!doctype html><html><body>ok</body></html>"), 0o644),
		canonicalFixtureEntry("payload/assets/app.js", []byte("console.log('managed-web');\n"), 0o644),
		canonicalFixtureEntry("app-info.json", mustJSON(t, info), 0o644),
	}
	return append(entries, extraEntries...)
}

func managedWebExpected(archivePath string) Expected {
	raw, err := os.ReadFile(archivePath)
	if err != nil {
		panic(err)
	}
	digest := sha256.Sum256(raw)
	return Expected{
		ArchiveSize:         int64(len(raw)),
		ArchiveSHA256:       hex.EncodeToString(digest[:]),
		AppID:               "publisher.example-app",
		Version:             "1.2.3",
		TargetID:            ManagedWebTargetID,
		OS:                  "any",
		Arch:                "any",
		RuntimeEntry:        ManagedWebRuntimeEntry,
		AppAccess:           []string{"runtime.consume"},
		ExecutionProfileRef: ManagedWebExecutionProfileRef,
		NativeTrust: ExpectedNativeTrust{
			WindowsCodeSigning: "not-applicable",
			MacOSNotarization:  "not-applicable",
		},
	}
}

func TestManagedWebArchiveInspectLocalMaterializeAndVerify(t *testing.T) {
	archivePath, _ := writeArchiveFixture(t, managedWebArchiveEntries(t))
	expected := managedWebExpected(archivePath)

	inspected, err := Inspect(context.Background(), archivePath, expected)
	if err != nil {
		t.Fatalf("Inspect managed-web: %v", err)
	}
	if inspected.Manifest.TargetID != ManagedWebTargetID || inspected.Manifest.OS != "any" || inspected.Manifest.Arch != "any" {
		t.Fatalf("unexpected inspected manifest: %+v", inspected.Manifest)
	}

	localMeta, err := InspectLocal(context.Background(), archivePath, "windows", "x86_64")
	if err != nil {
		t.Fatalf("InspectLocal windows managed-web: %v", err)
	}
	if localMeta.Expected.OS != "any" || localMeta.Expected.Arch != "any" || localMeta.Expected.TargetID != ManagedWebTargetID ||
		localMeta.Expected.ExecutionProfileRef != ManagedWebExecutionProfileRef {
		t.Fatalf("InspectLocal did not preserve universal target: %+v", localMeta.Expected)
	}
	localMac, err := InspectLocal(context.Background(), archivePath, "macos", "arm64")
	if err != nil || localMac.Expected.OS != "any" || localMac.Expected.Arch != "any" {
		t.Fatalf("InspectLocal macos managed-web: %+v err=%v", localMac.Expected, err)
	}

	owner, _ := openOwnerRoot(t)
	materialized, err := Materialize(context.Background(), archivePath, owner, "managed-release", expected)
	if err != nil {
		t.Fatalf("Materialize managed-web: %v", err)
	}
	if _, err := VerifyMaterialized(context.Background(), materialized.Root, expected, PayloadRootDigestRef(materialized.PayloadRootSHA256), materialized.HostExecutableSHA256); err != nil {
		t.Fatalf("VerifyMaterialized managed-web: %v", err)
	}
	entry, err := ResolveInstalledRuntimeEntry(materialized.Root, expected)
	if err != nil || entry != filepath.Join(materialized.Root, "payload", "index.html") {
		t.Fatalf("ResolveInstalledRuntimeEntry = %q, %v", entry, err)
	}
	// Tampering payload/assets/app.js must fail VerifyMaterialized.
	if err := os.WriteFile(filepath.Join(materialized.Root, "payload", "assets", "app.js"), []byte("tampered"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyMaterialized(context.Background(), materialized.Root, expected, PayloadRootDigestRef(materialized.PayloadRootSHA256), materialized.HostExecutableSHA256); !errors.Is(err, ErrPackageIntegrity) {
		t.Fatalf("tampered managed-web tree accepted: %v", err)
	}
}

func TestManagedWebDigestUsesUTF8ByteOrderForNonBMPAndBMPFilenames(t *testing.T) {
	// U+FF21 (UTF-8: EF BC A1) sorts BEFORE U+10000 (UTF-8: F0 90 80 80) in UTF-8 byte order,
	// whereas JS UTF-16 code units sort U+10000 (D800 DC00) BEFORE U+FF21 (FF21).
	bmpName := "payload/assets/\uff21.txt"
	nonBMPName := "payload/assets/\U00010000.txt"
	if !(bmpName < nonBMPName) {
		t.Fatalf("expected Go UTF-8 byte order %q < %q", bmpName, nonBMPName)
	}

	entries := []archiveFixtureEntry{
		canonicalFixtureEntry("LICENSE", []byte("MIT\n"), 0o644),
		canonicalFixtureEntry("manifest.json", mustJSON(t, managedWebManifest()), 0o644),
		canonicalFixtureEntry("nimi.app.yaml", []byte("app_id: publisher.example-app\nversion: 1.2.3\ndisplay_name: Example App\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy: { kind: nimi-mediated-default }\napp_access:\n  - runtime.consume\n"), 0o644),
		canonicalFixtureEntry("app-info.json", mustJSON(t, func() AppInfo { i := testAppInfo(t); i.TargetID = ManagedWebTargetID; return i }()), 0o644),
		canonicalFixtureEntry(ManagedWebRuntimeEntry, []byte("<html>ok</html>"), 0o644),
		canonicalFixtureEntry(nonBMPName, []byte("non-bmp"), 0o644),
		canonicalFixtureEntry(bmpName, []byte("bmp"), 0o644),
	}
	archivePath, _ := writeArchiveFixture(t, entries)
	expected := managedWebExpected(archivePath)
	owner, _ := openOwnerRoot(t)
	materialized, err := Materialize(context.Background(), archivePath, owner, "utf8-order", expected)
	if err != nil {
		t.Fatalf("Materialize utf8 order fixture: %v", err)
	}

	// Independently compute expected digest in exact UTF-8 byte order.
	ordered := []struct {
		name string
		data []byte
	}{
		{"LICENSE", entries[0].bytes},
		{"app-info.json", entries[3].bytes},
		{"manifest.json", entries[1].bytes},
		{"nimi.app.yaml", entries[2].bytes},
		{bmpName, entries[6].bytes},
		{nonBMPName, entries[5].bytes},
		{ManagedWebRuntimeEntry, entries[4].bytes},
	}
	h := sha256.New()
	_, _ = h.Write([]byte(payloadDigestDomain))
	for _, item := range ordered {
		var length [8]byte
		binary.LittleEndian.PutUint64(length[:], uint64(len(item.name)))
		_, _ = h.Write(length[:])
		_, _ = h.Write([]byte(item.name))
		binary.LittleEndian.PutUint64(length[:], uint64(len(item.data)))
		_, _ = h.Write(length[:])
		_, _ = h.Write(item.data)
	}
	var want [sha256.Size]byte
	copy(want[:], h.Sum(nil))
	if materialized.PayloadRootSHA256 != want {
		t.Fatalf("PayloadRootSHA256 = %x, want %x", materialized.PayloadRootSHA256, want)
	}
}

func TestManagedWebRejectsInvalidEntriesWindowStorageAndPermissions(t *testing.T) {
	t.Run("directory-budgets", func(t *testing.T) {
		maxDepth := canonicalFixtureEntry("payload/"+strings.Repeat("d/", 63)+"asset.txt", nil, 0o644)
		acceptable, _ := writeArchiveFixture(t, managedWebArchiveEntries(t, maxDepth))
		if _, err := Inspect(context.Background(), acceptable, managedWebExpected(acceptable)); err != nil {
			t.Fatalf("rejects a regular file at the deepest supported directory: %v", err)
		}
		overDepth := canonicalFixtureEntry("payload/"+strings.Repeat("d/", 64)+"asset.txt", nil, 0o644)
		tooDeep, _ := writeArchiveFixture(t, managedWebArchiveEntries(t, overDepth))
		if _, err := InspectLocal(context.Background(), tooDeep, "windows", "x86_64"); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("local import with excess directory depth: %v", err)
		}
		entries := managedWebArchiveEntries(t)
		for group := 0; group < 160; group++ {
			name := fmt.Sprintf("payload/group%d/%sasset.txt", group, strings.Repeat("d/", 62))
			entries = append(entries, canonicalFixtureEntry(name, nil, 0o644))
		}
		tooManyDirectories, _ := writeArchiveFixture(t, entries)
		if _, err := Inspect(context.Background(), tooManyDirectories, managedWebExpected(tooManyDirectories)); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("catalog package with excess directory count: %v", err)
		}
	})
	t.Run("runtime-entry-0755", func(t *testing.T) {
		entries := managedWebArchiveEntries(t)
		entries[3].mode = 0o100755
		archivePath, _ := writeArchiveFixture(t, entries)
		if _, err := Inspect(context.Background(), archivePath, managedWebExpected(archivePath)); err == nil {
			t.Fatal("0o755 payload/index.html accepted for managed-web")
		}
	})

	t.Run("symlink-rejected", func(t *testing.T) {
		link := canonicalFixtureEntry("payload/assets/link.js", []byte("app.js"), 0o777)
		link.mode = 0o120777
		archivePath, _ := writeArchiveFixture(t, managedWebArchiveEntries(t, link))
		if _, err := Inspect(context.Background(), archivePath, managedWebExpected(archivePath)); err == nil {
			t.Fatal("symlink accepted in managed-web")
		}
	})

	t.Run("windows-reserved-name-rejected", func(t *testing.T) {
		entries := managedWebArchiveEntries(t, canonicalFixtureEntry("payload/CON.js", []byte("x"), 0o644))
		archivePath, _ := writeArchiveFixture(t, entries)
		if _, err := Inspect(context.Background(), archivePath, managedWebExpected(archivePath)); err == nil {
			t.Fatal("Windows reserved segment accepted in os=any")
		}
	})

	t.Run("case-folding-collision-rejected", func(t *testing.T) {
		entries := managedWebArchiveEntries(t, canonicalFixtureEntry("payload/assets/APP.JS", []byte("x"), 0o644))
		archivePath, _ := writeArchiveFixture(t, entries)
		if _, err := Inspect(context.Background(), archivePath, managedWebExpected(archivePath)); err == nil {
			t.Fatal("case-folding collision accepted in os=any")
		}
	})

	t.Run("app-owned-os-storage-rejected-even-for-local-import", func(t *testing.T) {
		entries := managedWebArchiveEntries(t)
		info := testAppInfo(t)
		info.TargetID = ManagedWebTargetID
		info.StoragePolicy = AppInfoStoragePolicy{
			Kind: "app-owned-os-storage",
			OSStorageDisclosure: []AppInfoStorageDisclosure{{
				PathPattern: "~/data", Purpose: "db", ExpectedSizeBand: "small",
			}},
		}
		entries[5].bytes = mustJSON(t, info)
		archivePath, _ := writeArchiveFixture(t, entries)
		if _, err := InspectLocal(context.Background(), archivePath, "windows", "x86_64"); err == nil {
			t.Fatal("app-owned-os-storage accepted for local managed-web import")
		}
	})

	t.Run("desktop-window-bounds-and-unknown-key", func(t *testing.T) {
		badDeclarations := []string{
			"app_id: publisher.example-app\nversion: 1.2.3\ndisplay_name: Example App\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy: { kind: nimi-mediated-default }\napp_access:\n  - runtime.consume\ndesktop:\n  window:\n    width: 300\n",
			"app_id: publisher.example-app\nversion: 1.2.3\ndisplay_name: Example App\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy: { kind: nimi-mediated-default }\napp_access:\n  - runtime.consume\ndesktop:\n  window:\n    width: 500\n    min_width: 600\n",
			"app_id: publisher.example-app\nversion: 1.2.3\ndisplay_name: Example App\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy: { kind: nimi-mediated-default }\napp_access:\n  - runtime.consume\ndesktop:\n  window:\n    title_bar_style: frameless\n",
			"app_id: publisher.example-app\nversion: 1.2.3\ndisplay_name: Example App\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy: { kind: nimi-mediated-default }\napp_access:\n  - runtime.consume\ndesktop:\n  window:\n    fullscreen: true\n",
			"app_id: publisher.example-app\nversion: 1.2.3\ndisplay_name: Example App\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy: { kind: nimi-mediated-default }\napp_access:\n  - runtime.consume\ndesktop:\n  extra: {}\n",
		}
		for idx, decl := range badDeclarations {
			entries := managedWebArchiveEntries(t)
			entries[2].bytes = []byte(decl)
			archivePath, _ := writeArchiveFixture(t, entries)
			if _, err := Inspect(context.Background(), archivePath, managedWebExpected(archivePath)); err == nil {
				t.Fatalf("bad desktop.window case %d was accepted", idx)
			}
		}
	})
}
