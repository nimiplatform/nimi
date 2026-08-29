use crate::{
    BundledAvatarRuntimeClientStreamRequest, BundledAvatarRuntimeError,
    BundledAvatarRuntimeRequest, BundledAvatarRuntimeResponse, BundledAvatarRuntimeStreamReceiver,
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse,
    DesktopAccountProductClientStreamRequest, DesktopAccountProductStreamRequest,
    DesktopAccountProductUnaryRequest, DesktopAccountRealmUnaryRequest,
    DesktopAccountRealmUnaryResponse, DesktopAccountSessionEventReceiver,
    DesktopAccountSessionEventsRequest, DesktopAccountSessionStatus,
    DesktopAccountSessionStatusRequest, DesktopFirstPartyProductError,
    DesktopFirstPartyProductStreamReceiver, DesktopFirstPartyProductUnaryResponse,
    DesktopMachineProductStreamRequest, DesktopMachineProductUnaryRequest, DeveloperModeStatus,
    FixedRuntimeServiceControl, LocalDevelopmentEndRunRequest, LocalDevelopmentLaunchOutcome,
    LocalDevelopmentLaunchRequest, LocalDevelopmentRegistration,
    LocalDevelopmentRegistrationRequest, NimiHostError, ProtectedCarrierError,
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
    PresenceExpired,
    RuntimeAccessDenied,
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
    AiLocalDriverUnavailable,
    AiLocalAssetIncompatible,
    AiLocalSelectionNotFound,
    AiLocalCapabilityMismatch,
    AiLocalConfigurationNotConfigured,
    AiProviderAuthFailed,
    AiProviderInternal,
    AiProviderRateLimited,
    AiProviderTimeout,
    AiRealtimeSessionNotFound,
    AiRealtimeSessionClosed,
    AiMediaSpecInvalid,
    AiMediaOptionUnsupported,
    AiVoiceInputInvalid,
    AiVoiceWorkflowUnsupported,
    AiVoiceAssetNotFound,
    AiVoiceAssetExpired,
    AiVoiceAssetScopeForbidden,
    AiVoiceTargetModelMismatch,
    AiVoiceJobNotFound,
    AiVoiceJobNotCancellable,
    AiConfigInvalid,
    AiConfigNotFound,
    AiConfigPersistenceUnavailable,
    SnapshotUnavailable,
    AccessDenied,
    OperationUnsupported,
    OwnerUnavailable,
    CurrentUserDisplayUnavailable,
    OperationUnavailable,
    CapabilityUnavailable,
    InvalidInput,
    SessionInvalid,
    PersonaAccessDenied,
    OwnerAuthorityMissing,
    ContentConflict,
    RealmUnavailable,
    RateLimited,
    UpstreamFailed,
    ContractInvalid,
    RequestTooLarge,
    ResponseTooLarge,
    InvalidPayload,
    InvalidPath,
    NotFound,
    ResourceExhausted,
    AlreadyExists,
    ObjectTooLarge,
    InvalidRange,
    InvalidCursor,
    IntegrityFailure,
    ArtifactUnavailable,
    Canceled,
    HostInternalError,
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
            Self::PresenceExpired => "presence-expired",
            Self::RuntimeAccessDenied => "runtime-access-denied",
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
            Self::AiLocalDriverUnavailable => "ai-local-driver-unavailable",
            Self::AiLocalAssetIncompatible => "ai-local-asset-incompatible",
            Self::AiLocalSelectionNotFound => "ai-local-selection-not-found",
            Self::AiLocalCapabilityMismatch => "ai-local-capability-mismatch",
            Self::AiLocalConfigurationNotConfigured => "ai-local-configuration-not-configured",
            Self::AiProviderAuthFailed => "ai-provider-auth-failed",
            Self::AiProviderInternal => "ai-provider-internal",
            Self::AiProviderRateLimited => "ai-provider-rate-limited",
            Self::AiProviderTimeout => "ai-provider-timeout",
            Self::AiRealtimeSessionNotFound => "ai-realtime-session-not-found",
            Self::AiRealtimeSessionClosed => "ai-realtime-session-closed",
            Self::AiMediaSpecInvalid => "ai-media-spec-invalid",
            Self::AiMediaOptionUnsupported => "ai-media-option-unsupported",
            Self::AiVoiceInputInvalid => "ai-voice-input-invalid",
            Self::AiVoiceWorkflowUnsupported => "ai-voice-workflow-unsupported",
            Self::AiVoiceAssetNotFound => "ai-voice-asset-not-found",
            Self::AiVoiceAssetExpired => "ai-voice-asset-expired",
            Self::AiVoiceAssetScopeForbidden => "ai-voice-asset-scope-forbidden",
            Self::AiVoiceTargetModelMismatch => "ai-voice-target-model-mismatch",
            Self::AiVoiceJobNotFound => "ai-voice-job-not-found",
            Self::AiVoiceJobNotCancellable => "ai-voice-job-not-cancellable",
            Self::AiConfigInvalid => "ai-config-invalid",
            Self::AiConfigNotFound => "ai-config-not-found",
            Self::AiConfigPersistenceUnavailable => "ai-config-persistence-unavailable",
            Self::SnapshotUnavailable => "local-app-snapshot-unavailable",
            Self::AccessDenied => "local-app-access-denied",
            Self::OperationUnsupported => "local-app-operation-unsupported",
            Self::OwnerUnavailable => "local-app-owner-unavailable",
            Self::CurrentUserDisplayUnavailable => "current-user-display-unavailable",
            Self::OperationUnavailable => "local-app-operation-unavailable",
            Self::CapabilityUnavailable => "capability-unavailable",
            Self::InvalidInput => "invalid-input",
            Self::SessionInvalid => "session-invalid",
            Self::PersonaAccessDenied => "access-denied",
            Self::OwnerAuthorityMissing => "owner-authority-missing",
            Self::ContentConflict => "content-conflict",
            Self::RealmUnavailable => "realm-unavailable",
            Self::RateLimited => "rate-limited",
            Self::UpstreamFailed => "upstream-failed",
            Self::ContractInvalid => "contract-invalid",
            Self::RequestTooLarge => "request-too-large",
            Self::ResponseTooLarge => "response-too-large",
            Self::InvalidPayload => "invalid-payload",
            Self::InvalidPath => "invalid-path",
            Self::NotFound => "not-found",
            Self::ResourceExhausted => "resource-exhausted",
            Self::AlreadyExists => "already-exists",
            Self::ObjectTooLarge => "object-too-large",
            Self::InvalidRange => "invalid-range",
            Self::InvalidCursor => "invalid-cursor",
            Self::IntegrityFailure => "integrity-failure",
            Self::ArtifactUnavailable => "artifact-unavailable",
            Self::Canceled => "canceled",
            Self::HostInternalError => "host-internal-error",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalAppOperationError {
    reason_code: LocalAppReasonCode,
    retryable: bool,
    reason_metadata: BTreeMap<String, String>,
}

impl LocalAppOperationError {
    pub const fn new(reason_code: LocalAppReasonCode, retryable: bool) -> Self {
        Self {
            reason_code,
            retryable,
            reason_metadata: BTreeMap::new(),
        }
    }

    pub fn with_reason_metadata(mut self, reason_metadata: BTreeMap<String, String>) -> Self {
        self.reason_metadata = reason_metadata;
        self
    }

    pub const fn reason_code(&self) -> LocalAppReasonCode {
        self.reason_code
    }

    pub const fn retryable(&self) -> bool {
        self.retryable
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
pub struct LocalAppCurrentUserDisplay {
    pub handle: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalAppCurrentUserStatus {
    pub value: Option<LocalAppCurrentUserDisplay>,
    pub reason_code: LocalAppReasonCode,
    pub retryable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalAppSessionStatus {
    pub state: LocalAppSessionState,
    pub reason_code: LocalAppReasonCode,
    pub retryable: bool,
    pub current_user: LocalAppCurrentUserStatus,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppTextCandidateMessage {
    pub role: String,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppTextCandidateRequest {
    pub messages: Vec<LocalAppTextCandidateMessage>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<i32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppTextTurnRequest {
    pub messages: Vec<LocalAppTextCandidateMessage>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<i32>,
    pub top_k: Option<i32>,
    pub presence_penalty: Option<f32>,
    pub frequency_penalty: Option<f32>,
    pub stop: Vec<String>,
    pub seed: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppTextCandidateResult {
    pub text: String,
    pub finish_reason: String,
    pub trace_id: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppScenarioExecuteRequest {
    pub spec: JsonValue,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppScenarioSubmitRequest {
    pub spec: JsonValue,
    pub timeout_ms: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppScenarioGetRequest {
    pub job_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppScenarioCancelRequest {
    pub job_id: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppScenarioJobSubscribeRequest {
    pub job_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppScenarioReadArtifactRequest {
    pub artifact_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppScenarioUploadArtifactRequest {
    pub bytes: Vec<u8>,
    pub mime_type: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LocalAppScenarioListVoiceAssetsRequest {
    pub page_size: i32,
    pub page_token: String,
}

pub type LocalAppScenarioStreamReceiver =
    tokio::sync::mpsc::Receiver<Result<JsonValue, LocalAppOperationError>>;

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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetRecord {
    pub relative_path: String,
    pub media_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetStatRequest {
    pub relative_path: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LocalAppAssetListRequest {
    pub prefix: String,
    pub cursor: String,
    pub page_size: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetListResult {
    pub assets: Vec<LocalAppAssetRecord>,
    pub next_cursor: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetWriteRequest {
    pub relative_path: String,
    pub media_type: String,
    pub overwrite: bool,
}

pub type LocalAppAssetWriteReceiver = tokio::sync::mpsc::Receiver<Vec<u8>>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetReadRequest {
    pub relative_path: String,
    pub offset: Option<i64>,
    pub length: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetRange {
    pub offset: i64,
    pub length: i64,
    pub total_size: i64,
}

pub type LocalAppAssetReadReceiver =
    tokio::sync::mpsc::Receiver<Result<Vec<u8>, LocalAppOperationError>>;

pub struct LocalAppAssetReadResult {
    pub asset: LocalAppAssetRecord,
    pub range: LocalAppAssetRange,
    pub body: LocalAppAssetReadReceiver,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetRemoveRequest {
    pub relative_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetRemoveResult {
    pub removed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetMoveRequest {
    pub from_relative_path: String,
    pub to_relative_path: String,
    pub overwrite: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetRevealRequest {
    pub relative_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetRevealTarget {
    pub asset: LocalAppAssetRecord,
    pub absolute_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAssetAdoptRequest {
    pub artifact_id: String,
    pub relative_path: String,
    pub overwrite: bool,
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

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LocalAppPersonaCharacterListOwnedRequest {
    pub world_id: Option<String>,
    pub visibility: Option<String>,
    pub after_id: Option<String>,
    pub take: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppPersonaCharacterGetOwnedRequest {
    pub persona_character_id: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppPersonaCharacterCreateRequest {
    pub body: JsonValue,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppPersonaCharacterReplaceRequest {
    pub persona_character_id: String,
    pub body: JsonValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppPersonaCharacterDeleteRequest {
    pub persona_character_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentReference {
    pub agent_handle: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationOpenRequest {
    pub agent_handle: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationOpenResult {
    pub conversation_anchor_id: String,
    pub active_turn_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationSendRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub request_id: String,
    pub parts: Vec<LocalAppConversationInputPart>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LocalAppConversationInputPart {
    Text(String),
    ArtifactRef(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationSendResult {
    pub turn_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationAttachmentUploadRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub mime_type: String,
    pub display_name: Option<String>,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationAttachmentUploadResult {
    pub artifact_id: String,
    pub expires_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationArtifactReadRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub artifact_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationArtifactReadResult {
    pub artifact_id: String,
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub byte_length: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationVoiceTranscriptionRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub request_id: String,
    pub mime_type: String,
    pub audio_bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationVoiceTranscriptionResult {
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationVoiceRenderRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub message_id: String,
    pub request_id: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppConversationVoiceRenderResult {
    pub voice: JsonValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationInterruptRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationInterruptResult {
    pub turn_id: String,
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
pub struct LocalAppEmbodimentSnapshotRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppEmbodimentSubscribeRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub after_sequence: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentHandleRequest {
    pub agent_handle: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentPresentationAssetReadRequest {
    pub agent_handle: String,
    pub asset_ref: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentMemoryInspectRequest {
    pub agent_handle: String,
    pub limit: u32,
    pub page_token: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentManagerSnapshotRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppSharedAgentAIConfigOverwriteRequest {
    pub expected_revision: String,
    pub capabilities: JsonValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppSharedAgentAIConfigLocalOptionsRequest {
    pub kind: String,
    pub capability_contract: String,
    pub connector_ref: String,
    pub search: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAIConfigOverwriteRequest {
    pub expected_revision: String,
    pub capabilities: JsonValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAIConfigLocalOptionsRequest {
    pub kind: String,
    pub capability_contract: String,
    pub connector_ref: String,
    pub search: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAgentUpdateAutonomyRequest {
    pub agent_handle: String,
    pub expected_autonomy_revision: u64,
    pub intent: JsonValue,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAgentPresentationAssetInput {
    pub role: String,
    pub file_name: String,
    pub media_type: String,
    pub content: Vec<u8>,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAgentCommitPresentationRequest {
    pub agent_handle: String,
    pub expected_presentation_revision: u64,
    pub intent: JsonValue,
    pub imported_assets: Vec<LocalAppAgentPresentationAssetInput>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentMemoryCorrectRequest {
    pub agent_handle: String,
    pub memory_id: String,
    pub corrected_content: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentMemoryForgetRequest {
    pub agent_handle: String,
    pub memory_ids: Vec<String>,
    pub confirmed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentMemorySwitchRequest {
    pub agent_handle: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentMemoryDeleteRequest {
    pub agent_handle: String,
    pub confirmed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocalAppConversationMessageRole {
    User,
    Assistant,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationMessage {
    pub message_id: String,
    pub turn_id: String,
    pub role: LocalAppConversationMessageRole,
    pub parts: JsonValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationSnapshot {
    pub conversation_anchor_id: String,
    pub through_sequence: u64,
    pub turns: Vec<JsonValue>,
    pub messages: Vec<LocalAppConversationMessage>,
    pub actions: Vec<JsonValue>,
    pub voices: Vec<JsonValue>,
    pub truncated_before: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppConversationEvent {
    pub conversation_anchor_id: String,
    pub sequence: u64,
    pub event: LocalAppConversationEventKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LocalAppConversationEventKind {
    TurnAccepted {
        turn_id: String,
    },
    TurnStarted {
        turn_id: String,
    },
    TextDelta {
        turn_id: String,
        delta: String,
    },
    ReasoningStatus {
        turn_id: String,
        state: String,
    },
    LiveAction {
        turn_id: String,
        action: JsonValue,
    },
    LiveTool {
        turn_id: String,
        tool: JsonValue,
    },
    MessageCommitted {
        turn_id: String,
        message: JsonValue,
    },
    ActionPlanned {
        turn_id: String,
        action: JsonValue,
    },
    ActionStarted {
        turn_id: String,
        action: JsonValue,
    },
    ArtifactReady {
        turn_id: String,
        action_id: String,
        capability_contract: String,
        projection_message_id: String,
        artifact_id: String,
    },
    ActionCompleted {
        turn_id: String,
        action: JsonValue,
    },
    ActionFailed {
        turn_id: String,
        action: JsonValue,
    },
    VoiceReady {
        turn_id: String,
        voice: JsonValue,
    },
    VoiceFailed {
        turn_id: String,
        voice: JsonValue,
    },
    TurnCompleted {
        turn_id: String,
        terminal_reason: String,
    },
    TurnFailed {
        turn_id: String,
        reason_code: String,
        message: Option<String>,
    },
    TurnInterrupted {
        turn_id: String,
        reason: String,
    },
}

pub type LocalAppConversationSubscriptionReceiver =
    tokio::sync::mpsc::Receiver<Result<LocalAppConversationEvent, LocalAppOperationError>>;

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAiRealtimeOpenRequest {
    pub input_audio: JsonValue,
    pub audio_output_enabled: bool,
    pub turn_detection: String,
    pub initial_instruction: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAiRealtimeAppendInputRequest {
    pub realtime_session_id: String,
    pub generation: u64,
    pub input: JsonValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAiRealtimeOwnerControlRequest {
    pub realtime_session_id: String,
    pub generation: u64,
    pub request_id: String,
    pub control: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAiRealtimeSessionRequest {
    pub realtime_session_id: String,
    pub generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAiRealtimeOutputInterruptRequest {
    pub realtime_session_id: String,
    pub generation: u64,
    pub output_track_id: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAgentRealtimeOpenRequest {
    pub agent_handle: String,
    pub conversation_anchor_id: Option<String>,
    pub input_audio: JsonValue,
    pub turn_detection: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppAgentRealtimeAppendInputRequest {
    pub agent_handle: String,
    pub realtime_session_id: String,
    pub generation: u64,
    pub input: JsonValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentRealtimeSessionRequest {
    pub agent_handle: String,
    pub realtime_session_id: String,
    pub generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppAgentRealtimeOutputInterruptRequest {
    pub agent_handle: String,
    pub realtime_session_id: String,
    pub generation: u64,
    pub output_track_id: String,
    pub interrupt_agent_turn: bool,
}

pub type LocalAppRealtimeSubscriptionReceiver =
    tokio::sync::mpsc::Receiver<Result<JsonValue, LocalAppOperationError>>;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LocalAppRealmChatListRequest {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LocalAppRealmRealtimeOpenRequest;

#[derive(Clone, Debug, PartialEq)]
pub struct LocalAppRealmRealtimeSubscribeRequest {
    pub channel_id: String,
    pub target: JsonValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppRealmRealtimeAckRequest {
    pub channel_id: String,
    pub subscription_id: String,
    pub cursor: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppRealmRealtimeSubscriptionRequest {
    pub channel_id: String,
    pub subscription_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalAppRealmRealtimeChannelRequest {
    pub channel_id: String,
}

/// Opaque host-only handle for one connection-bound protected Desktop session.
/// The handle carries only explicit typed operations and cannot proxy an
/// arbitrary method id, request bytes, endpoint, or portable credential.
pub trait NimiDesktopControl: Send + Sync {
    /// Invalidates only the carrier cache entry owned by this exact
    /// connection-bound control. Implementations without a shared transport
    /// cache may keep the default no-op.
    fn invalidate_cached_transport(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async {})
    }

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

    fn invoke_bundled_avatar_client_stream(
        &self,
        request: BundledAvatarRuntimeClientStreamRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<BundledAvatarRuntimeResponse, BundledAvatarRuntimeError>>
                + Send
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

    fn invoke_account_product_client_stream(
        &self,
        request: DesktopAccountProductClientStreamRequest,
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

    fn set_developer_mode(
        &self,
        enabled: bool,
    ) -> Pin<Box<dyn Future<Output = Result<DeveloperModeStatus, NimiHostError>> + Send + '_>>;

    fn register_local_development_project(
        &self,
        request: LocalDevelopmentRegistrationRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentRegistration, NimiHostError>> + Send + '_>,
    >;

    fn list_local_development_registrations(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Vec<LocalDevelopmentRegistration>, NimiHostError>>
                + Send
                + '_,
        >,
    >;

    fn remove_local_development_registration(
        &self,
        registration_handle: [u8; 32],
    ) -> Pin<Box<dyn Future<Output = Result<(), NimiHostError>> + Send + '_>>;

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

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-044
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

    fn stream_text_turn(
        &self,
        request: LocalAppTextTurnRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppScenarioStreamReceiver, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn execute_scenario(
        &self,
        request: LocalAppScenarioExecuteRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn submit_scenario_job(
        &self,
        request: LocalAppScenarioSubmitRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn get_scenario_job(
        &self,
        request: LocalAppScenarioGetRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn subscribe_scenario_job(
        &self,
        request: LocalAppScenarioJobSubscribeRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppScenarioStreamReceiver, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn cancel_scenario_job(
        &self,
        request: LocalAppScenarioCancelRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn read_scenario_artifact(
        &self,
        request: LocalAppScenarioReadArtifactRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn upload_scenario_artifact(
        &self,
        request: LocalAppScenarioUploadArtifactRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn list_scenario_voice_assets(
        &self,
        request: LocalAppScenarioListVoiceAssetsRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn app_ai_config_get(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn app_ai_config_overwrite(
        &self,
        request: LocalAppAIConfigOverwriteRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn app_ai_config_local_options(
        &self,
        request: LocalAppAIConfigLocalOptionsRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_world_core_list(
        &self,
        request: LocalAppWorldCoreListRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_world_core_create(
        &self,
        request: LocalAppWorldCoreCreateRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_persona_character_list_owned(
        &self,
        request: LocalAppPersonaCharacterListOwnedRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_persona_character_get_owned(
        &self,
        request: LocalAppPersonaCharacterGetOwnedRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_persona_character_create(
        &self,
        request: LocalAppPersonaCharacterCreateRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_persona_character_replace(
        &self,
        request: LocalAppPersonaCharacterReplaceRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_persona_character_delete(
        &self,
        request: LocalAppPersonaCharacterDeleteRequest,
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

    fn storage_asset_stat(
        &self,
        request: LocalAppAssetStatRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppAssetRecord, LocalAppOperationError>> + Send + '_>,
    >;

    fn storage_asset_list(
        &self,
        request: LocalAppAssetListRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAssetListResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn storage_asset_write(
        &self,
        request: LocalAppAssetWriteRequest,
        body: LocalAppAssetWriteReceiver,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppAssetRecord, LocalAppOperationError>> + Send + '_>,
    >;

    fn storage_asset_read(
        &self,
        request: LocalAppAssetReadRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAssetReadResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn storage_asset_remove(
        &self,
        request: LocalAppAssetRemoveRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAssetRemoveResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn storage_asset_move(
        &self,
        request: LocalAppAssetMoveRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppAssetRecord, LocalAppOperationError>> + Send + '_>,
    >;

    fn storage_asset_reveal(
        &self,
        request: LocalAppAssetRevealRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAssetRevealTarget, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn storage_asset_adopt(
        &self,
        request: LocalAppAssetAdoptRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppAssetRecord, LocalAppOperationError>> + Send + '_>,
    >;

    fn agent_reference_list(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Vec<LocalAppAgentReference>, LocalAppOperationError>>
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

    fn conversation_attachment_upload(
        &self,
        request: LocalAppConversationAttachmentUploadRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        LocalAppConversationAttachmentUploadResult,
                        LocalAppOperationError,
                    >,
                > + Send
                + '_,
        >,
    >;

    fn conversation_artifact_read(
        &self,
        request: LocalAppConversationArtifactReadRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppConversationArtifactReadResult, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    >;

    fn conversation_voice_transcribe(
        &self,
        request: LocalAppConversationVoiceTranscriptionRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        LocalAppConversationVoiceTranscriptionResult,
                        LocalAppOperationError,
                    >,
                > + Send
                + '_,
        >,
    >;

    fn conversation_voice_render(
        &self,
        request: LocalAppConversationVoiceRenderRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppConversationVoiceRenderResult, LocalAppOperationError>,
                > + Send
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
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationSnapshot, LocalAppOperationError>>
                + Send
                + '_,
        >,
    >;

    fn embodiment_snapshot(
        &self,
        request: LocalAppEmbodimentSnapshotRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn embodiment_subscribe(
        &self,
        request: LocalAppEmbodimentSubscribeRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    >;

    fn ai_realtime_open(
        &self,
        request: LocalAppAiRealtimeOpenRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_chat_list(
        &self,
        request: LocalAppRealmChatListRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_realtime_open(
        &self,
        request: LocalAppRealmRealtimeOpenRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_realtime_subscribe(
        &self,
        request: LocalAppRealmRealtimeSubscribeRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    >;

    fn realm_realtime_ack(
        &self,
        request: LocalAppRealmRealtimeAckRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_realtime_subscription_close(
        &self,
        request: LocalAppRealmRealtimeSubscriptionRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn realm_realtime_channel_close(
        &self,
        request: LocalAppRealmRealtimeChannelRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn ai_realtime_append_input(
        &self,
        request: LocalAppAiRealtimeAppendInputRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn ai_realtime_submit_owner_control(
        &self,
        request: LocalAppAiRealtimeOwnerControlRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn ai_realtime_subscribe(
        &self,
        request: LocalAppAiRealtimeSessionRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    >;

    fn ai_realtime_interrupt_output(
        &self,
        request: LocalAppAiRealtimeOutputInterruptRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn ai_realtime_close(
        &self,
        request: LocalAppAiRealtimeSessionRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_realtime_open(
        &self,
        request: LocalAppAgentRealtimeOpenRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_realtime_append_input(
        &self,
        request: LocalAppAgentRealtimeAppendInputRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_realtime_subscribe(
        &self,
        request: LocalAppAgentRealtimeSessionRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError>,
                > + Send
                + '_,
        >,
    >;

    fn agent_realtime_status(
        &self,
        request: LocalAppAgentRealtimeSessionRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_realtime_interrupt_output(
        &self,
        request: LocalAppAgentRealtimeOutputInterruptRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_realtime_close(
        &self,
        request: LocalAppAgentRealtimeSessionRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn shared_agent_ai_config_get(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn shared_agent_ai_config_overwrite(
        &self,
        request: LocalAppSharedAgentAIConfigOverwriteRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn shared_agent_ai_config_local_options(
        &self,
        request: LocalAppSharedAgentAIConfigLocalOptionsRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_manager_snapshot(
        &self,
        request: LocalAppAgentManagerSnapshotRequest,
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

    fn agent_presentation_read_asset(
        &self,
        request: LocalAppAgentPresentationAssetReadRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_commit_presentation(
        &self,
        request: LocalAppAgentCommitPresentationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_memory_inspect(
        &self,
        request: LocalAppAgentMemoryInspectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_memory_correct(
        &self,
        request: LocalAppAgentMemoryCorrectRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_memory_forget(
        &self,
        request: LocalAppAgentMemoryForgetRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_memory_switch(
        &self,
        request: LocalAppAgentMemorySwitchRequest,
    ) -> Pin<Box<dyn Future<Output = Result<JsonValue, LocalAppOperationError>> + Send + '_>>;

    fn agent_memory_delete(
        &self,
        request: LocalAppAgentMemoryDeleteRequest,
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

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-041
pub trait NimiProtectedLocalHostCarrier: FixedRuntimeServiceControl {
    /// Opens a mutually verified native connection and performs the empty
    /// OpenDesktopSession bootstrap internally. Session and boot-epoch bytes
    /// remain connection-bound and are never returned by this host API.
    fn open_desktop_control(&self) -> DesktopControlFuture<'_>;
}
