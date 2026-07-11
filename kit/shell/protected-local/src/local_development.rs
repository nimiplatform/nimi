use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::path::PathBuf;

pub const LOCAL_DEVELOPMENT_TRUST_CLASS: &str = "local-development";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalDevelopmentShellKind {
    Electron,
    Tauri,
}

impl LocalDevelopmentShellKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Electron => "electron",
            Self::Tauri => "tauri",
        }
    }

    pub(crate) const fn proto_value(self) -> i32 {
        match self {
            Self::Electron => 1,
            Self::Tauri => 2,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalDevelopmentDecision {
    Deny,
    AllowRunOnce,
    AllowRememberProject,
}

impl LocalDevelopmentDecision {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Deny => "deny",
            Self::AllowRunOnce => "allow-run-once",
            Self::AllowRememberProject => "allow-remember-project",
        }
    }

    pub(crate) const fn proto_value(self) -> i32 {
        match self {
            Self::Deny => 1,
            Self::AllowRunOnce => 2,
            Self::AllowRememberProject => 3,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalDevelopmentAuthorizationState {
    ConfirmationRequired,
    Active,
    ReapprovalRequired,
    Denied,
    Revoked,
}

impl LocalDevelopmentAuthorizationState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ConfirmationRequired => "confirmation-required",
            Self::Active => "active",
            Self::ReapprovalRequired => "reapproval-required",
            Self::Denied => "denied",
            Self::Revoked => "revoked",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentProject {
    pub app_id: String,
    pub display_name: String,
    pub canonical_project_root: PathBuf,
    pub canonical_manifest_path: PathBuf,
    pub shell_kind: LocalDevelopmentShellKind,
    pub account_id: String,
    pub requested_capabilities: Vec<String>,
    pub capability_fingerprint: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentAuthorization {
    pub authorization_id: [u8; 32],
    pub project: LocalDevelopmentProject,
    pub state: LocalDevelopmentAuthorizationState,
    pub persistence: LocalDevelopmentDecision,
    pub authorization_generation: u64,
    pub approved_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentEvaluationRequest {
    pub expected_app_id: String,
    pub project_root: PathBuf,
    pub shell_kind: LocalDevelopmentShellKind,
    pub supervisor_run_id: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentEvaluation {
    pub evaluation_id: Option<[u8; 32]>,
    pub project: LocalDevelopmentProject,
    pub state: LocalDevelopmentAuthorizationState,
    pub confirmation_required: bool,
    pub authorization: Option<LocalDevelopmentAuthorization>,
    pub evaluation_expires_at_unix_ms: Option<i64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentDecisionRequest {
    pub evaluation_id: [u8; 32],
    pub decision: LocalDevelopmentDecision,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentLaunchRequest {
    pub authorization_id: [u8; 32],
    pub supervisor_run_id: [u8; 32],
    pub shell_kind: LocalDevelopmentShellKind,
    pub host_executable_path: PathBuf,
    pub renderer_origin: String,
    pub host_arguments: Vec<String>,
    pub working_directory: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentLaunchOutcome {
    pub process_id: u32,
    pub bind_deadline_unix_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentEndRunRequest {
    pub authorization_id: [u8; 32],
    pub supervisor_run_id: [u8; 32],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppHostTrustClass {
    ProductionInstalled,
    LocalDevelopment,
}

impl AppHostTrustClass {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ProductionInstalled => "production-installed",
            Self::LocalDevelopment => LOCAL_DEVELOPMENT_TRUST_CLASS,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppHostBootstrapState {
    Ready,
    AuthorizationRequired,
    Denied,
    RuntimeUnavailable,
    Revoked,
    ProjectChanged,
}

impl AppHostBootstrapState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::AuthorizationRequired => "authorization-required",
            Self::Denied => "denied",
            Self::RuntimeUnavailable => "runtime-unavailable",
            Self::Revoked => "revoked",
            Self::ProjectChanged => "project-changed",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppHostBootstrapStatus {
    pub state: AppHostBootstrapState,
    pub trust_class: AppHostTrustClass,
    pub app_id: String,
    pub bootstrap_artifact_id: Option<String>,
    pub expires_at_unix_ms: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NimiHostErrorReasonCode {
    ProtectedCarrierRequired,
    RuntimeServiceUnavailable,
    RuntimeServiceUntrusted,
    RuntimeServiceRepairRequired,
    PrincipalUnauthorized,
    LocalDevelopmentAuthorizationRequired,
    LocalDevelopmentReapprovalRequired,
    LocalDevelopmentProjectChanged,
    LocalDevelopmentSupervisorRequired,
    LocalDevelopmentSessionRevoked,
    LocalDevelopmentPlatformUnsupported,
    LocalDevelopmentOperationForbidden,
    LocalDevelopmentDevServerUncontrolled,
    LocalDevelopmentApprovalDenied,
}

impl NimiHostErrorReasonCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ProtectedCarrierRequired => "protected-carrier-required",
            Self::RuntimeServiceUnavailable => "runtime-service-unavailable",
            Self::RuntimeServiceUntrusted => "runtime-service-untrusted",
            Self::RuntimeServiceRepairRequired => "runtime-service-repair-required",
            Self::PrincipalUnauthorized => "principal-unauthorized",
            Self::LocalDevelopmentAuthorizationRequired => {
                "local-development-authorization-required"
            }
            Self::LocalDevelopmentReapprovalRequired => "local-development-reapproval-required",
            Self::LocalDevelopmentProjectChanged => "local-development-project-changed",
            Self::LocalDevelopmentSupervisorRequired => "local-development-supervisor-required",
            Self::LocalDevelopmentSessionRevoked => "local-development-session-revoked",
            Self::LocalDevelopmentPlatformUnsupported => "local-development-platform-unsupported",
            Self::LocalDevelopmentOperationForbidden => "local-development-operation-forbidden",
            Self::LocalDevelopmentDevServerUncontrolled => {
                "local-development-dev-server-uncontrolled"
            }
            Self::LocalDevelopmentApprovalDenied => "local-development-approval-denied",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NimiHostError {
    reason_code: NimiHostErrorReasonCode,
    retryable: bool,
}

impl NimiHostError {
    pub const fn new(reason_code: NimiHostErrorReasonCode, retryable: bool) -> Self {
        Self {
            reason_code,
            retryable,
        }
    }

    pub const fn reason_code(self) -> NimiHostErrorReasonCode {
        self.reason_code
    }

    pub const fn retryable(self) -> bool {
        self.retryable
    }
}

impl Display for NimiHostError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.reason_code.as_str())
    }
}

impl Error for NimiHostError {}

impl From<ProtectedCarrierError> for NimiHostError {
    fn from(error: ProtectedCarrierError) -> Self {
        let reason_code = match error.reason_code() {
            ProtectedCarrierReasonCode::ProtectedCarrierRequired => {
                NimiHostErrorReasonCode::ProtectedCarrierRequired
            }
            ProtectedCarrierReasonCode::RuntimeServiceUnavailable => {
                NimiHostErrorReasonCode::RuntimeServiceUnavailable
            }
            ProtectedCarrierReasonCode::RuntimeServiceUntrusted => {
                NimiHostErrorReasonCode::RuntimeServiceUntrusted
            }
            ProtectedCarrierReasonCode::RuntimeServiceRepairRequired => {
                NimiHostErrorReasonCode::RuntimeServiceRepairRequired
            }
        };
        Self::new(reason_code, error.retryable())
    }
}
