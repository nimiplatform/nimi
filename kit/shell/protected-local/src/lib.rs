#![deny(unsafe_code)]

mod adapters;
mod carrier;
mod desktop_account;
mod grpc_status;
mod local_development;
mod reason;
mod service;
mod generated {
    tonic::include_proto!("nimi.runtime.v1");
}
#[cfg(target_os = "windows")]
mod windows_desktop_account;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_installed_launch;
#[cfg(target_os = "windows")]
mod windows_installed_session;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_local_development;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_peer_trust;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_service_control;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_supervised_process;

pub use adapters::{
    LinuxAppHostCarrier, LinuxUnixSocketCarrier, MacOsAppHostCarrier, MacOsPrivilegedXpcCarrier,
    WindowsAppHostCarrier, WindowsNamedPipeCarrier,
};
pub use carrier::{
    AppHostArtifactBytes, AppHostArtifactReadError, AppHostArtifactReadReasonCode,
    InstalledAppLaunchOutcome, InstalledAppLaunchRequest, NimiAppHostCarrier, NimiAppHostSession,
    NimiDesktopControl, NimiProtectedLocalHostCarrier,
};
pub use desktop_account::{
    DesktopAccountProjection, DesktopAccountSessionState, DesktopAccountSessionStatus,
    DesktopAccountSessionStatusRequest,
};
pub use local_development::{
    AppHostBootstrapState, AppHostBootstrapStatus, AppHostTrustClass,
    LocalDevelopmentAuthorization, LocalDevelopmentAuthorizationState, LocalDevelopmentDecision,
    LocalDevelopmentDecisionRequest, LocalDevelopmentEndRunRequest, LocalDevelopmentEvaluation,
    LocalDevelopmentEvaluationRequest, LocalDevelopmentLaunchOutcome,
    LocalDevelopmentLaunchRequest, LocalDevelopmentProject, LocalDevelopmentShellKind,
    NimiHostError, NimiHostErrorReasonCode, LOCAL_DEVELOPMENT_TRUST_CLASS,
};
pub use reason::{ProtectedCarrierError, ProtectedCarrierReasonCode};
pub use service::{
    FixedRuntimeServiceControl, RuntimeServiceAction, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};
