//go:build darwin && cgo

package protectedlocal

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

const (
	macOSReleaseRecordMaxBytes = 64 * 1024
	macOSReleaseRecordSchema   = 2
	macOSReleaseOSProfile      = "macos"
	macOSReleaseProtocol       = "1"

	macOSRuntimeExecutableRole   = "nimi_runtime_service"
	macOSDesktopExecutableRole   = "nimi_desktop"
	macOSLocalHostExecutableRole = "nimi_local_app_host"

	macOSRuntimeRecordFile   = "nimi_runtime_service.release-trust-record.json"
	macOSDesktopRecordFile   = "nimi_desktop.release-trust-record.json"
	macOSLocalHostRecordFile = "nimi_local_app_host.release-trust-record.json"
)

type macOSReleaseTrustRecord struct {
	SchemaVersion                 uint64   `json:"schema_version"`
	Environment                   string   `json:"environment"`
	IdentityClass                 string   `json:"identity_class"`
	SignatureAlgorithm            string   `json:"signature_algorithm"`
	ExecutableRole                string   `json:"executable_role"`
	TrustSetID                    string   `json:"trust_set_id"`
	OSProfile                     string   `json:"os_profile"`
	ProtectedLocalProtocolVersion string   `json:"protected_local_protocol_version"`
	CompatiblePeerReleaseIDs      []string `json:"compatible_peer_release_ids"`
	ReleaseID                     string   `json:"release_id"`
	BuildID                       string   `json:"build_id"`
	ArtifactSHA256                string   `json:"artifact_sha256"`
	SignerPolicyID                string   `json:"signer_policy_id"`
	WindowsLeafSPKISHA256         string   `json:"windows_leaf_spki_sha256"`
	WindowsChainPolicyRef         string   `json:"windows_chain_policy_ref"`
	MacOSDesignatedRequirement    string   `json:"macos_designated_requirement"`
	MacOSTeamID                   string   `json:"macos_team_id"`
	MacOSLeafSPKISHA256           string   `json:"macos_leaf_spki_sha256"`
	MacOSCDHash                   string   `json:"macos_cdhash"`
	MacOSHardenedRuntimeRequired  bool     `json:"macos_hardened_runtime_required"`
	MacOSNotarizationRequired     bool     `json:"macos_notarization_required"`
	LinuxManifestKeyID            string   `json:"linux_manifest_key_id"`
	OSServicePrincipal            string   `json:"os_service_principal"`
	ValidFrom                     string   `json:"valid_from"`
	ExpiresAt                     string   `json:"expires_at"`
	Generation                    uint64   `json:"generation"`
	RootKeyID                     string   `json:"root_key_id"`
	Signature                     string   `json:"signature"`
}

type macOSRoleTrustRequirements struct {
	role              string
	trustSetID        string
	signingIdentifier string
	servicePrincipal  string
	recordFile        string
}

func macOSRoleRequirements(role string) (macOSRoleTrustRequirements, error) {
	switch role {
	case macOSRuntimeExecutableRole:
		return macOSRoleTrustRequirements{
			role: role, trustSetID: MacOSRuntimeTrustSetID,
			signingIdentifier: MacOSRuntimeSigningIdentifier,
			servicePrincipal:  MacOSRuntimeAccountName, recordFile: macOSRuntimeRecordFile,
		}, nil
	case macOSDesktopExecutableRole:
		return macOSRoleTrustRequirements{
			role: role, trustSetID: MacOSDesktopTrustSetID,
			signingIdentifier: MacOSDesktopSigningIdentifier,
			servicePrincipal:  "active_console_user", recordFile: macOSDesktopRecordFile,
		}, nil
	case macOSLocalHostExecutableRole:
		return macOSRoleTrustRequirements{
			role: role, trustSetID: MacOSLocalAppHostTrustSet,
			signingIdentifier: MacOSLocalAppHostIdentifier,
			servicePrincipal:  "verified_desktop_supervised_active_console_user",
			recordFile:        macOSLocalHostRecordFile,
		}, nil
	default:
		return macOSRoleTrustRequirements{}, fmt.Errorf("unknown macOS protected-local executable role")
	}
}

func loadMacOSCodePolicy(role string) (macOSCodePolicy, error) {
	requirements, err := macOSRoleRequirements(role)
	if err != nil {
		return macOSCodePolicy{}, err
	}
	record, err := loadVerifiedMacOSReleaseTrustRecord(requirements)
	if err != nil {
		return macOSCodePolicy{}, err
	}
	desktopRecord := record
	if role != macOSDesktopExecutableRole {
		desktopRequirements, err := macOSRoleRequirements(macOSDesktopExecutableRole)
		if err != nil {
			return macOSCodePolicy{}, err
		}
		desktopRecord, err = loadVerifiedMacOSReleaseTrustRecord(desktopRequirements)
		if err != nil {
			return macOSCodePolicy{}, err
		}
	}
	if err := verifyMacOSOuterBundleSeal(
		MacOSDesktopApplicationPath,
		desktopRecord.MacOSDesignatedRequirement,
		desktopRecord.MacOSTeamID,
		desktopRecord.MacOSLeafSPKISHA256,
		MacOSDesktopSigningIdentifier,
		macOSProfileRequiresTrustedAnchor,
		macOSProfileRequiresNotarization,
	); err != nil {
		return macOSCodePolicy{}, err
	}
	digestBytes, err := hex.DecodeString(record.ArtifactSHA256)
	if err != nil || len(digestBytes) != sha256.Size {
		return macOSCodePolicy{}, fmt.Errorf("macOS release trust record artifact digest is invalid")
	}
	var digest Identifier
	copy(digest[:], digestBytes)
	return macOSCodePolicy{
		executableRole:           requirements.role,
		teamID:                   record.MacOSTeamID,
		leafSPKISHA256:           record.MacOSLeafSPKISHA256,
		signingIdentifier:        requirements.signingIdentifier,
		designatedRequirement:    record.MacOSDesignatedRequirement,
		releaseCDHash:            record.MacOSCDHash,
		artifactDigest:           digest,
		trustSetID:               requirements.trustSetID,
		releaseID:                record.ReleaseID,
		compatiblePeerReleaseIDs: append([]string(nil), record.CompatiblePeerReleaseIDs...),
		generation:               record.Generation,
	}, nil
}

func loadVerifiedMacOSReleaseTrustRecord(requirements macOSRoleTrustRequirements) (macOSReleaseTrustRecord, error) {
	recordPath := filepath.Join(MacOSReleaseTrustRecordRoot, requirements.recordFile)
	encoded, err := readFixedMacOSReleaseRecord(recordPath)
	if err != nil {
		return macOSReleaseTrustRecord{}, err
	}
	return verifyMacOSReleaseTrustRecord(encoded, requirements, time.Now().UTC())
}

func readFixedMacOSReleaseRecord(path string) ([]byte, error) {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if cleaned != path || !strings.HasPrefix(cleaned, MacOSReleaseTrustRecordRoot+string(filepath.Separator)) {
		return nil, fmt.Errorf("macOS release trust record path is not fixed")
	}
	relative, err := filepath.Rel("/", cleaned)
	if err != nil || relative == "." || strings.HasPrefix(relative, "..") {
		return nil, fmt.Errorf("macOS release trust record escapes the installer trust root")
	}
	components := strings.Split(relative, string(filepath.Separator))
	parentFD, err := unix.Open("/", unix.O_RDONLY|unix.O_CLOEXEC|unix.O_DIRECTORY, 0)
	if err != nil {
		return nil, fmt.Errorf("open macOS release trust filesystem root: %w", err)
	}
	defer func() {
		if parentFD >= 0 {
			_ = unix.Close(parentFD)
		}
	}()
	var rootMetadata unix.Stat_t
	if err := unix.Fstat(parentFD, &rootMetadata); err != nil ||
		rootMetadata.Mode&unix.S_IFMT != unix.S_IFDIR || rootMetadata.Uid != 0 ||
		rootMetadata.Mode&0o022 != 0 || rootMetadata.Nlink == 0 {
		return nil, fmt.Errorf("macOS release trust filesystem root is not a stable root-owned nonwritable directory")
	}
	current := ""
	var recordStat unix.Stat_t
	for index, component := range components {
		last := index == len(components)-1
		flags := macOSReleaseRecordOpenFlags(last)
		openedFD, openErr := unix.Openat(parentFD, component, flags, 0)
		if openErr != nil {
			return nil, fmt.Errorf("open macOS release trust record component %s: %w", filepath.Join("/", current, component), openErr)
		}
		var metadata unix.Stat_t
		if statErr := unix.Fstat(openedFD, &metadata); statErr != nil {
			_ = unix.Close(openedFD)
			return nil, fmt.Errorf("inspect macOS release trust record component %s: %w", filepath.Join("/", current, component), statErr)
		}
		current = filepath.Join(current, component)
		componentPath := filepath.Join("/", current)
		if validationErr := validateMacOSReleaseRecordPathComponent(componentPath, metadata, last); validationErr != nil {
			_ = unix.Close(openedFD)
			return nil, validationErr
		}
		_ = unix.Close(parentFD)
		parentFD = openedFD
		if last {
			recordStat = metadata
		}
	}
	file := os.NewFile(uintptr(parentFD), cleaned)
	if file == nil {
		_ = unix.Close(parentFD)
		parentFD = -1
		return nil, fmt.Errorf("adopt macOS release trust record descriptor")
	}
	parentFD = -1
	defer func() { _ = file.Close() }()
	if recordStat.Size <= 0 || recordStat.Size > macOSReleaseRecordMaxBytes {
		return nil, fmt.Errorf("macOS release trust record vnode is invalid")
	}
	encoded, err := io.ReadAll(io.LimitReader(file, macOSReleaseRecordMaxBytes+1))
	if err != nil || len(encoded) == 0 || len(encoded) > macOSReleaseRecordMaxBytes {
		return nil, fmt.Errorf("read bounded macOS release trust record")
	}
	var after unix.Stat_t
	if err := unix.Fstat(int(file.Fd()), &after); err != nil ||
		after.Dev != recordStat.Dev || after.Ino != recordStat.Ino ||
		after.Mode != recordStat.Mode || after.Uid != recordStat.Uid ||
		after.Gid != recordStat.Gid || after.Nlink != recordStat.Nlink ||
		after.Size != recordStat.Size || after.Mtim != recordStat.Mtim ||
		after.Ctim != recordStat.Ctim || int64(len(encoded)) != recordStat.Size {
		return nil, fmt.Errorf("macOS release trust record vnode changed while being read")
	}
	return encoded, nil
}

func macOSReleaseRecordOpenFlags(finalRecord bool) int {
	flags := unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW
	if finalRecord {
		return flags | unix.O_NONBLOCK
	}
	return flags | unix.O_DIRECTORY
}

func validateMacOSReleaseRecordPathComponent(path string, metadata unix.Stat_t, finalRecord bool) error {
	if finalRecord {
		if metadata.Uid != 0 || metadata.Gid != 0 || metadata.Mode&unix.S_IFMT != unix.S_IFREG ||
			metadata.Mode&0o777 != 0o644 || metadata.Nlink != 1 {
			return fmt.Errorf("macOS release trust record path component %s violates the exact root:wheel 0644 single-link record policy", path)
		}
		return nil
	}
	if metadata.Mode&unix.S_IFMT != unix.S_IFDIR || metadata.Uid != 0 || metadata.Nlink == 0 {
		return fmt.Errorf("macOS release trust record path component %s is not a root-owned stable directory", path)
	}
	if path == "/Library" || path == "/Library/Application Support" {
		if metadata.Mode&0o022 != 0 {
			return fmt.Errorf("macOS release trust record OS-owned ancestor %s is group- or world-writable", path)
		}
		return nil
	}
	if path == "/Library/Application Support/Nimi" || strings.HasPrefix(path, "/Library/Application Support/Nimi/") {
		if metadata.Gid != 0 || metadata.Mode&0o777 != 0o755 {
			return fmt.Errorf("macOS release trust record Nimi-owned directory %s is not exact root:wheel 0755", path)
		}
		return nil
	}
	return fmt.Errorf("macOS release trust record path component %s is outside the admitted ancestor classes", path)
}

func verifyMacOSReleaseTrustRecord(encoded []byte, requirements macOSRoleTrustRequirements, now time.Time) (macOSReleaseTrustRecord, error) {
	embeddedRootKeyID, embeddedRootKey := macOSReleaseRootInputs()
	rootKeyID := strings.TrimSpace(embeddedRootKeyID)
	rootKeyEncoded := strings.TrimSpace(embeddedRootKey)
	if !validMacOSReleaseText(rootKeyID, 128) || rootKeyEncoded == "" {
		return macOSReleaseTrustRecord{}, fmt.Errorf("macOS Platform release root is not embedded")
	}
	rootKey, err := base64.RawURLEncoding.DecodeString(rootKeyEncoded)
	if err != nil || len(rootKey) == 0 {
		return macOSReleaseTrustRecord{}, fmt.Errorf("macOS Platform release root is invalid")
	}

	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil {
		return macOSReleaseTrustRecord{}, fmt.Errorf("decode macOS release trust record: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return macOSReleaseTrustRecord{}, fmt.Errorf("macOS release trust record has trailing content")
	}
	canonical, err := marshalMacOSCanonicalJSON(value)
	if err != nil || !bytes.Equal(canonical, encoded) {
		return macOSReleaseTrustRecord{}, fmt.Errorf("macOS release trust record is not canonical JSON")
	}
	var record macOSReleaseTrustRecord
	strict := json.NewDecoder(bytes.NewReader(encoded))
	strict.DisallowUnknownFields()
	if err := strict.Decode(&record); err != nil {
		return macOSReleaseTrustRecord{}, fmt.Errorf("decode strict macOS release trust record: %w", err)
	}
	signatureValue, ok := value["signature"].(string)
	if !ok || signatureValue != record.Signature {
		return macOSReleaseTrustRecord{}, fmt.Errorf("macOS release trust record signature field is invalid")
	}
	delete(value, "signature")
	payload, err := marshalMacOSCanonicalJSON(value)
	if err != nil {
		return macOSReleaseTrustRecord{}, fmt.Errorf("canonicalize macOS release trust payload: %w", err)
	}
	signature, err := base64.RawURLEncoding.DecodeString(record.Signature)
	if err != nil || !verifyMacOSReleaseRecordSignature(rootKey, payload, signature) {
		return macOSReleaseTrustRecord{}, fmt.Errorf("macOS release trust record signature is invalid")
	}
	if err := validateMacOSReleaseTrustRecord(record, requirements, rootKeyID, now); err != nil {
		return macOSReleaseTrustRecord{}, err
	}
	return record, nil
}

func verifyMacOSReleaseRecordSignature(rootKey, payload, signature []byte) bool {
	switch macOSReleaseSignatureAlgorithm {
	case "ed25519":
		return len(rootKey) == ed25519.PublicKeySize && len(signature) == ed25519.SignatureSize &&
			ed25519.Verify(ed25519.PublicKey(rootKey), payload, signature)
	case "ecdsa_p256_sha256":
		public, err := x509.ParsePKIXPublicKey(rootKey)
		if err != nil {
			return false
		}
		ecdsaPublic, ok := public.(*ecdsa.PublicKey)
		if !ok || ecdsaPublic.Curve.Params().Name != "P-256" {
			return false
		}
		digest := sha256.Sum256(payload)
		return ecdsa.VerifyASN1(ecdsaPublic, digest[:], signature)
	default:
		return false
	}
}

func marshalMacOSCanonicalJSON(value any) ([]byte, error) {
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	encoded := output.Bytes()
	if len(encoded) == 0 || encoded[len(encoded)-1] != '\n' {
		return nil, fmt.Errorf("canonical JSON encoder did not terminate the value")
	}
	return append([]byte(nil), encoded[:len(encoded)-1]...), nil
}

func validateMacOSReleaseTrustRecord(record macOSReleaseTrustRecord, requirements macOSRoleTrustRequirements, rootKeyID string, now time.Time) error {
	if record.SchemaVersion != macOSReleaseRecordSchema ||
		record.Environment != macOSReleaseEnvironment || record.ExecutableRole != requirements.role ||
		record.IdentityClass != macOSReleaseIdentityClass ||
		record.SignatureAlgorithm != macOSReleaseSignatureAlgorithm ||
		record.TrustSetID != requirements.trustSetID || record.OSProfile != macOSReleaseOSProfile ||
		record.ProtectedLocalProtocolVersion != macOSReleaseProtocol ||
		record.SignerPolicyID != macOSReleaseSignerPolicy || record.RootKeyID != rootKeyID ||
		record.OSServicePrincipal != requirements.servicePrincipal || record.Generation == 0 ||
		record.WindowsLeafSPKISHA256 != "" || record.WindowsChainPolicyRef != "" ||
		record.LinuxManifestKeyID != "" || !validMacOSReleaseText(record.ReleaseID, 128) ||
		!validMacOSReleaseText(record.BuildID, 128) || !validMacOSProfileTeamID(record.MacOSTeamID) ||
		!validMacOSProfileLeafSPKI(record.MacOSLeafSPKISHA256) ||
		record.MacOSHardenedRuntimeRequired != true ||
		record.MacOSNotarizationRequired != macOSProfileRequiresNotarization ||
		!validMacOSRequirement(record.MacOSDesignatedRequirement) || !validMacOSCDHash(record.MacOSCDHash) ||
		!validLowerHex(record.ArtifactSHA256, sha256.Size*2) {
		return fmt.Errorf("macOS release trust record fields do not match the fixed role policy")
	}
	if len(record.CompatiblePeerReleaseIDs) == 0 || len(record.CompatiblePeerReleaseIDs) > 16 ||
		!sort.StringsAreSorted(record.CompatiblePeerReleaseIDs) {
		return fmt.Errorf("macOS release trust record compatible peers are not canonical")
	}
	for index, releaseID := range record.CompatiblePeerReleaseIDs {
		if !validMacOSReleaseText(releaseID, 128) || (index > 0 && releaseID == record.CompatiblePeerReleaseIDs[index-1]) {
			return fmt.Errorf("macOS release trust record compatible peers are invalid")
		}
	}
	validFrom, err := time.Parse(time.RFC3339, record.ValidFrom)
	if err != nil || validFrom.Format(time.RFC3339) != record.ValidFrom {
		return fmt.Errorf("macOS release trust record valid_from is invalid")
	}
	expiresAt, err := time.Parse(time.RFC3339, record.ExpiresAt)
	if err != nil || expiresAt.Format(time.RFC3339) != record.ExpiresAt || !validFrom.Before(expiresAt) || now.Before(validFrom) || !now.Before(expiresAt) {
		return fmt.Errorf("macOS release trust record is outside its validity interval")
	}
	return nil
}

func requireMacOSReleaseCompatibility(left, right macOSCodePolicy) error {
	if left.releaseID == "" || right.releaseID == "" ||
		!containsSortedReleaseID(left.compatiblePeerReleaseIDs, right.releaseID) ||
		!containsSortedReleaseID(right.compatiblePeerReleaseIDs, left.releaseID) {
		return fmt.Errorf("macOS protected-local peer release records are not mutually compatible")
	}
	return nil
}

func containsSortedReleaseID(values []string, expected string) bool {
	index := sort.SearchStrings(values, expected)
	return index < len(values) && values[index] == expected
}

func validMacOSReleaseText(value string, maximum int) bool {
	if value == "" || len(value) > maximum || strings.TrimSpace(value) != value || !utf8.ValidString(value) {
		return false
	}
	for _, character := range value {
		if character > 0x7f || character < 0x21 || character == '\\' || character == '/' {
			return false
		}
	}
	return true
}

func validMacOSTeamID(value string) bool {
	if len(value) != 10 {
		return false
	}
	for _, character := range value {
		if (character < 'A' || character > 'Z') && (character < '0' || character > '9') {
			return false
		}
	}
	return true
}

func validMacOSRequirement(value string) bool {
	if value == "" || len(value) > 2048 || strings.TrimSpace(value) != value || !utf8.ValidString(value) {
		return false
	}
	for _, character := range value {
		if character > 0x7f || character == 0 || character < 0x20 {
			return false
		}
	}
	return true
}

func validMacOSCDHash(value string) bool {
	return (len(value) == 40 || len(value) == 64) && validLowerHex(value, len(value))
}

func validLowerHex(value string, exact int) bool {
	if len(value) != exact {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}
