package nimiapppackage

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appaccess"
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

var localAppID = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$`)

func InspectLocal(ctx context.Context, archivePath, targetOS, targetArch string) (LocalMetadata, error) {
	if ctx == nil {
		return LocalMetadata{}, ErrInvalidPackage
	}
	file, err := os.Open(archivePath)
	if err != nil {
		return LocalMetadata{}, fmt.Errorf("open selected App package: %w", err)
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 {
		return LocalMetadata{}, ErrInvalidPackage
	}
	reader, err := zip.NewReader(file, info.Size())
	if err != nil {
		return LocalMetadata{}, fmt.Errorf("open local App archive: %w", ErrInvalidPackage)
	}
	var manifest, declaration []byte
	for _, entry := range reader.File {
		if entry.Name != "manifest.json" && entry.Name != "nimi.app.yaml" {
			continue
		}
		if err := validateZipEntry(entry, targetOS); err != nil {
			return LocalMetadata{}, err
		}
		raw, err := readControlEntry(ctx, entry, maxControlDocumentBytes)
		if err != nil {
			return LocalMetadata{}, err
		}
		if entry.Name == "manifest.json" {
			manifest = raw
		} else {
			declaration = raw
		}
	}
	metadata, err := localMetadata(manifest, declaration, targetOS, targetArch)
	if err != nil {
		return LocalMetadata{}, err
	}
	digest := sha256.New()
	if err := copyWithContext(ctx, digest, file, uint64(info.Size())); err != nil {
		return LocalMetadata{}, err
	}
	metadata.Expected.ArchiveSize = info.Size()
	metadata.Expected.ArchiveSHA256 = hex.EncodeToString(digest.Sum(nil))
	inspection, _, err := inspectReader(ctx, reader, metadata.Expected)
	if err != nil {
		return LocalMetadata{}, err
	}
	metadata.AppInfo = inspection.AppInfo
	return metadata, nil
}

// The committed payload and executable digests authenticate these control
// documents during VerifyMaterialized; no Registry document is synthesized.
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
	if manifest.OS != targetOS || manifest.Arch != targetArch {
		return LocalMetadata{}, ErrUnsupportedTarget
	}
	// x/mod accepts abbreviated versions such as v1.2; package versions must
	// include all three components, while retaining valid prerelease/build data.
	version := "v" + manifest.Version
	withoutBuild, _, _ := strings.Cut(version, "+")
	if !localAppID.MatchString(manifest.AppID) || !semver.IsValid(version) || semver.Canonical(version) != withoutBuild {
		return LocalMetadata{}, ErrInvalidPackage
	}
	if err := validatePlatformManifestShape(manifestRaw, targetOS); err != nil {
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
	if targetOS == "macos" {
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
	if native.Posture == "observed-valid-native-signature" {
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
