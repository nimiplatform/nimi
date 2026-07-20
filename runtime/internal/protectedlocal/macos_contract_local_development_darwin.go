//go:build darwin && nimi_macos_local_development

// Code generated from .nimi/spec fresh-carrier-4 authority; DO NOT EDIT.
package protectedlocal
const (
 MacOSReleaseRecordSchemaVersion=3
 MacOSRequiredArchitecture="arm64"
 MacOSRuntimeServiceLabel="ai.nimi.runtime.dev"
 MacOSRuntimeAccountName="_nimiruntimedev"
 MacOSRuntimeExecutablePath="/Library/Application Support/Nimi/RuntimeDev/active/bin/nimi-runtime"
 MacOSDesktopExecutablePath="/Applications/Nimi Dev.app/Contents/MacOS/Nimi Dev"
 MacOSDesktopApplicationPath="/Applications/Nimi Dev.app"
 MacOSLocalAppHostPath="/Applications/Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev"
 MacOSRuntimeStateRoot="/Library/Application Support/Nimi/RuntimeDev/state"
 MacOSReleaseTrustRecordRoot="/Library/Application Support/Nimi/RuntimeDev/active/trust/protected-local/v1"
 MacOSKeychainService="ai.nimi.runtime.protected-local.dev.v1"
 MacOSDesktopSocketActivationName="DesktopControlDev"
 MacOSLocalAppSocketActivationName="LocalAppHostDev"
 MacOSDesktopSocketPath="/private/var/run/nimi-dev/runtime-desktop.sock"
 MacOSLocalAppSocketPath="/private/var/run/nimi-dev/runtime-local-app.sock"
 MacOSRuntimeSigningIdentifier="ai.nimi.runtime.dev"
 MacOSDesktopSigningIdentifier="ai.nimi.apps.nimi.desktop.dev"
 MacOSLocalAppHostIdentifier="ai.nimi.apps.nimi.local-app-host.dev"
 MacOSDesktopTrustSetID="nimi-desktop-macos-local-development-v1"
 MacOSRuntimeTrustSetID="nimi-runtime-macos-local-development-v1"
 MacOSLocalAppHostTrustSet="nimi-local-development-host-macos-local-development-v1"
 macOSProfileRequiresTrustedAnchor=false
 macOSProfileRequiresNotarization=false
)
func validMacOSProfileTeamID(value string)bool{return value==""}
func validMacOSProfileLeafSPKI(value string)bool{return validLowerHex(value,64)}
