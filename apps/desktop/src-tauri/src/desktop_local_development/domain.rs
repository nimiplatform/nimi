use super::{plan::DevelopmentProjectPlan, RunContext};
use nimi_shell_tauri::capabilities::runtime::{
    self as runtime_bridge, DeveloperModeState, DeveloperModeStatus, LocalDevelopmentAuthorization,
};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc};

const MAX_STATUS_LOGS: usize = 80;

pub(crate) enum AuthorityRefresh {
    Active,
    ApprovalRequired,
    RuntimeUnavailable,
    Terminal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum InitialAuthorityResolution {
    Settled,
    Retryable,
}

#[derive(Clone)]
pub(super) struct PendingApproval {
    pub(super) target: PendingApprovalTarget,
    pub(super) run: Arc<RunContext>,
    pub(super) projection: LocalDevelopmentApprovalProjection,
}

#[derive(Clone, Copy)]
pub(super) enum PendingApprovalTarget {
    Evaluation([u8; 32]),
    Reactivation([u8; 32]),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDevelopmentApprovalProjection {
    pub(crate) request_id: String,
    pub(crate) app_id: String,
    pub(crate) display_name: String,
    pub(crate) canonical_project_root: String,
    pub(crate) shell: String,
    pub(crate) account_id: String,
    pub(crate) permission_requirements: Vec<PermissionRequirementProjection>,
    pub(crate) approval_state: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDevelopmentAuthorizationProjection {
    pub(crate) selector: String,
    pub(crate) app_id: String,
    pub(crate) display_name: String,
    pub(crate) canonical_project_root: String,
    pub(crate) shell: String,
    pub(crate) account_id: String,
    pub(crate) permission_requirements: Vec<PermissionRequirementProjection>,
    pub(crate) persistence: String,
    pub(crate) state: String,
    pub(crate) updated_at_unix_ms: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PermissionRequirementProjection {
    pub(crate) permission_id: String,
    pub(crate) reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDevelopmentRunProjection {
    pub(crate) app_id: String,
    pub(crate) display_name: String,
    pub(crate) canonical_project_root: String,
    pub(crate) shell: String,
    pub(crate) state: String,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason_code: Option<String>,
    pub(crate) retryable: bool,
    pub(crate) host_generation: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeveloperModeProjection {
    pub(super) state: String,
    pub(super) enabled: bool,
    pub(super) revision: u64,
    pub(super) account_generation: u64,
    pub(super) reason_code: String,
    pub(super) retryable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDevelopmentRunStatus {
    pub(crate) schema_version: u8,
    pub(crate) run_id: String,
    pub(crate) state: String,
    pub(crate) app_id: String,
    pub(crate) display_name: String,
    pub(crate) canonical_project_root: String,
    pub(crate) shell: String,
    pub(crate) renderer_origin: String,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason_code: Option<String>,
    pub(crate) retryable: bool,
    pub(crate) host_generation: u64,
    pub(crate) log_sequence: u64,
    pub(crate) logs: Vec<LocalDevelopmentLogLine>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDevelopmentLogLine {
    sequence: u64,
    stream: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalDevelopmentDecisionPayload {
    pub(super) request_id: String,
    pub(super) decision: String,
    pub(super) risk_disclosure_acknowledged: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalDevelopmentRevokePayload {
    pub(super) selector: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeveloperModeSetPayload {
    pub(super) enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalDevelopmentPresenceDescriptor {
    schema_version: u8,
    desktop_app_id: String,
    desktop_pid: u32,
    endpoint: String,
    started_at: String,
    last_heartbeat_at: String,
}

pub(super) fn initial_status(
    run_id: &str,
    plan: &DevelopmentProjectPlan,
) -> LocalDevelopmentRunStatus {
    LocalDevelopmentRunStatus {
        schema_version: 1,
        run_id: run_id.to_string(),
        state: "preparing".to_string(),
        app_id: plan.app_id.clone(),
        display_name: plan.display_name.clone(),
        canonical_project_root: path_text(&plan.project_root),
        shell: plan.shell.name().to_string(),
        renderer_origin: plan.renderer_origin.clone(),
        message: "Validating project with Nimi Runtime".to_string(),
        reason_code: None,
        retryable: false,
        host_generation: 0,
        log_sequence: 0,
        logs: Vec::new(),
    }
}

pub(super) fn developer_mode_projection(status: DeveloperModeStatus) -> DeveloperModeProjection {
    DeveloperModeProjection {
        state: status.state.as_str().to_string(),
        enabled: status.state == DeveloperModeState::Enabled,
        revision: status.revision,
        account_generation: status.account_generation,
        reason_code: if status.state == DeveloperModeState::Unavailable {
            "local-app-operation-unavailable".to_string()
        } else {
            "action-executed".to_string()
        },
        retryable: status.state == DeveloperModeState::Unavailable,
    }
}

pub(super) fn terminal_status_without_run(
    app_id: String,
    project_root: String,
    shell: String,
    reason_code: String,
) -> LocalDevelopmentRunStatus {
    LocalDevelopmentRunStatus {
        schema_version: 1,
        run_id: String::new(),
        state: if reason_code == "runtime-service-unavailable" {
            "runtime-unavailable"
        } else {
            "project-changed"
        }
        .to_string(),
        app_id,
        display_name: String::new(),
        canonical_project_root: project_root,
        shell,
        renderer_origin: String::new(),
        message: reason_code.clone(),
        reason_code: Some(reason_code),
        retryable: false,
        host_generation: 0,
        log_sequence: 0,
        logs: Vec::new(),
    }
}

pub(super) fn initial_authority_retryable(reason: &str) -> bool {
    matches!(
        reason,
        "runtime-service-unavailable" | "principal-unauthorized"
    )
}

pub(super) fn recordable_terminal_status(status: &LocalDevelopmentRunStatus) -> bool {
    let app_id = status.app_id.as_str();
    !app_id.is_empty()
        && app_id.len() <= 160
        && app_id.trim() == app_id
        && app_id
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && app_id
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && app_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
        && Path::new(&status.canonical_project_root).is_absolute()
        && status.canonical_project_root.trim() == status.canonical_project_root
        && matches!(status.shell.as_str(), "electron" | "tauri")
}

pub(super) fn evaluation_matches_plan(
    project: &runtime_bridge::LocalDevelopmentProject,
    plan: &DevelopmentProjectPlan,
) -> bool {
    project.app_id == plan.app_id
        && project.display_name == plan.display_name
        && project.shell_kind == plan.shell.kind()
        && paths_equal(&project.canonical_project_root, &plan.project_root)
}

pub(super) fn project_authorization(
    selector: String,
    authorization: LocalDevelopmentAuthorization,
) -> LocalDevelopmentAuthorizationProjection {
    LocalDevelopmentAuthorizationProjection {
        selector,
        app_id: authorization.project.app_id,
        display_name: authorization.project.display_name,
        canonical_project_root: path_text(&authorization.project.canonical_project_root),
        shell: authorization.project.shell_kind.as_str().to_string(),
        account_id: authorization.project.account_id,
        permission_requirements: authorization
            .project
            .permission_requirements
            .into_iter()
            .map(|requirement| PermissionRequirementProjection {
                permission_id: requirement.permission_id,
                reason: requirement.reason,
            })
            .collect(),
        persistence: authorization.persistence.as_str().to_string(),
        state: authorization.state.as_str().to_string(),
        updated_at_unix_ms: authorization.updated_at_unix_ms,
    }
}

pub(super) fn project_run_status(
    status: LocalDevelopmentRunStatus,
) -> LocalDevelopmentRunProjection {
    let display_name = if status.display_name.is_empty() {
        status.app_id.clone()
    } else {
        status.display_name
    };
    LocalDevelopmentRunProjection {
        app_id: status.app_id,
        display_name,
        canonical_project_root: status.canonical_project_root,
        shell: status.shell,
        state: status.state,
        message: status.message,
        reason_code: status.reason_code,
        retryable: status.retryable,
        host_generation: status.host_generation,
    }
}

pub(super) fn append_log_locked(
    status: &mut LocalDevelopmentRunStatus,
    stream: &str,
    message: String,
) {
    status.log_sequence = status.log_sequence.saturating_add(1);
    status.logs.push(LocalDevelopmentLogLine {
        sequence: status.log_sequence,
        stream: stream.to_string(),
        message,
    });
    if status.logs.len() > MAX_STATUS_LOGS {
        status.logs.drain(..status.logs.len() - MAX_STATUS_LOGS);
    }
}

pub(super) fn sanitize_log(message: String) -> String {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let lowered = trimmed.to_ascii_lowercase();
    if [
        "session_proof",
        "sessionproof",
        "access_token",
        "refresh_token",
        "authorization: bearer",
        "credential",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
    {
        return "[sensitive supervisor output redacted]".to_string();
    }
    trimmed.chars().take(2_000).collect()
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    left.to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase()
        == right
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase()
}

pub(super) fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(super) fn random_identifier() -> Result<[u8; 32], String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| "local-development-supervisor-required".to_string())?;
    if bytes == [0u8; 32] {
        return Err("local-development-supervisor-required".to_string());
    }
    Ok(bytes)
}

pub(super) fn random_selector(prefix: &str, byte_count: usize) -> Result<String, String> {
    crate::desktop_open_intent::presence::random_base64_url(byte_count)
        .map(|suffix| format!("{prefix}-{suffix}"))
}

pub(super) fn required_selector<'a>(value: &'a str, prefix: &str) -> Result<&'a str, String> {
    if value.trim() != value
        || !value.starts_with(&format!("{prefix}-"))
        || value.len() > 160
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("local-development-supervisor-required".to_string());
    }
    Ok(value)
}

pub(super) fn write_presence(path: &Path, endpoint: &str, started_at: &str) -> Result<(), String> {
    crate::desktop_open_intent::presence::write_presence_document(
        path,
        &LocalDevelopmentPresenceDescriptor {
            schema_version: 1,
            desktop_app_id: "nimi.desktop".to_string(),
            desktop_pid: std::process::id(),
            endpoint: endpoint.to_string(),
            started_at: started_at.to_string(),
            last_heartbeat_at: crate::desktop_open_intent::presence::now_iso8601(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selectors_are_exact_and_do_not_admit_path_or_header_syntax() {
        assert!(required_selector("dev-run-abc_123", "dev-run").is_ok());
        for invalid in [
            " dev-run-abc",
            "dev-run-abc/def",
            "dev-run-abc:Bearer",
            "other-abc",
        ] {
            assert!(required_selector(invalid, "dev-run").is_err(), "{invalid}");
        }
    }

    #[test]
    fn supervisor_logs_redact_security_material() {
        assert_eq!(
            sanitize_log("authorization: Bearer secret".to_string()),
            "[sensitive supervisor output redacted]"
        );
        assert_eq!(sanitize_log("Vite ready".to_string()), "Vite ready");
    }

    #[test]
    fn initial_authority_retry_is_limited_to_runtime_and_account_recovery() {
        assert!(initial_authority_retryable("runtime-service-unavailable"));
        assert!(initial_authority_retryable("principal-unauthorized"));
        assert!(!initial_authority_retryable(
            "local-development-project-changed"
        ));
        assert!(!initial_authority_retryable("runtime-service-untrusted"));
    }
}
