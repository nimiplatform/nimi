//go:build nimi_runtime_e2e && nimi_runtime_e2e_virtual

package protectedlocal

func activeWindowsRuntimeProfile() windowsRuntimeProfile {
	return windowsRuntimeProfile{
		id:                    "windows-e2e-virtual-v1",
		serviceName:           WindowsE2EVirtualServiceName,
		serviceAccount:        WindowsE2EVirtualServiceAccount,
		serviceSID:            WindowsE2EVirtualServiceSID,
		serviceHostAccount:    WindowsE2EVirtualServiceAccount,
		serviceHostSID:        WindowsE2EVirtualServiceSID,
		custodyDescriptor:     windowsDPAPINGLocalUserDescriptor,
		desktopPipeName:       WindowsE2EVirtualDesktopPipeName,
		installedPipeName:     WindowsE2EVirtualInstalledPipeName,
		runtimeTrustSetID:     WindowsRuntimeE2EVirtualTrustSetID,
		desktopTrustSetID:     WindowsDesktopE2EVirtualTrustSetID,
		runtimeExecutableName: "nimi-runtime-e2e-virtual.exe",
		desktopExecutableName: "nimiplatform-desktop-dev-run.exe",
		stateRelativePath:     `Nimi\Runtime\E2E-Virtual`,
		nonProduct:            true,
	}
}
