use crate::{FixedRuntimeServiceControl, ProtectedCarrierError};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledAppLaunchRequest {
    pub launch_id: [u8; 32],
    pub executable_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledAppLaunchOutcome {
    pub launch_id: [u8; 32],
    pub process_id: u32,
}

/// Opaque host-only handle for one connection-bound protected Desktop session.
///
/// Typed account and lifecycle methods are added to this contract only from
/// generated Runtime protocol projections. Keeping this trait marker-only in
/// the compile-only carrier slice prevents a generic method-id or byte proxy
/// from becoming a protected transport bypass.
pub trait NimiDesktopControl: Send + Sync {
    fn launch_installed_app(
        &self,
        request: InstalledAppLaunchRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<InstalledAppLaunchOutcome, ProtectedCarrierError>>
                + Send
                + '_,
        >,
    >;
}

pub trait NimiInstalledAppSession: Send + Sync {}

pub trait NimiInstalledAppCarrier: Send + Sync {
    fn open_installed_app_session(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Box<dyn NimiInstalledAppSession>, ProtectedCarrierError>>
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
