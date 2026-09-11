package nimiapppackage

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type archiveFixtureEntry struct {
	name           string
	bytes          []byte
	mode           uint32
	flags          uint16
	method         uint16
	creatorVersion uint16
	readerVersion  uint16
	extra          []byte
	comment        string
	crc32          *uint32
}

type runtimeEntryVerifierFunc func(context.Context, string, [sha256.Size]byte) error

func macOSArchiveFixture(t *testing.T, linkTarget string) (string, Expected) {
	t.Helper()
	manifest := validManifest()
	manifest.OS, manifest.Arch, manifest.TargetID = "macos", "arm64", "macos-aarch64"
	manifest.RuntimeEntry = "payload/Example.app/Contents/MacOS/example"
	manifest.NativeTrust = ManifestNativeTrust{Posture: "production-unsigned", MacOSDeveloperID: "absent", MacOSNotarization: "absent", CertificateSubject: json.RawMessage("null")}
	manifest.ExecutionProfile = &ManifestExecutionProfile{LaunchMode: "current-user"}
	entries := validArchiveEntries(t)
	entries[1].bytes = mustJSON(t, manifest)
	entries[3].name = manifest.RuntimeEntry
	info := testAppInfo(t)
	info.TargetID = manifest.TargetID
	entries[6].bytes = mustJSON(t, info)
	entries = append(entries,
		canonicalFixtureEntry("payload/Example.app/Contents/Frameworks/F.framework/Versions/A/F", []byte("framework contents"), 0o755),
		canonicalFixtureEntry("payload/Example.app/Contents/Frameworks/F.framework/Versions/Current", []byte(linkTarget), 0o777),
	)
	entries[len(entries)-1].mode = 0o120777
	archive, expected := writeArchiveFixture(t, entries)
	expected.OS, expected.Arch, expected.TargetID = manifest.OS, manifest.Arch, manifest.TargetID
	expected.RuntimeEntry, expected.ExecutionProfileRef = manifest.RuntimeEntry, macOSExecutionProfileRef
	expected.NativeTrust = ExpectedNativeTrust{WindowsCodeSigning: "not-applicable", MacOSNotarization: "absent"}
	return archive, expected
}

func TestMacOSArchivePreservesFrameworkLinksAndDetectsLinkReplacement(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS filesystem semantics")
	}
	archive, expected := macOSArchiveFixture(t, "A")
	owner, _ := openOwnerRoot(t)
	materialized, err := Materialize(context.Background(), archive, owner, "macos-release", expected)
	if err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(materialized.Root, "payload/Example.app/Contents/Frameworks/F.framework/Versions/Current")
	if target, err := os.Readlink(link); err != nil || target != "A" {
		t.Fatalf("framework link = %q, %v", target, err)
	}
	if _, err := VerifyMaterialized(context.Background(), materialized.Root, expected, PayloadRootDigestRef(materialized.PayloadRootSHA256), materialized.HostExecutableSHA256); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(link, []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyMaterialized(context.Background(), materialized.Root, expected, PayloadRootDigestRef(materialized.PayloadRootSHA256), materialized.HostExecutableSHA256); !errors.Is(err, ErrPackageIntegrity) {
		t.Fatalf("link replaced by same-content file: %v", err)
	}
}

func TestMacOSArchiveRejectsEscapingAndCyclicFrameworkLinksBeforeMaterialization(t *testing.T) {
	for _, target := range []string{"../../../../../../../../outside", "Current", "/outside", "missing"} {
		t.Run(target, func(t *testing.T) {
			archive, expected := macOSArchiveFixture(t, target)
			owner, root := openOwnerRoot(t)
			if _, err := Materialize(context.Background(), archive, owner, "rejected", expected); err == nil {
				t.Fatal("invalid framework link accepted")
			}
			if _, err := os.Stat(filepath.Join(root, "rejected")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("rejected archive created a destination")
			}
		})
	}
}

func (verify runtimeEntryVerifierFunc) Verify(ctx context.Context, path string, digest [sha256.Size]byte) error {
	return verify(ctx, path, digest)
}

func TestInspectAndMaterializeCanonicalNimiApp(t *testing.T) {
	entries := validArchiveEntries(t)
	archivePath, expected := writeArchiveFixture(t, entries)
	inspection, err := Inspect(context.Background(), archivePath, expected)
	if err != nil {
		t.Fatal(err)
	}
	if inspection.Files != len(entries) || inspection.UncompressedBytes == 0 || inspection.Manifest.AppID != expected.AppID ||
		!equalStrings(inspection.Declaration.AppAccess, expected.AppAccess) {
		t.Fatalf("inspection = %+v", inspection)
	}
	ownerRoot, ownerPath := openOwnerRoot(t)
	materialized, err := Materialize(context.Background(), archivePath, ownerRoot, "job-01", expected)
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(ownerPath, "job-01")
	if materialized.Root != destination || materialized.Files != len(entries) || materialized.Bytes != inspection.UncompressedBytes ||
		materialized.HostExecutableSHA256 == ([sha256.Size]byte{}) || materialized.PayloadRootSHA256 == ([sha256.Size]byte{}) ||
		!strings.HasPrefix(PayloadRootDigestRef(materialized.PayloadRootSHA256), "sha256:") ||
		!equalStrings(materialized.RawDeclaration, expected.AppAccess) {
		t.Fatalf("materialized = %+v", materialized)
	}
	if got, err := os.ReadFile(materialized.RuntimeEntryPath); err != nil || string(got) != "MZ-runtime" {
		t.Fatalf("Runtime entry = %q err=%v", got, err)
	}
	if got, err := os.ReadFile(filepath.Join(destination, "payload", "resources", "index.html")); err != nil || string(got) != "<html>ok</html>" {
		t.Fatalf("renderer = %q err=%v", got, err)
	}
	if _, err := Materialize(context.Background(), archivePath, ownerRoot, "job-01", expected); !errors.Is(err, ErrDestinationExists) {
		t.Fatalf("existing staging root error = %v", err)
	}
	if got, err := os.ReadFile(materialized.RuntimeEntryPath); err != nil || string(got) != "MZ-runtime" {
		t.Fatalf("existing staging root was mutated: %q err=%v", got, err)
	}
}

func TestProbeRuntimeEntryIsExactScopedAndEphemeral(t *testing.T) {
	archivePath, expected := writeArchiveFixture(t, validArchiveEntries(t))
	ownerRoot, ownerPath := openOwnerRoot(t)
	var observedPath string
	probe, err := ProbeRuntimeEntry(
		context.Background(), archivePath, ownerRoot, "native-probe", expected,
		runtimeEntryVerifierFunc(func(_ context.Context, path string, digest [sha256.Size]byte) error {
			observedPath = path
			raw, err := os.ReadFile(path)
			if err != nil || string(raw) != "MZ-runtime" || sha256.Sum256(raw) != digest {
				return errors.New("observer did not receive the exact Runtime entry")
			}
			return nil
		}),
	)
	if err != nil {
		t.Fatal(err)
	}
	if observedPath != filepath.Join(ownerPath, "native-probe", "example-app.exe") ||
		probe.HostExecutableSHA256 != sha256.Sum256([]byte("MZ-runtime")) {
		t.Fatalf("probe = %+v path=%q", probe, observedPath)
	}
	if _, err := os.Stat(filepath.Join(ownerPath, "native-probe")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("successful probe root remained: %v", err)
	}

	materialized, err := Materialize(context.Background(), archivePath, ownerRoot, "stage", expected)
	if err != nil {
		t.Fatal(err)
	}
	if materialized.HostExecutableSHA256 != probe.HostExecutableSHA256 {
		t.Fatal("staged Runtime entry differs from the observed probe")
	}
}

func TestProbeRuntimeEntryRejectsMutationErrorAndCancellationWithoutResidue(t *testing.T) {
	archivePath, expected := writeArchiveFixture(t, validArchiveEntries(t))
	ownerRoot, ownerPath := openOwnerRoot(t)
	tests := []struct {
		name     string
		ctx      context.Context
		verifier RuntimeEntryVerifier
		want     error
	}{
		{
			name: "observer mutation",
			ctx:  context.Background(),
			verifier: runtimeEntryVerifierFunc(func(_ context.Context, path string, _ [sha256.Size]byte) error {
				return os.WriteFile(path, []byte("mutated"), 0o600)
			}),
			want: ErrPackageIntegrity,
		},
		{
			name: "observer failure",
			ctx:  context.Background(),
			verifier: runtimeEntryVerifierFunc(func(context.Context, string, [sha256.Size]byte) error {
				return ErrUnsupportedTarget
			}),
			want: ErrUnsupportedTarget,
		},
		{
			name: "canceled",
			ctx: func() context.Context {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx
			}(),
			verifier: runtimeEntryVerifierFunc(func(context.Context, string, [sha256.Size]byte) error {
				return nil
			}),
			want: context.Canceled,
		},
	}
	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			child := fmt.Sprintf("native-probe-%d", index)
			if _, err := ProbeRuntimeEntry(test.ctx, archivePath, ownerRoot, child, expected, test.verifier); !errors.Is(err, test.want) {
				t.Fatalf("probe error = %v", err)
			}
			if _, err := os.Stat(filepath.Join(ownerPath, child)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("failed probe root remained: %v", err)
			}
		})
	}
}

func TestInspectRejectsUnsafeOrNoncanonicalArchiveBeforeStaging(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*testing.T, []archiveFixtureEntry)
	}{
		{name: "traversal", mutate: func(_ *testing.T, entries []archiveFixtureEntry) { entries[3].name = "payload/../escape.exe" }},
		{name: "backslash", mutate: func(_ *testing.T, entries []archiveFixtureEntry) { entries[3].name = `payload\escape.exe` }},
		{name: "Windows reserved", mutate: func(_ *testing.T, entries []archiveFixtureEntry) { entries[4].name = "payload/CON.txt" }},
		{name: "case collision", mutate: func(_ *testing.T, entries []archiveFixtureEntry) {
			entries[3].name = "payload/RESOURCES/INDEX.HTML"
		}},
		{name: "file used as parent", mutate: func(_ *testing.T, entries []archiveFixtureEntry) {
			entries[4].name = "payload/example-app.exe/child"
		}},
		{name: "case folded parent alias", mutate: func(_ *testing.T, entries []archiveFixtureEntry) {
			entries[4].name = "payload/Resources/index.html"
			entries[5].name = "payload/resources/app.js"
		}},
		{name: "NFC parent alias", mutate: func(_ *testing.T, entries []archiveFixtureEntry) {
			entries[4].name = "payload/résources/index.html"
			entries[5].name = "payload/re\u0301sources/app.js"
		}},
		{name: "Windows reserved base with space", mutate: func(_ *testing.T, entries []archiveFixtureEntry) {
			entries[4].name = "payload/CON .txt"
		}},
		{name: "symlink type", mutate: func(_ *testing.T, entries []archiveFixtureEntry) { entries[4].mode = 0o120777 }},
		{name: "compressed", mutate: func(_ *testing.T, entries []archiveFixtureEntry) { entries[4].method = zip.Deflate }},
		{name: "data descriptor", mutate: func(_ *testing.T, entries []archiveFixtureEntry) { entries[4].flags |= 0x0008 }},
		{name: "extra field", mutate: func(_ *testing.T, entries []archiveFixtureEntry) { entries[4].extra = []byte{1, 2} }},
		{name: "unexpected root", mutate: func(_ *testing.T, entries []archiveFixtureEntry) { entries[4].name = "unexpected.txt" }},
		{name: "Runtime not executable", mutate: func(_ *testing.T, entries []archiveFixtureEntry) { entries[3].mode = 0o100644 }},
		{name: "development manifest", mutate: func(t *testing.T, entries []archiveFixtureEntry) {
			manifest := validManifest()
			manifest.NativeTrust = ManifestNativeTrust{Posture: "development-unsigned", CertificateSubject: json.RawMessage("null")}
			entries[1].bytes = mustJSON(t, manifest)
		}},
		{name: "missing certificate subject", mutate: func(t *testing.T, entries []archiveFixtureEntry) {
			entries[1].bytes = deleteNestedJSONField(t, mustJSON(t, validManifest()), "native_trust", "certificate_subject")
		}},
		{name: "missing ui access", mutate: func(t *testing.T, entries []archiveFixtureEntry) {
			entries[1].bytes = deleteNestedJSONField(t, mustJSON(t, validManifest()), "execution_profile", "ui_access")
		}},
		{name: "declaration App Access drift", mutate: func(_ *testing.T, entries []archiveFixtureEntry) {
			entries[2].bytes = []byte("app_id: publisher.example-app\nversion: 1.2.3\ndisplay_name: Example App\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy: { kind: nimi-mediated-default }\napp_access: []\n")
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			entries := validArchiveEntries(t)
			test.mutate(t, entries)
			archivePath, expected := writeArchiveFixture(t, entries)
			ownerRoot, ownerPath := openOwnerRoot(t)
			if _, err := Materialize(context.Background(), archivePath, ownerRoot, "stage", expected); !errors.Is(err, ErrInvalidPackage) && !errors.Is(err, ErrPackageIntegrity) {
				t.Fatalf("invalid archive error = %v", err)
			}
			if _, err := os.Stat(filepath.Join(ownerPath, "stage")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("invalid archive created staging root: %v", err)
			}
		})
	}
}

func TestMaterializeRejectsPayloadCRCFailureAndCancellationWithoutResidue(t *testing.T) {
	entries := validArchiveEntries(t)
	wrongCRC := uint32(1)
	entries[4].crc32 = &wrongCRC
	archivePath, expected := writeArchiveFixture(t, entries)
	if _, err := Inspect(context.Background(), archivePath, expected); err == nil {
		t.Fatal("payload CRC mismatch passed preflight")
	}
	ownerRoot, ownerPath := openOwnerRoot(t)
	if _, err := Materialize(context.Background(), archivePath, ownerRoot, "stage", expected); err == nil {
		t.Fatal("payload CRC mismatch materialized")
	}
	if _, err := os.Stat(filepath.Join(ownerPath, "stage")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("CRC failure left staging root: %v", err)
	}

	archivePath, expected = writeArchiveFixture(t, validArchiveEntries(t))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Inspect(ctx, archivePath, expected); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled inspection error = %v", err)
	}
	if _, err := Materialize(ctx, archivePath, ownerRoot, "canceled-stage", expected); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled materialization error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(ownerPath, "canceled-stage")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("canceled materialization left staging root: %v", err)
	}
}

func TestArchiveIntegrityFailsBeforeDestinationCreation(t *testing.T) {
	archivePath, expected := writeArchiveFixture(t, validArchiveEntries(t))
	expected.ArchiveSHA256 = strings.Repeat("0", 64)
	ownerRoot, ownerPath := openOwnerRoot(t)
	if _, err := Materialize(context.Background(), archivePath, ownerRoot, "stage", expected); !errors.Is(err, ErrPackageIntegrity) {
		t.Fatalf("archive hash mismatch error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(ownerPath, "stage")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("archive hash mismatch created staging root: %v", err)
	}
}

func TestMaterializeRequiresRuntimeOwnedDirectChild(t *testing.T) {
	archivePath, expected := writeArchiveFixture(t, validArchiveEntries(t))
	ownerRoot, ownerPath := openOwnerRoot(t)
	for _, child := range []string{"", "../outside", "nested/stage", `nested\stage`, "CON"} {
		if _, err := Materialize(context.Background(), archivePath, ownerRoot, child, expected); !errors.Is(err, ErrInvalidPackage) {
			t.Fatalf("staging child %q error = %v", child, err)
		}
	}
	entries, err := os.ReadDir(ownerPath)
	if err != nil || len(entries) != 0 {
		t.Fatalf("invalid staging children changed owner root: entries=%v err=%v", entries, err)
	}
	if _, err := Materialize(context.Background(), archivePath, nil, "stage", expected); !errors.Is(err, ErrInvalidPackage) {
		t.Fatalf("nil owner root error = %v", err)
	}
}

func TestInspectRejectsLicenseBeyondDistributionInfoLimit(t *testing.T) {
	entries := validArchiveEntries(t)
	entries[0].bytes = bytes.Repeat([]byte("L"), 128*1024+1)
	archivePath, expected := writeArchiveFixture(t, entries)
	if _, err := Inspect(context.Background(), archivePath, expected); !errors.Is(err, ErrInvalidPackage) {
		t.Fatalf("oversized license: %v", err)
	}
}

func TestInspectPreservesExactPublisherSignedSubject(t *testing.T) {
	entries := validArchiveEntries(t)
	manifest := validManifest()
	subject := "CN=Example Publisher"
	manifest.NativeTrust = ManifestNativeTrust{
		Posture: "observed-valid-native-signature", WindowsAuthenticode: "valid", CertificateSubject: json.RawMessage(mustJSON(t, subject)),
	}
	entries[1].bytes = mustJSON(t, manifest)
	archivePath, expected := writeArchiveFixture(t, entries)
	publisher := "publisher"
	expected.NativeTrust = ExpectedNativeTrust{
		WindowsCodeSigning: "signed", SigningSubject: &publisher, ObservedSubject: &subject,
	}
	if _, err := Inspect(context.Background(), archivePath, expected); err != nil {
		t.Fatal(err)
	}
	other := "CN=Other Publisher"
	expected.NativeTrust.ObservedSubject = &other
	if _, err := Inspect(context.Background(), archivePath, expected); !errors.Is(err, ErrPackageIntegrity) {
		t.Fatalf("signed subject mismatch error = %v", err)
	}
}

func validArchiveEntries(t *testing.T) []archiveFixtureEntry {
	t.Helper()
	return []archiveFixtureEntry{
		canonicalFixtureEntry("LICENSE", []byte("MIT\n"), 0o644),
		canonicalFixtureEntry("manifest.json", mustJSON(t, validManifest()), 0o644),
		canonicalFixtureEntry("nimi.app.yaml", []byte("app_id: publisher.example-app\nversion: 1.2.3\ndisplay_name: Example App\ncapability_contract_refs: []\nrequired_standardized_feature_refs: []\nstorage_policy: { kind: nimi-mediated-default }\napp_access:\n  - runtime.consume\n"), 0o644),
		canonicalFixtureEntry("payload/example-app.exe", []byte("MZ-runtime"), 0o755),
		canonicalFixtureEntry("payload/resources/index.html", []byte("<html>ok</html>"), 0o644),
		canonicalFixtureEntry("payload/resources/app.js", []byte("console.log('ok')\n"), 0o644),
		canonicalFixtureEntry("app-info.json", mustJSON(t, testAppInfo(t)), 0o644),
	}
}

func validManifest() Manifest {
	uiAccess := false
	return Manifest{
		Format: packageFormat, AppID: "publisher.example-app", Version: "1.2.3",
		TargetID: "windows-x86_64", OS: "windows", Arch: "x86_64", RuntimeEntry: "payload/example-app.exe",
		NativeTrust:      ManifestNativeTrust{Posture: "production-unsigned", WindowsAuthenticode: "unsigned", CertificateSubject: json.RawMessage("null")},
		ExecutionProfile: &ManifestExecutionProfile{RequestedExecutionLevel: "asInvoker", UIAccess: &uiAccess},
	}
}

func expectedPackage(archive []byte) Expected {
	digest := sha256.Sum256(archive)
	return Expected{
		ArchiveSize: int64(len(archive)), ArchiveSHA256: hex.EncodeToString(digest[:]),
		AppID: "publisher.example-app", Version: "1.2.3", TargetID: "windows-x86_64",
		OS: "windows", Arch: "x86_64", RuntimeEntry: "payload/example-app.exe",
		AppAccess:           []string{"runtime.consume"},
		ExecutionProfileRef: windowsExecutionProfileRef,
		NativeTrust:         ExpectedNativeTrust{WindowsCodeSigning: "unsigned"},
	}
}

func canonicalFixtureEntry(name string, value []byte, permissions uint32) archiveFixtureEntry {
	return archiveFixtureEntry{
		name: name, bytes: value, mode: 0o100000 | permissions,
		flags: canonicalZipFlags, method: zip.Store,
		creatorVersion: canonicalZipCreatorVersion, readerVersion: canonicalZipReaderVersion,
	}
}

func writeArchiveFixture(t *testing.T, entries []archiveFixtureEntry) (string, Expected) {
	t.Helper()
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, entry := range entries {
		checksum := crc32.ChecksumIEEE(entry.bytes)
		if entry.crc32 != nil {
			checksum = *entry.crc32
		}
		header := &zip.FileHeader{
			Name: entry.name, Method: entry.method, Flags: entry.flags,
			CreatorVersion: entry.creatorVersion, ReaderVersion: entry.readerVersion,
			CRC32: checksum, CompressedSize: uint32(len(entry.bytes)), UncompressedSize: uint32(len(entry.bytes)),
			CompressedSize64: uint64(len(entry.bytes)), UncompressedSize64: uint64(len(entry.bytes)),
			Extra: append([]byte(nil), entry.extra...), Comment: entry.comment,
			ExternalAttrs: entry.mode << 16,
		}
		entryWriter, err := writer.CreateRaw(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entryWriter.Write(entry.bytes); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	archive := output.Bytes()
	archivePath := filepath.Join(t.TempDir(), "app.nimiapp")
	if err := os.WriteFile(archivePath, archive, 0o600); err != nil {
		t.Fatal(err)
	}
	return archivePath, expectedPackage(archive)
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func deleteNestedJSONField(t *testing.T, raw []byte, objectName, fieldName string) []byte {
	t.Helper()
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	object, ok := document[objectName].(map[string]any)
	if !ok {
		t.Fatalf("JSON object %q is missing", objectName)
	}
	delete(object, fieldName)
	return mustJSON(t, document)
}

func openOwnerRoot(t *testing.T) (*os.Root, string) {
	t.Helper()
	rootPath := t.TempDir()
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	return root, rootPath
}

func testAppInfo(t *testing.T) AppInfo {
	t.Helper()
	icon := image.NewNRGBA(image.Rect(0, 0, 128, 128))
	icon.Set(64, 64, color.NRGBA{R: 35, G: 165, B: 220, A: 255})
	var bytes bytes.Buffer
	if err := png.Encode(&bytes, icon); err != nil {
		t.Fatal(err)
	}
	return AppInfo{Format: "nimi.app-info/v1", AppID: "publisher.example-app", Version: "1.2.3", TargetID: "windows-x86_64", DisplayName: "Example App", Summary: "Example package test application.", Icon: AppInfoIcon{MediaType: "image/png", DataBase64: base64.StdEncoding.EncodeToString(bytes.Bytes())}, ReadmeMarkdown: "Use the example app.", ReleaseNotesMarkdown: "Initial release.", License: AppInfoLicense{Identifier: "MIT", Text: "MIT\n"}, AppAccess: []string{"runtime.consume"}, CapabilityContractRefs: []string{}, RequiredStandardizedFeatureRefs: []string{}, StoragePolicy: AppInfoStoragePolicy{Kind: "nimi-mediated-default"}}
}
