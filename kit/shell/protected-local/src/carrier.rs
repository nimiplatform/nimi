use crate::{
    BundledAvatarRuntimeError, BundledAvatarRuntimeRequest,
    BundledAvatarRuntimeResponse, BundledAvatarRuntimeStreamReceiver,
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse,
    DesktopAccountSessionEventReceiver, DesktopAccountSessionEventsRequest,
    DesktopAccountSessionStatus, DesktopAccountSessionStatusRequest, DesktopProductControlError,
    DesktopProductControlRequest, DesktopProductControlResponse, DesktopRuntimeConsumerError,
    DesktopRuntimeConsumerRequest, DesktopRuntimeConsumerResponse, DeveloperModeStatus,
    FixedRuntimeServiceControl, LocalDevelopmentAuthoritySummary, LocalDevelopmentAuthorization,
    LocalDevelopmentDecisionRequest, LocalDevelopmentEndRunRequest, LocalDevelopmentEvaluation,
    LocalDevelopmentEvaluationRequest, LocalDevelopmentLaunchOutcome,
    LocalDevelopmentLaunchRequest, NimiHostError, ProtectedCarrierError,
    RuntimeServiceActionOutcome,
};
use serde_json::Value as JsonValue;
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::future::Future;
use std::pin::Pin;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalAppReasonCode {
    ActionExecuted,
    ProtectedCarrierRequired,
    RuntimeServiceUnavailable,
    RuntimeServiceUntrusted,
    RuntimeServiceRepairRequired,
    RuntimeUnauthenticated,
    ProcessReplaced,
    AccountChanged,
    RuntimeRestarted,
    Revoked,
    ProjectChanged,
    PermissionRequired,
    PermissionDenied,
    PermissionRevoked,
    PresenceExpired,
    RuntimePermissionDenied,
    InvalidPayload,
    InvalidPath,
    NotFound,
    ResourceExhausted,
}

impl LocalAppReasonCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ActionExecuted => "action-executed",
            Self::ProtectedCarrierRequired => "protected-carrier-required",
            Self::RuntimeServiceUnavailable => "runtime-service-unavailable",
            Self::RuntimeServiceUntrusted => "runtime-service-untrusted",
            Self::RuntimeServiceRepairRequired => "runtime-service-repair-required",
            Self::RuntimeUnauthenticated => "runtime-unauthenticated",
            Self::ProcessReplaced => "process-replaced",
            Self::AccountChanged => "account-changed",
            Self::RuntimeRestarted => "runtime-restarted",
            Self::Revoked => "revoked",
            Self::ProjectChanged => "project-changed",
            Self::PermissionRequired => "permission-required",
            Self::PermissionDenied => "permission-denied",
            Self::PermissionRevoked => "permission-revoked",
            Self::PresenceExpired => "presence-expired",
            Self::RuntimePermissionDenied => "runtime-permission-denied",
            Self::InvalidPayload => "invalid-payload",
            Self::InvalidPath => "invalid-path",
            Self::NotFound => "not-found",
            Self::ResourceExhausted => "resource-exhausted",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LocalAppOperationError {
    reason_code: LocalAppReasonCode,
    retryable: bool,
}

impl LocalAppOperationError {
    pub const fn new(reason_code: LocalAppReasonCode, retryable: bool) -> Self {
        Self {
            reason_code,
            retryable,
        }
    }

    pub const fn reason_code(self) -> LocalAppReasonCode {
        self.reason_code
    }

    pub const fn retryable(self) -> bool {
        self.retryable
    }
}

impl Display for LocalAppOperationError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.reason_code.as_str())
    }
}

impl Error for LocalAppOperationError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalAppSessionState {
    Ready,
}

impl LocalAppSessionState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalAppSessionStatus {
    pub state: LocalAppSessionState,
    pub reason_code: LocalAppReasonCode,
    pub retryable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalAppPermissionStatusRequest {
    pub permission_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalAppPermissionRequest {
    pub permission_id: String,
    pub reason: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalAppPermissionState {
    Prompt,
    Pending,
    Granted,
    Denied,
    Unavailable,
}

impl LocalAppPermissionState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Prompt => "prompt",
            Self::Pending => "pending",
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalAppPermissionStatus {
    pub state: LocalAppPermissionState,
    pub permission_id: String,
    pub can_request: bool,
    pub reason_code: LocalAppReasonCode,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppStorageReadRequest {
    pub relative_path: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppStorageWriteRequest {
    pub relative_path: String,
    pub value: JsonValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppStorageRemoveRequest {
    pub relative_path: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppStorageDocument {
    pub value: JsonValue,
    pub size_bytes: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppStorageRemoveResult {
    pub removed: bool,
}

/// Opaque host-only handle for one connection-bound protected Desktop session.
/// The handle carries only explicit typed operations and cannot proxy an
/// arbitrary method id, request bytes, endpoint, or portable credential.
pub trait NimiDesktopControl: Send + Sync {
    fn invoke_bundled_avatar(
        &self,
        request: BundledAvatarRuntimeRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<BundledAvatarRuntimeResponse, BundledAvatarRuntimeError>>
                + Send
                + '_,
        >,
    >;

    fn open_bundled_avatar_stream(
        &self,
        request: BundledAvatarRuntimeRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<BundledAvatarRuntimeStreamReceiver, BundledAvatarRuntimeError>>
                + Send
                + '_,
        >,
    >;

    fn invoke_product_control(
        &self,
        request: DesktopProductControlRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopProductControlResponse, DesktopProductControlError>>
                + Send
                + '_,
        >,
    >;

    fn invoke_runtime_consumer(
        &self,
        request: DesktopRuntimeConsumerRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopRuntimeConsumerResponse, DesktopRuntimeConsumerError>>
                + Send
                + '_,
        >,
    >;

    fn request_runtime_service_restart(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<RuntimeServiceActionOutcome, ProtectedCarrierError>>
                + Send
                + '_,
        >,
    >;

    fn get_account_session_status(
        &self,
        request: DesktopAccountSessionStatusRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DesktopAccountSessionStatus, NimiHostError>> + Send + '_>>;

    fn open_account_session_events(
        &self,
        request: DesktopAccountSessionEventsRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopAccountSessionEventReceiver, NimiHostError>>
                + Send
                + '_,
        >,
    >;

    fn begin_account_login(
        &self,
        request: DesktopAccountBeginLoginRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopAccountBeginLoginResponse, NimiHostError>>
                + Send
                + '_,
        >,
    >;

    fn complete_account_login(
        &self,
        request: DesktopAccountCompleteLoginRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<DesktopAccountMutationResponse, NimiHostError>> + Send + '_>,
    >;

    fn invoke_account_realm_unary(
        &self,
        request: DesktopAccountRealmUnaryRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopAccountRealmUnaryResponse, NimiHostError>>
                + Send
                + '_,
        >,
    >;

    fn logout_account(
        &self,
        request: DesktopAccountActionRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<DesktopAccountMutationResponse, NimiHostError>> + Send + '_>,
    >;

    fn switch_account(
        &self,
        request: DesktopAccountActionRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<DesktopAccountMutationResponse, NimiHostError>> + Send + '_>,
    >;

    fn get_developer_mode_status(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<DeveloperModeStatus, NimiHostError>> + Send + '_>>;

    fn get_local_development_authority_summary(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalDevelopmentAuthoritySummary, NimiHostError>>
                + Send
                + '_,
        >,
    >;

    fn set_developer_mode(
        &self,
        enabled: bool,
    ) -> Pin<Box<dyn Future<Output = Result<DeveloperModeStatus, NimiHostError>> + Send + '_>>;

    fn evaluate_local_development_project(
        &self,
        request: LocalDevelopmentEvaluationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<LocalDevelopmentEvaluation, NimiHostError>> + Send + '_>>;

    fn decide_local_development_project(
        &self,
        request: LocalDevelopmentDecisionRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentAuthorization, NimiHostError>> + Send + '_>,
    >;

    fn list_local_development_authorizations(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Vec<LocalDevelopmentAuthorization>, NimiHostError>>
                + Send
                + '_,
        >,
    >;

    fn revoke_local_development_authorization(
        &self,
        authorization_id: [u8; 32],
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentAuthorization, NimiHostError>> + Send + '_>,
    >;

    fn launch_local_development_host(
        &self,
        request: LocalDevelopmentLaunchRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentLaunchOutcome, NimiHostError>> + Send + '_>,
    >;

    fn local_development_host_running(
        &self,
        supervisor_run_id: [u8; 32],
    ) -> Result<bool, NimiHostError>;

    fn terminate_local_development_host(
        &self,
        supervisor_run_id: [u8; 32],
    ) -> Result<(), NimiHostError>;

    fn end_local_development_run(
        &self,
        request: LocalDevelopmentEndRunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<(), NimiHostError>> + Send + '_>>;
}

/// Connection-bound third-party Local App session. These exact typed methods
/// are the complete public carrier surface for the 0K checkpoint.
pub trait NimiLocalAppSession: Send + Sync {
    fn session_status(
        &self,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppSessionStatus, LocalAppOperationError>> + Send + '_>,
    >;

    /// Rotates only the Runtime-private short-lived technical session on the
    /// exact current protected host connection. No authority material is
    /// returned to the caller.
    fn renew_technical_session(
        &self,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppSessionStatus, LocalAppOperationError>> + Send + '_>,
    >;

    fn permission_status(
        &self,
        request: LocalAppPermissionStatusRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppPermissionStatus, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn permission_request(
        &self,
        request: LocalAppPermissionRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppPermissionStatus, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn storage_read_json(
        &self,
        request: LocalAppStorageReadRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppStorageDocument, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn storage_write_json(
        &self,
        request: LocalAppStorageWriteRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppStorageDocument, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn storage_remove_json(
        &self,
        request: LocalAppStorageRemoveRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppStorageRemoveResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;
}

pub type LocalAppSessionFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError>>
            + Send
            + 'a,
    >,
>;

pub trait NimiLocalAppCarrier: Send + Sync {
    fn open_local_app_session(&self) -> LocalAppSessionFuture<'_>;
}

pub type DesktopControlFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<Box<dyn NimiDesktopControl>, ProtectedCarrierError>> + Send + 'a,
    >,
>;

pub trait NimiProtectedLocalHostCarrier: FixedRuntimeServiceControl {
    /// Opens a mutually verified native connection and performs the empty
    /// OpenDesktopSession bootstrap internally. Session and boot-epoch bytes
    /// remain connection-bound and are never returned by this host API.
    fn open_desktop_control(&self) -> DesktopControlFuture<'_>;
}
