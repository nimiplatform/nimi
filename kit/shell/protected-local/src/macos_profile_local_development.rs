// Code generated from .nimi/spec protected-local macOS local-development
// authority tables; DO NOT EDIT.

pub(crate) const RECORD_ROOT: &str =
    "/Library/Application Support/Nimi/RuntimeDev/active/trust/protected-local/v1";
pub(crate) const ENVIRONMENT: &str = "local_development";
pub(crate) const IDENTITY_CLASS: &str = "local_ca";
pub(crate) const SIGNATURE_ALGORITHM: &str = "ecdsa_p256_sha256";
pub(crate) const SIGNER_POLICY_ID: &str = "nimi-macos-local-development-signing-policy";
pub(crate) const RUNTIME_TRUST_SET_ID: &str = "nimi-runtime-macos-local-development-v1";
pub(crate) const DESKTOP_TRUST_SET_ID: &str = "nimi-desktop-macos-local-development-v1";
pub(crate) const RUNTIME_SIGNING_IDENTIFIER: &str = "ai.nimi.runtime.dev";
pub(crate) const DESKTOP_SIGNING_IDENTIFIER: &str = "ai.nimi.apps.nimi.desktop.dev";
pub(crate) const RUNTIME_SERVICE_PRINCIPAL: &str = "_nimiruntimedev";
pub(crate) const RUNTIME_SOCKET_PATH: &str = "/private/var/run/nimi-dev/runtime-desktop.sock";
pub(crate) const LOCAL_APP_SOCKET_PATH: &str = "/private/var/run/nimi-dev/runtime-local-app.sock";
pub(crate) const RUNTIME_EXECUTABLE_PATH: &str =
    "/Library/Application Support/Nimi/RuntimeDev/active/bin/nimi-runtime";
pub(crate) const DESKTOP_APPLICATION_PATH: &str = "/Applications/Nimi Dev.app";
pub(crate) const LOCAL_APP_HOST_PATH: &str = "/Applications/Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev";
pub(crate) const REQUIRE_TRUSTED_ANCHOR: bool = false;
pub(crate) const REQUIRE_NOTARIZATION: bool = false;
pub(crate) const ROOT_KEY_ID: Option<&str> =
    option_env!("NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_KEY_ID");
pub(crate) const ROOT_PUBLIC_KEY_B64URL: Option<&str> =
    option_env!("NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_PUBLIC_KEY_B64URL");
