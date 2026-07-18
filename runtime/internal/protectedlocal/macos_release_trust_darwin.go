//go:build darwin && cgo

package protectedlocal

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
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
	macOSReleaseRecordSchema   = 1
	macOSReleaseOSProfile      = "macos"
	macOSReleaseProtocol       = "1"
	macOSReleaseEnvironment    = "production"
	macOSReleaseSignerPolicy   = "nimi-production-release-signing-policy"

	macOSRuntimeExecutableRole   = "nimi_runtime_service"
	macOSDesktopExecutableRole   = "nimi_desktop"
	macOSLocalHostExecutableRole = "nimi_local_app_host"

	macOSRuntimeRecordFile   = "nimi_runtime_service.release-trust-record.json"
	macOSDesktopRecordFile   = "nimi_desktop.release-trust-record.json"
	macOSLocalHostRecordFile = "nimi_local_app_host.release-trust-record.json"
)

// These are stable release-root verification inputs injected by the guarded
// production build. They do not vary per candidate and therefore do not create
// a code-signing cycle. Empty/default values fail closed.
var (
	MacOSPlatformReleaseRootKeyID        string
	MacOSPlatformReleaseRootPublicKeyB64 string
)

type macOSReleaseTrustRecord struct {
	SchemaVersion                 uint64   `json:"schema_version"`
	Environment                   string   `json:"environment"`
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
	MacOSCDHash                   string   `json:"macos_cdhash"`
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
			role: role, trustSetID: MacOSRuntimeProductionTrustSetID,
			signingIdentifier: MacOSRuntimeSigningIdentifier,
			servicePrincipal:  MacOSRuntimeAccountName, recordFile: macOSRuntimeRecordFile,
		}, nil
	case macOSDesktopExecutableRole:
		return macOSRoleTrustRequirements{
			role: role, trustSetID: MacOSDesktopProductionTrustSetID,
			signingIdentifier: MacOSDesktopSigningIdentifier,
			servicePrincipal:  "active_console_user", recordFile: macOSDesktopRecordFile,
		}, nil
	case macOSLocalHostExecutableRole:
		return macOSRoleTrustRequirements{
			role: role, trustSetID: MacOSLocalDevelopmentTrustSetID,
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
		desktopRecord.MacOSDesignatedRequirement,
		desktopRecord.MacOSTeamID,
		MacOSDesktopSigningIdentifier,
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
	current := "/Library"
	relative, err := filepath.Rel(current, cleaned)
	if err != nil || strings.HasPrefix(relative, "..") {
		return nil, fmt.Errorf("macOS release trust record escapes the installer trust root")
	}
	components := strings.Split(relative, string(filepath.Separator))
	for index, component := range components {
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("macOS release trust record path contains a missing or symlinked component")
		}
		stat, ok := info.Sys().(*unix.Stat_t)
		last := index == len(components)-1
		if !ok || stat.Uid != 0 || stat.Gid != 0 ||
			(!last && (!info.IsDir() || info.Mode().Perm() != 0o755 || stat.Nlink < 2)) ||
			(last && (!info.Mode().IsRegular() || info.Mode().Perm() != 0o644 || stat.Nlink != 1)) {
			return nil, fmt.Errorf("macOS release trust record path owner, mode, kind, or link count is invalid")
		}
	}
	fd, err := unix.Open(cleaned, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, fmt.Errorf("open macOS release trust record: %w", err)
	}
	file := os.NewFile(uintptr(fd), cleaned)
	if file == nil {
		_ = unix.Close(fd)
		return nil, fmt.Errorf("adopt macOS release trust record descriptor")
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	stat, ok := infoSys(info)
	if err != nil || info == nil || !info.Mode().IsRegular() || !ok || stat.Uid != 0 || stat.Gid != 0 ||
		info.Mode().Perm() != 0o644 || stat.Nlink != 1 || info.Size() <= 0 || info.Size() > macOSReleaseRecordMaxBytes {
		return nil, fmt.Errorf("macOS release trust record vnode is invalid")
	}
	encoded, err := io.ReadAll(io.LimitReader(file, macOSReleaseRecordMaxBytes+1))
	if err != nil || len(encoded) == 0 || len(encoded) > macOSReleaseRecordMaxBytes {
		return nil, fmt.Errorf("read bounded macOS release trust record")
	}
	return encoded, nil
}

func infoSys(info os.FileInfo) (*unix.Stat_t, bool) {
	if info == nil {
		return nil, false
	}
	stat, ok := info.Sys().(*unix.Stat_t)
	return stat, ok
}

func verifyMacOSReleaseTrustRecord(encoded []byte, requirements macOSRoleTrustRequirements, now time.Time) (macOSReleaseTrustRecord, error) {
	rootKeyID := strings.TrimSpace(MacOSPlatformReleaseRootKeyID)
	rootKeyEncoded := strings.TrimSpace(MacOSPlatformReleaseRootPublicKeyB64)
	if !validMacOSReleaseText(rootKeyID, 128) || rootKeyEncoded == "" {
		return macOSReleaseTrustRecord{}, fmt.Errorf("macOS Platform release root is not embedded")
	}
	rootKey, err := base64.RawURLEncoding.DecodeString(rootKeyEncoded)
	if err != nil || len(rootKey) != ed25519.PublicKeySize {
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
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(rootKey), payload, signature) {
		return macOSReleaseTrustRecord{}, fmt.Errorf("macOS release trust record signature is invalid")
	}
	if err := validateMacOSReleaseTrustRecord(record, requirements, rootKeyID, now); err != nil {
		return macOSReleaseTrustRecord{}, err
	}
	return record, nil
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
		record.TrustSetID != requirements.trustSetID || record.OSProfile != macOSReleaseOSProfile ||
		record.ProtectedLocalProtocolVersion != macOSReleaseProtocol ||
		record.SignerPolicyID != macOSReleaseSignerPolicy || record.RootKeyID != rootKeyID ||
		record.OSServicePrincipal != requirements.servicePrincipal || record.Generation == 0 ||
		record.WindowsLeafSPKISHA256 != "" || record.WindowsChainPolicyRef != "" ||
		record.LinuxManifestKeyID != "" || !validMacOSReleaseText(record.ReleaseID, 128) ||
		!validMacOSReleaseText(record.BuildID, 128) || !validMacOSTeamID(record.MacOSTeamID) ||
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
