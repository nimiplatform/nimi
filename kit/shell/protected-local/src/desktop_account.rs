#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopAccountSessionStatusRequest {
    pub app_id: String,
    pub app_instance_id: String,
    pub device_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopAccountBeginLoginRequest {
    pub redirect_uri: String,
    pub callback_origin: String,
    pub requested_scopes: Vec<String>,
    pub ttl_seconds: i32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopAccountBeginLoginResponse {
    pub accepted: bool,
    pub login_attempt_id: String,
    pub oauth_authorization_url: String,
    pub callback_origin: String,
    pub state: String,
    pub nonce: String,
    pub reason_code: i32,
    pub account_reason_code: i32,
    pub production_inert: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopAccountCompleteLoginRequest {
    pub login_attempt_id: String,
    pub code: String,
    pub state: String,
    pub nonce: String,
    pub redirect_uri: String,
    pub callback_origin: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopAccountMutationResponse {
    pub accepted: bool,
    pub state: i32,
    pub account_projection: Option<DesktopAccountProjection>,
    pub reason_code: i32,
    pub account_reason_code: i32,
    pub production_inert: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopAccountRealmUnaryRequest {
    pub method_id: String,
    pub request_json: String,
    pub timeout_ms: i32,
    pub idempotency_key: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopAccountRealmUnaryResponse {
    pub accepted: bool,
    pub response_json: String,
    pub reason_code: i32,
    pub account_reason_code: i32,
    pub production_inert: bool,
    pub http_status: i32,
    pub error_message: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopAccountActionRequest {
    pub reason: String,
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
