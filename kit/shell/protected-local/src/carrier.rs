use crate::{FixedRuntimeServiceControl, ProtectedCarrierError};

/// Opaque host-only handle for one connection-bound protected Desktop session.
///
/// Typed account and lifecycle methods are added to this contract only from
/// generated Runtime protocol projections. Keeping this trait marker-only in
/// the compile-only carrier slice prevents a generic method-id or byte proxy
/// from becoming a protected transport bypass.
pub trait NimiDesktopControl: Send {}

pub trait NimiProtectedLocalHostCarrier: FixedRuntimeServiceControl {
    /// Opens a mutually verified native connection and performs the empty
    /// OpenDesktopSession bootstrap internally. Session and boot-epoch bytes
    /// remain connection-bound and are never returned by this host API.
    fn open_desktop_control(&self) -> Result<Box<dyn NimiDesktopControl>, ProtectedCarrierError>;
}
