//go:build windows && nimi_runtime_e2e

package protectedlocal

import "testing"

func TestWindowsE2ERuntimeProfileIsSeparateAndClosed(t *testing.T) {
	profile := activeWindowsRuntimeProfile()
	if !profile.nonProduct {
		t.Fatalf("active E2E service profile = %+v", profile)
	}
	switch profile.id {
	case "windows-e2e-v1":
		if profile.serviceName != WindowsE2EServiceName || profile.serviceAccount != WindowsE2EServiceAccount ||
			profile.serviceSID != WindowsE2EServiceSID || profile.serviceHostAccount != WindowsServiceHostAccount ||
			profile.serviceHostSID != WindowsServiceHostSID || profile.desktopPipeName != WindowsE2EDesktopPipeName ||
			profile.installedPipeName != WindowsE2EInstalledPipeName || profile.runtimeTrustSetID != WindowsRuntimeE2ETrustSetID ||
			profile.desktopTrustSetID != WindowsDesktopE2ETrustSetID {
			t.Fatalf("active LocalSystem E2E profile = %+v", profile)
		}
	case "windows-e2e-virtual-v1":
		if profile.serviceName != WindowsE2EVirtualServiceName || profile.serviceAccount != WindowsE2EVirtualServiceAccount ||
			profile.serviceSID != WindowsE2EVirtualServiceSID || profile.serviceHostAccount != WindowsE2EVirtualServiceAccount ||
			profile.serviceHostSID != WindowsE2EVirtualServiceSID || profile.desktopPipeName != WindowsE2EVirtualDesktopPipeName ||
			profile.installedPipeName != WindowsE2EVirtualInstalledPipeName || profile.runtimeTrustSetID != WindowsRuntimeE2EVirtualTrustSetID ||
			profile.desktopTrustSetID != WindowsDesktopE2EVirtualTrustSetID {
			t.Fatalf("active virtual-account E2E profile = %+v", profile)
		}
	default:
		t.Fatalf("unknown E2E profile = %+v", profile)
	}
	if profile.custodyDescriptor != windowsDPAPINGLocalUserDescriptor {
		t.Fatalf("active E2E custody profile = %+v", profile)
	}
	if profile.serviceName == WindowsProductionServiceName ||
		profile.serviceSID == WindowsProductionServiceSID ||
		profile.desktopPipeName == WindowsProductionDesktopPipeName ||
		profile.installedPipeName == WindowsProductionInstalledPipeName {
		t.Fatal("E2E profile collided with production authority")
	}
}

func TestWindowsE2EPrincipalComparisonVariantsCannotShareServiceStateOrPipes(t *testing.T) {
	values := []string{
		WindowsE2EServiceName, WindowsE2EVirtualServiceName,
		WindowsE2EServiceSID, WindowsE2EVirtualServiceSID,
		WindowsE2EDesktopPipeName, WindowsE2EVirtualDesktopPipeName,
		WindowsE2EInstalledPipeName, WindowsE2EVirtualInstalledPipeName,
		WindowsProductionServiceName, WindowsProductionServiceSID,
		WindowsProductionDesktopPipeName, WindowsProductionInstalledPipeName,
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			t.Fatalf("Windows fixture or production authority collided on %q", value)
		}
		seen[value] = struct{}{}
	}
	if WindowsE2EServiceAccount == WindowsE2EVirtualServiceAccount {
		t.Fatal("LocalSystem-hosted and virtual-account fixtures share a service principal name")
	}
}

func TestWindowsE2EProfileDrivesPrincipalAndExecutableAdmission(t *testing.T) {
	profile := activeWindowsRuntimeProfile()
	principal, err := validateWindowsPrincipalSnapshot(windowsPrincipalSnapshot{
		ResolvedServiceSID: profile.serviceSID,
		ServiceStartName:   profile.serviceHostAccount,
		TokenUserSID:       profile.serviceHostSID,
		TokenSessionID:     0,
		TokenType:          windowsTokenPrimary,
		TokenRestricted:    true,
		ServiceSIDType:     windowsServiceSIDTypeRestricted,
		Groups: []windowsSIDAttributes{
			{SID: profile.serviceSID, Attributes: windowsGroupEnabled},
			{SID: windowsServiceLogonSID, Attributes: windowsGroupEnabled},
		},
		RestrictedSIDs: []windowsSIDAttributes{{SID: profile.serviceSID}},
	})
	if err != nil {
		t.Fatalf("validate E2E principal snapshot: %v", err)
	}
	if principal.ServiceSID() != profile.serviceSID {
		t.Fatalf("E2E principal SID = %q", principal.ServiceSID())
	}
	if _, err := validateWindowsPrincipalSnapshot(windowsPrincipalSnapshot{
		ResolvedServiceSID: WindowsProductionServiceSID,
	}); err == nil {
		t.Fatal("E2E binary admitted the production service principal")
	}

	runtimeName, runtimeTrust, err := windowsExecutableRolePolicy(WindowsExecutableRoleRuntime)
	if err != nil || runtimeName != profile.runtimeExecutableName || runtimeTrust != profile.runtimeTrustSetID {
		t.Fatalf("E2E Runtime executable policy = (%q, %q, %v)", runtimeName, runtimeTrust, err)
	}
	desktopName, desktopTrust, err := windowsExecutableRolePolicy(WindowsExecutableRoleDesktop)
	if err != nil || desktopName != profile.desktopExecutableName || desktopTrust != profile.desktopTrustSetID {
		t.Fatalf("E2E Desktop executable policy = (%q, %q, %v)", desktopName, desktopTrust, err)
	}

	process := WindowsRuntimeProcess{
		principalSID: profile.serviceSID,
		tuple: ProcessTuple{
			OS:                          OSWindows,
			PID:                         42,
			CreationMarker:              "e2e-process-creation",
			OSLoginSession:              "e2e-service-session",
			SecurityPrincipal:           profile.serviceSID,
			CanonicalExecutableIdentity: "e2e-volume-file-id",
			ExecutableDigest:            Identifier{1},
			ExecutableTrustSetID:        profile.runtimeTrustSetID,
		},
	}
	if err := process.validate(); err != nil {
		t.Fatalf("validate E2E Runtime process capability: %v", err)
	}
}

func TestWindowsE2ESignerIdentityFailsClosedWithoutBuildInjection(t *testing.T) {
	previous := WindowsRuntimeSignerCertSHA256
	WindowsRuntimeSignerCertSHA256 = ""
	t.Cleanup(func() { WindowsRuntimeSignerCertSHA256 = previous })
	if _, err := NewWindowsNativeExecutableTrustVerifier(); !IsReason(err, ReasonDesktopExecutableTrustFailed) {
		t.Fatalf("missing E2E signer identity error = %v", err)
	}
}
