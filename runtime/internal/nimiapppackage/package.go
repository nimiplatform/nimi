package nimiapppackage

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"io/fs"
	"math"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/nimiplatform/nimi/runtime/internal/appaccess"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
	"gopkg.in/yaml.v3"
)

const (
	packageFormat                    = "nimi.app-package/v1"
	windowsExecutionProfileRef       = "windows-user-mode-as-invoker-v1"
	canonicalZipFlags                = uint16(0x0800)
	canonicalZipCreatorVersion       = uint16(0x0314)
	canonicalZipReaderVersion        = uint16(20)
	maxZip32Entries                  = 65_535
	maxControlDocumentBytes    int64 = 1024 * 1024
	payloadDigestDomain              = "nimi.app-installed-root.v1\x00"
)

var (
	ErrInvalidPackage    = errors.New("invalid nimiapp package")
	ErrPackageIntegrity  = errors.New("nimiapp package integrity mismatch")
	ErrUnsupportedTarget = errors.New("unsupported nimiapp target")
	ErrDestinationExists = errors.New("nimiapp staging destination already exists")
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
// @nimi-authority: definition.nimi.platform.app-ecosystem.immutable-package-seam

type ExpectedNativeTrust struct {
	WindowsCodeSigning string
	SigningSubject     *string
	ObservedSubject    *string
}

type Expected struct {
	ArchiveSize         int64
	ArchiveSHA256       string
	AppID               string
	Version             string
	TargetID            string
	OS                  string
	Arch                string
	RuntimeEntry        string
	AppAccess           []string
	ExecutionProfileRef string
	NativeTrust         ExpectedNativeTrust
}

type ManifestNativeTrust struct {
	Posture             string          `json:"posture"`
	WindowsAuthenticode string          `json:"windows_authenticode"`
	CertificateSubject  json.RawMessage `json:"certificate_subject"`
}

type ManifestExecutionProfile struct {
	RequestedExecutionLevel string `json:"requested_execution_level"`
	UIAccess                *bool  `json:"ui_access"`
}

type Manifest struct {
	Format           string                    `json:"format"`
	AppID            string                    `json:"app_id"`
	Version          string                    `json:"version"`
	TargetID         string                    `json:"target_id"`
	OS               string                    `json:"os"`
	Arch             string                    `json:"arch"`
	RuntimeEntry     string                    `json:"runtime_entry"`
	NativeTrust      ManifestNativeTrust       `json:"native_trust"`
	ExecutionProfile *ManifestExecutionProfile `json:"execution_profile"`
}

type Inspection struct {
	Manifest          Manifest
	Declaration       Declaration
	Files             int
	UncompressedBytes uint64
}

type Declaration struct {
	AppID     string
	Version   string
	AppAccess []string
}

type Materialized struct {
	Root                 string
	ManifestPath         string
	DeclarationPath      string
	RuntimeEntryPath     string
	RawDeclaration       []string
	HostExecutableSHA256 [sha256.Size]byte
	PayloadRootSHA256    [sha256.Size]byte
	Files                int
	Bytes                uint64
}

type inspectedArchive struct {
	file       *os.File
	reader     *zip.Reader
	inspection Inspection
	names      []string
}

// Inspect verifies whole-archive integrity, the closed ZIP entry profile, and
// the package manifest without creating a staging directory.
func Inspect(ctx context.Context, archivePath string, expected Expected) (Inspection, error) {
	archive, err := openAndInspect(ctx, archivePath, expected)
	if err != nil {
		return Inspection{}, err
	}
	defer func() { _ = archive.file.Close() }()
	return archive.inspection, nil
}

// Materialize performs the same complete preflight before it creates a fresh
// destination. It writes only regular files below that root with create-new
// semantics, then re-reads the staged tree to produce Runtime-owned digests.
func Materialize(ctx context.Context, archivePath string, ownerRoot *os.Root, stagingChild string, expected Expected) (result Materialized, err error) {
	archive, err := openAndInspect(ctx, archivePath, expected)
	if err != nil {
		return Materialized{}, err
	}
	defer func() { _ = archive.file.Close() }()
	destination, err := validateStagingDestination(ownerRoot, stagingChild)
	if err != nil {
		return Materialized{}, err
	}
	if err := ctx.Err(); err != nil {
		return Materialized{}, err
	}
	if err := ownerRoot.Mkdir(stagingChild, 0o700); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return Materialized{}, ErrDestinationExists
		}
		return Materialized{}, fmt.Errorf("create nimiapp staging root: %w", err)
	}
	created := true
	defer func() {
		if err != nil && created {
			_ = ownerRoot.RemoveAll(stagingChild)
		}
	}()
	root, err := ownerRoot.OpenRoot(stagingChild)
	if err != nil {
		return Materialized{}, fmt.Errorf("open nimiapp staging root: %w", err)
	}
	for _, entry := range archive.reader.File {
		if err := ctx.Err(); err != nil {
			_ = root.Close()
			return Materialized{}, err
		}
		name := filepath.FromSlash(entry.Name)
		parent := filepath.Dir(name)
		if parent != "." {
			if err := root.MkdirAll(parent, 0o700); err != nil {
				_ = root.Close()
				return Materialized{}, fmt.Errorf("create nimiapp staging directory: %w", err)
			}
		}
		input, err := entry.Open()
		if err != nil {
			_ = root.Close()
			return Materialized{}, fmt.Errorf("open nimiapp entry %s: %w", entry.Name, err)
		}
		output, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, entry.Mode().Perm())
		if err != nil {
			_ = input.Close()
			_ = root.Close()
			return Materialized{}, fmt.Errorf("create nimiapp entry %s: %w", entry.Name, err)
		}
		copyErr := copyWithContext(ctx, output, input, entry.UncompressedSize64)
		syncErr := output.Sync()
		closeOutputErr := output.Close()
		closeInputErr := input.Close()
		if copyErr != nil || syncErr != nil || closeOutputErr != nil || closeInputErr != nil {
			_ = root.Close()
			return Materialized{}, fmt.Errorf("materialize nimiapp entry %s: %w", entry.Name,
				errors.Join(copyErr, syncErr, closeOutputErr, closeInputErr))
		}
	}
	if err := root.Close(); err != nil {
		return Materialized{}, fmt.Errorf("close nimiapp staging root: %w", err)
	}
	digest, hostDigest, names, bytesTotal, err := digestMaterializedRoot(ctx, destination, expected.OS, expected.RuntimeEntry)
	if err != nil {
		return Materialized{}, err
	}
	if !equalStrings(names, archive.names) || bytesTotal != archive.inspection.UncompressedBytes {
		return Materialized{}, fmt.Errorf("verify nimiapp staged tree: %w", ErrPackageIntegrity)
	}
	created = false
	return Materialized{
		Root: destination, ManifestPath: filepath.Join(destination, "manifest.json"),
		DeclarationPath:      filepath.Join(destination, "nimi.app.yaml"),
		RuntimeEntryPath:     filepath.Join(destination, filepath.FromSlash(expected.RuntimeEntry)),
		RawDeclaration:       append([]string(nil), archive.inspection.Declaration.AppAccess...),
		HostExecutableSHA256: hostDigest, PayloadRootSHA256: digest,
		Files: archive.inspection.Files, Bytes: archive.inspection.UncompressedBytes,
	}, nil
}

func openAndInspect(ctx context.Context, archivePath string, expected Expected) (*inspectedArchive, error) {
	if ctx == nil {
		return nil, fmt.Errorf("inspect nimiapp archive: %w", ErrInvalidPackage)
	}
	if err := validateExpected(expected); err != nil {
		return nil, err
	}
	archivePath = filepath.Clean(strings.TrimSpace(archivePath))
	if archivePath == "." || !filepath.IsAbs(archivePath) {
		return nil, fmt.Errorf("open nimiapp archive: %w", ErrInvalidPackage)
	}
	file, err := os.Open(archivePath)
	if err != nil {
		return nil, fmt.Errorf("open nimiapp archive: %w", err)
	}
	closeOnError := true
	defer func() {
		if closeOnError {
			_ = file.Close()
		}
	}()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != expected.ArchiveSize {
		return nil, fmt.Errorf("verify nimiapp archive size: %w", ErrPackageIntegrity)
	}
	digest := sha256.New()
	if err := copyWithContext(ctx, digest, file, uint64(info.Size())); err != nil {
		return nil, fmt.Errorf("hash nimiapp archive: %w", err)
	}
	if hex.EncodeToString(digest.Sum(nil)) != expected.ArchiveSHA256 {
		return nil, fmt.Errorf("verify nimiapp archive SHA-256: %w", ErrPackageIntegrity)
	}
	reader, err := zip.NewReader(file, info.Size())
	if err != nil {
		return nil, fmt.Errorf("open nimiapp ZIP: %w", errors.Join(ErrInvalidPackage, err))
	}
	inspection, names, err := inspectReader(ctx, reader, expected)
	if err != nil {
		return nil, err
	}
	closeOnError = false
	return &inspectedArchive{file: file, reader: reader, inspection: inspection, names: names}, nil
}

func inspectReader(ctx context.Context, reader *zip.Reader, expected Expected) (Inspection, []string, error) {
	if reader == nil || reader.Comment != "" || len(reader.File) == 0 || len(reader.File) > maxZip32Entries {
		return Inspection{}, nil, fmt.Errorf("inspect nimiapp ZIP: %w", ErrInvalidPackage)
	}
	seen := make(map[string]struct{}, len(reader.File))
	collisions := make(map[string]string, len(reader.File))
	pathRoles := make(map[string]entryPathRole, len(reader.File)*2)
	names := make([]string, 0, len(reader.File))
	var total uint64
	var manifestEntry, licenseEntry, declarationEntry *zip.File
	payloadFiles := 0
	runtimeFound := false
	for _, entry := range reader.File {
		if err := validateZipEntry(entry, expected.OS); err != nil {
			return Inspection{}, nil, err
		}
		if _, duplicate := seen[entry.Name]; duplicate {
			return Inspection{}, nil, fmt.Errorf("inspect duplicate nimiapp entry %s: %w", entry.Name, ErrInvalidPackage)
		}
		collisionKey := targetPathCollisionKey(entry.Name, expected.OS)
		if previous, collision := collisions[collisionKey]; collision {
			return Inspection{}, nil, fmt.Errorf("inspect colliding nimiapp entries %s and %s: %w", previous, entry.Name, ErrInvalidPackage)
		}
		seen[entry.Name] = struct{}{}
		collisions[collisionKey] = entry.Name
		if err := recordEntryPathRoles(pathRoles, entry.Name, expected.OS); err != nil {
			return Inspection{}, nil, err
		}
		names = append(names, entry.Name)
		if math.MaxUint64-total < entry.UncompressedSize64 {
			return Inspection{}, nil, fmt.Errorf("inspect nimiapp size overflow: %w", ErrInvalidPackage)
		}
		total += entry.UncompressedSize64
		if total > uint64(expected.ArchiveSize) {
			return Inspection{}, nil, fmt.Errorf("inspect nimiapp expanded size: %w", ErrInvalidPackage)
		}
		switch entry.Name {
		case "manifest.json":
			manifestEntry = entry
		case "LICENSE":
			licenseEntry = entry
		case "nimi.app.yaml":
			declarationEntry = entry
		default:
			payloadFiles++
		}
		if entry.Name == expected.RuntimeEntry {
			if entry.Mode().Perm() != 0o755 {
				return Inspection{}, nil, fmt.Errorf("inspect nimiapp Runtime entry mode: %w", ErrInvalidPackage)
			}
			runtimeFound = true
		}
	}
	if manifestEntry == nil || licenseEntry == nil || declarationEntry == nil || payloadFiles == 0 || !runtimeFound {
		return Inspection{}, nil, fmt.Errorf("inspect nimiapp required entries: %w", ErrInvalidPackage)
	}
	if licenseEntry.UncompressedSize64 == 0 {
		return Inspection{}, nil, fmt.Errorf("inspect nimiapp LICENSE: %w", ErrInvalidPackage)
	}
	var manifestRaw, declarationRaw []byte
	for _, entry := range reader.File {
		var err error
		switch entry.Name {
		case "manifest.json":
			manifestRaw, err = readControlEntry(ctx, entry, maxControlDocumentBytes)
		case "nimi.app.yaml":
			declarationRaw, err = readControlEntry(ctx, entry, maxControlDocumentBytes)
		default:
			err = verifyEntryBytes(ctx, entry)
		}
		if err != nil {
			return Inspection{}, nil, fmt.Errorf("verify nimiapp entry %s: %w", entry.Name, errors.Join(ErrInvalidPackage, err))
		}
	}
	var manifest Manifest
	if err := jsonstrict.Decode(manifestRaw, &manifest); err != nil {
		return Inspection{}, nil, fmt.Errorf("decode nimiapp manifest: %w", errors.Join(ErrInvalidPackage, err))
	}
	if err := validateManifest(manifest, expected); err != nil {
		return Inspection{}, nil, err
	}
	declaration, err := validateDeclaration(declarationRaw, expected)
	if err != nil {
		return Inspection{}, nil, err
	}
	sort.Strings(names)
	return Inspection{Manifest: manifest, Declaration: declaration, Files: len(names), UncompressedBytes: total}, names, nil
}

type entryPathRole struct {
	spelling string
	file     bool
}

func recordEntryPathRoles(roles map[string]entryPathRole, name, targetOS string) error {
	segments := strings.Split(name, "/")
	for index := range segments {
		prefix := strings.Join(segments[:index+1], "/")
		key := targetPathCollisionKey(prefix, targetOS)
		isFile := index == len(segments)-1
		if previous, ok := roles[key]; ok {
			if previous.spelling != prefix || previous.file || isFile {
				return fmt.Errorf("inspect colliding nimiapp path roles %s and %s: %w", previous.spelling, prefix, ErrInvalidPackage)
			}
			continue
		}
		roles[key] = entryPathRole{spelling: prefix, file: isFile}
	}
	return nil
}

func validateZipEntry(entry *zip.File, targetOS string) error {
	if entry == nil || entry.NonUTF8 || entry.Flags != canonicalZipFlags || entry.Method != zip.Store ||
		entry.CreatorVersion != canonicalZipCreatorVersion || entry.ReaderVersion != canonicalZipReaderVersion ||
		len(entry.Extra) != 0 || entry.Comment != "" || entry.CompressedSize64 != entry.UncompressedSize64 ||
		entry.UncompressedSize64 > math.MaxUint32 || !entry.Mode().IsRegular() ||
		(entry.Mode().Perm() != 0o644 && entry.Mode().Perm() != 0o755) {
		return fmt.Errorf("inspect nimiapp entry header %q: %w", entry.Name, ErrInvalidPackage)
	}
	if err := validateEntryName(entry.Name, targetOS); err != nil {
		return err
	}
	if entry.Name == "LICENSE" || entry.Name == "manifest.json" || entry.Name == "nimi.app.yaml" {
		if entry.Mode().Perm() != 0o644 {
			return fmt.Errorf("inspect nimiapp control entry mode %q: %w", entry.Name, ErrInvalidPackage)
		}
		return nil
	}
	if !strings.HasPrefix(entry.Name, "payload/") {
		return fmt.Errorf("inspect unexpected nimiapp root entry %q: %w", entry.Name, ErrInvalidPackage)
	}
	return nil
}

func validateEntryName(name, targetOS string) error {
	if name == "" || !utf8.ValidString(name) || len([]byte(name)) > math.MaxUint16 || strings.HasPrefix(name, "/") ||
		strings.ContainsAny(name, "\\\x00") || path.Clean(name) != name {
		return fmt.Errorf("inspect nimiapp entry path %q: %w", name, ErrInvalidPackage)
	}
	segments := strings.Split(name, "/")
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return fmt.Errorf("inspect nimiapp entry path %q: %w", name, ErrInvalidPackage)
		}
		for _, character := range segment {
			if character < 0x20 || character == 0x7f {
				return fmt.Errorf("inspect nimiapp entry path %q: %w", name, ErrInvalidPackage)
			}
		}
		if targetOS == "windows" && !validWindowsSegment(segment) {
			return fmt.Errorf("inspect Windows nimiapp entry path %q: %w", name, ErrInvalidPackage)
		}
	}
	return nil
}

func validWindowsSegment(segment string) bool {
	if strings.ContainsAny(segment, `<>:"|?*`) || strings.HasSuffix(segment, ".") || strings.HasSuffix(segment, " ") {
		return false
	}
	base := strings.ToUpper(strings.TrimRight(strings.SplitN(segment, ".", 2)[0], " "))
	switch base {
	case "CON", "PRN", "AUX", "NUL", "CLOCK$", "CONIN$", "CONOUT$":
		return false
	}
	if (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && windowsDeviceNumber(base[3:]) {
		return false
	}
	return true
}

func windowsDeviceNumber(value string) bool {
	return len(value) == 1 && value[0] >= '1' && value[0] <= '9' || value == "¹" || value == "²" || value == "³"
}

func targetPathCollisionKey(name, targetOS string) string {
	normalized := norm.NFC.String(name)
	if targetOS == "windows" {
		return cases.Fold().String(normalized)
	}
	return normalized
}

func validateExpected(expected Expected) error {
	if expected.ArchiveSize <= 0 || !sha256Text(expected.ArchiveSHA256) || !exactText(expected.AppID) ||
		!exactText(expected.Version) || !exactText(expected.TargetID) || !exactText(expected.RuntimeEntry) ||
		expected.OS != "windows" || expected.Arch != "x86_64" ||
		expected.ExecutionProfileRef != windowsExecutionProfileRef {
		return fmt.Errorf("validate expected nimiapp target: %w", ErrUnsupportedTarget)
	}
	if err := validateEntryName(expected.RuntimeEntry, expected.OS); err != nil || !strings.HasPrefix(expected.RuntimeEntry, "payload/") {
		return fmt.Errorf("validate expected nimiapp Runtime entry: %w", ErrUnsupportedTarget)
	}
	declaration, _, err := appaccess.ResolveDeclaration(expected.AppAccess)
	if err != nil || !equalStrings(declaration, expected.AppAccess) {
		return fmt.Errorf("validate expected nimiapp App Access: %w", errors.Join(ErrUnsupportedTarget, err))
	}
	switch expected.NativeTrust.WindowsCodeSigning {
	case "unsigned":
		if expected.NativeTrust.SigningSubject != nil || expected.NativeTrust.ObservedSubject != nil {
			return fmt.Errorf("validate expected unsigned nimiapp target: %w", ErrUnsupportedTarget)
		}
	case "signed":
		if expected.NativeTrust.SigningSubject == nil || *expected.NativeTrust.SigningSubject != "publisher" ||
			expected.NativeTrust.ObservedSubject == nil || !exactText(*expected.NativeTrust.ObservedSubject) {
			return fmt.Errorf("validate expected signed nimiapp target: %w", ErrUnsupportedTarget)
		}
	default:
		return fmt.Errorf("validate expected nimiapp native posture: %w", ErrUnsupportedTarget)
	}
	return nil
}

func validateManifest(manifest Manifest, expected Expected) error {
	if manifest.Format != packageFormat || manifest.AppID != expected.AppID || manifest.Version != expected.Version ||
		manifest.TargetID != expected.TargetID || manifest.OS != expected.OS || manifest.Arch != expected.Arch ||
		manifest.RuntimeEntry != expected.RuntimeEntry || manifest.ExecutionProfile == nil ||
		manifest.ExecutionProfile.RequestedExecutionLevel != "asInvoker" || manifest.ExecutionProfile.UIAccess == nil ||
		*manifest.ExecutionProfile.UIAccess {
		return fmt.Errorf("validate nimiapp manifest identity: %w", ErrPackageIntegrity)
	}
	switch expected.NativeTrust.WindowsCodeSigning {
	case "unsigned":
		if manifest.NativeTrust.Posture != "production-unsigned" || manifest.NativeTrust.WindowsAuthenticode != "unsigned" ||
			!bytes.Equal(bytes.TrimSpace(manifest.NativeTrust.CertificateSubject), []byte("null")) {
			return fmt.Errorf("validate nimiapp unsigned posture: %w", ErrPackageIntegrity)
		}
	case "signed":
		var subject string
		if err := json.Unmarshal(manifest.NativeTrust.CertificateSubject, &subject); err != nil || !exactText(subject) {
			return fmt.Errorf("validate nimiapp signed subject: %w", errors.Join(ErrPackageIntegrity, err))
		}
		if manifest.NativeTrust.Posture != "observed-valid-native-signature" || manifest.NativeTrust.WindowsAuthenticode != "valid" ||
			expected.NativeTrust.ObservedSubject == nil || subject != *expected.NativeTrust.ObservedSubject {
			return fmt.Errorf("validate nimiapp signed posture: %w", ErrPackageIntegrity)
		}
	default:
		return fmt.Errorf("validate nimiapp native posture: %w", ErrPackageIntegrity)
	}
	return nil
}

func validateDeclaration(raw []byte, expected Expected) (Declaration, error) {
	var document yaml.Node
	if err := yaml.Unmarshal(raw, &document); err != nil || len(document.Content) != 1 || document.Content[0].Kind != yaml.MappingNode {
		return Declaration{}, fmt.Errorf("decode nimiapp declaration: %w", errors.Join(ErrInvalidPackage, err))
	}
	root := document.Content[0]
	keys := make(map[string]struct{}, len(root.Content)/2)
	for index := 0; index < len(root.Content); index += 2 {
		key := root.Content[index]
		if key.Kind != yaml.ScalarNode || key.Tag != "!!str" || key.Value == "" {
			return Declaration{}, fmt.Errorf("decode nimiapp declaration keys: %w", ErrInvalidPackage)
		}
		if _, duplicate := keys[key.Value]; duplicate {
			return Declaration{}, fmt.Errorf("decode duplicate nimiapp declaration key %s: %w", key.Value, ErrInvalidPackage)
		}
		keys[key.Value] = struct{}{}
		if key.Value == "permissions" {
			return Declaration{}, fmt.Errorf("decode legacy nimiapp permissions: %w", ErrInvalidPackage)
		}
		if key.Value == "local_development" && mappingContainsKey(root.Content[index+1], "runtime_scoped_binding_requests") {
			return Declaration{}, fmt.Errorf("decode legacy nimiapp Runtime bindings: %w", ErrInvalidPackage)
		}
	}
	type declarationDocument struct {
		AppID     *string   `yaml:"app_id"`
		Version   *string   `yaml:"version"`
		AppAccess *[]string `yaml:"app_access"`
	}
	var parsed declarationDocument
	if err := yaml.Unmarshal(raw, &parsed); err != nil || parsed.AppID == nil || parsed.Version == nil || parsed.AppAccess == nil {
		return Declaration{}, fmt.Errorf("decode nimiapp declaration fields: %w", errors.Join(ErrInvalidPackage, err))
	}
	appAccess, _, err := appaccess.ResolveDeclaration(*parsed.AppAccess)
	if err != nil || *parsed.AppID != expected.AppID || *parsed.Version != expected.Version || !equalStrings(appAccess, expected.AppAccess) {
		return Declaration{}, fmt.Errorf("validate nimiapp declaration: %w", errors.Join(ErrPackageIntegrity, err))
	}
	return Declaration{AppID: *parsed.AppID, Version: *parsed.Version, AppAccess: appAccess}, nil
}

func mappingContainsKey(node *yaml.Node, target string) bool {
	if node == nil || node.Kind != yaml.MappingNode {
		return false
	}
	for index := 0; index < len(node.Content); index += 2 {
		if node.Content[index].Kind == yaml.ScalarNode && node.Content[index].Value == target {
			return true
		}
	}
	return false
}

func readControlEntry(ctx context.Context, entry *zip.File, limit int64) ([]byte, error) {
	if entry == nil || entry.UncompressedSize64 == 0 || entry.UncompressedSize64 > uint64(limit) {
		return nil, ErrInvalidPackage
	}
	reader, err := entry.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = reader.Close() }()
	var raw bytes.Buffer
	raw.Grow(int(entry.UncompressedSize64))
	err = copyWithContext(ctx, &raw, reader, entry.UncompressedSize64)
	if err != nil || raw.Len() == 0 || int64(raw.Len()) > limit {
		return nil, errors.Join(ErrInvalidPackage, err)
	}
	return raw.Bytes(), nil
}

func verifyEntryBytes(ctx context.Context, entry *zip.File) error {
	reader, err := entry.Open()
	if err != nil {
		return err
	}
	copyErr := copyWithContext(ctx, io.Discard, reader, entry.UncompressedSize64)
	closeErr := reader.Close()
	return errors.Join(copyErr, closeErr)
}

func copyWithContext(ctx context.Context, destination io.Writer, source io.Reader, expected uint64) error {
	buffer := make([]byte, 128*1024)
	var written uint64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		count, readErr := source.Read(buffer)
		if count > 0 {
			if math.MaxUint64-written < uint64(count) || written+uint64(count) > expected {
				return ErrPackageIntegrity
			}
			written += uint64(count)
			if _, err := destination.Write(buffer[:count]); err != nil {
				return err
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if written != expected {
		return ErrPackageIntegrity
	}
	return nil
}

func validateStagingDestination(ownerRoot *os.Root, stagingChild string) (string, error) {
	if ownerRoot == nil || !exactText(stagingChild) || filepath.Base(stagingChild) != stagingChild ||
		strings.ContainsAny(stagingChild, `/\`) || !validWindowsSegment(stagingChild) {
		return "", fmt.Errorf("validate nimiapp staging child: %w", ErrInvalidPackage)
	}
	ownerPath := filepath.Clean(ownerRoot.Name())
	if !filepath.IsAbs(ownerPath) || ownerPath != ownerRoot.Name() {
		return "", fmt.Errorf("validate nimiapp staging owner root: %w", ErrInvalidPackage)
	}
	info, err := ownerRoot.Stat(".")
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("validate nimiapp staging owner root: %w", errors.Join(ErrInvalidPackage, err))
	}
	return filepath.Join(ownerPath, stagingChild), nil
}

func digestMaterializedRoot(ctx context.Context, rootPath, targetOS, runtimeEntry string) ([sha256.Size]byte, [sha256.Size]byte, []string, uint64, error) {
	type stagedFile struct {
		name string
		path string
		size int64
	}
	files := make([]stagedFile, 0)
	var total uint64
	err := filepath.WalkDir(rootPath, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if current == rootPath {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return ErrPackageIntegrity
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			return ErrPackageIntegrity
		}
		relative, err := filepath.Rel(rootPath, current)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		if err := validateEntryName(name, targetOS); err != nil {
			return err
		}
		if info.Size() < 0 || math.MaxUint64-total < uint64(info.Size()) {
			return ErrPackageIntegrity
		}
		total += uint64(info.Size())
		files = append(files, stagedFile{name: name, path: current, size: info.Size()})
		return nil
	})
	if err != nil {
		return [sha256.Size]byte{}, [sha256.Size]byte{}, nil, 0, fmt.Errorf("walk nimiapp staged tree: %w", err)
	}
	sort.Slice(files, func(left, right int) bool { return files[left].name < files[right].name })
	tree := sha256.New()
	_, _ = tree.Write([]byte(payloadDigestDomain))
	var hostDigest [sha256.Size]byte
	names := make([]string, 0, len(files))
	for _, file := range files {
		if err := writeDigestFile(ctx, tree, file.name, file.path, file.size); err != nil {
			return [sha256.Size]byte{}, [sha256.Size]byte{}, nil, 0, err
		}
		names = append(names, file.name)
		if file.name == runtimeEntry {
			digest, err := digestFile(ctx, file.path)
			if err != nil {
				return [sha256.Size]byte{}, [sha256.Size]byte{}, nil, 0, err
			}
			hostDigest = digest
		}
	}
	if hostDigest == ([sha256.Size]byte{}) {
		return [sha256.Size]byte{}, [sha256.Size]byte{}, nil, 0, fmt.Errorf("digest nimiapp Runtime entry: %w", ErrPackageIntegrity)
	}
	var treeDigest [sha256.Size]byte
	copy(treeDigest[:], tree.Sum(nil))
	return treeDigest, hostDigest, names, total, nil
}

func writeDigestFile(ctx context.Context, destination hash.Hash, name, filePath string, size int64) error {
	var length [8]byte
	binary.LittleEndian.PutUint64(length[:], uint64(len([]byte(name))))
	_, _ = destination.Write(length[:])
	_, _ = destination.Write([]byte(name))
	binary.LittleEndian.PutUint64(length[:], uint64(size))
	_, _ = destination.Write(length[:])
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("open staged nimiapp file %s: %w", name, err)
	}
	defer func() { _ = file.Close() }()
	if err := copyWithContext(ctx, destination, file, uint64(size)); err != nil {
		return fmt.Errorf("digest staged nimiapp file %s: %w", name, err)
	}
	return nil
}

func digestFile(ctx context.Context, filePath string) ([sha256.Size]byte, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return [sha256.Size]byte{}, err
	}
	defer func() { _ = file.Close() }()
	digest := sha256.New()
	buffer := make([]byte, 128*1024)
	for {
		if err := ctx.Err(); err != nil {
			return [sha256.Size]byte{}, err
		}
		count, readErr := file.Read(buffer)
		if count > 0 {
			_, _ = digest.Write(buffer[:count])
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return [sha256.Size]byte{}, readErr
		}
	}
	var result [sha256.Size]byte
	copy(result[:], digest.Sum(nil))
	return result, nil
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func exactText(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && utf8.ValidString(value) && !strings.ContainsAny(value, "\x00\r\n")
}

func sha256Text(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}
