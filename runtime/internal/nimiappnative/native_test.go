package nimiappnative

import (
	"crypto/sha256"
	"errors"
	"testing"
)

func TestWindowsExpectationAndObservationStayClosed(t *testing.T) {
	publisher := "publisher"
	subject := "CN=Example Publisher"
	validSigned := WindowsExpectation{
		Arch: "x86_64", ExecutionProfileRef: WindowsExecutionProfileRef,
		WindowsCodeSigning: "signed", SigningSubject: &publisher, ObservedSubject: &subject,
	}
	for _, invalid := range []WindowsExpectation{
		{},
		{Arch: "arm64", ExecutionProfileRef: WindowsExecutionProfileRef, WindowsCodeSigning: "unsigned"},
		{Arch: "x86_64", ExecutionProfileRef: "other", WindowsCodeSigning: "unsigned"},
		{Arch: "x86_64", ExecutionProfileRef: WindowsExecutionProfileRef, WindowsCodeSigning: "unsigned", ObservedSubject: &subject},
		{Arch: "x86_64", ExecutionProfileRef: WindowsExecutionProfileRef, WindowsCodeSigning: "signed", SigningSubject: &publisher},
	} {
		if _, err := NewWindowsVerifier(invalid); !errors.Is(err, ErrInvalidExpectation) {
			t.Fatalf("invalid expectation %+v error = %v", invalid, err)
		}
	}
	if _, err := NewWindowsVerifier(validSigned); err != nil {
		t.Fatal(err)
	}
	otherSubject := "CN=Other Publisher"
	for _, observation := range []WindowsObservation{
		{},
		{Arch: "x86_64", WindowsCodeSigning: "unsigned", RequestedExecutionLevel: "highestAvailable"},
		{Arch: "x86_64", WindowsCodeSigning: "unsigned", RequestedExecutionLevel: "asInvoker", UIAccess: true},
		{Arch: "x86_64", WindowsCodeSigning: "signed", CertificateSubject: &otherSubject, RequestedExecutionLevel: "asInvoker"},
	} {
		observation.HostExecutableSHA256 = sha256.Sum256([]byte("fixture"))
		if err := matchWindowsObservation(observation, validSigned); !errors.Is(err, ErrNativePostureMismatch) {
			t.Fatalf("invalid observation %+v error = %v", observation, err)
		}
	}
}
