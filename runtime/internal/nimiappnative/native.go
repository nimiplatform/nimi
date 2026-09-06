package nimiappnative

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

const WindowsExecutionProfileRef = "windows-user-mode-as-invoker-v1"

var (
	ErrUnsupportedPlatform   = errors.New("native App verification is unsupported on this platform")
	ErrInvalidExpectation    = errors.New("invalid native App expectation")
	ErrNativeVerification    = errors.New("native App verification failed")
	ErrNativePostureMismatch = errors.New("native App posture mismatch")
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-024b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a

type WindowsExpectation struct {
	Arch                string
	ExecutionProfileRef string
	WindowsCodeSigning  string
	SigningSubject      *string
	ObservedSubject     *string
}

type WindowsObservation struct {
	Arch                    string
	WindowsCodeSigning      string
	CertificateSubject      *string
	RequestedExecutionLevel string
	UIAccess                bool
	HostExecutableSHA256    [sha256.Size]byte
}

type WindowsVerifier struct {
	expected WindowsExpectation
}

func NewWindowsVerifier(expected WindowsExpectation) (*WindowsVerifier, error) {
	if err := validateWindowsExpectation(expected); err != nil {
		return nil, err
	}
	return &WindowsVerifier{expected: cloneWindowsExpectation(expected)}, nil
}

func (verifier *WindowsVerifier) Verify(
	ctx context.Context,
	executablePath string,
	executableSHA256 [sha256.Size]byte,
) error {
	if verifier == nil {
		return fmt.Errorf("verify Windows App Runtime entry: %w", ErrInvalidExpectation)
	}
	_, err := VerifyWindowsRuntimeEntry(ctx, executablePath, verifier.expected, executableSHA256)
	return err
}

func VerifyWindowsRuntimeEntry(
	ctx context.Context,
	executablePath string,
	expected WindowsExpectation,
	expectedSHA256 [sha256.Size]byte,
) (WindowsObservation, error) {
	if ctx == nil || expectedSHA256 == ([sha256.Size]byte{}) {
		return WindowsObservation{}, fmt.Errorf("verify Windows App Runtime entry input: %w", ErrInvalidExpectation)
	}
	if err := validateWindowsExpectation(expected); err != nil {
		return WindowsObservation{}, err
	}
	observation, err := verifyWindowsRuntimeEntry(ctx, executablePath, expectedSHA256)
	if err != nil {
		return WindowsObservation{}, err
	}
	if err := matchWindowsObservation(observation, expected); err != nil {
		return WindowsObservation{}, err
	}
	return cloneWindowsObservation(observation), nil
}

func validateWindowsExpectation(expected WindowsExpectation) error {
	if expected.Arch != "x86_64" || expected.ExecutionProfileRef != WindowsExecutionProfileRef {
		return fmt.Errorf("validate Windows App Runtime entry target: %w", ErrInvalidExpectation)
	}
	switch expected.WindowsCodeSigning {
	case "unsigned":
		if expected.SigningSubject != nil || expected.ObservedSubject != nil {
			return fmt.Errorf("validate unsigned Windows App expectation: %w", ErrInvalidExpectation)
		}
	case "signed":
		if expected.SigningSubject == nil || *expected.SigningSubject != "publisher" ||
			expected.ObservedSubject == nil || !exactText(*expected.ObservedSubject) {
			return fmt.Errorf("validate signed Windows App expectation: %w", ErrInvalidExpectation)
		}
	default:
		return fmt.Errorf("validate Windows App signing expectation: %w", ErrInvalidExpectation)
	}
	return nil
}

func matchWindowsObservation(observation WindowsObservation, expected WindowsExpectation) error {
	if observation.Arch != expected.Arch || observation.RequestedExecutionLevel != "asInvoker" || observation.UIAccess {
		return fmt.Errorf("match Windows App execution posture: %w", ErrNativePostureMismatch)
	}
	switch expected.WindowsCodeSigning {
	case "unsigned":
		if observation.WindowsCodeSigning != "unsigned" || observation.CertificateSubject != nil {
			return fmt.Errorf("match unsigned Windows App posture: %w", ErrNativePostureMismatch)
		}
	case "signed":
		if observation.WindowsCodeSigning != "signed" || observation.CertificateSubject == nil ||
			expected.ObservedSubject == nil || *observation.CertificateSubject != *expected.ObservedSubject {
			return fmt.Errorf("match signed Windows App posture: %w", ErrNativePostureMismatch)
		}
	default:
		return fmt.Errorf("match Windows App posture: %w", ErrNativePostureMismatch)
	}
	return nil
}

func cloneWindowsExpectation(expected WindowsExpectation) WindowsExpectation {
	result := expected
	if expected.SigningSubject != nil {
		value := *expected.SigningSubject
		result.SigningSubject = &value
	}
	if expected.ObservedSubject != nil {
		value := *expected.ObservedSubject
		result.ObservedSubject = &value
	}
	return result
}

func cloneWindowsObservation(observation WindowsObservation) WindowsObservation {
	result := observation
	if observation.CertificateSubject != nil {
		value := *observation.CertificateSubject
		result.CertificateSubject = &value
	}
	return result
}

func exactText(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && utf8.ValidString(value) && !strings.ContainsAny(value, "\x00\r\n")
}
