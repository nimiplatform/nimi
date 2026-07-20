// This module is the compile-time projection of the admitted protected-local
// profile. Production and local-development roots are mutually exclusive.

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const RECORD_SCHEMA_VERSION: u64 = 3;
#[cfg(not(feature = "macos-local-development"))]
pub(crate) const REQUIRED_ARCHITECTURE: &str = "arm64";
#[cfg(not(feature = "macos-local-development"))]
pub(crate) const RECORD_ROOT: &str =
    "/Library/Application Support/Nimi/Runtime/trust/protected-local/v1";
#[cfg(feature = "macos-local-development")]
pub(crate) use crate::macos_profile_local_development::*;

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const ENVIRONMENT: &str = "production";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const IDENTITY_CLASS: &str = "developer_id_application";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const SIGNATURE_ALGORITHM: &str = "ed25519";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const SIGNER_POLICY_ID: &str = "nimi-production-release-signing-policy";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const RUNTIME_TRUST_SET_ID: &str = "nimi-runtime-production-v1";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const DESKTOP_TRUST_SET_ID: &str = "nimi-desktop-production-v1";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const RUNTIME_SIGNING_IDENTIFIER: &str = "ai.nimi.runtime";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const DESKTOP_SIGNING_IDENTIFIER: &str = "ai.nimi.apps.nimi.desktop";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const RUNTIME_SERVICE_PRINCIPAL: &str = "_nimiruntime";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const RUNTIME_SOCKET_PATH: &str = "/private/var/run/nimi/runtime-desktop.sock";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const LOCAL_APP_SOCKET_PATH: &str = "/private/var/run/nimi/runtime-local-app.sock";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const RUNTIME_EXECUTABLE_PATH: &str =
    "/Applications/Nimi.app/Contents/Library/LaunchServices/nimi-runtime";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const DESKTOP_APPLICATION_PATH: &str = "/Applications/Nimi.app";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const LOCAL_APP_HOST_PATH: &str = "/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host";

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const REQUIRE_TRUSTED_ANCHOR: bool = true;

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const REQUIRE_NOTARIZATION: bool = true;

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const ROOT_KEY_ID: Option<&str> = option_env!("NIMI_PLATFORM_RELEASE_ROOT_KEY_ID");

#[cfg(not(feature = "macos-local-development"))]
pub(crate) const ROOT_PUBLIC_KEY_B64URL: Option<&str> =
    option_env!("NIMI_PLATFORM_RELEASE_ROOT_PUBLIC_KEY_B64URL");
