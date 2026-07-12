package protectedlocal

import "fmt"

const (
	WindowsE2EServiceName    = "NimiRuntimeE2E"
	WindowsE2EServiceAccount = `NT SERVICE\NimiRuntimeE2E`
	WindowsE2EServiceSID     = "S-1-5-80-2508001767-432113807-2225235661-2974466524-556849280"

	WindowsE2EDesktopPipeName   = `\\.\pipe\nimi-runtime-e2e-protected-v1`
	WindowsE2EInstalledPipeName = `\\.\pipe\nimi-runtime-e2e-installed-v1`

	WindowsDesktopE2ETrustSetID = "nimi-desktop-e2e-fixture-v1"
	WindowsRuntimeE2ETrustSetID = "nimi-runtime-e2e-fixture-v1"
)

type windowsRuntimeProfile struct {
	id                    string
	serviceName           string
	serviceAccount        string
	serviceSID            string
	serviceHostAccount    string
	serviceHostSID        string
	custodyDescriptor     string
	desktopPipeName       string
	installedPipeName     string
	runtimeTrustSetID     string
	desktopTrustSetID     string
	runtimeExecutableName string
	desktopExecutableName string
	stateRelativePath     string
	nonProduct            bool
}

func (profile windowsRuntimeProfile) validate() error {
	if profile.id == "" || profile.serviceName == "" || profile.serviceAccount == "" ||
		profile.serviceSID == "" || profile.serviceHostAccount == "" || profile.serviceHostSID == "" || profile.custodyDescriptor == "" ||
		profile.desktopPipeName == "" || profile.installedPipeName == "" ||
		profile.runtimeTrustSetID == "" || profile.desktopTrustSetID == "" ||
		profile.runtimeExecutableName == "" || profile.desktopExecutableName == "" ||
		profile.stateRelativePath == "" {
		return fmt.Errorf("complete fixed Windows Runtime profile required")
	}
	if profile.nonProduct {
		if profile.id != "windows-e2e-v1" ||
			profile.serviceName != WindowsE2EServiceName ||
			profile.serviceAccount != WindowsE2EServiceAccount ||
			profile.serviceSID != WindowsE2EServiceSID ||
			profile.serviceHostAccount != WindowsServiceHostAccount ||
			profile.serviceHostSID != WindowsServiceHostSID ||
			profile.custodyDescriptor != windowsDPAPINGLocalUserDescriptor ||
			profile.desktopPipeName != WindowsE2EDesktopPipeName ||
			profile.installedPipeName != WindowsE2EInstalledPipeName ||
			profile.runtimeTrustSetID != WindowsRuntimeE2ETrustSetID ||
			profile.desktopTrustSetID != WindowsDesktopE2ETrustSetID ||
			profile.runtimeExecutableName != "nimi-runtime-e2e.exe" ||
			profile.desktopExecutableName != "nimiplatform-desktop-dev-run.exe" ||
			profile.stateRelativePath != `Nimi\Runtime\E2E` {
			return fmt.Errorf("Windows Runtime E2E profile diverges from admitted fixture authority")
		}
		return nil
	}
	if profile.id != "windows-production-v1" ||
		profile.serviceName != WindowsProductionServiceName ||
		profile.serviceAccount != WindowsProductionServiceAccount ||
		profile.serviceSID != WindowsProductionServiceSID ||
		profile.serviceHostAccount != WindowsServiceHostAccount ||
		profile.serviceHostSID != WindowsServiceHostSID ||
		profile.custodyDescriptor != windowsDPAPINGLocalUserDescriptor ||
		profile.desktopPipeName != WindowsProductionDesktopPipeName ||
		profile.installedPipeName != WindowsProductionInstalledPipeName ||
		profile.runtimeTrustSetID != WindowsRuntimeProductionTrustSetID ||
		profile.desktopTrustSetID != WindowsDesktopProductionTrustSetID ||
		profile.runtimeExecutableName != "nimi.exe" ||
		profile.desktopExecutableName != "Nimi Desktop Runtime.exe" ||
		profile.stateRelativePath != `Nimi\Runtime\Protected` {
		return fmt.Errorf("Windows Runtime production profile diverges from admitted authority")
	}
	return nil
}

func mustActiveWindowsRuntimeProfile() windowsRuntimeProfile {
	profile := activeWindowsRuntimeProfile()
	if err := profile.validate(); err != nil {
		panic(err)
	}
	return profile
}

func WindowsRuntimeServiceName() string {
	return mustActiveWindowsRuntimeProfile().serviceName
}

func WindowsRuntimeStateRelativePath() string {
	return mustActiveWindowsRuntimeProfile().stateRelativePath
}

func WindowsRuntimeIsNonProductFixture() bool {
	return mustActiveWindowsRuntimeProfile().nonProduct
}
