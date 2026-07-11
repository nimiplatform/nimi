use crate::{FixedRuntimeServiceControl, ProtectedCarrierError};
use std::error::Error;
use std::fmt::{Display, Formatter};
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledArtifactBytes {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub size_bytes: i64,
    pub mime_inferred: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstalledArtifactReadReasonCode {
    InvalidInput,
    Forbidden,
    NotFound,
    TooLarge,
    RuntimeUnavailable,
    RuntimeUntrusted,
}

impl InstalledArtifactReadReasonCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidInput => "installed-artifact-invalid-input",
            Self::Forbidden => "installed-artifact-forbidden",
            Self::NotFound => "installed-artifact-not-found",
            Self::TooLarge => "installed-artifact-too-large",
            Self::RuntimeUnavailable => "installed-artifact-runtime-unavailable",
            Self::RuntimeUntrusted => "installed-artifact-runtime-untrusted",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstalledArtifactReadError {
    reason_code: InstalledArtifactReadReasonCode,
    retryable: bool,
}

impl InstalledArtifactReadError {
    pub const fn new(reason_code: InstalledArtifactReadReasonCode, retryable: bool) -> Self {
        Self {
            reason_code,
            retryable,
        }
    }

    pub const fn reason_code(self) -> InstalledArtifactReadReasonCode {
        self.reason_code
    }

    pub const fn retryable(self) -> bool {
        self.retryable
    }
}

impl Display for InstalledArtifactReadError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.reason_code.as_str())
    }
}

impl Error for InstalledArtifactReadError {}

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

pub trait NimiInstalledAppSession: Send + Sync {
    fn read_artifact_bytes(
        &self,
        artifact_id: String,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<InstalledArtifactBytes, InstalledArtifactReadError>>
                + Send
                + '_,
        >,
    >;
}

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
