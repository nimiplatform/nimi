// Code generated from config/runtime-macos-protected-local-development-profile.yaml; canonical constraints live under .nimi/spec; DO NOT EDIT.
export const MACOS_LOCAL_DEVELOPMENT_PROFILE = Object.freeze({
  "runtimeServiceLabel": "ai.nimi.runtime.dev",
  "runtimeAccountName": "_nimiruntimedev",
  "runtimeExecutablePath": "/Library/Application Support/Nimi/RuntimeDev/active/bin/nimi-runtime",
  "runtimeStateRoot": "/Library/Application Support/Nimi/RuntimeDev/state",
  "desktopApplicationPath": "/Applications/Nimi Dev.app",
  "desktopExecutablePath": "/Applications/Nimi Dev.app/Contents/MacOS/Nimi Dev",
  "localAppHostPath": "/Applications/Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev",
  "launchDaemonPath": "/Library/LaunchDaemons/ai.nimi.runtime.dev.plist",
  "runtimeSigningIdentifier": "ai.nimi.runtime.dev",
  "desktopSigningIdentifier": "ai.nimi.apps.nimi.desktop.dev",
  "localAppHostSigningIdentifier": "ai.nimi.apps.nimi.local-app-host.dev",
  "installerSigningIdentifier": "ai.nimi.dev-installer",
  "architecture": "arm64",
  "desktopSocketActivationName": "DesktopControlDev",
  "localAppSocketActivationName": "LocalAppHostDev",
  "desktopSocketPath": "/private/var/run/nimi-dev/runtime-desktop.sock",
  "localAppSocketPath": "/private/var/run/nimi-dev/runtime-local-app.sock",
  "helperPath": "/usr/local/libexec/nimi-macos-dev-security"
});
