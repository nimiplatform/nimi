// Code generated from config/runtime-macos-protected-local-development-profile.yaml; canonical constraints live under .nimi/spec; DO NOT EDIT.
pub(crate) const RUNTIME_SIGNING_IDENTIFIER: &str = "ai.nimi.runtime.dev";
pub(crate) const RUNTIME_SOCKET_PATH: &str = "/private/var/run/nimi-dev/runtime-desktop.sock";
pub(crate) const LOCAL_APP_SOCKET_PATH: &str = "/private/var/run/nimi-dev/runtime-local-app.sock";
pub(crate) const RUNTIME_EXECUTABLE_PATH: &str =
    "/Library/Application Support/Nimi/RuntimeDev/active/bin/nimi-runtime";
pub(crate) const LOCAL_APP_HOST_PATH:&str="/Applications/Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev";
pub(crate) const REQUIRE_TRUSTED_ANCHOR: bool = false;
pub(crate) const REQUIRE_NOTARIZATION: bool = false;
pub(crate) const REQUIRE_AD_HOC: bool = true;
