package protectedlocal

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"testing"
	"time"
)

func TestWindowsReleaseTrustExecutableVerifierBindsRecordToLockedEvidenceAndAuthenticode(t *testing.T) {
	t.Parallel()

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate synthetic release-root key: %v", err)
	}
	digest := identifierFilled(0x81)
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
		Now: func() time.Time {
			return time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
		},
	}
	record := validWindowsReleaseTrustRecord(requirements.ArtifactSHA256)
	source := &testWindowsReleaseTrustRecordSource{
		encoded:      signWindowsReleaseTrustRecord(t, record, privateKey),
		requirements: requirements,
	}
	authenticode := &testWindowsAuthenticodeVerifier{}
	verifier, err := newWindowsReleaseTrustExecutableVerifier(source, authenticode)
	if err != nil {
		t.Fatalf("construct executable trust verifier: %v", err)
	}
	locked := testWindowsLockedExecutable{
		handle: 99,
		evidence: WindowsExecutableEvidence{
			PID:                   5101,
			CreationMarker:        "service-start-1",
			Path:                  `C:\Program Files\Nimi\releases\release-2026.07.11-e2e\nimi.exe`,
			CanonicalFileIdentity: "windows-volume-00000001-file-0000000000000001",
			Digest:                digest,
		},
	}

	trustSetID, err := verifier.VerifyWindowsExecutable(context.Background(), WindowsExecutableRoleRuntime, locked)
	if err != nil {
		t.Fatalf("verify locked executable: %v", err)
	}
	if trustSetID != requirements.TrustSetID || source.role != WindowsExecutableRoleRuntime {
		t.Fatalf("trust source binding = trustSet=%q role=%q", trustSetID, source.role)
	}
	if authenticode.handle != locked.handle || authenticode.leafSPKISHA256 != record.WindowsLeafSPKISHA256 || authenticode.chainPolicyRef != record.WindowsChainPolicyRef {
		t.Fatalf("Authenticode binding = %#v", authenticode)
	}

	t.Run("record requirement cannot contradict locked digest", func(t *testing.T) {
		mismatched := *source
		wrongDigest := identifierFilled(0x82)
		mismatched.requirements.ArtifactSHA256 = hex.EncodeToString(wrongDigest[:])
		verifier, err := newWindowsReleaseTrustExecutableVerifier(&mismatched, authenticode)
		if err != nil {
			t.Fatalf("construct mismatch verifier: %v", err)
		}
		if _, err := verifier.VerifyWindowsExecutable(context.Background(), WindowsExecutableRoleRuntime, locked); !IsReason(err, ReasonRuntimeExecutableTrustRecordInvalid) {
			t.Fatalf("locked digest mismatch error = %v", err)
		}
	})

	t.Run("unbound dependencies fail closed", func(t *testing.T) {
		if _, err := newWindowsReleaseTrustExecutableVerifier(nil, authenticode); !IsReason(err, ReasonRuntimeExecutableTrustRecordInvalid) {
			t.Fatalf("missing record source error = %v", err)
		}
		if _, err := newWindowsReleaseTrustExecutableVerifier(source, nil); !IsReason(err, ReasonRuntimeExecutableTrustRecordInvalid) {
			t.Fatalf("missing Authenticode verifier error = %v", err)
		}
	})

	t.Run("source role cannot contradict requested role", func(t *testing.T) {
		mismatched := *source
		mismatched.requirements.ExecutableRole = WindowsExecutableRoleDesktop
		verifier, err := newWindowsReleaseTrustExecutableVerifier(&mismatched, authenticode)
		if err != nil {
			t.Fatalf("construct role mismatch verifier: %v", err)
		}
		if _, err := verifier.VerifyWindowsExecutable(context.Background(), WindowsExecutableRoleRuntime, locked); !IsReason(err, ReasonRuntimeExecutableTrustRecordInvalid) {
			t.Fatalf("source role mismatch error = %v", err)
		}
	})

	t.Run("Authenticode denial fails closed", func(t *testing.T) {
		denied := &testWindowsAuthenticodeVerifier{err: errors.New("synthetic Authenticode denial")}
		verifier, err := newWindowsReleaseTrustExecutableVerifier(source, denied)
		if err != nil {
			t.Fatalf("construct denied verifier: %v", err)
		}
		if _, err := verifier.VerifyWindowsExecutable(context.Background(), WindowsExecutableRoleRuntime, locked); !IsReason(err, ReasonRuntimeExecutableTrustRecordInvalid) {
			t.Fatalf("Authenticode denial error = %v", err)
		}
	})
}

type testWindowsReleaseTrustRecordSource struct {
	encoded      []byte
	requirements windowsReleaseTrustRecordRequirements
	err          error
	role         WindowsExecutableRole
}

func (source *testWindowsReleaseTrustRecordSource) ReadWindowsReleaseTrustRecord(_ context.Context, role WindowsExecutableRole, _ WindowsExecutableEvidence) ([]byte, windowsReleaseTrustRecordRequirements, error) {
	source.role = role
	if source.err != nil {
		return nil, windowsReleaseTrustRecordRequirements{}, source.err
	}
	return append([]byte(nil), source.encoded...), source.requirements, nil
}

type testWindowsAuthenticodeVerifier struct {
	err            error
	handle         uintptr
	leafSPKISHA256 string
	chainPolicyRef string
}

func (verifier *testWindowsAuthenticodeVerifier) VerifyWindowsAuthenticode(_ context.Context, executable WindowsLockedExecutable, leafSPKISHA256 string, chainPolicyRef string) error {
	if verifier.err != nil {
		return verifier.err
	}
	verifier.handle = executable.NativeHandle()
	verifier.leafSPKISHA256 = leafSPKISHA256
	verifier.chainPolicyRef = chainPolicyRef
	return nil
}

type testWindowsLockedExecutable struct {
	handle   uintptr
	evidence WindowsExecutableEvidence
}

func (locked testWindowsLockedExecutable) Evidence() WindowsExecutableEvidence {
	return locked.evidence
}

func (locked testWindowsLockedExecutable) NativeHandle() uintptr { return locked.handle }

var _ WindowsExecutableTrustVerifier = (*windowsReleaseTrustExecutableVerifier)(nil)
var _ windowsReleaseTrustRecordSource = (*testWindowsReleaseTrustRecordSource)(nil)
var _ windowsAuthenticodeVerifier = (*testWindowsAuthenticodeVerifier)(nil)
