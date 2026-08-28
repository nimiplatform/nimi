#![deny(unsafe_code)]

mod adapters;
mod asset_reveal;
mod bundled_avatar;
mod carrier;
mod desktop_account;
mod desktop_stream;
mod desktop_unary;
mod first_party_product;
mod first_party_profiles_generated;
mod grpc_limits;
mod grpc_status;
mod local_development;
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos_data_root;
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos_peer_trust;
#[cfg(target_os = "macos")]
mod macos_profile;
#[cfg(all(target_os = "macos", feature = "macos-local-development"))]
mod macos_profile_local_development;
#[cfg(all(target_os = "macos", feature = "macos-source-local-development"))]
mod macos_profile_source_local_development;
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos_service_control;
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos_supervised_process;
mod reason;
mod service;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_asset_reveal;
mod windows_source_policy;
#[allow(
    dead_code,
    clippy::doc_lazy_continuation,
    clippy::enum_variant_names,
    clippy::large_enum_variant
)]
#[cfg(all(
    feature = "macos-local-development",
    feature = "macos-source-local-development"
))]
compile_error!("macos-local-development and macos-source-local-development are mutually exclusive");

#[cfg(all(
    feature = "windows-source-local-development",
    not(target_os = "windows")
))]
compile_error!("windows-source-local-development requires a Windows target");

mod generated {
    tonic::include_proto!("nimi.runtime.v1");
}
#[cfg(all(
    target_os = "windows",
    not(feature = "windows-source-local-development")
))]
#[allow(unsafe_code)]
mod windows_data_root;
#[cfg(all(target_os = "windows", feature = "windows-source-local-development"))]
#[allow(unsafe_code)]
#[path = "windows_data_root_source_local_development.rs"]
mod windows_data_root;
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod windows_desktop_account;
#[cfg(any(target_os = "windows", target_os = "macos"))]
#[allow(unsafe_code)]
mod windows_local_app;
#[cfg(any(target_os = "windows", target_os = "macos"))]
#[allow(unsafe_code)]
mod windows_local_development;
#[cfg(any(target_os = "windows", target_os = "macos"))]
#[cfg(all(
    target_os = "windows",
    not(feature = "windows-source-local-development")
))]
#[allow(unsafe_code)]
mod windows_peer_trust;
#[cfg(all(target_os = "windows", feature = "windows-source-local-development"))]
#[allow(unsafe_code)]
#[path = "windows_peer_trust_source_local_development.rs"]
mod windows_peer_trust;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_service_control;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_supervised_process;

#[cfg(not(target_os = "macos"))]
pub use adapters::MacOsLocalAppCarrier;
pub use adapters::{
    LinuxLocalAppCarrier, LinuxUnixSocketCarrier, WindowsLocalAppCarrier, WindowsNamedPipeCarrier,
};
pub use asset_reveal::reveal_local_app_asset_target;
pub use bundled_avatar::{
    BundledAvatarRuntimeError, BundledAvatarRuntimeRequest, BundledAvatarRuntimeResponse,
    BundledAvatarRuntimeStreamReceiver,
};
pub use carrier::{
    DesktopControlFuture, LocalAppAIConfigLocalOptionsRequest, LocalAppAIConfigOverwriteRequest,
    LocalAppAgentCommitPresentationRequest, LocalAppAgentHandleRequest,
    LocalAppAgentManagerSnapshotRequest, LocalAppAgentMemoryCorrectRequest,
    LocalAppAgentMemoryDeleteRequest, LocalAppAgentMemoryForgetRequest,
    LocalAppAgentMemoryInspectRequest, LocalAppAgentMemorySwitchRequest,
    LocalAppAgentRealtimeAppendInputRequest, LocalAppAgentRealtimeOpenRequest,
    LocalAppAgentRealtimeOutputInterruptRequest, LocalAppAgentRealtimeSessionRequest,
    LocalAppAgentReference, LocalAppAgentUpdateAutonomyRequest,
    LocalAppAiRealtimeAppendInputRequest, LocalAppAiRealtimeOpenRequest,
    LocalAppAiRealtimeOutputInterruptRequest, LocalAppAiRealtimeOwnerControlRequest,
    LocalAppAiRealtimeSessionRequest, LocalAppAssetAdoptRequest, LocalAppAssetListRequest,
    LocalAppAssetListResult, LocalAppAssetMoveRequest, LocalAppAssetRange,
    LocalAppAssetReadReceiver, LocalAppAssetReadRequest, LocalAppAssetReadResult,
    LocalAppAssetRecord, LocalAppAssetRemoveRequest, LocalAppAssetRemoveResult,
    LocalAppAssetRevealRequest, LocalAppAssetRevealTarget, LocalAppAssetStatRequest,
    LocalAppAssetWriteReceiver, LocalAppAssetWriteRequest, LocalAppConversationArtifactReadRequest,
    LocalAppConversationArtifactReadResult, LocalAppConversationAttachmentUploadRequest,
    LocalAppConversationAttachmentUploadResult, LocalAppConversationEvent,
    LocalAppConversationEventKind, LocalAppConversationInputPart,
    LocalAppConversationInterruptRequest, LocalAppConversationInterruptResult,
    LocalAppConversationMessage, LocalAppConversationMessageRole, LocalAppConversationOpenRequest,
    LocalAppConversationOpenResult, LocalAppConversationSendRequest,
    LocalAppConversationSendResult, LocalAppConversationSnapshot,
    LocalAppConversationSnapshotRequest, LocalAppConversationSubscribeRequest,
    LocalAppConversationSubscriptionReceiver, LocalAppConversationVoiceRenderRequest,
    LocalAppConversationVoiceRenderResult, LocalAppConversationVoiceTranscriptionRequest,
    LocalAppConversationVoiceTranscriptionResult, LocalAppCurrentUserDisplay,
    LocalAppCurrentUserStatus, LocalAppOperationError, LocalAppPersonaCharacterCreateRequest,
    LocalAppPersonaCharacterDeleteRequest, LocalAppPersonaCharacterGetOwnedRequest,
    LocalAppPersonaCharacterListOwnedRequest, LocalAppPersonaCharacterReplaceRequest,
    LocalAppRealmChatListRequest, LocalAppRealmRealtimeAckRequest,
    LocalAppRealmRealtimeChannelRequest, LocalAppRealmRealtimeOpenRequest,
    LocalAppRealmRealtimeSubscribeRequest, LocalAppRealmRealtimeSubscriptionRequest,
    LocalAppRealtimeSubscriptionReceiver, LocalAppReasonCode, LocalAppScenarioCancelRequest,
    LocalAppScenarioExecuteRequest, LocalAppScenarioGetRequest,
    LocalAppScenarioJobSubscribeRequest, LocalAppScenarioListVoiceAssetsRequest,
    LocalAppScenarioReadArtifactRequest, LocalAppScenarioStreamReceiver,
    LocalAppScenarioSubmitRequest, LocalAppScenarioUploadArtifactRequest, LocalAppSessionFuture,
    LocalAppSessionState, LocalAppSessionStatus, LocalAppSharedAgentAIConfigLocalOptionsRequest,
    LocalAppSharedAgentAIConfigOverwriteRequest, LocalAppStorageDocument,
    LocalAppStorageReadRequest, LocalAppStorageRemoveRequest, LocalAppStorageRemoveResult,
    LocalAppStorageWriteRequest, LocalAppTextCandidateMessage, LocalAppTextCandidateRequest,
    LocalAppTextCandidateResult, LocalAppWorldCoreCreateRequest, LocalAppWorldCoreListRequest,
    NimiDesktopControl, NimiLocalAppCarrier, NimiLocalAppSession, NimiProtectedLocalHostCarrier,
};
pub use desktop_account::{
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse, DesktopAccountProjection,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse,
    DesktopAccountSessionDeliveryKind, DesktopAccountSessionEvent,
    DesktopAccountSessionEventReceiver, DesktopAccountSessionEventsRequest,
    DesktopAccountSessionState, DesktopAccountSessionStatus, DesktopAccountSessionStatusRequest,
};
pub use first_party_product::{
    DesktopAccountProductStreamRequest, DesktopAccountProductUnaryRequest,
    DesktopFirstPartyProductError, DesktopFirstPartyProductStreamReceiver,
    DesktopFirstPartyProductUnaryResponse, DesktopMachineProductStreamRequest,
    DesktopMachineProductUnaryRequest,
};
pub use first_party_profiles_generated::{
    DesktopAccountProductStreamMethod, DesktopAccountProductUnaryMethod,
    DesktopMachineProductStreamMethod, DesktopMachineProductUnaryMethod,
    DESKTOP_ACCOUNT_PRODUCT_PROFILE_ID, DESKTOP_ACCOUNT_PRODUCT_STREAM_METHODS,
    DESKTOP_ACCOUNT_PRODUCT_UNARY_METHODS, DESKTOP_MACHINE_PRODUCT_PROFILE_ID,
    DESKTOP_MACHINE_PRODUCT_STREAM_METHODS, DESKTOP_MACHINE_PRODUCT_UNARY_METHODS,
};
pub use grpc_limits::{
    runtime_raw_client, RUNTIME_GRPC_MAX_MESSAGE_BYTES, RUNTIME_GRPC_MESSAGE_HEADROOM_BYTES,
    RUNTIME_MAX_INLINE_PAYLOAD_BYTES,
};
pub use local_development::{
    DeveloperModeState, DeveloperModeStatus, LocalDevelopmentEndRunRequest,
    LocalDevelopmentLaunchOutcome, LocalDevelopmentLaunchRequest, LocalDevelopmentProject,
    LocalDevelopmentRegistration, LocalDevelopmentRegistrationRequest, LocalDevelopmentShellKind,
    NimiHostError, NimiHostErrorReasonCode, LOCAL_DEVELOPMENT_TRUST_CLASS,
};
#[cfg(target_os = "macos")]
pub use macos_data_root::{prepare_fixed_runtime_data_root, FixedRuntimeDataRootError};
#[cfg(target_os = "macos")]
pub use macos_service_control::MacOsUnixSocketCarrier;
pub use reason::{ProtectedCarrierError, ProtectedCarrierReasonCode};
pub use service::{
    FixedRuntimeServiceControl, RuntimeServiceAction, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};
#[cfg(target_os = "windows")]
pub use windows_data_root::{prepare_fixed_runtime_data_root, FixedRuntimeDataRootError};
#[cfg(target_os = "macos")]
pub use windows_local_app::MacOsLocalAppCarrier;
#[cfg(all(target_os = "windows", feature = "windows-source-local-development"))]
pub use windows_service_control::terminate_source_local_development_host;
#[cfg(target_os = "windows")]
pub use windows_service_control::{
    invalidate_verified_desktop_runtime_channel, open_verified_desktop_runtime_channel,
};
