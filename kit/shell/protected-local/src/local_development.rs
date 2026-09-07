use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};
use std::collections::BTreeMap;
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::path::PathBuf;

pub const LOCAL_DEVELOPMENT_TRUST_CLASS: &str = "local_development";

#[cfg(any(
    test,
    all(target_os = "macos", feature = "macos-source-local-development"),
    all(target_os = "windows", feature = "windows-source-local-development")
))]
pub(crate) fn local_development_rebind_candidate_is_stale(
    current: Option<(u32, bool)>,
    expected_process_id: u32,
) -> bool {
    !matches!(current, Some((process_id, true)) if process_id == expected_process_id)
}

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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentProject {
    pub app_id: String,
    pub display_name: String,
    pub canonical_project_root: PathBuf,
    pub canonical_manifest_path: PathBuf,
    pub shell_kind: LocalDevelopmentShellKind,
    pub app_access: Vec<String>,
    pub source_generation: u64,
    pub declaration_generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentRegistration {
    pub registration_handle: [u8; 32],
    pub project: LocalDevelopmentProject,
    pub registered_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentRegistrationRequest {
    pub expected_app_id: String,
    pub project_root: PathBuf,
    pub shell_kind: LocalDevelopmentShellKind,
    pub supervisor_run_id: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalDevelopmentLaunchRequest {
    pub registration_handle: [u8; 32],
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
    pub registration_handle: [u8; 32],
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
    LocalDevelopmentProjectChanged,
    LocalDevelopmentSupervisorRequired,
    LocalDevelopmentSessionRevoked,
    LocalDevelopmentPlatformUnsupported,
    LocalDevelopmentOperationForbidden,
    LocalDevelopmentDevServerUncontrolled,
    LocalAppDeveloperModeDisabled,
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
    ProcessStartFailed,
    OsPolicyBlocked,
    ElevationRequired,
    ProcessContextRejected,
    ProcessStopFailed,
    ProcessFocusFailed,
    InstalledAppLaunchFailed,
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
            Self::LocalDevelopmentProjectChanged => "local-development-project-changed",
            Self::LocalDevelopmentSupervisorRequired => "local-development-supervisor-required",
            Self::LocalDevelopmentSessionRevoked => "local-development-session-revoked",
            Self::LocalDevelopmentPlatformUnsupported => "local-development-platform-unsupported",
            Self::LocalDevelopmentOperationForbidden => "local-development-operation-forbidden",
            Self::LocalDevelopmentDevServerUncontrolled => {
                "local-development-dev-server-uncontrolled"
            }
            Self::LocalAppDeveloperModeDisabled => "local-app-developer-mode-disabled",
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
            Self::ProcessStartFailed => "process-start-failed",
            Self::OsPolicyBlocked => "os-policy-blocked",
            Self::ElevationRequired => "elevation-required",
            Self::ProcessContextRejected => "process-context-rejected",
            Self::ProcessStopFailed => "process-stop-failed",
            Self::ProcessFocusFailed => "process-focus-failed",
            Self::InstalledAppLaunchFailed => "installed-app-launch-failed",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NimiHostError {
    reason_code: NimiHostErrorReasonCode,
    retryable: bool,
    reason_metadata: BTreeMap<String, String>,
}

impl NimiHostError {
    pub const fn new(reason_code: NimiHostErrorReasonCode, retryable: bool) -> Self {
        Self {
            reason_code,
            retryable,
            reason_metadata: BTreeMap::new(),
        }
    }

    pub fn with_reason_metadata(mut self, reason_metadata: BTreeMap<String, String>) -> Self {
        self.reason_metadata = reason_metadata;
        self
    }

    pub const fn reason_code(&self) -> NimiHostErrorReasonCode {
        self.reason_code
    }
    pub const fn retryable(&self) -> bool {
        self.retryable
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

#[cfg(test)]
mod tests {
    use super::local_development_rebind_candidate_is_stale;

    #[test]
    fn rebind_failure_is_stale_only_after_the_exact_candidate_stops_or_is_replaced() {
        assert!(!local_development_rebind_candidate_is_stale(
            Some((41, true)),
            41
        ));
        assert!(local_development_rebind_candidate_is_stale(
            Some((41, false)),
            41
        ));
        assert!(local_development_rebind_candidate_is_stale(
            Some((42, true)),
            41
        ));
        assert!(local_development_rebind_candidate_is_stale(None, 41));
    }
}
