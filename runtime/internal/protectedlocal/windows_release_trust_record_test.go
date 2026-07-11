package protectedlocal

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"testing"
	"time"
)

func TestVerifySignedWindowsReleaseTrustRecordRequiresExactSignedRecord(t *testing.T) {
	t.Parallel()

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate synthetic release-root key: %v", err)
	}
	now := time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
	digest := identifierFilled(0x71)
	record := validWindowsReleaseTrustRecord(hex.EncodeToString(digest[:]))
	requirements := windowsReleaseTrustRecordRequirements{
		SchemaVersion:                 1,
		Environment:                   "non_product_test",
		ExecutableRole:                WindowsExecutableRoleRuntime,
		TrustSetID:                    "nimi-runtime-e2e-fixture-v1",
		OSProfile:                     "windows",
		ProtectedLocalProtocolVersion: "1",
		ReleaseID:                     "release-2026.07.11-e2e",
		SignerPolicyID:                "external-non-product-e2e-signing-policy",
		OSServicePrincipal:            "NT SERVICE/NimiRuntimeE2E",
		RootKeyID:                     "platform-release-root-e2e-v1",
		RootPublicKey:                 publicKey,
		ArtifactSHA256:                hex.EncodeToString(digest[:]),
		Now:                           func() time.Time { return now },
	}

	encoded := signWindowsReleaseTrustRecord(t, record, privateKey)
	verified, err := verifySignedWindowsReleaseTrustRecord(encoded, requirements)
	if err != nil {
		t.Fatalf("verify valid signed release record: %v", err)
	}
	if verified.TrustSetID != requirements.TrustSetID || verified.ReleaseID != requirements.ReleaseID {
		t.Fatalf("verified record = %#v", verified)
	}

	t.Run("tampered signature", func(t *testing.T) {
		tampered := signedWindowsReleaseTrustRecord(t, record, privateKey)
		last := tampered.Signature[len(tampered.Signature)-1]
		if last == 'A' {
			tampered.Signature = tampered.Signature[:len(tampered.Signature)-1] + "B"
		} else {
			tampered.Signature = tampered.Signature[:len(tampered.Signature)-1] + "A"
		}
		encoded, err := canonicalWindowsReleaseTrustRecord(tampered, true)
		if err != nil {
			t.Fatalf("canonicalize tampered signature: %v", err)
		}
		if _, err := verifySignedWindowsReleaseTrustRecord(encoded, requirements); !IsReason(err, ReasonRuntimeExecutableTrustRecordInvalid) {
			t.Fatalf("tampered signed record error = %v", err)
		}
	})

	t.Run("noncanonical JSON", func(t *testing.T) {
		noncanonical := append([]byte("\n"), encoded...)
		if _, err := verifySignedWindowsReleaseTrustRecord(noncanonical, requirements); !IsReason(err, ReasonRuntimeExecutableTrustRecordInvalid) {
			t.Fatalf("noncanonical record error = %v", err)
		}
	})

	t.Run("signed artifact mismatch", func(t *testing.T) {
		mismatched := record
		mismatchedDigest := identifierFilled(0x72)
		mismatched.ArtifactSHA256 = hex.EncodeToString(mismatchedDigest[:])
		encoded := signWindowsReleaseTrustRecord(t, mismatched, privateKey)
		if _, err := verifySignedWindowsReleaseTrustRecord(encoded, requirements); !IsReason(err, ReasonRuntimeExecutableTrustRecordInvalid) {
			t.Fatalf("signed artifact mismatch error = %v", err)
		}
	})

	t.Run("production cannot accept synthetic trust", func(t *testing.T) {
		productionRequirements := requirements
		productionRequirements.Environment = "production"
		productionRequirements.TrustSetID = WindowsRuntimeProductionTrustSetID
		productionRequirements.SignerPolicyID = "nimi-production-release-signing-policy"
		productionRequirements.RootKeyID = "platform-release-root-production-v1"
		if _, err := verifySignedWindowsReleaseTrustRecord(encoded, productionRequirements); !IsReason(err, ReasonRuntimeExecutableTrustRecordInvalid) {
			t.Fatalf("production trust isolation error = %v", err)
		}
	})
}

func validWindowsReleaseTrustRecord(artifactSHA256 string) windowsReleaseTrustRecord {
	spkiDigest := identifierFilled(0x73)
	return windowsReleaseTrustRecord{
		SchemaVersion:                 1,
		Environment:                   "non_product_test",
		ExecutableRole:                WindowsExecutableRoleRuntime,
		TrustSetID:                    "nimi-runtime-e2e-fixture-v1",
		OSProfile:                     "windows",
		ProtectedLocalProtocolVersion: "1",
		CompatiblePeerReleaseIDs:      []string{"release-2026.07.11-e2e-desktop"},
		ReleaseID:                     "release-2026.07.11-e2e",
		BuildID:                       "build-e2e-1",
		ArtifactSHA256:                artifactSHA256,
		SignerPolicyID:                "external-non-product-e2e-signing-policy",
		WindowsLeafSPKISHA256:         hex.EncodeToString(spkiDigest[:]),
		WindowsChainPolicyRef:         "external-non-product-e2e-signing-policy",
		MacOSDesignatedRequirement:    "",
		MacOSTeamID:                   "",
		MacOSCDHash:                   "",
		LinuxManifestKeyID:            "",
		OSServicePrincipal:            "NT SERVICE/NimiRuntimeE2E",
		ValidFrom:                     "2026-07-10T00:00:00Z",
		ExpiresAt:                     "2026-07-12T00:00:00Z",
		Generation:                    1,
		RootKeyID:                     "platform-release-root-e2e-v1",
	}
}

func signWindowsReleaseTrustRecord(t *testing.T, record windowsReleaseTrustRecord, privateKey ed25519.PrivateKey) []byte {
	t.Helper()
	record = signedWindowsReleaseTrustRecord(t, record, privateKey)
	encoded, err := canonicalWindowsReleaseTrustRecord(record, true)
	if err != nil {
		t.Fatalf("canonicalize synthetic signed release record: %v", err)
	}
	return encoded
}

func signedWindowsReleaseTrustRecord(t *testing.T, record windowsReleaseTrustRecord, privateKey ed25519.PrivateKey) windowsReleaseTrustRecord {
	t.Helper()
	payload, err := canonicalWindowsReleaseTrustRecord(record, false)
	if err != nil {
		t.Fatalf("canonicalize synthetic release record payload: %v", err)
	}
	record.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	return record
}

func TestCanonicalWindowsReleaseTrustRecordStringUsesJCSCompatibleEscaping(t *testing.T) {
	t.Parallel()

	encoded, err := quoteWindowsReleaseTrustJSONString("<>&\u0001\n")
	if err != nil {
		t.Fatalf("quote canonical release-record string: %v", err)
	}
	if encoded != `"<>&\u0001\n"` {
		t.Fatalf("canonical string = %q", encoded)
	}
}
