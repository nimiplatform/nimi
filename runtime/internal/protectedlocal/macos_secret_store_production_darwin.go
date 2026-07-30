//go:build darwin && cgo && !nimi_macos_local_development

package protectedlocal

import "fmt"

func openMacOSRuntimeBinarySecretStore(stateRoot string, principal macOSRuntimePrincipal) (macOSRuntimeBinarySecretStore, error) {
	if stateRoot != MacOSRuntimeStateRoot || principal.uid == 0 || principal.gid == 0 {
		return nil, fail(
			ReasonProtectedLocalCustodyBoundaryUnavailable,
			false,
			"repair_runtime_service",
			fmt.Errorf("open macOS Runtime secret custody: fixed state authority is required"),
		)
	}
	return OpenMacOSSystemKeychainSecretStore()
}
