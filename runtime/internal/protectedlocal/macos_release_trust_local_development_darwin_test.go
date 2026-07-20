//go:build darwin && cgo && nimi_macos_local_development

package protectedlocal

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestMacOSLocalDevelopmentReleaseRecordRequiresExactProfileAndP256Signature(t *testing.T) {
	private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate fixture key: %v", err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&private.PublicKey)
	if err != nil {
		t.Fatalf("marshal fixture key: %v", err)
	}
	priorID := MacOSLocalDevelopmentReleaseRootKeyID
	priorKey := MacOSLocalDevelopmentReleaseRootPublicKeyB64
	MacOSLocalDevelopmentReleaseRootKeyID = "nimi-macos-local-development-record-root-v1"
	MacOSLocalDevelopmentReleaseRootPublicKeyB64 = base64.RawURLEncoding.EncodeToString(publicDER)
	t.Cleanup(func() {
		MacOSLocalDevelopmentReleaseRootKeyID = priorID
		MacOSLocalDevelopmentReleaseRootPublicKeyB64 = priorKey
	})

	value := map[string]any{
		"schema_version":                   3,
		"environment":                      "local_development",
		"identity_class":                   "local_ca",
		"signature_algorithm":              "ecdsa_p256_sha256",
		"executable_role":                  "nimi_desktop",
		"trust_set_id":                     "nimi-desktop-macos-local-development-v1",
		"os_profile":                       "macos",
		"protected_local_protocol_version": "1",
		"compatible_peer_release_ids":      []string{"runtime-dev-2026.07"},
		"release_id":                       "desktop-dev-2026.07",
		"build_id":                         "desktop-dev-build-1",
		"artifact_sha256":                  strings.Repeat("11", 32),
		"signer_policy_id":                 "nimi-macos-local-development-signing-policy",
		"windows_leaf_spki_sha256":         "",
		"windows_chain_policy_ref":         "",
		"macos_designated_requirement":     `identifier "ai.nimi.apps.nimi.desktop.dev" and anchor = H"00112233445566778899aabbccddeeff00112233"`, // pragma: allowlist secret
		"macos_team_id":                    "",
		"macos_leaf_spki_sha256":           strings.Repeat("33", 32),
		"macos_cdhash":                     strings.Repeat("22", 20),
		"macos_hardened_runtime_required":  true,
		"macos_notarization_required":      false,
		"macos_architecture":              "arm64",
		"macos_entitlements_sha256":       strings.Repeat("44", 32),
		"linux_manifest_key_id":            "",
		"os_service_principal":             "active_console_user",
		"valid_from":                       "2026-07-01T00:00:00Z",
		"expires_at":                       "2026-08-01T00:00:00Z",
		"generation":                       7,
		"root_key_id":                      "nimi-macos-local-development-record-root-v1",
	}
	encoded := signMacOSLocalDevelopmentFixture(t, private, value)
	requirements, err := macOSRoleRequirements(macOSDesktopExecutableRole)
	if err != nil {
		t.Fatalf("role requirements: %v", err)
	}
	if _, err := verifyMacOSReleaseTrustRecord(encoded, requirements, time.Date(2026, 7, 19, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("verify local-development record: %v", err)
	}

	value["macos_team_id"] = "ABCDE12345"
	resignedInvalidProfile := signMacOSLocalDevelopmentFixture(t, private, value)
	if _, err := verifyMacOSReleaseTrustRecord(resignedInvalidProfile, requirements, time.Date(2026, 7, 19, 0, 0, 0, 0, time.UTC)); err == nil {
		t.Fatal("local-development verifier accepted a nonempty Team ID")
	}
}

func signMacOSLocalDevelopmentFixture(t *testing.T, private *ecdsa.PrivateKey, value map[string]any) []byte {
	t.Helper()
	delete(value, "signature")
	payload, err := marshalMacOSCanonicalJSON(value)
	if err != nil {
		t.Fatalf("canonical local-development payload: %v", err)
	}
	digest := sha256.Sum256(payload)
	signature, err := ecdsa.SignASN1(rand.Reader, private, digest[:])
	if err != nil {
		t.Fatalf("sign local-development fixture: %v", err)
	}
	value["signature"] = base64.RawURLEncoding.EncodeToString(signature)
	encoded, err := marshalMacOSCanonicalJSON(value)
	if err != nil {
		t.Fatalf("canonical local-development record: %v", err)
	}
	return encoded
}
