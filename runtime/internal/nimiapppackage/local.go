package nimiapppackage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appaccess"
	"github.com/nimiplatform/nimi/runtime/internal/appidentity"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
	"golang.org/x/mod/semver"
	"gopkg.in/yaml.v3"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040e
// Local metadata is a package declaration, never a Registry approval. Native
// verification remains mandatory at preparation, staging and installed launch.
type LocalMetadata struct {
	AppInfo     AppInfo
	Expected    Expected
	DisplayName string
}

func InspectLocal(ctx context.Context, archivePath, targetOS, targetArch string) (LocalMetadata, error) {
	if ctx == nil {
		return LocalMetadata{}, ErrInvalidPackage
	}
	file, archiveSize, err := OpenArchiveReadOnly(archivePath)
	if err != nil {
		return LocalMetadata{}, err
	}
	defer func() { _ = file.Close() }()
	if archiveSize <= 0 || archiveSize > NativeMaxArchiveBytes {
		return LocalMetadata{}, ErrInvalidPackage
	}
	var (
		ra             io.ReaderAt
		inMemoryReader *bytes.Reader
		archiveSHA256  string
	)
	if archiveSize <= ManagedWebMaxArchiveBytes {
		var buf bytes.Buffer
		buf.Grow(int(archiveSize))
		if err := copyWithContext(ctx, &buf, io.LimitReader(file, archiveSize+1), uint64(archiveSize)); err != nil {
			return LocalMetadata{}, err
		}
		raw := buf.Bytes()
		if int64(len(raw)) != archiveSize {
			return LocalMetadata{}, ErrPackageIntegrity
		}
		sum := sha256.Sum256(raw)
		archiveSHA256 = hex.EncodeToString(sum[:])
		inMemoryReader = bytes.NewReader(raw)
		ra = inMemoryReader
	} else {
		digest := sha256.New()
		if err := copyWithContext(ctx, digest, io.LimitReader(file, archiveSize+1), uint64(archiveSize)); err != nil {
			return LocalMetadata{}, err
		}
		archiveSHA256 = hex.EncodeToString(digest.Sum(nil))
		ra = file
	}
	canonical, err := parseCanonicalZip(ra, archiveSize)
	if err != nil {
		return LocalMetadata{}, err
	}
	manifestEntry, hasManifest := canonical.find("manifest.json")
	declEntry, hasDecl := canonical.find("nimi.app.yaml")
	if !hasManifest || !hasDecl ||
		!manifestEntry.Mode.IsRegular() || manifestEntry.Mode.Perm() != 0o644 ||
		!declEntry.Mode.IsRegular() || declEntry.Mode.Perm() != 0o644 {
		return LocalMetadata{}, ErrInvalidPackage
	}
	manifest, err := readCanonicalControlEntry(ctx, ra, manifestEntry, maxControlDocumentBytes)
	if err != nil {
		return LocalMetadata{}, err
	}
	declaration, err := readCanonicalControlEntry(ctx, ra, declEntry, maxControlDocumentBytes)
	if err != nil {
		return LocalMetadata{}, err
	}
	metadata, err := localMetadata(manifest, declaration, targetOS, targetArch)
	if err != nil {
		return LocalMetadata{}, err
	}
	if IsManagedWebTarget(metadata.Expected) && (archiveSize > ManagedWebMaxArchiveBytes || inMemoryReader == nil) {
		return LocalMetadata{}, ErrInvalidPackage
	}
	metadata.Expected.ArchiveSize = archiveSize
	metadata.Expected.ArchiveSHA256 = archiveSHA256
	// Preserve full payload CRC/stream verification on local preview so a
	// corrupted archive never reaches user confirmation.
	inspection, _, err := inspectCanonicalArchive(ctx, canonical, metadata.Expected, true)
	if err != nil {
		return LocalMetadata{}, err
	}
	metadata.AppInfo = inspection.AppInfo
	return metadata, nil
}

// ReadInstalledLocalMetadata reads package control files for explicit integrity
// inspection. Launch uses installation-owned configuration, never these files.
func ReadInstalledLocalMetadata(rootPath, targetOS, targetArch string) (LocalMetadata, error) {
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return LocalMetadata{}, err
	}
	defer func() { _ = root.Close() }()
	read := func(name string) ([]byte, error) {
		file, err := root.Open(name)
		if err != nil {
			return nil, err
		}
		defer func() { _ = file.Close() }()
		raw, err := io.ReadAll(io.LimitReader(file, maxControlDocumentBytes+1))
		if int64(len(raw)) > maxControlDocumentBytes {
			return nil, ErrInvalidPackage
		}
		return raw, err
	}
	manifest, err := read("manifest.json")
	if err != nil {
		return LocalMetadata{}, err
	}
	declaration, err := read("nimi.app.yaml")
	if err != nil {
		return LocalMetadata{}, err
	}
	return localMetadata(manifest, declaration, targetOS, targetArch)
}

func localMetadata(manifestRaw, declarationRaw []byte, targetOS, targetArch string) (LocalMetadata, error) {
	var manifest Manifest
	if err := jsonstrict.Decode(manifestRaw, &manifest); err != nil {
		return LocalMetadata{}, ErrInvalidPackage
	}
	managedWeb := manifest.OS == "any" && manifest.Arch == "any" && manifest.TargetID == ManagedWebTargetID
	if managedWeb {
		if (targetOS != "windows" || targetArch != "x86_64") && (targetOS != "macos" || targetArch != "arm64") {
			return LocalMetadata{}, ErrUnsupportedTarget
		}
	} else if manifest.OS != targetOS || manifest.Arch != targetArch {
		return LocalMetadata{}, ErrUnsupportedTarget
	}
	// x/mod accepts abbreviated versions such as v1.2; package versions must
	// include all three components, while retaining valid prerelease/build data.
	version := "v" + manifest.Version
	withoutBuild, _, _ := strings.Cut(version, "+")
	if !appidentity.Valid(manifest.AppID) || !semver.IsValid(version) || semver.Canonical(version) != withoutBuild {
		return LocalMetadata{}, ErrInvalidPackage
	}
	shapeOS := targetOS
	if managedWeb {
		shapeOS = "any"
	}
	if err := validatePlatformManifestShape(manifestRaw, shapeOS); err != nil {
		return LocalMetadata{}, err
	}
	var declaration struct {
		DisplayName string   `yaml:"display_name"`
		AppAccess   []string `yaml:"app_access"`
	}
	if err := yaml.Unmarshal(declarationRaw, &declaration); err != nil {
		return LocalMetadata{}, ErrInvalidPackage
	}
	access, _, err := appaccess.ResolveDeclaration(declaration.AppAccess)
	if err != nil {
		return LocalMetadata{}, ErrInvalidPackage
	}
	expected := Expected{AppID: manifest.AppID, Version: manifest.Version, TargetID: manifest.TargetID,
		OS: targetOS, Arch: targetArch, RuntimeEntry: manifest.RuntimeEntry, AppAccess: access,
		ExecutionProfileRef: windowsExecutionProfileRef}
	native := manifest.NativeTrust
	if managedWeb {
		expected.OS = "any"
		expected.Arch = "any"
		expected.ExecutionProfileRef = ManagedWebExecutionProfileRef
		expected.NativeTrust.WindowsCodeSigning = "not-applicable"
		expected.NativeTrust.MacOSNotarization = "not-applicable"
	} else if targetOS == "macos" {
		expected.ExecutionProfileRef = macOSExecutionProfileRef
		expected.NativeTrust.WindowsCodeSigning = "not-applicable"
		expected.NativeTrust.MacOSNotarization = native.MacOSNotarization
		if manifest.TargetID != "macos-aarch64" {
			return LocalMetadata{}, ErrUnsupportedTarget
		}
	} else if targetOS == "windows" && manifest.TargetID == "windows-x86_64" {
		expected.NativeTrust.WindowsCodeSigning = "unsigned"
	} else {
		return LocalMetadata{}, ErrUnsupportedTarget
	}
	if !managedWeb && native.Posture == "observed-valid-native-signature" {
		var subject string
		if err := json.Unmarshal(native.CertificateSubject, &subject); err != nil || !exactText(subject) {
			return LocalMetadata{}, ErrInvalidPackage
		}
		publisher := "publisher"
		expected.NativeTrust.SigningSubject, expected.NativeTrust.ObservedSubject = &publisher, &subject
		if targetOS == "macos" {
			expected.NativeTrust.MacOSDeveloperIDSubject = &subject
		} else {
			expected.NativeTrust.WindowsCodeSigning = "signed"
		}
	}
	if err := validateExpectedTarget(expected); err != nil {
		return LocalMetadata{}, err
	}
	if err := validateManifest(manifest, expected); err != nil {
		return LocalMetadata{}, err
	}
	if _, err := validateDeclaration(declarationRaw, expected); err != nil {
		return LocalMetadata{}, err
	}
	name := declaration.DisplayName
	if !infoText(name, 120) {
		return LocalMetadata{}, ErrInvalidPackage
	}
	return LocalMetadata{Expected: expected, DisplayName: name}, nil
}
