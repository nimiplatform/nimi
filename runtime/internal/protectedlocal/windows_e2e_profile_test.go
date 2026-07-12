//go:build windows && nimi_runtime_e2e

package protectedlocal

import "testing"

func TestWindowsE2ERuntimeProfileIsSeparateAndClosed(t *testing.T) {
	profile := activeWindowsRuntimeProfile()
	if !profile.nonProduct || profile.serviceName != "NimiRuntimeE2E" {
		t.Fatalf("active E2E service profile = %+v", profile)
	}
	if profile.serviceAccount != `NT SERVICE\NimiRuntimeE2E` ||
		profile.serviceSID != "S-1-5-80-2508001767-432113807-2225235661-2974466524-556849280" {
		t.Fatalf("active E2E principal profile = %+v", profile)
	}
	if profile.desktopPipeName != `\\.\pipe\nimi-runtime-e2e-protected-v1` ||
		profile.installedPipeName != `\\.\pipe\nimi-runtime-e2e-installed-v1` {
		t.Fatalf("active E2E pipe profile = %+v", profile)
	}
	if profile.runtimeTrustSetID != "nimi-runtime-e2e-fixture-v1" ||
		profile.desktopTrustSetID != "nimi-desktop-e2e-fixture-v1" {
		t.Fatalf("active E2E trust profile = %+v", profile)
	}
	if profile.serviceName == WindowsProductionServiceName ||
		profile.serviceSID == WindowsProductionServiceSID ||
		profile.desktopPipeName == WindowsProductionDesktopPipeName ||
		profile.installedPipeName == WindowsProductionInstalledPipeName {
		t.Fatal("E2E profile collided with production authority")
	}
}

func TestWindowsE2EProfileDrivesPrincipalAndExecutableAdmission(t *testing.T) {
	profile := activeWindowsRuntimeProfile()
	principal, err := validateWindowsPrincipalSnapshot(windowsPrincipalSnapshot{
		ResolvedServiceSID: profile.serviceSID,
		TokenUserSID:       "S-1-5-18",
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
	if principal.ServiceSID() != WindowsE2EServiceSID {
		t.Fatalf("E2E principal SID = %q", principal.ServiceSID())
	}
	if _, err := validateWindowsPrincipalSnapshot(windowsPrincipalSnapshot{
		ResolvedServiceSID: WindowsProductionServiceSID,
	}); err == nil {
		t.Fatal("E2E binary admitted the production service principal")
	}

	runtimeName, runtimeTrust, err := windowsExecutableRolePolicy(WindowsExecutableRoleRuntime)
	if err != nil || runtimeName != "nimi-runtime-e2e.exe" || runtimeTrust != WindowsRuntimeE2ETrustSetID {
		t.Fatalf("E2E Runtime executable policy = (%q, %q, %v)", runtimeName, runtimeTrust, err)
	}
	desktopName, desktopTrust, err := windowsExecutableRolePolicy(WindowsExecutableRoleDesktop)
	if err != nil || desktopName != "nimiplatform-desktop-dev-run.exe" || desktopTrust != WindowsDesktopE2ETrustSetID {
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
