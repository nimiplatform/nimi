//go:build darwin && !nimi_macos_local_development

package protectedlocal

import "regexp"

const (
	MacOSReleaseRecordSchemaVersion = 3
	MacOSRequiredArchitecture       = "arm64"
	MacOSRuntimeServiceLabel = "ai.nimi.runtime"
	MacOSRuntimeAccountName  = "_nimiruntime"

	MacOSRuntimeExecutablePath  = "/Applications/Nimi.app/Contents/Library/LaunchServices/nimi-runtime"
	MacOSDesktopExecutablePath  = "/Applications/Nimi.app/Contents/MacOS/Nimi"
	MacOSDesktopApplicationPath = "/Applications/Nimi.app"
	MacOSLocalAppHostPath       = "/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host"
	MacOSRuntimeStateRoot       = "/Library/Application Support/Nimi/Runtime/state"
	MacOSReleaseTrustRecordRoot = "/Library/Application Support/Nimi/Runtime/trust/protected-local/v1"
	MacOSKeychainService        = "ai.nimi.runtime.protected-local.v1"

	MacOSDesktopSocketActivationName  = "DesktopControl"
	MacOSLocalAppSocketActivationName = "LocalAppHost"
	MacOSDesktopSocketPath            = "/private/var/run/nimi/runtime-desktop.sock"
	MacOSLocalAppSocketPath           = "/private/var/run/nimi/runtime-local-app.sock"

	MacOSRuntimeSigningIdentifier = "ai.nimi.runtime"
	MacOSDesktopSigningIdentifier = "ai.nimi.apps.nimi.desktop"
	MacOSLocalAppHostIdentifier   = "ai.nimi.apps.nimi.local-app-host"

	MacOSDesktopTrustSetID    = "nimi-desktop-production-v1"
	MacOSRuntimeTrustSetID    = "nimi-runtime-production-v1"
	MacOSLocalAppHostTrustSet = "nimi-local-development-host-macos-production-v1"

	// Retained exported names identify the production policy in tests and
	// governance. Runtime verification uses the active compile-time aliases.
	MacOSDesktopProductionTrustSetID = MacOSDesktopTrustSetID
	MacOSRuntimeProductionTrustSetID = MacOSRuntimeTrustSetID

	macOSProfileRequiresTrustedAnchor = true
	macOSProfileRequiresNotarization  = true
)

var macOSProductionTeamIDPattern = regexp.MustCompile(`^[A-Z0-9]{10}$`)

func validMacOSProfileTeamID(value string) bool {
	return macOSProductionTeamIDPattern.MatchString(value)
}

func validMacOSProfileLeafSPKI(value string) bool {
	return value == ""
}
