//go:build windows

package daemon

import "github.com/nimiplatform/nimi/runtime/internal/protectedlocal"

func installedProcessVerifierForWindowsState(state *protectedlocal.WindowsRuntimeSecurityState) (protectedlocal.InstalledProcessVerifier, error) {
	executableVerifier, err := protectedlocal.NewWindowsNativeExecutableTrustVerifier()
	if err != nil {
		return nil, err
	}
	return protectedlocal.NewWindowsInstalledProcessVerifier(state.DesktopIdentity(), executableVerifier)
}
