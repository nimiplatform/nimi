package protectedlocal

import "fmt"

type windowsRuntimeProfile struct {
	id                    string
	serviceName           string
	serviceAccount        string
	serviceSID            string
	serviceHostAccount    string
	serviceHostSID        string
	custodyDescriptor     string
	desktopPipeName       string
	localAppPipeName      string
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
		profile.desktopPipeName == "" || profile.localAppPipeName == "" ||
		profile.runtimeTrustSetID == "" || profile.desktopTrustSetID == "" ||
		profile.runtimeExecutableName == "" || profile.desktopExecutableName == "" ||
		profile.stateRelativePath == "" {
		return fmt.Errorf("complete fixed Windows Runtime profile required")
	}
	if profile.nonProduct {
		return validateNonProductWindowsRuntimeProfile(profile)
	}
	if profile.id != "windows-production-v1" ||
		profile.serviceName != WindowsProductionServiceName ||
		profile.serviceAccount != WindowsProductionServiceAccount ||
		profile.serviceSID != WindowsProductionServiceSID ||
		profile.serviceHostAccount != WindowsServiceHostAccount ||
		profile.serviceHostSID != WindowsServiceHostSID ||
		profile.custodyDescriptor != windowsDPAPINGLocalUserDescriptor ||
		profile.desktopPipeName != WindowsProductionDesktopPipeName ||
		profile.localAppPipeName != WindowsProductionLocalAppPipeName ||
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
