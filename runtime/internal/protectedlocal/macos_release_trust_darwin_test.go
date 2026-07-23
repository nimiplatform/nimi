//go:build darwin && cgo && !nimi_macos_local_development

package protectedlocal

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func macOSFixtureReleaseRecord(t *testing.T, private ed25519.PrivateKey, overrides map[string]any) []byte {
	t.Helper()
	value := map[string]any{
		"schema_version":                   3,
		"environment":                      "production",
		"identity_class":                   "developer_id_application",
		"signature_algorithm":              "ed25519",
		"executable_role":                  "nimi_desktop",
		"trust_set_id":                     "nimi-desktop-production-v1",
		"os_profile":                       "macos",
		"protected_local_protocol_version": "1",
		"compatible_peer_release_ids":      []string{"runtime-2026.07"},
		"release_id":                       "desktop-2026.07",
		"build_id":                         "desktop-build-1",
		"artifact_sha256":                  strings.Repeat("11", 32),
		"signer_policy_id":                 "nimi-production-release-signing-policy",
		"windows_leaf_spki_sha256":         "",
		"windows_chain_policy_ref":         "",
		"macos_designated_requirement":     `identifier "ai.nimi.apps.nimi.desktop" and anchor apple generic and certificate leaf[subject.OU] = "ABCDE12345"`,
		"macos_team_id":                    "ABCDE12345",
		"macos_leaf_spki_sha256":           "",
		"macos_cdhash":                     strings.Repeat("22", 20),
		"macos_hardened_runtime_required":  true,
		"macos_notarization_required":      true,
		"macos_architecture":               "arm64",
		"macos_entitlements_sha256":        strings.Repeat("44", 32),
		"linux_manifest_key_id":            "",
		"os_service_principal":             "active_console_user",
		"valid_from":                       "2026-07-01T00:00:00Z",
		"expires_at":                       "2026-08-01T00:00:00Z",
		"generation":                       7,
		"root_key_id":                      "platform-release-root-fixture-v1",
	}
	for key, replacement := range overrides {
		value[key] = replacement
	}
	payload, err := marshalMacOSCanonicalJSON(value)
	if err != nil {
		t.Fatalf("canonical fixture payload: %v", err)
	}
	value["signature"] = base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, payload))
	encoded, err := marshalMacOSCanonicalJSON(value)
	if err != nil {
		t.Fatalf("canonical fixture record: %v", err)
	}
	return encoded
}

func withMacOSFixtureReleaseRoot(t *testing.T, public ed25519.PublicKey) {
	t.Helper()
	priorID := MacOSPlatformReleaseRootKeyID
	priorKey := MacOSPlatformReleaseRootPublicKeyB64
	MacOSPlatformReleaseRootKeyID = "platform-release-root-fixture-v1"
	MacOSPlatformReleaseRootPublicKeyB64 = base64.RawURLEncoding.EncodeToString(public)
	t.Cleanup(func() {
		MacOSPlatformReleaseRootKeyID = priorID
		MacOSPlatformReleaseRootPublicKeyB64 = priorKey
	})
}

func TestMacOSReleaseTrustRecordAcceptsExactCanonicalFixture(t *testing.T) {
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("fixture key: %v", err)
	}
	withMacOSFixtureReleaseRoot(t, public)
	requirements, err := macOSRoleRequirements(macOSDesktopExecutableRole)
	if err != nil {
		t.Fatalf("role requirements: %v", err)
	}
	record, err := verifyMacOSReleaseTrustRecord(
		macOSFixtureReleaseRecord(t, private, nil), requirements,
		time.Date(2026, 7, 19, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("verify fixture record: %v", err)
	}
	if record.ReleaseID != "desktop-2026.07" || record.Generation != 7 {
		t.Fatalf("verified release = %#v", record)
	}
}

func TestMacOSReleaseTrustRecordRejectsTamperingNonCanonicalAndWrongRole(t *testing.T) {
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("fixture key: %v", err)
	}
	withMacOSFixtureReleaseRoot(t, public)
	requirements, err := macOSRoleRequirements(macOSDesktopExecutableRole)
	if err != nil {
		t.Fatalf("role requirements: %v", err)
	}
	now := time.Date(2026, 7, 19, 0, 0, 0, 0, time.UTC)
	encoded := macOSFixtureReleaseRecord(t, private, nil)
	var tampered map[string]any
	if err := json.Unmarshal(encoded, &tampered); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	tampered["generation"] = float64(8)
	tamperedBytes, err := marshalMacOSCanonicalJSON(tampered)
	if err != nil {
		t.Fatalf("encode tampered fixture: %v", err)
	}
	if _, err := verifyMacOSReleaseTrustRecord(tamperedBytes, requirements, now); err == nil {
		t.Fatal("tampered record was accepted")
	}
	pretty, err := json.MarshalIndent(tampered, "", "  ")
	if err != nil {
		t.Fatalf("encode non-canonical fixture: %v", err)
	}
	if _, err := verifyMacOSReleaseTrustRecord(pretty, requirements, now); err == nil {
		t.Fatal("non-canonical record was accepted")
	}
	wrongRole := macOSFixtureReleaseRecord(t, private, map[string]any{"executable_role": "nimi_runtime_service"})
	if _, err := verifyMacOSReleaseTrustRecord(wrongRole, requirements, now); err == nil {
		t.Fatal("wrong-role record was accepted")
	}
}
