//go:build !windows

package daemon

import "github.com/nimiplatform/nimi/runtime/internal/protectedlocal"

func installedProcessVerifierForWindowsState(*protectedlocal.WindowsRuntimeSecurityState) (protectedlocal.InstalledProcessVerifier, error) {
	// Non-Windows builds retain the authority shape for compile coverage but
	// cannot admit a Windows process. The handler remains fail-closed.
	return nil, nil
}

func localDevelopmentProcessVerifierForWindowsState(*protectedlocal.WindowsRuntimeSecurityState) (protectedlocal.LocalDevelopmentProcessVerifier, error) {
	return nil, nil
}
