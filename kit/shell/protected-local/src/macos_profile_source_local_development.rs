// Source-only D2 deliberately has no installer-fixed Runtime, Host, socket,
// service label, team, or signing identifier. Dynamic paths are derived from
// the current OS user and the exact Runtime-authorized Host request.
pub(crate) const RUNTIME_SOCKET_PATH: &str = "";
pub(crate) const LOCAL_APP_SOCKET_PATH: &str = "";
pub(crate) const RUNTIME_EXECUTABLE_PATH: &str = "";
pub(crate) const LOCAL_APP_HOST_PATH: &str = "";
pub(crate) const RUNTIME_SIGNING_IDENTIFIER: &str = "";
pub(crate) const MACOS_TEAM_ID: Option<&str> = None;
pub(crate) const REQUIRE_TRUSTED_ANCHOR: bool = false;
pub(crate) const REQUIRE_NOTARIZATION: bool = false;
pub(crate) const REQUIRE_AD_HOC: bool = false;
