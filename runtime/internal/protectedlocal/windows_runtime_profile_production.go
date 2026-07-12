//go:build !nimi_runtime_e2e

package protectedlocal

func activeWindowsRuntimeProfile() windowsRuntimeProfile {
	return windowsRuntimeProfile{
		id:                    "windows-production-v1",
		serviceName:           WindowsProductionServiceName,
		serviceAccount:        WindowsProductionServiceAccount,
		serviceSID:            WindowsProductionServiceSID,
		serviceHostAccount:    WindowsServiceHostAccount,
		serviceHostSID:        WindowsServiceHostSID,
		custodyDescriptor:     windowsDPAPINGLocalUserDescriptor,
		desktopPipeName:       WindowsProductionDesktopPipeName,
		installedPipeName:     WindowsProductionInstalledPipeName,
		runtimeTrustSetID:     WindowsRuntimeProductionTrustSetID,
		desktopTrustSetID:     WindowsDesktopProductionTrustSetID,
		runtimeExecutableName: "nimi.exe",
		desktopExecutableName: "Nimi Desktop Runtime.exe",
		stateRelativePath:     `Nimi\Runtime\Protected`,
		nonProduct:            false,
	}
}
