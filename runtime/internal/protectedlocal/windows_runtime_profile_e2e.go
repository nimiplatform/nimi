//go:build nimi_runtime_e2e && !nimi_runtime_e2e_virtual

package protectedlocal

func activeWindowsRuntimeProfile() windowsRuntimeProfile {
	return windowsRuntimeProfile{
		id:                    "windows-e2e-v1",
		serviceName:           WindowsE2EServiceName,
		serviceAccount:        WindowsE2EServiceAccount,
		serviceSID:            WindowsE2EServiceSID,
		serviceHostAccount:    WindowsServiceHostAccount,
		serviceHostSID:        WindowsServiceHostSID,
		custodyDescriptor:     windowsDPAPINGLocalUserDescriptor,
		desktopPipeName:       WindowsE2EDesktopPipeName,
		localAppPipeName:      WindowsE2ELocalAppPipeName,
		runtimeTrustSetID:     WindowsRuntimeE2ETrustSetID,
		desktopTrustSetID:     WindowsDesktopE2ETrustSetID,
		runtimeExecutableName: "nimi-runtime-e2e.exe",
		desktopExecutableName: "nimiplatform-desktop-dev-run.exe",
		stateRelativePath:     `Nimi\Runtime\E2E`,
		nonProduct:            true,
	}
}
