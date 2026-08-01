use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};
use std::collections::BTreeMap;
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::path::PathBuf;

pub const LOCAL_DEVELOPMENT_TRUST_CLASS: &str = "local_development";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeveloperModeState {
    Disabled,
    Enabled,
    Unavailable,
}

impl DeveloperModeState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Enabled => "enabled",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeveloperModeStatus {
    pub state: DeveloperModeState,
    pub revision: u64,
    pub account_generation: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalDevelopmentSummaryAvailability {
    Available,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentDeveloperModeSummary {
    pub availability: LocalDevelopmentSummaryAvailability,
    pub state: DeveloperModeState,
    pub unavailable_reason: Option<NimiHostErrorReasonCode>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentProjectAuthorizationSummary {
    pub availability: LocalDevelopmentSummaryAvailability,
    pub active_count: u64,
    pub denied_count: u64,
    pub revoked_count: u64,
    pub unavailable_reason: Option<NimiHostErrorReasonCode>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentAuthoritySummary {
    pub developer_mode: LocalDevelopmentDeveloperModeSummary,
    pub project_authorization: LocalDevelopmentProjectAuthorizationSummary,
}

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
    AllowProject,
}

impl LocalDevelopmentDecision {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Deny => "deny",
            Self::AllowRunOnce => "allow-run-once",
            Self::AllowProject => "allow-project",
        }
    }

    pub(crate) const fn proto_value(self) -> i32 {
        match self {
            Self::Deny => 1,
            Self::AllowRunOnce => 2,
            Self::AllowProject => 3,
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
    pub permission_requirements: Vec<LocalDevelopmentPermissionRequirement>,
    pub permission_requirement_fingerprint: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentPermissionRequirement {
    pub permission_id: String,
    pub reason: String,
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
    pub risk_disclosure_acknowledged: bool,
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
pub enum NimiHostErrorReasonCode {
    ProtectedCarrierRequired,
    RuntimeServiceUnavailable,
    RuntimeServiceUntrusted,
    RuntimeServiceErrorUnclassified,
    RuntimeServiceRepairRequired,
    RuntimeRestarted,
    ProcessReplaced,
    AccountChanged,
    SessionRevoked,
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
    LocalAppDeveloperModeDisabled,
    LocalAppPermissionRequired,
    LocalAppPermissionDenied,
    LocalAppPermissionRevoked,
    LocalAppPermissionReservedNotAdmitted,
    LocalAppPermissionUnknown,
    AiVoiceTargetModelMismatch,
    AgentAiConfigRevisionConflict,
    AgentAiConfigInvalid,
    AgentAiConfigTargetRequired,
    AgentAiConfigTargetInvalid,
    AgentAiConfigTargetUnavailable,
    AgentAiConfigCapabilityMismatch,
    AgentAiConfigModelTargetMismatch,
    AgentAutonomyRevisionConflict,
    AgentPresentationRevisionConflict,
    LocalAppPresenceRequired,
    LocalAppPresenceExpired,
    LocalAppOperationUnavailable,
}

impl NimiHostErrorReasonCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ProtectedCarrierRequired => "protected-carrier-required",
            Self::RuntimeServiceUnavailable => "runtime-service-unavailable",
            Self::RuntimeServiceUntrusted => "runtime-service-untrusted",
            Self::RuntimeServiceErrorUnclassified => "runtime-service-error-unclassified",
            Self::RuntimeServiceRepairRequired => "runtime-service-repair-required",
            Self::RuntimeRestarted => "runtime-restarted",
            Self::ProcessReplaced => "process-replaced",
            Self::AccountChanged => "account-changed",
            Self::SessionRevoked => "session-revoked",
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
            Self::LocalAppDeveloperModeDisabled => "local-app-developer-mode-disabled",
            Self::LocalAppPermissionRequired => "local-app-permission-required",
            Self::LocalAppPermissionDenied => "local-app-permission-denied",
            Self::LocalAppPermissionRevoked => "local-app-permission-revoked",
            Self::LocalAppPermissionReservedNotAdmitted => {
                "local-app-permission-reserved-not-admitted"
            }
            Self::LocalAppPermissionUnknown => "local-app-permission-unknown",
            Self::AiVoiceTargetModelMismatch => "ai-voice-target-model-mismatch",
            Self::AgentAiConfigRevisionConflict => "agent-ai-config-revision-conflict",
            Self::AgentAiConfigInvalid => "agent-ai-config-invalid",
            Self::AgentAiConfigTargetRequired => "agent-ai-config-target-required",
            Self::AgentAiConfigTargetInvalid => "agent-ai-config-target-invalid",
            Self::AgentAiConfigTargetUnavailable => "agent-ai-config-target-unavailable",
            Self::AgentAiConfigCapabilityMismatch => "agent-ai-config-capability-mismatch",
            Self::AgentAiConfigModelTargetMismatch => "agent-ai-config-model-target-mismatch",
            Self::AgentAutonomyRevisionConflict => "agent-autonomy-revision-conflict",
            Self::AgentPresentationRevisionConflict => "agent-presentation-revision-conflict",
            Self::LocalAppPresenceRequired => "local-app-presence-required",
            Self::LocalAppPresenceExpired => "local-app-presence-expired",
            Self::LocalAppOperationUnavailable => "local-app-operation-unavailable",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NimiHostError {
    reason_code: NimiHostErrorReasonCode,
    retryable: bool,
    permission_id: Option<String>,
    reason_metadata: BTreeMap<String, String>,
}

impl NimiHostError {
    pub const fn new(reason_code: NimiHostErrorReasonCode, retryable: bool) -> Self {
        Self {
            reason_code,
            retryable,
            permission_id: None,
            reason_metadata: BTreeMap::new(),
        }
    }

    pub fn with_reason_metadata(
        mut self,
        permission_id: Option<String>,
        reason_metadata: BTreeMap<String, String>,
    ) -> Self {
        self.permission_id = permission_id;
        self.reason_metadata = reason_metadata;
        self
    }

    pub const fn reason_code(&self) -> NimiHostErrorReasonCode {
        self.reason_code
    }

    pub const fn retryable(&self) -> bool {
        self.retryable
    }

    pub fn permission_id(&self) -> Option<&str> {
        self.permission_id.as_deref()
    }

    pub const fn reason_metadata(&self) -> &BTreeMap<String, String> {
        &self.reason_metadata
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
