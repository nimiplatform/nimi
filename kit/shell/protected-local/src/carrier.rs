use crate::{
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse, DesktopAccountSessionStatus,
    DesktopAccountSessionStatusRequest, DesktopProductControlError, DesktopProductControlRequest,
    DesktopProductControlResponse, DeveloperModeStatus, FixedRuntimeServiceControl,
    LocalDevelopmentAuthorization, LocalDevelopmentDecisionRequest, LocalDevelopmentEndRunRequest,
    LocalDevelopmentEvaluation, LocalDevelopmentEvaluationRequest, LocalDevelopmentLaunchOutcome,
    LocalDevelopmentLaunchRequest, LocalDevelopmentReactivationRequest, NimiHostError,
    ProtectedCarrierError, RuntimeServiceActionOutcome,
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
    NoGrant,
    GrantRevoked,
    GrantSuperseded,
    RuntimePermissionDenied,
    InvalidPayload,
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
            Self::NoGrant => "no-grant",
            Self::GrantRevoked => "grant-revoked",
            Self::GrantSuperseded => "grant-superseded",
            Self::RuntimePermissionDenied => "runtime-permission-denied",
            Self::InvalidPayload => "invalid-payload",
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
    ZeroGrant,
}

impl LocalAppSessionState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ZeroGrant => "zero-grant",
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
pub struct LocalAppPermissionPostureRequest {
    pub operation_id: String,
    pub resource_ref: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalAppPermissionRequest {
    pub operation_id: String,
    pub resource_ref: String,
    pub purpose: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalAppPermissionState {
    ZeroGrant,
    Pending,
    Granted,
    Denied,
    Revoked,
    Superseded,
    Unavailable,
}

impl LocalAppPermissionState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ZeroGrant => "zero-grant",
            Self::Pending => "pending",
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Revoked => "revoked",
            Self::Superseded => "superseded",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalAppPermissionPosture {
    pub state: LocalAppPermissionState,
    pub operation_id: String,
    pub resource_ref: String,
    pub reason_code: LocalAppReasonCode,
    pub action_hint: String,
    pub retryable: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppArtifactReadRequest {
    pub artifact_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppArtifactBytes {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub size_bytes: i64,
    pub mime_inferred: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentOpenConversationRequest {
    pub agent_id: String,
    pub requested_anchor_disposition: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentSendTurnRequest {
    pub agent_id: String,
    pub conversation_anchor_id: String,
    pub client_turn_id: String,
    pub user_text: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentSubscribeTurnRequest {
    pub agent_id: String,
    pub conversation_anchor_id: String,
    pub cursor: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentConversationSnapshotRequest {
    pub agent_id: String,
    pub conversation_anchor_id: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAgentProjection {
    pub value: JsonValue,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum LocalAppGrantControlState {
    Pending,
    Granted,
    Denied,
    Revoked,
}

/// Host-private pending grant request. Opaque identifiers never cross the
/// Desktop native selector vault into renderer IPC, logs, storage, or errors.
pub struct LocalAppGrantControlPending {
    pub request_id: [u8; 32],
    pub presence_challenge_id: [u8; 32],
    pub pending_grant_id: [u8; 32],
    pub operation_id: String,
    pub resource_ref: String,
    pub expires_at_unix_ms: i64,
}

pub struct LocalAppGrantControlDecisionRequest {
    pub request_id: [u8; 32],
    pub presence_challenge_id: [u8; 32],
    pub approved: bool,
}

pub struct LocalAppGrantControlProjection {
    pub state: LocalAppGrantControlState,
    pub grant_id: [u8; 32],
    pub operation_id: String,
    pub resource_ref: String,
}

/// Opaque host-only handle for one connection-bound protected Desktop session.
/// The handle carries only explicit typed operations and cannot proxy an
/// arbitrary method id, request bytes, endpoint, or portable credential.
pub trait NimiDesktopControl: Send + Sync {
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

    fn set_developer_mode(
        &self,
        enabled: bool,
    ) -> Pin<Box<dyn Future<Output = Result<DeveloperModeStatus, NimiHostError>> + Send + '_>>;

    fn pending_local_app_grant(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Option<LocalAppGrantControlPending>, NimiHostError>>
                + Send
                + '_,
        >,
    >;

    fn decide_local_app_grant(
        &self,
        request: LocalAppGrantControlDecisionRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppGrantControlProjection, NimiHostError>> + Send + '_>,
    >;

    fn revoke_local_app_grant(
        &self,
        grant_id: [u8; 32],
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppGrantControlProjection, NimiHostError>> + Send + '_>,
    >;

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

    fn reactivate_local_development_project(
        &self,
        request: LocalDevelopmentReactivationRequest,
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

    fn permission_posture(
        &self,
        request: LocalAppPermissionPostureRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppPermissionPosture, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn permission_request(
        &self,
        request: LocalAppPermissionRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppPermissionPosture, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn artifacts_read_runtime_bytes(
        &self,
        request: LocalAppArtifactReadRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppArtifactBytes, LocalAppOperationError>> + Send + '_>,
    >;

    fn agent_open_conversation(
        &self,
        request: LocalAppAgentOpenConversationRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn agent_send_turn(
        &self,
        request: LocalAppAgentSendTurnRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn agent_subscribe_turn(
        &self,
        request: LocalAppAgentSubscribeTurnRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn agent_get_conversation_snapshot(
        &self,
        request: LocalAppAgentConversationSnapshotRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;
}

pub trait NimiLocalAppCarrier: Send + Sync {
    fn open_local_app_session(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;
}

pub trait NimiProtectedLocalHostCarrier: FixedRuntimeServiceControl {
    /// Opens a mutually verified native connection and performs the empty
    /// OpenDesktopSession bootstrap internally. Session and boot-epoch bytes
    /// remain connection-bound and are never returned by this host API.
    fn open_desktop_control(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Box<dyn NimiDesktopControl>, ProtectedCarrierError>>
                + Send
                + '_,
        >,
    >;
}
