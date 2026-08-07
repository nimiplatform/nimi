// This module is the compile-time projection of admitted protected-local
// paths and live macOS signing policy. Production, privileged local
// development and source-workspace local development are mutually exclusive.

#[cfg(feature = "macos-local-development")]
pub(crate) use crate::macos_profile_local_development::*;
#[cfg(feature = "macos-source-local-development")]
pub(crate) use crate::macos_profile_source_local_development::*;

#[cfg(all(
    not(feature = "macos-local-development"),
    not(feature = "macos-source-local-development")
))]
pub(crate) const RUNTIME_SIGNING_IDENTIFIER: &str = "ai.nimi.runtime";

#[cfg(all(
    not(feature = "macos-local-development"),
    not(feature = "macos-source-local-development")
))]
pub(crate) const RUNTIME_SOCKET_PATH: &str = "/private/var/run/nimi/runtime-desktop.sock";

#[cfg(all(
    not(feature = "macos-local-development"),
    not(feature = "macos-source-local-development")
))]
pub(crate) const LOCAL_APP_SOCKET_PATH: &str = "/private/var/run/nimi/runtime-local-app.sock";

#[cfg(all(
    not(feature = "macos-local-development"),
    not(feature = "macos-source-local-development")
))]
pub(crate) const RUNTIME_EXECUTABLE_PATH: &str =
    "/Applications/Nimi.app/Contents/Library/LaunchServices/nimi-runtime";

#[cfg(all(
    not(feature = "macos-local-development"),
    not(feature = "macos-source-local-development")
))]
pub(crate) const LOCAL_APP_HOST_PATH: &str = "/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host";

#[cfg(all(
    not(feature = "macos-local-development"),
    not(feature = "macos-source-local-development")
))]
pub(crate) const REQUIRE_TRUSTED_ANCHOR: bool = true;

#[cfg(all(
    not(feature = "macos-local-development"),
    not(feature = "macos-source-local-development")
))]
pub(crate) const REQUIRE_NOTARIZATION: bool = true;

#[cfg(all(
    not(feature = "macos-local-development"),
    not(feature = "macos-source-local-development")
))]
pub(crate) const REQUIRE_AD_HOC: bool = false;

#[cfg(feature = "macos-local-development")]
pub(crate) const MACOS_TEAM_ID: Option<&str> = None;

#[cfg(all(
    not(feature = "macos-local-development"),
    not(feature = "macos-source-local-development")
))]
pub(crate) const MACOS_TEAM_ID: Option<&str> = option_env!("NIMI_MACOS_TEAM_ID");
