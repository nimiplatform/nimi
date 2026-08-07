//go:build darwin && !nimi_macos_local_development && !nimi_macos_source_local_development

package protectedlocal

const (
	MacOSRequiredArchitecture = "arm64"
	MacOSRuntimeServiceLabel  = "ai.nimi.runtime"
	MacOSRuntimeAccountName   = "_nimiruntime"

	MacOSRuntimeExecutablePath  = "/Applications/Nimi.app/Contents/Library/LaunchServices/nimi-runtime"
	MacOSDesktopExecutablePath  = "/Applications/Nimi.app/Contents/MacOS/Nimi"
	MacOSDesktopApplicationPath = "/Applications/Nimi.app"
	MacOSLocalAppHostPath       = "/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host"
	MacOSRuntimeStateRoot       = "/Library/Application Support/Nimi/Runtime/state"
	MacOSKeychainService        = "ai.nimi.runtime.protected-local.v1"

	MacOSDesktopSocketActivationName  = "DesktopControl"
	MacOSLocalAppSocketActivationName = "LocalAppHost"
	MacOSDesktopSocketPath            = "/private/var/run/nimi/runtime-desktop.sock"
	MacOSLocalAppSocketPath           = "/private/var/run/nimi/runtime-local-app.sock"

	MacOSRuntimeSigningIdentifier = "ai.nimi.runtime"
	MacOSDesktopSigningIdentifier = "ai.nimi.apps.nimi.desktop"
	MacOSLocalAppHostIdentifier   = "ai.nimi.apps.nimi.local-app-host"
)
