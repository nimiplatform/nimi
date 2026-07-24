//go:build nimi_runtime_e2e

package protectedlocal

import "fmt"

const (
	WindowsE2EServiceName           = "NimiRuntimeE2E"
	WindowsE2EServiceAccount        = `NT SERVICE\NimiRuntimeE2E`
	WindowsE2EServiceSID            = "S-1-5-80-2508001767-432113807-2225235661-2974466524-556849280"
	WindowsE2EVirtualServiceName    = "NimiRuntimeE2EVirtual"
	WindowsE2EVirtualServiceAccount = `NT SERVICE\NimiRuntimeE2EVirtual`
	WindowsE2EVirtualServiceSID     = "S-1-5-80-614952668-3885649176-109076348-3419474809-3167076013"

	WindowsE2EDesktopPipeName         = `\\.\pipe\nimi-runtime-e2e-protected-v1`
	WindowsE2ELocalAppPipeName        = `\\.\pipe\nimi-runtime-e2e-local-app-v1`
	WindowsE2EVirtualDesktopPipeName  = `\\.\pipe\nimi-runtime-e2e-virtual-protected-v1`
	WindowsE2EVirtualLocalAppPipeName = `\\.\pipe\nimi-runtime-e2e-virtual-local-app-v1`

	WindowsDesktopE2ETrustSetID        = "nimi-desktop-e2e-fixture-v1"
	WindowsRuntimeE2ETrustSetID        = "nimi-runtime-e2e-fixture-v1"
	WindowsDesktopE2EVirtualTrustSetID = "nimi-desktop-e2e-virtual-fixture-v1"
	WindowsRuntimeE2EVirtualTrustSetID = "nimi-runtime-e2e-virtual-fixture-v1"
)

func validateNonProductWindowsRuntimeProfile(profile windowsRuntimeProfile) error {
	valid := profile.custodyDescriptor == windowsDPAPINGLocalUserDescriptor &&
		profile.desktopExecutableName == "nimiplatform-desktop-dev-run.exe"
	switch profile.id {
	case "windows-e2e-v1":
		valid = valid && profile.serviceName == WindowsE2EServiceName &&
			profile.serviceAccount == WindowsE2EServiceAccount && profile.serviceSID == WindowsE2EServiceSID &&
			profile.serviceHostAccount == WindowsServiceHostAccount && profile.serviceHostSID == WindowsServiceHostSID &&
			profile.desktopPipeName == WindowsE2EDesktopPipeName && profile.localAppPipeName == WindowsE2ELocalAppPipeName &&
			profile.runtimeTrustSetID == WindowsRuntimeE2ETrustSetID && profile.desktopTrustSetID == WindowsDesktopE2ETrustSetID &&
			profile.runtimeExecutableName == "nimi-runtime-e2e.exe" && profile.stateRelativePath == `Nimi\Runtime\E2E`
	case "windows-e2e-virtual-v1":
		valid = valid && profile.serviceName == WindowsE2EVirtualServiceName &&
			profile.serviceAccount == WindowsE2EVirtualServiceAccount && profile.serviceSID == WindowsE2EVirtualServiceSID &&
			profile.serviceHostAccount == WindowsE2EVirtualServiceAccount && profile.serviceHostSID == WindowsE2EVirtualServiceSID &&
			profile.desktopPipeName == WindowsE2EVirtualDesktopPipeName && profile.localAppPipeName == WindowsE2EVirtualLocalAppPipeName &&
			profile.runtimeTrustSetID == WindowsRuntimeE2EVirtualTrustSetID && profile.desktopTrustSetID == WindowsDesktopE2EVirtualTrustSetID &&
			profile.runtimeExecutableName == "nimi-runtime-e2e-virtual.exe" && profile.stateRelativePath == `Nimi\Runtime\E2E-Virtual`
	default:
		valid = false
	}
	if !valid {
		return fmt.Errorf("Windows Runtime E2E profile diverges from admitted fixture authority")
	}
	return nil
}
