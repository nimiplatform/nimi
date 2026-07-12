#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopAccountSessionStatusRequest {
    pub app_id: String,
    pub app_instance_id: String,
    pub device_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopAccountSessionState {
    Anonymous,
    LoginPending,
    Authenticated,
    RefreshPending,
    Expired,
    ReauthRequired,
    Switching,
    LoggingOut,
    Unavailable,
}

impl DesktopAccountSessionState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Anonymous => "anonymous",
            Self::LoginPending => "login-pending",
            Self::Authenticated => "authenticated",
            Self::RefreshPending => "refresh-pending",
            Self::Expired => "expired",
            Self::ReauthRequired => "reauth-required",
            Self::Switching => "switching",
            Self::LoggingOut => "logging-out",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopAccountProjection {
    pub account_id: String,
    pub display_name: String,
    pub realm_environment_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopAccountSessionStatus {
    pub state: DesktopAccountSessionState,
    pub account_projection: Option<DesktopAccountProjection>,
}
