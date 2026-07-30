// This module is the compile-time projection of the admitted protected-local
// paths and live macOS signing policy. Production and local-development
// identities are mutually exclusive.

#[cfg(feature = "macos-local-development")]
pub(crate) use crate::macos_profile_local_development::*;

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const RUNTIME_SIGNING_IDENTIFIER: &str = "ai.nimi.runtime";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const RUNTIME_SOCKET_PATH: &str = "/private/var/run/nimi/runtime-desktop.sock";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const LOCAL_APP_SOCKET_PATH: &str = "/private/var/run/nimi/runtime-local-app.sock";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const RUNTIME_EXECUTABLE_PATH: &str =
    "/Applications/Nimi.app/Contents/Library/LaunchServices/nimi-runtime";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const LOCAL_APP_HOST_PATH: &str = "/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const REQUIRE_TRUSTED_ANCHOR: bool = true;

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const REQUIRE_NOTARIZATION: bool = true;

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const REQUIRE_AD_HOC: bool = false;

#[cfg(feature = "macos-local-development")]
pub(crate) const MACOS_TEAM_ID: Option<&str> = None;

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const MACOS_TEAM_ID: Option<&str> = option_env!("NIMI_MACOS_TEAM_ID");
