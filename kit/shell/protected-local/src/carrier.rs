use crate::{
    BundledAvatarRuntimeError, BundledAvatarRuntimeRequest, BundledAvatarRuntimeResponse,
    BundledAvatarRuntimeStreamReceiver, DesktopAccountActionRequest,
    DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse,
    DesktopAccountProductStreamRequest, DesktopAccountProductUnaryRequest,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse,
    DesktopAccountSessionEventReceiver, DesktopAccountSessionEventsRequest,
    DesktopAccountSessionStatus, DesktopAccountSessionStatusRequest, DesktopFirstPartyProductError,
    DesktopFirstPartyProductStreamReceiver, DesktopFirstPartyProductUnaryResponse,
    DesktopMachineProductStreamRequest, DesktopMachineProductUnaryRequest,
    DesktopPermissionOwnerUnaryRequest, DesktopPermissionOwnerUnaryResponse, DeveloperModeStatus,
    FixedRuntimeServiceControl, LocalDevelopmentAuthoritySummary, LocalDevelopmentAuthorization,
    LocalDevelopmentDecisionRequest, LocalDevelopmentEndRunRequest, LocalDevelopmentEvaluation,
    LocalDevelopmentEvaluationRequest, LocalDevelopmentLaunchOutcome,
    LocalDevelopmentLaunchRequest, NimiHostError, ProtectedCarrierError,
    RuntimeServiceActionOutcome,
};
use serde_json::Value as JsonValue;
use std::collections::BTreeMap;
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
    RuntimeServiceErrorUnclassified,
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
    PermissionReservedNotAdmitted,
    PermissionUnknown,
    PresenceExpired,
    RuntimePermissionDenied,
    AiModelNotFound,
    AiModelNotReady,
    AiProviderUnavailable,
    AiRouteUnsupported,
    AiRouteFallbackDenied,
    AiInputInvalid,
    AiOutputInvalid,
    AiContentFilterBlocked,
    AiLocalModelUnavailable,
    AiLocalModelProfileMissing,
    AiLocalServiceUnavailable,
    AiProviderAuthFailed,
    AiProviderInternal,
    AiProviderRateLimited,
    AiProviderTimeout,
    AiVoiceTargetModelMismatch,
    AgentAiConfigRevisionConflict,
    AgentAiConfigInvalid,
    AgentAiConfigTargetRequired,
    AgentAiConfigTargetInvalid,
    AgentAiConfigTargetUnavailable,
    AgentAiConfigCapabilityMismatch,
    AgentAiConfigModelTargetMismatch,
    AgentAutonomyRevisionConflict,
    AgentPresentationRevisionConflict,
    AiConfigInvalid,
    AiConfigNotFound,
    AiConfigPersistenceUnavailable,
    OperationUnavailable,
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
            Self::RuntimeServiceErrorUnclassified => "runtime-service-error-unclassified",
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
            Self::PermissionReservedNotAdmitted => "permission-reserved-not-admitted",
            Self::PermissionUnknown => "permission-unknown",
            Self::PresenceExpired => "presence-expired",
            Self::RuntimePermissionDenied => "runtime-permission-denied",
            Self::AiModelNotFound => "ai-model-not-found",
            Self::AiModelNotReady => "ai-model-not-ready",
            Self::AiProviderUnavailable => "ai-provider-unavailable",
            Self::AiRouteUnsupported => "ai-route-unsupported",
            Self::AiRouteFallbackDenied => "ai-route-fallback-denied",
            Self::AiInputInvalid => "ai-input-invalid",
            Self::AiOutputInvalid => "ai-output-invalid",
            Self::AiContentFilterBlocked => "ai-content-filter-blocked",
            Self::AiLocalModelUnavailable => "ai-local-model-unavailable",
            Self::AiLocalModelProfileMissing => "ai-local-model-profile-missing",
            Self::AiLocalServiceUnavailable => "ai-local-service-unavailable",
            Self::AiProviderAuthFailed => "ai-provider-auth-failed",
            Self::AiProviderInternal => "ai-provider-internal",
            Self::AiProviderRateLimited => "ai-provider-rate-limited",
            Self::AiProviderTimeout => "ai-provider-timeout",
            Self::AiVoiceTargetModelMismatch => "ai-voice-target-model-mismatch",
            Self::AgentAiConfigRevisionConflict => "agent-ai-config-revision-conflict",
            Self::AgentAiConfigInvalid => "agent-ai-config-invalid",
            Self::AgentAiConfigTargetRequired => "agent-ai-config-target-required",
            Self::AgentAiConfigTargetInvalid => "agent-ai-config-target-invalid",
            Self::AgentAiConfigTargetUnavailable => "agent-ai-config-target-unavailable",
            Self::AgentAiConfigCapabilityMismatch => "agent-ai-config-capability-mismatch",
            Self::AgentAiConfigModelTargetMismatch => "agent-ai-config-model-target-mismatch",
            Self::AgentAutonomyRevisionConflict => "agent-autonomy-revision-conflict",
            Self::AgentPresentationRevisionConflict => "agent-presentation-revision-conflict",
            Self::AiConfigInvalid => "ai-config-invalid",
            Self::AiConfigNotFound => "ai-config-not-found",
            Self::AiConfigPersistenceUnavailable => "ai-config-persistence-unavailable",
            Self::OperationUnavailable => "local-app-operation-unavailable",
            Self::InvalidPayload => "invalid-payload",
            Self::InvalidPath => "invalid-path",
            Self::NotFound => "not-found",
            Self::ResourceExhausted => "resource-exhausted",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalAppOperationError {
    reason_code: LocalAppReasonCode,
    retryable: bool,
    permission_id: Option<String>,
    reason_metadata: BTreeMap<String, String>,
}

impl LocalAppOperationError {
    pub const fn new(reason_code: LocalAppReasonCode, retryable: bool) -> Self {
        Self {
            reason_code,
            retryable,
            permission_id: None,
            reason_metadata: BTreeMap::new(),
        }
    }

    pub fn with_reason_metadata(
        mut self,
        permission_id: Option<String>,
        reason_metadata: BTreeMap<String, String>,
    ) -> Self {
        self.permission_id = permission_id;
        self.reason_metadata = reason_metadata;
        self
    }

    pub const fn reason_code(&self) -> LocalAppReasonCode {
        self.reason_code
    }

    pub const fn retryable(&self) -> bool {
        self.retryable
    }

    pub fn permission_id(&self) -> Option<&str> {
        self.permission_id.as_deref()
    }

    pub const fn reason_metadata(&self) -> &BTreeMap<String, String> {
        &self.reason_metadata
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
    pub request_id: String,
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
pub struct LocalAppAgentHandle {
    pub agent_handle: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalAppPermissionStatus {
    pub state: LocalAppPermissionState,
    pub permission_id: String,
    pub can_request: bool,
    pub reason_code: LocalAppReasonCode,
    pub agents: Vec<LocalAppAgentHandle>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppTextCandidateMessage {
    pub role: String,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppTextCandidateRequest {
    pub messages: Vec<LocalAppTextCandidateMessage>,
    pub temperature: f32,
    pub top_p: f32,
    pub max_tokens: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppTextCandidateResult {
    pub text: String,
    pub finish_reason: String,
    pub trace_id: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAIConfigOverwriteRequest {
    pub capabilities: JsonValue,
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

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LocalAppWorldCoreListRequest {
    pub take: Option<u32>,
    pub visibility: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppWorldCoreCreateRequest {
    pub body: JsonValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationOpenRequest {
    pub agent_handle: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationOpenResult {
    pub conversation_anchor_id: String,
    pub active_turn_id: Option<String>,
    pub active_stream_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationSendRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub request_id: String,
    pub text: String,
    pub attachments: JsonValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationSendResult {
    pub message_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppArtifactPutRequest {
    pub mime_type: String,
    pub display_name: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppArtifactPutResult {
    pub artifact_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppArtifactReadRequest {
    pub artifact_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppArtifactReadResult {
    pub bytes: Vec<u8>,
    pub mime_type: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationInterruptRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationInterruptResult {
    pub message_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationSubscribeRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationSnapshotRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentHandleRequest {
    pub agent_handle: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAgentUpdateConfigurationRequest {
    pub agent_handle: String,
    pub expected_configuration_revision: u64,
    pub intents: JsonValue,
    pub profile_origin: JsonValue,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAgentAIProfilePreviewRequest {
    pub agent_handle: String,
    pub profile: JsonValue,
    pub runtime_descriptor: JsonValue,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAgentAIProfileApplyRequest {
    pub agent_handle: String,
    pub expected_configuration_revision: u64,
    pub profile: JsonValue,
    pub runtime_descriptor: JsonValue,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAgentUpdateAutonomyRequest {
    pub agent_handle: String,
    pub expected_autonomy_revision: u64,
    pub intent: JsonValue,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAgentCommitPresentationRequest {
    pub agent_handle: String,
    pub expected_presentation_revision: u64,
    pub intent: JsonValue,
    pub imported_assets: JsonValue,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppConversationEvent {
    pub event_type: i32,
    pub sequence: u64,
    pub message_id: String,
    pub message_type: String,
    pub payload: JsonValue,
    pub reason_code: LocalAppReasonCode,
    pub trace_id: String,
    pub timestamp_unix_ms: Option<i64>,
}

pub type LocalAppConversationSubscriptionReceiver =
    tokio::sync::mpsc::Receiver<Result<LocalAppConversationEvent, LocalAppOperationError>>;

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
            dyn Future<
                    Output = Result<BundledAvatarRuntimeStreamReceiver, BundledAvatarRuntimeError>,
                > + Send
                + '_,
        >,
    >;

    fn invoke_machine_product_unary(
        &self,
        request: DesktopMachineProductUnaryRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        DesktopFirstPartyProductUnaryResponse,
                        DesktopFirstPartyProductError,
                    >,
                > + Send
                + '_,
        >,
    >;

    fn open_machine_product_stream(
        &self,
        request: DesktopMachineProductStreamRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        DesktopFirstPartyProductStreamReceiver,
                        DesktopFirstPartyProductError,
                    >,
                > + Send
                + '_,
        >,
    >;

    fn invoke_account_product_unary(
        &self,
        request: DesktopAccountProductUnaryRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        DesktopFirstPartyProductUnaryResponse,
                        DesktopFirstPartyProductError,
                    >,
                > + Send
                + '_,
        >,
    >;

    fn open_account_product_stream(
        &self,
        request: DesktopAccountProductStreamRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        DesktopFirstPartyProductStreamReceiver,
                        DesktopFirstPartyProductError,
                    >,
                > + Send
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

    fn invoke_permission_owner_unary(
        &self,
        request: DesktopPermissionOwnerUnaryRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopPermissionOwnerUnaryResponse, NimiHostError>>
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

    fn generate_text_candidate(
        &self,
        request: LocalAppTextCandidateRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppTextCandidateResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn app_ai_config_get(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn app_ai_config_overwrite(
        &self,
        request: LocalAppAIConfigOverwriteRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_world_core_list(
        &self,
        request: LocalAppWorldCoreListRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_world_core_create(
        &self,
        request: LocalAppWorldCoreCreateRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

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

    fn conversation_open(
        &self,
        request: LocalAppConversationOpenRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationOpenResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn conversation_send_turn(
        &self,
        request: LocalAppConversationSendRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationSendResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn conversation_interrupt_turn(
        &self,
        request: LocalAppConversationInterruptRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationInterruptResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn conversation_subscribe(
        &self,
        request: LocalAppConversationSubscribeRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        LocalAppConversationSubscriptionReceiver,
                        LocalAppOperationError,
                    >,
                > + Send
                + '_,
        >,
    >;

    fn conversation_snapshot(
        &self,
        request: LocalAppConversationSnapshotRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn artifact_put(
        &self,
        request: LocalAppArtifactPutRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppArtifactPutResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn artifact_read_bytes(
        &self,
        request: LocalAppArtifactReadRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppArtifactReadResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn agent_configuration_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_update_configuration(
        &self,
        request: LocalAppAgentUpdateConfigurationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_readiness_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_ai_profile_preview(
        &self,
        request: LocalAppAgentAIProfilePreviewRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_ai_profile_apply(
        &self,
        request: LocalAppAgentAIProfileApplyRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_autonomy_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_update_autonomy(
        &self,
        request: LocalAppAgentUpdateAutonomyRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_presentation_snapshot(
        &self,
        request: LocalAppAgentHandleRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_commit_presentation(
        &self,
        request: LocalAppAgentCommitPresentationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;
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
