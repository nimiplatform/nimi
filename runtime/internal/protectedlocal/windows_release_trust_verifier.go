package protectedlocal

import (
	"context"
	"encoding/hex"
	"fmt"
)

// windowsReleaseTrustRecordSource is implemented by the protected service
// bootstrap. It locates a signed release record and derives its fixed
// requirements from the signed service definition; callers cannot provide a
// record path, root key, or trust-set selection.
type windowsReleaseTrustRecordSource interface {
	ReadWindowsReleaseTrustRecord(context.Context, WindowsExecutableRole, WindowsExecutableEvidence) ([]byte, windowsReleaseTrustRecordRequirements, error)
}

// windowsAuthenticodeVerifier validates the certificate chain for the exact
// file object that remains locked while the release record is checked.
type windowsAuthenticodeVerifier interface {
	VerifyWindowsAuthenticode(context.Context, WindowsLockedExecutable, string, string) error
}

// windowsReleaseTrustExecutableVerifier binds one locked executable to its
// service-selected signed release record and Authenticode policy. It is a core
// seam: the Windows service bootstrap owns record discovery and the native
// backend owns WinVerifyTrust, while this type prevents either from drifting
// away from the locked file evidence.
type windowsReleaseTrustExecutableVerifier struct {
	recordSource windowsReleaseTrustRecordSource
	authenticode windowsAuthenticodeVerifier
}

func newWindowsReleaseTrustExecutableVerifier(recordSource windowsReleaseTrustRecordSource, authenticode windowsAuthenticodeVerifier) (*windowsReleaseTrustExecutableVerifier, error) {
	if recordSource == nil {
		return nil, releaseTrustRecordFailure("construct executable verifier", fmt.Errorf("service-owned release record source is required"))
	}
	if authenticode == nil {
		return nil, releaseTrustRecordFailure("construct executable verifier", fmt.Errorf("locked-file Authenticode verifier is required"))
	}
	return &windowsReleaseTrustExecutableVerifier{
		recordSource: recordSource,
		authenticode: authenticode,
	}, nil
}

func (verifier *windowsReleaseTrustExecutableVerifier) VerifyWindowsExecutable(ctx context.Context, role WindowsExecutableRole, executable WindowsLockedExecutable) (string, error) {
	if verifier == nil || verifier.recordSource == nil || verifier.authenticode == nil {
		return "", releaseTrustRecordFailure("verify executable", fmt.Errorf("complete executable verifier dependencies are required"))
	}
	if executable == nil {
		return "", releaseTrustRecordFailure("verify executable", fmt.Errorf("locked executable is required"))
	}

	evidence := executable.Evidence()
	if evidence.Digest == (Identifier{}) {
		return "", releaseTrustRecordFailure("verify executable", fmt.Errorf("locked executable digest is required"))
	}
	encoded, requirements, err := verifier.recordSource.ReadWindowsReleaseTrustRecord(ctx, role, evidence)
	if err != nil {
		return "", releaseTrustRecordFailure("read service-owned release record", err)
	}
	if requirements.ExecutableRole != role {
		return "", releaseTrustRecordFailure("bind executable role", fmt.Errorf("release record requirements role %q does not match requested role %q", requirements.ExecutableRole, role))
	}
	if requirements.ArtifactSHA256 != hex.EncodeToString(evidence.Digest[:]) {
		return "", releaseTrustRecordFailure("bind executable digest", fmt.Errorf("release record requirements digest does not match locked executable"))
	}

	record, err := verifySignedWindowsReleaseTrustRecord(encoded, requirements)
	if err != nil {
		return "", err
	}
	if err := verifier.authenticode.VerifyWindowsAuthenticode(ctx, executable, record.WindowsLeafSPKISHA256, record.WindowsChainPolicyRef); err != nil {
		return "", releaseTrustRecordFailure("verify locked executable Authenticode", err)
	}
	return record.TrustSetID, nil
}

var _ WindowsExecutableTrustVerifier = (*windowsReleaseTrustExecutableVerifier)(nil)
