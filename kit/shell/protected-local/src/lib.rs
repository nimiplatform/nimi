#![forbid(unsafe_code)]

mod adapters;
mod carrier;
mod reason;
mod service;

pub use adapters::{LinuxUnixSocketCarrier, MacOsPrivilegedXpcCarrier, WindowsNamedPipeCarrier};
pub use carrier::{NimiDesktopControl, NimiProtectedLocalHostCarrier};
pub use reason::{ProtectedCarrierError, ProtectedCarrierReasonCode};
pub use service::{
    FixedRuntimeServiceControl, RuntimeServiceAction, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};
