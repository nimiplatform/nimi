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
mod windows_peer_trust;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_service_control;

pub use adapters::{LinuxUnixSocketCarrier, MacOsPrivilegedXpcCarrier, WindowsNamedPipeCarrier};
pub use carrier::{NimiDesktopControl, NimiProtectedLocalHostCarrier};
pub use reason::{ProtectedCarrierError, ProtectedCarrierReasonCode};
pub use service::{
    FixedRuntimeServiceControl, RuntimeServiceAction, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};
