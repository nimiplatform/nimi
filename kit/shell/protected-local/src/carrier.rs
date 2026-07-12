use crate::{
    AppHostBootstrapStatus, DesktopAccountSessionStatus, DesktopAccountSessionStatusRequest,
    FixedRuntimeServiceControl, LocalDevelopmentAuthorization, LocalDevelopmentDecisionRequest,
    LocalDevelopmentEndRunRequest, LocalDevelopmentEvaluation, LocalDevelopmentEvaluationRequest,
    LocalDevelopmentLaunchOutcome, LocalDevelopmentLaunchRequest, NimiHostError,
    ProtectedCarrierError,
};
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
pub struct AppHostArtifactBytes {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub size_bytes: i64,
    pub mime_inferred: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppHostArtifactReadReasonCode {
    InvalidInput,
    Forbidden,
    NotFound,
    TooLarge,
    RuntimeUnavailable,
    RuntimeUntrusted,
}

impl AppHostArtifactReadReasonCode {
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
pub struct AppHostArtifactReadError {
    reason_code: AppHostArtifactReadReasonCode,
    retryable: bool,
}

impl AppHostArtifactReadError {
    pub const fn new(reason_code: AppHostArtifactReadReasonCode, retryable: bool) -> Self {
        Self {
            reason_code,
            retryable,
        }
    }

    pub const fn reason_code(self) -> AppHostArtifactReadReasonCode {
        self.reason_code
    }

    pub const fn retryable(self) -> bool {
        self.retryable
    }
}

impl Display for AppHostArtifactReadError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.reason_code.as_str())
    }
}

impl Error for AppHostArtifactReadError {}

/// Opaque host-only handle for one connection-bound protected Desktop session.
///
/// Typed account and lifecycle methods are added to this contract only from
/// generated Runtime protocol projections. Keeping this trait marker-only in
/// the compile-only carrier slice prevents a generic method-id or byte proxy
/// from becoming a protected transport bypass.
pub trait NimiDesktopControl: Send + Sync {
    fn get_account_session_status(
        &self,
        request: DesktopAccountSessionStatusRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DesktopAccountSessionStatus, NimiHostError>> + Send + '_>>;

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

    fn evaluate_local_development_project(
        &self,
        request: LocalDevelopmentEvaluationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<LocalDevelopmentEvaluation, NimiHostError>> + Send + '_>>;

    fn decide_local_development_project(
        &self,
        request: LocalDevelopmentDecisionRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentAuthorization, NimiHostError>> + Send + '_>,
    >;

    fn list_local_development_authorizations(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Vec<LocalDevelopmentAuthorization>, NimiHostError>>
                + Send
                + '_,
        >,
    >;

    fn revoke_local_development_authorization(
        &self,
        authorization_id: [u8; 32],
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentAuthorization, NimiHostError>> + Send + '_>,
    >;

    fn launch_local_development_host(
        &self,
        request: LocalDevelopmentLaunchRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentLaunchOutcome, NimiHostError>> + Send + '_>,
    >;

    fn local_development_host_running(
        &self,
        supervisor_run_id: [u8; 32],
    ) -> Result<bool, NimiHostError>;

    fn terminate_local_development_host(
        &self,
        supervisor_run_id: [u8; 32],
    ) -> Result<(), NimiHostError>;

    fn end_local_development_run(
        &self,
        request: LocalDevelopmentEndRunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<(), NimiHostError>> + Send + '_>>;
}

pub trait NimiAppHostSession: Send + Sync {
    fn bootstrap_status(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<AppHostBootstrapStatus, NimiHostError>> + Send + '_>>;

    fn read_artifact_bytes(
        &self,
        artifact_id: String,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<AppHostArtifactBytes, AppHostArtifactReadError>> + Send + '_,
        >,
    >;
}

pub trait NimiAppHostCarrier: Send + Sync {
    fn open_app_host_session(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Box<dyn NimiAppHostSession>, NimiHostError>> + Send + '_>>;
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
