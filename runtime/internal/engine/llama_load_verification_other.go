//go:build !windows

package engine

import "github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"

// windowsLocalNTFSModelFilesEligible always returns false on non-Windows
// platforms so macOS and Linux retain full per-invocation model re-verification.
func windowsLocalNTFSModelFilesEligible([]capabilitydriver.InvocationExactBinding) bool {
	return false
}
