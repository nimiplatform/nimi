package protectedlocal

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

// windowsReleaseTrustRecord is the fixed Platform release-record payload for
// a Windows protected-local executable. It deliberately has no path, endpoint,
// caller, or credential fields: service bootstrap owns record discovery and
// the verifier only authenticates already-selected record bytes.
type windowsReleaseTrustRecord struct {
	SchemaVersion                 uint64
	Environment                   string
	ExecutableRole                WindowsExecutableRole
	TrustSetID                    string
	OSProfile                     string
	ProtectedLocalProtocolVersion string
	CompatiblePeerReleaseIDs      []string
	ReleaseID                     string
	BuildID                       string
	ArtifactSHA256                string
	SignerPolicyID                string
	WindowsLeafSPKISHA256         string
	WindowsChainPolicyRef         string
	MacOSDesignatedRequirement    string
	MacOSTeamID                   string
	MacOSCDHash                   string
	LinuxManifestKeyID            string
	OSServicePrincipal            string
	ValidFrom                     string
	ExpiresAt                     string
	Generation                    uint64
	RootKeyID                     string
	Signature                     string
}

// windowsReleaseTrustRecordRequirements are derived by the protected service
// bootstrap from the signed service definition and the already-open executable
// object. This core deliberately does not accept paths, argv, environment, or
// renderer-owned values.
type windowsReleaseTrustRecordRequirements struct {
	SchemaVersion                 uint64
	Environment                   string
	ExecutableRole                WindowsExecutableRole
	TrustSetID                    string
	OSProfile                     string
	ProtectedLocalProtocolVersion string
	ReleaseID                     string
	SignerPolicyID                string
	OSServicePrincipal            string
	RootKeyID                     string
	RootPublicKey                 ed25519.PublicKey
	ArtifactSHA256                string
	Now                           func() time.Time
}

var windowsReleaseTrustRecordFields = map[string]struct{}{
	"artifact_sha256":                  {},
	"build_id":                         {},
	"compatible_peer_release_ids":      {},
	"environment":                      {},
	"executable_role":                  {},
	"expires_at":                       {},
	"generation":                       {},
	"linux_manifest_key_id":            {},
	"macos_cdhash":                     {},
	"macos_designated_requirement":     {},
	"macos_team_id":                    {},
	"os_profile":                       {},
	"os_service_principal":             {},
	"protected_local_protocol_version": {},
	"release_id":                       {},
	"root_key_id":                      {},
	"schema_version":                   {},
	"signer_policy_id":                 {},
	"signature":                        {},
	"trust_set_id":                     {},
	"valid_from":                       {},
	"windows_chain_policy_ref":         {},
	"windows_leaf_spki_sha256":         {},
}

func verifySignedWindowsReleaseTrustRecord(encoded []byte, requirements windowsReleaseTrustRecordRequirements) (windowsReleaseTrustRecord, error) {
	if err := validateWindowsReleaseTrustRecordRequirements(requirements); err != nil {
		return windowsReleaseTrustRecord{}, releaseTrustRecordFailure("validate requirements", err)
	}
	record, err := decodeWindowsReleaseTrustRecord(encoded)
	if err != nil {
		return windowsReleaseTrustRecord{}, releaseTrustRecordFailure("decode record", err)
	}
	canonicalRecord, err := canonicalWindowsReleaseTrustRecord(record, true)
	if err != nil {
		return windowsReleaseTrustRecord{}, releaseTrustRecordFailure("canonicalize record", err)
	}
	if !bytes.Equal(encoded, canonicalRecord) {
		return windowsReleaseTrustRecord{}, releaseTrustRecordFailure("verify canonical record", fmt.Errorf("record bytes are not canonical RFC8785 JSON"))
	}
	payload, err := canonicalWindowsReleaseTrustRecord(record, false)
	if err != nil {
		return windowsReleaseTrustRecord{}, releaseTrustRecordFailure("canonicalize signed payload", err)
	}
	signature, err := base64.RawURLEncoding.DecodeString(record.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize {
		if err == nil {
			err = fmt.Errorf("Ed25519 signature has invalid length")
		}
		return windowsReleaseTrustRecord{}, releaseTrustRecordFailure("decode signature", err)
	}
	if !ed25519.Verify(requirements.RootPublicKey, payload, signature) {
		return windowsReleaseTrustRecord{}, releaseTrustRecordFailure("verify root signature", fmt.Errorf("Ed25519 verification failed"))
	}
	if err := validateWindowsReleaseTrustRecord(record, requirements); err != nil {
		return windowsReleaseTrustRecord{}, releaseTrustRecordFailure("validate signed record", err)
	}
	return record, nil
}

func validateWindowsReleaseTrustRecordRequirements(requirements windowsReleaseTrustRecordRequirements) error {
	if requirements.SchemaVersion == 0 || requirements.Now == nil || len(requirements.RootPublicKey) != ed25519.PublicKeySize || !validSHA256Hex(requirements.ArtifactSHA256) {
		return fmt.Errorf("complete schema, clock, root key, and artifact digest are required")
	}
	for field, value := range map[string]string{
		"environment":                      requirements.Environment,
		"trust_set_id":                     requirements.TrustSetID,
		"os_profile":                       requirements.OSProfile,
		"protected_local_protocol_version": requirements.ProtectedLocalProtocolVersion,
		"release_id":                       requirements.ReleaseID,
		"signer_policy_id":                 requirements.SignerPolicyID,
		"os_service_principal":             requirements.OSServicePrincipal,
		"root_key_id":                      requirements.RootKeyID,
	} {
		if err := validateReleaseTrustText(field, value, true); err != nil {
			return err
		}
	}
	if requirements.ExecutableRole != WindowsExecutableRoleRuntime && requirements.ExecutableRole != WindowsExecutableRoleDesktop {
		return fmt.Errorf("admitted Windows executable role is required")
	}
	return nil
}

func validateWindowsReleaseTrustRecord(record windowsReleaseTrustRecord, requirements windowsReleaseTrustRecordRequirements) error {
	if record.SchemaVersion != requirements.SchemaVersion || record.Environment != requirements.Environment ||
		record.ExecutableRole != requirements.ExecutableRole || record.TrustSetID != requirements.TrustSetID ||
		record.OSProfile != requirements.OSProfile || record.ProtectedLocalProtocolVersion != requirements.ProtectedLocalProtocolVersion ||
		record.ReleaseID != requirements.ReleaseID || record.SignerPolicyID != requirements.SignerPolicyID ||
		record.OSServicePrincipal != requirements.OSServicePrincipal || record.RootKeyID != requirements.RootKeyID ||
		record.ArtifactSHA256 != requirements.ArtifactSHA256 {
		return fmt.Errorf("signed record does not match protected Runtime requirements")
	}
	if record.Generation == 0 || !validSHA256Hex(record.ArtifactSHA256) || !validSHA256Hex(record.WindowsLeafSPKISHA256) {
		return fmt.Errorf("signed record has invalid generation or digest")
	}
	for field, value := range map[string]string{
		"build_id":                     record.BuildID,
		"windows_chain_policy_ref":     record.WindowsChainPolicyRef,
		"signature":                    record.Signature,
		"macos_designated_requirement": record.MacOSDesignatedRequirement,
		"macos_team_id":                record.MacOSTeamID,
		"macos_cdhash":                 record.MacOSCDHash,
		"linux_manifest_key_id":        record.LinuxManifestKeyID,
	} {
		if err := validateReleaseTrustText(field, value, field != "macos_designated_requirement" && field != "macos_team_id" && field != "macos_cdhash" && field != "linux_manifest_key_id"); err != nil {
			return err
		}
	}
	if len(record.CompatiblePeerReleaseIDs) == 0 {
		return fmt.Errorf("signed record requires compatible peer releases")
	}
	seenPeers := make(map[string]struct{}, len(record.CompatiblePeerReleaseIDs))
	for _, peerReleaseID := range record.CompatiblePeerReleaseIDs {
		if err := validateReleaseTrustText("compatible_peer_release_ids", peerReleaseID, true); err != nil {
			return err
		}
		if _, duplicate := seenPeers[peerReleaseID]; duplicate {
			return fmt.Errorf("signed record repeats compatible peer release")
		}
		seenPeers[peerReleaseID] = struct{}{}
	}
	validFrom, err := time.Parse(time.RFC3339, record.ValidFrom)
	if err != nil {
		return fmt.Errorf("parse valid_from: %w", err)
	}
	expiresAt, err := time.Parse(time.RFC3339, record.ExpiresAt)
	if err != nil {
		return fmt.Errorf("parse expires_at: %w", err)
	}
	now := requirements.Now().UTC()
	if !validFrom.Before(expiresAt) || now.Before(validFrom) || !now.Before(expiresAt) {
		return fmt.Errorf("signed record is outside its validity window")
	}
	return nil
}

func decodeWindowsReleaseTrustRecord(encoded []byte) (windowsReleaseTrustRecord, error) {
	if len(encoded) == 0 || !utf8.Valid(encoded) {
		return windowsReleaseTrustRecord{}, fmt.Errorf("record requires valid UTF-8 JSON")
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	token, err := decoder.Token()
	if err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	delimiter, ok := token.(json.Delim)
	if !ok || delimiter != '{' {
		return windowsReleaseTrustRecord{}, fmt.Errorf("record must be a JSON object")
	}
	fields := make(map[string]json.RawMessage, len(windowsReleaseTrustRecordFields))
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return windowsReleaseTrustRecord{}, err
		}
		name, ok := token.(string)
		if !ok {
			return windowsReleaseTrustRecord{}, fmt.Errorf("record property must be a string")
		}
		if _, allowed := windowsReleaseTrustRecordFields[name]; !allowed {
			return windowsReleaseTrustRecord{}, fmt.Errorf("record contains unknown property %q", name)
		}
		if _, duplicate := fields[name]; duplicate {
			return windowsReleaseTrustRecord{}, fmt.Errorf("record repeats property %q", name)
		}
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			return windowsReleaseTrustRecord{}, err
		}
		fields[name] = raw
	}
	if token, err := decoder.Token(); err != nil {
		return windowsReleaseTrustRecord{}, err
	} else if delimiter, ok := token.(json.Delim); !ok || delimiter != '}' {
		return windowsReleaseTrustRecord{}, fmt.Errorf("record object did not terminate")
	}
	if _, err := decoder.Token(); err != io.EOF {
		if err == nil {
			return windowsReleaseTrustRecord{}, fmt.Errorf("record contains trailing JSON values")
		}
		return windowsReleaseTrustRecord{}, err
	}
	if len(fields) != len(windowsReleaseTrustRecordFields) {
		return windowsReleaseTrustRecord{}, fmt.Errorf("record has incomplete fixed schema")
	}

	readString := func(name string) (string, error) { return decodeReleaseTrustString(fields[name], name) }
	readUint := func(name string) (uint64, error) { return decodeReleaseTrustUint(fields[name], name) }
	record := windowsReleaseTrustRecord{}
	if record.SchemaVersion, err = readUint("schema_version"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.Environment, err = readString("environment"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	role, err := readString("executable_role")
	if err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	record.ExecutableRole = WindowsExecutableRole(role)
	if record.TrustSetID, err = readString("trust_set_id"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.OSProfile, err = readString("os_profile"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.ProtectedLocalProtocolVersion, err = readString("protected_local_protocol_version"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.CompatiblePeerReleaseIDs, err = decodeReleaseTrustStringArray(fields["compatible_peer_release_ids"], "compatible_peer_release_ids"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.ReleaseID, err = readString("release_id"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.BuildID, err = readString("build_id"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.ArtifactSHA256, err = readString("artifact_sha256"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.SignerPolicyID, err = readString("signer_policy_id"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.WindowsLeafSPKISHA256, err = readString("windows_leaf_spki_sha256"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.WindowsChainPolicyRef, err = readString("windows_chain_policy_ref"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.MacOSDesignatedRequirement, err = readString("macos_designated_requirement"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.MacOSTeamID, err = readString("macos_team_id"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.MacOSCDHash, err = readString("macos_cdhash"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.LinuxManifestKeyID, err = readString("linux_manifest_key_id"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.OSServicePrincipal, err = readString("os_service_principal"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.ValidFrom, err = readString("valid_from"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.ExpiresAt, err = readString("expires_at"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.Generation, err = readUint("generation"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.RootKeyID, err = readString("root_key_id"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	if record.Signature, err = readString("signature"); err != nil {
		return windowsReleaseTrustRecord{}, err
	}
	return record, nil
}

func decodeReleaseTrustString(raw json.RawMessage, field string) (string, error) {
	if len(raw) < 2 || raw[0] != '"' {
		return "", fmt.Errorf("record field %s must be a JSON string", field)
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	return value, nil
}

func decodeReleaseTrustUint(raw json.RawMessage, field string) (uint64, error) {
	if len(raw) == 0 || raw[0] < '0' || raw[0] > '9' {
		return 0, fmt.Errorf("record field %s must be an unsigned integer", field)
	}
	var value uint64
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, err
	}
	return value, nil
}

func decodeReleaseTrustStringArray(raw json.RawMessage, field string) ([]string, error) {
	if len(raw) < 2 || raw[0] != '[' {
		return nil, fmt.Errorf("record field %s must be a JSON string array", field)
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	if values == nil {
		return nil, fmt.Errorf("record field %s must not be null", field)
	}
	return values, nil
}

func canonicalWindowsReleaseTrustRecord(record windowsReleaseTrustRecord, includeSignature bool) ([]byte, error) {
	fields := make([]windowsReleaseTrustCanonicalField, 0, len(windowsReleaseTrustRecordFields))
	addString := func(name, value string) error {
		encoded, err := quoteWindowsReleaseTrustJSONString(value)
		if err != nil {
			return err
		}
		fields = append(fields, windowsReleaseTrustCanonicalField{name: name, value: encoded})
		return nil
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{"environment", record.Environment},
		{"executable_role", string(record.ExecutableRole)},
		{"trust_set_id", record.TrustSetID},
		{"os_profile", record.OSProfile},
		{"protected_local_protocol_version", record.ProtectedLocalProtocolVersion},
		{"release_id", record.ReleaseID},
		{"build_id", record.BuildID},
		{"artifact_sha256", record.ArtifactSHA256},
		{"signer_policy_id", record.SignerPolicyID},
		{"windows_leaf_spki_sha256", record.WindowsLeafSPKISHA256},
		{"windows_chain_policy_ref", record.WindowsChainPolicyRef},
		{"macos_designated_requirement", record.MacOSDesignatedRequirement},
		{"macos_team_id", record.MacOSTeamID},
		{"macos_cdhash", record.MacOSCDHash},
		{"linux_manifest_key_id", record.LinuxManifestKeyID},
		{"os_service_principal", record.OSServicePrincipal},
		{"valid_from", record.ValidFrom},
		{"expires_at", record.ExpiresAt},
		{"root_key_id", record.RootKeyID},
	} {
		if err := addString(field.name, field.value); err != nil {
			return nil, err
		}
	}
	peerReleases, err := canonicalWindowsReleaseTrustStringArray(record.CompatiblePeerReleaseIDs)
	if err != nil {
		return nil, err
	}
	fields = append(fields,
		windowsReleaseTrustCanonicalField{name: "schema_version", value: strconv.FormatUint(record.SchemaVersion, 10)},
		windowsReleaseTrustCanonicalField{name: "generation", value: strconv.FormatUint(record.Generation, 10)},
		windowsReleaseTrustCanonicalField{name: "compatible_peer_release_ids", value: peerReleases},
	)
	if includeSignature {
		if err := addString("signature", record.Signature); err != nil {
			return nil, err
		}
	}
	sort.Slice(fields, func(left, right int) bool {
		return compareWindowsReleaseTrustJSONKeys(fields[left].name, fields[right].name) < 0
	})
	var builder strings.Builder
	builder.WriteByte('{')
	for index, field := range fields {
		if index > 0 {
			builder.WriteByte(',')
		}
		name, err := quoteWindowsReleaseTrustJSONString(field.name)
		if err != nil {
			return nil, err
		}
		builder.WriteString(name)
		builder.WriteByte(':')
		builder.WriteString(field.value)
	}
	builder.WriteByte('}')
	return []byte(builder.String()), nil
}

type windowsReleaseTrustCanonicalField struct {
	name  string
	value string
}

func canonicalWindowsReleaseTrustStringArray(values []string) (string, error) {
	var builder strings.Builder
	builder.WriteByte('[')
	for index, value := range values {
		if index > 0 {
			builder.WriteByte(',')
		}
		encoded, err := quoteWindowsReleaseTrustJSONString(value)
		if err != nil {
			return "", err
		}
		builder.WriteString(encoded)
	}
	builder.WriteByte(']')
	return builder.String(), nil
}

func quoteWindowsReleaseTrustJSONString(value string) (string, error) {
	if !utf8.ValidString(value) {
		return "", fmt.Errorf("canonical JSON string is not valid UTF-8")
	}
	var builder strings.Builder
	builder.Grow(len(value) + 2)
	builder.WriteByte('"')
	for _, runeValue := range value {
		switch runeValue {
		case '"':
			builder.WriteString(`\"`)
		case '\\':
			builder.WriteString(`\\`)
		case '\b':
			builder.WriteString(`\b`)
		case '\f':
			builder.WriteString(`\f`)
		case '\n':
			builder.WriteString(`\n`)
		case '\r':
			builder.WriteString(`\r`)
		case '\t':
			builder.WriteString(`\t`)
		default:
			if runeValue <= 0x1f {
				builder.WriteString(`\u00`)
				builder.WriteByte("0123456789abcdef"[(runeValue>>4)&0x0f])
				builder.WriteByte("0123456789abcdef"[runeValue&0x0f])
			} else {
				builder.WriteRune(runeValue)
			}
		}
	}
	builder.WriteByte('"')
	return builder.String(), nil
}

func compareWindowsReleaseTrustJSONKeys(left, right string) int {
	leftUnits := utf16.Encode([]rune(left))
	rightUnits := utf16.Encode([]rune(right))
	for index := 0; index < len(leftUnits) && index < len(rightUnits); index++ {
		if leftUnits[index] < rightUnits[index] {
			return -1
		}
		if leftUnits[index] > rightUnits[index] {
			return 1
		}
	}
	switch {
	case len(leftUnits) < len(rightUnits):
		return -1
	case len(leftUnits) > len(rightUnits):
		return 1
	default:
		return 0
	}
}

func validateReleaseTrustText(field, value string, required bool) error {
	if !utf8.ValidString(value) || strings.TrimSpace(value) != value || (required && value == "") {
		return fmt.Errorf("record field %s is invalid", field)
	}
	for _, runeValue := range value {
		if runeValue < 0x20 || runeValue == 0x7f {
			return fmt.Errorf("record field %s contains a control character", field)
		}
	}
	return nil
}

func validSHA256Hex(value string) bool {
	if len(value) != 64 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32
}

func releaseTrustRecordFailure(operation string, cause error) error {
	return fail(
		ReasonRuntimeExecutableTrustRecordInvalid,
		false,
		"repair_runtime_service",
		fmt.Errorf("verify signed Windows release trust record %s: %w", operation, cause),
	)
}
