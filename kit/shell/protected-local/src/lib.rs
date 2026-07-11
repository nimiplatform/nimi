#![deny(unsafe_code)]

mod adapters;
mod carrier;
mod reason;
mod service;
mod generated {
    tonic::include_proto!("nimi.runtime.v1");
}
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_installed_launch;
#[cfg(target_os = "windows")]
mod windows_installed_session;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_peer_trust;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_service_control;

pub use adapters::{
    LinuxInstalledAppCarrier, LinuxUnixSocketCarrier, MacOsInstalledAppCarrier,
    MacOsPrivilegedXpcCarrier, WindowsInstalledAppCarrier, WindowsNamedPipeCarrier,
};
pub use carrier::{
    InstalledAppLaunchOutcome, InstalledAppLaunchRequest, NimiDesktopControl,
    NimiInstalledAppCarrier, NimiInstalledAppSession, NimiProtectedLocalHostCarrier,
};
pub use reason::{ProtectedCarrierError, ProtectedCarrierReasonCode};
pub use service::{
    FixedRuntimeServiceControl, RuntimeServiceAction, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};
