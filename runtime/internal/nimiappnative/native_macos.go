package nimiappnative

import (
	"context"
	"crypto/sha256"
	"fmt"
)

const MacOSExecutionProfileRef = "macos-user-mode-same-session-v1"

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

type MacOSExpectation struct {
	Arch                string
	ExecutionProfileRef string
	SigningSubject      *string
	ObservedSubject     *string
	DeveloperIDSubject  *string
	Notarization        string
}

type MacOSObservation struct {
	DeveloperIDSubject   *string
	Notarization         string
	HostExecutableSHA256 [sha256.Size]byte
}

type MacOSVerifier struct{ expected MacOSExpectation }

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-024b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
func NewMacOSVerifier(expected MacOSExpectation) (*MacOSVerifier, error) {
	if err := validateMacOSExpectation(expected); err != nil {
		return nil, err
	}
	expected.SigningSubject = cloneString(expected.SigningSubject)
	expected.ObservedSubject = cloneString(expected.ObservedSubject)
	expected.DeveloperIDSubject = cloneString(expected.DeveloperIDSubject)
	return &MacOSVerifier{expected: expected}, nil
}

func (verifier *MacOSVerifier) Verify(ctx context.Context, executablePath string, digest [sha256.Size]byte) error {
	if verifier == nil {
		return ErrInvalidExpectation
	}
	_, err := VerifyMacOSRuntimeEntry(ctx, executablePath, verifier.expected, digest)
	return err
}

func VerifyMacOSRuntimeEntry(ctx context.Context, executablePath string, expected MacOSExpectation, digest [sha256.Size]byte) (MacOSObservation, error) {
	if ctx == nil || digest == ([sha256.Size]byte{}) {
		return MacOSObservation{}, ErrInvalidExpectation
	}
	if err := validateMacOSExpectation(expected); err != nil {
		return MacOSObservation{}, err
	}
	observed, err := verifyMacOSRuntimeEntry(ctx, executablePath, digest)
	if err != nil {
		return MacOSObservation{}, err
	}
	if observed.Notarization != expected.Notarization || (observed.DeveloperIDSubject == nil) != (expected.DeveloperIDSubject == nil) || (observed.DeveloperIDSubject != nil && *observed.DeveloperIDSubject != *expected.DeveloperIDSubject) {
		return MacOSObservation{}, fmt.Errorf("match macOS native posture: %w", ErrNativePostureMismatch)
	}
	return observed, nil
}

func validateMacOSExpectation(expected MacOSExpectation) error {
	if expected.Arch != "arm64" || expected.ExecutionProfileRef != MacOSExecutionProfileRef {
		return ErrInvalidExpectation
	}
	if expected.SigningSubject == nil {
		if expected.ObservedSubject != nil || expected.DeveloperIDSubject != nil || expected.Notarization != "absent" {
			return ErrInvalidExpectation
		}
		return nil
	}
	if *expected.SigningSubject != "publisher" || expected.ObservedSubject == nil || expected.DeveloperIDSubject == nil || !exactText(*expected.DeveloperIDSubject) || *expected.ObservedSubject != *expected.DeveloperIDSubject || (expected.Notarization != "absent" && expected.Notarization != "notarized") {
		return ErrInvalidExpectation
	}
	return nil
}
