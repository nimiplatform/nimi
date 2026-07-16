#![deny(unsafe_code)]

mod adapters;
mod carrier;
mod desktop_account;
mod desktop_product_control;
mod desktop_runtime_consumer;
mod desktop_unary;
mod grpc_status;
mod local_development;
mod reason;
mod service;
#[allow(dead_code)]
mod generated {
    tonic::include_proto!("nimi.runtime.v1");
}
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_data_root;
#[cfg(target_os = "windows")]
mod windows_desktop_account;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_local_app;
#[cfg(target_os = "windows")]
mod windows_local_app_grant_control;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_local_development;
#[cfg(target_os = "windows")]
mod windows_local_development_authority_summary;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_peer_trust;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_presence_browser_broker;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_service_control;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_supervised_process;

pub use adapters::{
    LinuxLocalAppCarrier, LinuxUnixSocketCarrier, MacOsLocalAppCarrier, MacOsPrivilegedXpcCarrier,
    WindowsLocalAppCarrier, WindowsNamedPipeCarrier,
};
pub use carrier::{
    LocalAppAgentConversationSnapshotRequest, LocalAppAgentInventoryRequest,
    LocalAppAgentOpenConversationRequest, LocalAppAgentProjection, LocalAppAgentSendTurnRequest,
    LocalAppAgentSubscribeTurnRequest, LocalAppAgentSubscribeVoiceStreamRequest,
    LocalAppAgentTranscribeVoiceRequest, LocalAppAgentVoiceStreamEvent,
    LocalAppAgentVoiceStreamPage, LocalAppAgentVoiceTranscription, LocalAppArtifactBytes,
    LocalAppArtifactReadRequest, LocalAppGrantControlDecisionRequest, LocalAppGrantControlPending,
    LocalAppGrantControlProjection, LocalAppGrantControlState, LocalAppOperationError,
    LocalAppPermissionPosture, LocalAppPermissionPostureRequest, LocalAppPermissionRequest,
    LocalAppPermissionState, LocalAppReasonCode, LocalAppSessionState, LocalAppSessionStatus,
    LocalAppStorageDocument, LocalAppStorageReadRequest, LocalAppStorageRemoveRequest,
    LocalAppStorageRemoveResult, LocalAppStorageWriteRequest, NimiDesktopControl,
    NimiLocalAppCarrier, NimiLocalAppSession, NimiProtectedLocalHostCarrier,
};
pub use desktop_account::{
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse, DesktopAccountProjection,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse, DesktopAccountSessionState,
    DesktopAccountSessionStatus, DesktopAccountSessionStatusRequest,
};
pub use desktop_product_control::{
    DesktopProductControlError, DesktopProductControlMethod, DesktopProductControlRequest,
    DesktopProductControlResponse,
};
pub use desktop_runtime_consumer::{
    DesktopRuntimeConsumerError, DesktopRuntimeConsumerMethod, DesktopRuntimeConsumerRequest,
    DesktopRuntimeConsumerResponse,
};
pub use local_development::{
    DeveloperModeState, DeveloperModeStatus, LocalDevelopmentAuthoritySummary,
    LocalDevelopmentAuthorization, LocalDevelopmentAuthorizationState, LocalDevelopmentDecision,
    LocalDevelopmentDecisionRequest, LocalDevelopmentDeveloperModeSummary,
    LocalDevelopmentEndRunRequest, LocalDevelopmentEvaluation, LocalDevelopmentEvaluationRequest,
    LocalDevelopmentGrantSummary, LocalDevelopmentLaunchOutcome, LocalDevelopmentLaunchRequest,
    LocalDevelopmentProject, LocalDevelopmentProjectAuthorizationSummary,
    LocalDevelopmentReactivationRequest, LocalDevelopmentShellKind,
    LocalDevelopmentSummaryAvailability, NimiHostError, NimiHostErrorReasonCode,
    LOCAL_DEVELOPMENT_TRUST_CLASS,
};
pub use reason::{ProtectedCarrierError, ProtectedCarrierReasonCode};
pub use service::{
    FixedRuntimeServiceControl, RuntimeServiceAction, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};
#[cfg(target_os = "windows")]
pub use windows_data_root::{prepare_fixed_runtime_data_root, FixedRuntimeDataRootError};
#[cfg(target_os = "windows")]
pub use windows_service_control::{
    invalidate_verified_desktop_runtime_channel, open_verified_desktop_runtime_channel,
};
