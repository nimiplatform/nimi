#![deny(unsafe_code)]

mod adapters;
mod bundled_avatar;
mod carrier;
mod desktop_account;
mod desktop_stream;
mod desktop_unary;
mod first_party_product;
mod first_party_profiles_generated;
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

mod generated {
    tonic::include_proto!("nimi.runtime.v1");
}
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
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
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
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
pub use bundled_avatar::{
    BundledAvatarRuntimeError, BundledAvatarRuntimeRequest, BundledAvatarRuntimeResponse,
    BundledAvatarRuntimeStreamReceiver,
};
pub use carrier::{
    DesktopControlFuture, LocalAppAIConfigOverwriteRequest, LocalAppAgentCommitPresentationRequest,
    LocalAppAgentHandleRequest, LocalAppAgentReference, LocalAppAgentUpdateAutonomyRequest,
    LocalAppArtifactPutRequest, LocalAppArtifactPutResult, LocalAppArtifactReadRequest,
    LocalAppArtifactReadResult, LocalAppConversationEvent, LocalAppConversationInterruptRequest,
    LocalAppConversationInterruptResult, LocalAppConversationOpenRequest,
    LocalAppConversationOpenResult, LocalAppConversationSendRequest,
    LocalAppConversationSendResult, LocalAppConversationSnapshotRequest,
    LocalAppConversationSubscribeRequest, LocalAppConversationSubscriptionReceiver,
    LocalAppCurrentUserDisplay, LocalAppCurrentUserStatus, LocalAppOperationError,
    LocalAppReasonCode, LocalAppSessionFuture, LocalAppSessionState, LocalAppSessionStatus,
    LocalAppSharedAgentAIConfigOverwriteRequest, LocalAppSharedAgentAIProfileRequest,
    LocalAppStorageDocument, LocalAppStorageReadRequest, LocalAppStorageRemoveRequest,
    LocalAppStorageRemoveResult, LocalAppStorageWriteRequest, LocalAppTextCandidateMessage,
    LocalAppTextCandidateRequest, LocalAppTextCandidateResult, LocalAppWorldCoreCreateRequest,
    LocalAppWorldCoreListRequest, NimiDesktopControl, NimiLocalAppCarrier, NimiLocalAppSession,
    NimiProtectedLocalHostCarrier,
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
#[cfg(target_os = "windows")]
pub use windows_service_control::{
    invalidate_verified_desktop_runtime_channel, open_verified_desktop_runtime_channel,
};
