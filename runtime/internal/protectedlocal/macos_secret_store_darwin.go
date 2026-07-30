//go:build darwin && cgo

package protectedlocal

import (
	"fmt"
	"regexp"
)

const macOSRuntimeMaxSecretBytes = 65536

var macOSRuntimeSecretNamePattern = regexp.MustCompile(`^[a-z][a-z0-9.-]{0,62}[a-z0-9]$|^[a-z]$`)

type macOSRuntimeBinarySecretStore interface {
	BinarySecretStore
	Close() error
}

func validateMacOSRuntimeSecretName(name string) error {
	if !macOSRuntimeSecretNamePattern.MatchString(name) {
		return fail(
			ReasonProtectedLocalCustodyBoundaryUnavailable,
			false,
			"repair_runtime_service",
			fmt.Errorf("validate macOS Runtime secret name: invalid logical identifier"),
		)
	}
	return nil
}
