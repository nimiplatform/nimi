use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use prost_types::Timestamp;
use tonic::transport::Channel;
use url::Url;

use crate::generated::runtime_app_service_client::RuntimeAppServiceClient;
use crate::generated::runtime_development_service_client::RuntimeDevelopmentServiceClient;
use crate::generated::{
    BindLocalAppProcessRequest, DecideLocalDevelopmentProjectRequest,
    EndLocalDevelopmentRunRequest, EvaluateLocalDevelopmentProjectRequest,
    EvaluateLocalDevelopmentProjectResponse, GetDeveloperModeStatusRequest,
    ListLocalDevelopmentAuthorizationsRequest, LocalDevelopmentAuthorizationProjection,
    LocalDevelopmentProjectProjection, PrepareLocalAppLaunchRequest,
    RevokeLocalDevelopmentAuthorizationRequest, SetDeveloperModeRequest,
};
use crate::grpc_status::host_error_from_status;
#[cfg(target_os = "macos")]
use crate::macos_supervised_process::SupervisedDevelopmentProcess;
#[cfg(target_os = "windows")]
use crate::windows_supervised_process::SupervisedDevelopmentProcess;
use crate::{
    DeveloperModeState, DeveloperModeStatus, LocalDevelopmentAuthorization,
    LocalDevelopmentAuthorizationState, LocalDevelopmentDecision, LocalDevelopmentDecisionRequest,
    LocalDevelopmentEndRunRequest as NativeEndRunRequest, LocalDevelopmentEvaluation,
    LocalDevelopmentEvaluationRequest as NativeEvaluationRequest, LocalDevelopmentLaunchOutcome,
    LocalDevelopmentLaunchRequest, LocalDevelopmentProject, LocalDevelopmentShellKind,
    NimiHostError, NimiHostErrorReasonCode, LOCAL_DEVELOPMENT_TRUST_CLASS,
};

const ACTION_EXECUTED: i32 = 1;

pub(crate) async fn get_developer_mode_status(
    channel: Channel,
) -> Result<DeveloperModeStatus, NimiHostError> {
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .get_developer_mode_status(GetDeveloperModeStatusRequest {})
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    developer_mode_projection(
        response.state,
        response.revision,
        response.account_generation,
        response.reason_code,
    )
}

pub(crate) async fn set_developer_mode(
    channel: Channel,
    enabled: bool,
) -> Result<DeveloperModeStatus, NimiHostError> {
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .set_developer_mode(SetDeveloperModeRequest { enabled })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    let projection = developer_mode_projection(
        response.state,
        response.revision,
        response.account_generation,
        response.reason_code,
    )?;
    if (projection.state == DeveloperModeState::Enabled) != enabled {
        return Err(untrusted());
    }
    Ok(projection)
}

fn developer_mode_projection(
    state: i32,
    revision: u64,
    account_generation: u64,
    reason_code: i32,
) -> Result<DeveloperModeStatus, NimiHostError> {
    let state = match state {
        1 => DeveloperModeState::Disabled,
        2 => DeveloperModeState::Enabled,
        3 => DeveloperModeState::Unavailable,
        _ => return Err(untrusted()),
    };
    if state == DeveloperModeState::Unavailable {
        if reason_code == ACTION_EXECUTED {
            return Err(untrusted());
        }
    } else if reason_code != ACTION_EXECUTED
        || revision == 0
        || (state == DeveloperModeState::Enabled && account_generation == 0)
    {
        return Err(untrusted());
    }
    Ok(DeveloperModeStatus {
        state,
        revision,
        account_generation,
    })
}

#[cfg(test)]
mod developer_mode_projection_tests {
    use super::*;

    #[test]
    fn initial_disabled_mode_allows_an_unbound_account_generation() {
        let projection = developer_mode_projection(1, 1, 0, ACTION_EXECUTED)
            .expect("initial disabled Developer Mode should be readable");
        assert_eq!(projection.state, DeveloperModeState::Disabled);
        assert_eq!(projection.revision, 1);
        assert_eq!(projection.account_generation, 0);
    }

    #[test]
    fn enabled_mode_requires_an_authenticated_account_generation() {
        assert!(developer_mode_projection(2, 1, 0, ACTION_EXECUTED).is_err());
        let projection = developer_mode_projection(2, 2, 7, ACTION_EXECUTED)
            .expect("enabled Developer Mode should retain its account binding");
        assert_eq!(projection.state, DeveloperModeState::Enabled);
        assert_eq!(projection.account_generation, 7);
    }

    #[test]
    fn actionable_mode_states_require_revision_and_action_evidence() {
        assert!(developer_mode_projection(1, 0, 0, ACTION_EXECUTED).is_err());
        assert!(developer_mode_projection(1, 1, 0, 0).is_err());
    }
}

#[cfg(feature = "windows-e2e-fixture")]
fn report_windows_e2e_evaluation_response(response: &EvaluateLocalDevelopmentProjectResponse) {
    let project = response.project.as_ref();
    eprintln!(
        "[protected-local local-development windows-e2e-fixture] stage=evaluation-response reason_code={} state={} confirmation_required={} evaluation_id_len={} project_present={} project_app_id_present={} project_display_name_present={} project_root_present={} project_manifest_present={} project_account_present={} permission_requirement_count={} permission_requirement_fingerprint_len={} trust_class_matches={} authorization_present={} expires_present={}",
        response.reason_code,
        response.state,
        response.confirmation_required,
        response.evaluation_id.len(),
        project.is_some(),
        project.is_some_and(|value| !value.app_id.is_empty()),
        project.is_some_and(|value| !value.display_name.is_empty()),
        project.is_some_and(|value| !value.canonical_project_root.is_empty()),
        project.is_some_and(|value| !value.canonical_manifest_path.is_empty()),
        project.is_some_and(|value| !value.account_id.is_empty()),
        project.map_or(0, |value| value.permission_requirements.len()),
        project.map_or(0, |value| value.permission_requirement_fingerprint.len()),
        project.is_some_and(|value| value.trust_class == LOCAL_DEVELOPMENT_TRUST_CLASS),
        response.authorization.is_some(),
        response.evaluation_expires_at.is_some(),
    );
}

#[cfg(not(feature = "windows-e2e-fixture"))]
fn report_windows_e2e_evaluation_response(_: &EvaluateLocalDevelopmentProjectResponse) {}

#[cfg(feature = "windows-e2e-fixture")]
fn report_windows_e2e_projection_stage(stage: &str) {
    eprintln!(
        "[protected-local local-development windows-e2e-fixture] stage={}",
        stage
    );
}

#[cfg(not(feature = "windows-e2e-fixture"))]
fn report_windows_e2e_projection_stage(_: &str) {}

fn projection_error(stage: &str, error: NimiHostError) -> NimiHostError {
    report_windows_e2e_projection_stage(stage);
    error
}

pub(crate) async fn evaluate_project(
    channel: Channel,
    request: NativeEvaluationRequest,
) -> Result<LocalDevelopmentEvaluation, NimiHostError> {
    validate_identifier(request.supervisor_run_id)?;
    let expected_app_id = required_text(request.expected_app_id)?;
    let project_root = canonical_directory(&request.project_root)?;
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .evaluate_local_development_project(EvaluateLocalDevelopmentProjectRequest {
            expected_app_id,
            project_root: path_text(&project_root)?,
            shell_kind: request.shell_kind.proto_value(),
            supervisor_run_id: request.supervisor_run_id.to_vec(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    report_windows_e2e_evaluation_response(&response);
    require_success_reason(response.reason_code)
        .map_err(|error| projection_error("evaluation-reason-code", error))?;
    let state = authorization_state(response.state)
        .map_err(|error| projection_error("evaluation-authorization-state", error))?;
    let project = project_projection(response.project, Some(request.shell_kind))?;
    let evaluation_id = optional_identifier(response.evaluation_id)
        .map_err(|error| projection_error("evaluation-identifier", error))?;
    let evaluation_expires_at_unix_ms = optional_timestamp_ms(response.evaluation_expires_at)
        .map_err(|error| projection_error("evaluation-expiry", error))?;
    let authorization = response
        .authorization
        .map(authorization_projection)
        .transpose()
        .map_err(|error| projection_error("evaluation-authorization", error))?;
    if response.confirmation_required {
        let fresh_decision = evaluation_id.is_some()
            && evaluation_expires_at_unix_ms.is_some()
            && authorization.is_none();
        if !fresh_decision {
            return Err(projection_error(
                "evaluation-confirmation-shape",
                untrusted(),
            ));
        }
    } else if state != LocalDevelopmentAuthorizationState::Active
        || evaluation_id.is_some()
        || authorization.is_none()
    {
        return Err(projection_error("evaluation-active-shape", untrusted()));
    }
    Ok(LocalDevelopmentEvaluation {
        evaluation_id,
        project,
        state,
        confirmation_required: response.confirmation_required,
        authorization,
        evaluation_expires_at_unix_ms,
    })
}

pub(crate) async fn decide_project(
    channel: Channel,
    request: LocalDevelopmentDecisionRequest,
) -> Result<LocalDevelopmentAuthorization, NimiHostError> {
    validate_identifier(request.evaluation_id)?;
    let rpc_request = tonic::Request::new(DecideLocalDevelopmentProjectRequest {
        evaluation_id: request.evaluation_id.to_vec(),
        decision: request.decision.proto_value(),
        risk_disclosure_acknowledged: request.risk_disclosure_acknowledged,
    });
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .decide_local_development_project(rpc_request)
        .await;
    let response = response.map_err(host_error_from_status)?.into_inner();
    let expected_reason = match request.decision {
        LocalDevelopmentDecision::Deny => 650,
        LocalDevelopmentDecision::AllowRunOnce | LocalDevelopmentDecision::AllowProject => {
            ACTION_EXECUTED
        }
    };
    if response.reason_code != expected_reason {
        return Err(untrusted());
    }
    authorization_projection(response.authorization.ok_or_else(untrusted)?)
}

pub(crate) async fn list_authorizations(
    channel: Channel,
) -> Result<Vec<LocalDevelopmentAuthorization>, NimiHostError> {
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .list_local_development_authorizations(ListLocalDevelopmentAuthorizationsRequest {})
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    report_windows_e2e_projection_stage("launch-prepare-response");
    require_success_reason(response.reason_code)?;
    response
        .authorizations
        .into_iter()
        .map(authorization_projection)
        .collect()
}

pub(crate) async fn revoke_authorization(
    channel: Channel,
    authorization_id: [u8; 32],
) -> Result<LocalDevelopmentAuthorization, NimiHostError> {
    validate_identifier(authorization_id)?;
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .revoke_local_development_authorization(RevokeLocalDevelopmentAuthorizationRequest {
            authorization_id: authorization_id.to_vec(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    require_success_reason(response.reason_code)?;
    let authorization = authorization_projection(response.authorization.ok_or_else(untrusted)?)?;
    if authorization.authorization_id != authorization_id
        || authorization.state != LocalDevelopmentAuthorizationState::Revoked
    {
        return Err(untrusted());
    }
    Ok(authorization)
}

pub(crate) async fn launch_host(
    channel: Channel,
    request: LocalDevelopmentLaunchRequest,
) -> Result<(LocalDevelopmentLaunchOutcome, SupervisedDevelopmentProcess), NimiHostError> {
    validate_identifier(request.authorization_id)?;
    validate_identifier(request.supervisor_run_id)?;
    report_windows_e2e_projection_stage("launch-identifiers-validated");
    let host_executable_path = canonical_file(&request.host_executable_path).map_err(|error| {
        report_windows_e2e_projection_stage("launch-host-canonical-rejected");
        error
    })?;
    report_windows_e2e_projection_stage("launch-host-canonical-validated");
    let working_directory = canonical_directory(&request.working_directory).map_err(|error| {
        report_windows_e2e_projection_stage("launch-working-directory-rejected");
        error
    })?;
    report_windows_e2e_projection_stage("launch-working-directory-validated");
    let _renderer_origin =
        controlled_renderer_origin(&request.renderer_origin).map_err(|error| {
            report_windows_e2e_projection_stage("launch-renderer-origin-rejected");
            error
        })?;
    report_windows_e2e_projection_stage("launch-prepare-request");
    let response = RuntimeAppServiceClient::new(channel.clone())
        .prepare_local_app_launch(PrepareLocalAppLaunchRequest {
            local_app_handle: request.authorization_id.to_vec(),
            supervisor_run_id: request.supervisor_run_id.to_vec(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    require_success_reason(response.reason_code)?;
    let launch_id = required_identifier(response.launch_id)?;
    let prepare_deadline = required_timestamp_ms(response.bind_deadline)?;
    let mut process = SupervisedDevelopmentProcess::create_runtime_authorized(
        &host_executable_path,
        &request.host_arguments,
        &working_directory,
    )?;
    report_windows_e2e_projection_stage("launch-process-created-suspended");
    let bound = RuntimeAppServiceClient::new(channel)
        .bind_local_app_process(BindLocalAppProcessRequest {
            launch_id: launch_id.to_vec(),
            child_process_id: process.id(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    report_windows_e2e_projection_stage("launch-bind-response");
    require_success_reason(bound.reason_code)?;
    if required_identifier(bound.launch_id)? != launch_id {
        return Err(untrusted());
    }
    let bind_deadline_unix_ms = required_timestamp_ms(bound.bind_deadline)?;
    let now_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| untrusted())?
        .as_millis()
        .try_into()
        .map_err(|_| untrusted())?;
    if !valid_local_development_bind_deadline(now_unix_ms, bind_deadline_unix_ms, prepare_deadline)
    {
        return Err(untrusted());
    }
    report_windows_e2e_projection_stage("launch-bind-deadline-validated");
    process.resume().map_err(|error| {
        report_windows_e2e_projection_stage("launch-process-resume-rejected");
        error
    })?;
    report_windows_e2e_projection_stage("launch-process-resumed");
    Ok((
        LocalDevelopmentLaunchOutcome {
            process_id: process.id(),
            bind_deadline_unix_ms,
        },
        process,
    ))
}

fn valid_local_development_bind_deadline(
    now_unix_ms: i64,
    bind_deadline_unix_ms: i64,
    prepare_deadline_unix_ms: i64,
) -> bool {
    now_unix_ms > 0
        && bind_deadline_unix_ms > now_unix_ms
        && bind_deadline_unix_ms <= prepare_deadline_unix_ms
}

pub(crate) async fn end_run(
    channel: Channel,
    request: NativeEndRunRequest,
) -> Result<(), NimiHostError> {
    validate_identifier(request.authorization_id)?;
    validate_identifier(request.supervisor_run_id)?;
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .end_local_development_run(EndLocalDevelopmentRunRequest {
            authorization_id: request.authorization_id.to_vec(),
            supervisor_run_id: request.supervisor_run_id.to_vec(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    require_success_reason(response.reason_code)
}

fn project_projection(
    project: Option<LocalDevelopmentProjectProjection>,
    expected_shell: Option<LocalDevelopmentShellKind>,
) -> Result<LocalDevelopmentProject, NimiHostError> {
    let project = project.ok_or_else(|| projection_error("project-missing", untrusted()))?;
    if project.trust_class != LOCAL_DEVELOPMENT_TRUST_CLASS {
        return Err(projection_error("project-trust-class", untrusted()));
    }
    let shell_kind = shell_kind(project.shell_kind)
        .map_err(|error| projection_error("project-shell-kind", error))?;
    if expected_shell.is_some_and(|expected| expected != shell_kind) {
        return Err(projection_error("project-shell-mismatch", untrusted()));
    }
    let canonical_project_root = canonical_directory(Path::new(&project.canonical_project_root))
        .map_err(|error| projection_error("project-root", error))?;
    let canonical_manifest_path = canonical_file(Path::new(&project.canonical_manifest_path))
        .map_err(|error| projection_error("project-manifest", error))?;
    if !canonical_manifest_path.starts_with(&canonical_project_root) {
        return Err(projection_error("project-manifest-boundary", untrusted()));
    }
    let permission_requirement_fingerprint =
        required_identifier(project.permission_requirement_fingerprint).map_err(|error| {
            projection_error("project-permission-requirement-fingerprint", error)
        })?;
    let mut previous: Option<String> = None;
    let mut permission_requirements = Vec::with_capacity(project.permission_requirements.len());
    for requirement in project.permission_requirements {
        if requirement.permission_id.is_empty()
            || requirement.permission_id.trim() != requirement.permission_id
            || requirement.reason.is_empty()
            || requirement.reason.trim() != requirement.reason
            || requirement.reason.len() > 240
            || previous
                .as_ref()
                .is_some_and(|value| value.as_str() >= requirement.permission_id.as_str())
        {
            return Err(projection_error(
                "project-permission-requirement",
                untrusted(),
            ));
        }
        previous = Some(requirement.permission_id.clone());
        permission_requirements.push(crate::LocalDevelopmentPermissionRequirement {
            permission_id: requirement.permission_id,
            reason: requirement.reason,
        });
    }
    Ok(LocalDevelopmentProject {
        app_id: required_text(project.app_id)
            .map_err(|error| projection_error("project-app-id", error))?,
        display_name: required_text(project.display_name)
            .map_err(|error| projection_error("project-display-name", error))?,
        canonical_project_root,
        canonical_manifest_path,
        shell_kind,
        account_id: required_text(project.account_id)
            .map_err(|error| projection_error("project-account-id", error))?,
        permission_requirements,
        permission_requirement_fingerprint,
    })
}

fn authorization_projection(
    authorization: LocalDevelopmentAuthorizationProjection,
) -> Result<LocalDevelopmentAuthorization, NimiHostError> {
    require_success_reason(authorization.reason_code)?;
    let state = authorization_state(authorization.state)?;
    let persistence = decision(authorization.persistence)?;
    if authorization.authorization_generation == 0
        || persistence == LocalDevelopmentDecision::Deny
            && state != LocalDevelopmentAuthorizationState::Denied
    {
        return Err(untrusted());
    }
    Ok(LocalDevelopmentAuthorization {
        authorization_id: required_identifier(authorization.authorization_id)?,
        project: project_projection(authorization.project, None)?,
        state,
        persistence,
        authorization_generation: authorization.authorization_generation,
        approved_at_unix_ms: required_timestamp_ms(authorization.approved_at)?,
        updated_at_unix_ms: required_timestamp_ms(authorization.updated_at)?,
    })
}

fn shell_kind(value: i32) -> Result<LocalDevelopmentShellKind, NimiHostError> {
    match value {
        1 => Ok(LocalDevelopmentShellKind::Electron),
        2 => Ok(LocalDevelopmentShellKind::Tauri),
        _ => Err(untrusted()),
    }
}

fn decision(value: i32) -> Result<LocalDevelopmentDecision, NimiHostError> {
    match value {
        1 => Ok(LocalDevelopmentDecision::Deny),
        2 => Ok(LocalDevelopmentDecision::AllowRunOnce),
        3 => Ok(LocalDevelopmentDecision::AllowProject),
        _ => Err(untrusted()),
    }
}

fn authorization_state(value: i32) -> Result<LocalDevelopmentAuthorizationState, NimiHostError> {
    match value {
        1 => Ok(LocalDevelopmentAuthorizationState::ConfirmationRequired),
        2 => Ok(LocalDevelopmentAuthorizationState::Active),
        3 => Ok(LocalDevelopmentAuthorizationState::ReapprovalRequired),
        4 => Ok(LocalDevelopmentAuthorizationState::Denied),
        5 => Ok(LocalDevelopmentAuthorizationState::Revoked),
        _ => Err(untrusted()),
    }
}

fn controlled_renderer_origin(value: &str) -> Result<String, NimiHostError> {
    let normalized = value.trim();
    if normalized.is_empty() || normalized != value {
        return Err(dev_server_uncontrolled());
    }
    let parsed = Url::parse(normalized).map_err(|_| dev_server_uncontrolled())?;
    if parsed.scheme() != "http"
        || parsed.port().is_none()
        || !matches!(
            parsed.host_str(),
            Some("127.0.0.1" | "[::1]" | "::1" | "localhost")
        )
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(dev_server_uncontrolled());
    }
    Ok(format!(
        "http://{}:{}",
        parsed.host_str().ok_or_else(dev_server_uncontrolled)?,
        parsed.port().ok_or_else(dev_server_uncontrolled)?
    ))
}

fn required_text(value: String) -> Result<String, NimiHostError> {
    if value.is_empty() || value.trim() != value {
        return Err(untrusted());
    }
    Ok(value)
}

fn path_text(path: &Path) -> Result<String, NimiHostError> {
    path.to_str().map(str::to_string).ok_or_else(untrusted)
}

fn canonical_file(path: &Path) -> Result<PathBuf, NimiHostError> {
    if !path.is_absolute() || !path.is_file() {
        return Err(project_changed());
    }
    std::fs::canonicalize(path).map_err(|_| project_changed())
}

fn canonical_directory(path: &Path) -> Result<PathBuf, NimiHostError> {
    if !path.is_absolute() || !path.is_dir() {
        return Err(project_changed());
    }
    std::fs::canonicalize(path).map_err(|_| project_changed())
}

fn validate_identifier(value: [u8; 32]) -> Result<(), NimiHostError> {
    (value != [0u8; 32]).then_some(()).ok_or_else(untrusted)
}

fn required_identifier(value: Vec<u8>) -> Result<[u8; 32], NimiHostError> {
    let value: [u8; 32] = value.try_into().map_err(|_| untrusted())?;
    validate_identifier(value)?;
    Ok(value)
}

fn optional_identifier(value: Vec<u8>) -> Result<Option<[u8; 32]>, NimiHostError> {
    if value.is_empty() {
        return Ok(None);
    }
    required_identifier(value).map(Some)
}

fn required_timestamp_ms(value: Option<Timestamp>) -> Result<i64, NimiHostError> {
    optional_timestamp_ms(value)?.ok_or_else(untrusted)
}

fn optional_timestamp_ms(value: Option<Timestamp>) -> Result<Option<i64>, NimiHostError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.seconds <= 0 || !(0..1_000_000_000).contains(&value.nanos) {
        return Err(untrusted());
    }
    value
        .seconds
        .checked_mul(1_000)
        .and_then(|millis| millis.checked_add(i64::from(value.nanos / 1_000_000)))
        .map(Some)
        .ok_or_else(untrusted)
}

fn require_success_reason(reason_code: i32) -> Result<(), NimiHostError> {
    (reason_code == ACTION_EXECUTED)
        .then_some(())
        .ok_or_else(untrusted)
}

fn project_changed() -> NimiHostError {
    NimiHostError::new(
        NimiHostErrorReasonCode::LocalDevelopmentProjectChanged,
        false,
    )
}

fn dev_server_uncontrolled() -> NimiHostError {
    NimiHostError::new(
        NimiHostErrorReasonCode::LocalDevelopmentDevServerUncontrolled,
        false,
    )
}

fn untrusted() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_origin_accepts_only_explicit_loopback_http_ports() {
        for valid in [
            "http://127.0.0.1:5173",
            "http://localhost:1420",
            "http://[::1]:5173",
        ] {
            assert!(controlled_renderer_origin(valid).is_ok(), "{valid}");
        }
        for invalid in [
            "http://192.168.1.7:5173",
            "https://localhost:5173",
            "http://localhost",
            "http://localhost:5173/path",
            "http://user@localhost:5173",
        ] {
            let error = controlled_renderer_origin(invalid).expect_err(invalid);
            assert_eq!(
                error.reason_code(),
                NimiHostErrorReasonCode::LocalDevelopmentDevServerUncontrolled
            );
        }
    }

    #[test]
    fn identifiers_and_timestamps_fail_closed() {
        assert!(validate_identifier([0u8; 32]).is_err());
        assert!(required_identifier(vec![1; 31]).is_err());
        assert!(required_timestamp_ms(None).is_err());
        assert!(required_timestamp_ms(Some(Timestamp {
            seconds: 1,
            nanos: 1_000_000_000,
        }))
        .is_err());
    }

    #[test]
    fn bind_deadline_is_a_fresh_narrowing_of_prepare_deadline() {
        assert!(valid_local_development_bind_deadline(1_000, 2_000, 3_000));
        assert!(valid_local_development_bind_deadline(1_000, 3_000, 3_000));
        assert!(!valid_local_development_bind_deadline(1_000, 1_000, 3_000));
        assert!(!valid_local_development_bind_deadline(1_000, 3_001, 3_000));
        assert!(!valid_local_development_bind_deadline(0, 2_000, 3_000));
    }
}
