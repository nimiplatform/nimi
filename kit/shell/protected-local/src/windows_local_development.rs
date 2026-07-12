use std::path::{Path, PathBuf};

use prost_types::Timestamp;
use tonic::transport::Channel;
use url::Url;

use crate::generated::runtime_development_service_client::RuntimeDevelopmentServiceClient;
use crate::generated::{
    BindLocalDevelopmentHostProcessRequest, DecideLocalDevelopmentProjectRequest,
    EndLocalDevelopmentRunRequest, EvaluateLocalDevelopmentProjectRequest,
    EvaluateLocalDevelopmentProjectResponse, ListLocalDevelopmentAuthorizationsRequest,
    LocalDevelopmentAuthorizationProjection, LocalDevelopmentProjectProjection,
    PrepareLocalDevelopmentLaunchRequest, RevokeLocalDevelopmentAuthorizationRequest,
};
use crate::grpc_status::host_error_from_status;
use crate::windows_supervised_process::SupervisedDevelopmentProcess;
use crate::{
    LocalDevelopmentAuthorization, LocalDevelopmentAuthorizationState, LocalDevelopmentDecision,
    LocalDevelopmentDecisionRequest, LocalDevelopmentEndRunRequest as NativeEndRunRequest,
    LocalDevelopmentEvaluation, LocalDevelopmentEvaluationRequest as NativeEvaluationRequest,
    LocalDevelopmentLaunchOutcome, LocalDevelopmentLaunchRequest, LocalDevelopmentProject,
    LocalDevelopmentShellKind, NimiHostError, NimiHostErrorReasonCode,
    LOCAL_DEVELOPMENT_TRUST_CLASS,
};

const ACTION_EXECUTED: i32 = 1;

#[cfg(feature = "windows-e2e-fixture")]
fn report_windows_e2e_evaluation_response(response: &EvaluateLocalDevelopmentProjectResponse) {
    let project = response.project.as_ref();
    eprintln!(
        "[protected-local local-development windows-e2e-fixture] stage=evaluation-response reason_code={} state={} confirmation_required={} evaluation_id_len={} project_present={} project_app_id_present={} project_display_name_present={} project_root_present={} project_manifest_present={} project_account_present={} capability_count={} capability_fingerprint_len={} trust_class_matches={} authorization_present={} expires_present={}",
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
        project.map_or(0, |value| value.requested_capabilities.len()),
        project.map_or(0, |value| value.capability_fingerprint.len()),
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
        if evaluation_id.is_none() || evaluation_expires_at_unix_ms.is_none() {
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
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .decide_local_development_project(DecideLocalDevelopmentProjectRequest {
            evaluation_id: request.evaluation_id.to_vec(),
            decision: request.decision.proto_value(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    let expected_reason = match request.decision {
        LocalDevelopmentDecision::Deny => 650,
        LocalDevelopmentDecision::AllowRunOnce | LocalDevelopmentDecision::AllowRememberProject => {
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
    let renderer_origin =
        controlled_renderer_origin(&request.renderer_origin).map_err(|error| {
            report_windows_e2e_projection_stage("launch-renderer-origin-rejected");
            error
        })?;
    report_windows_e2e_projection_stage("launch-prepare-request");
    let response = RuntimeDevelopmentServiceClient::new(channel.clone())
        .prepare_local_development_launch(PrepareLocalDevelopmentLaunchRequest {
            authorization_id: request.authorization_id.to_vec(),
            supervisor_run_id: request.supervisor_run_id.to_vec(),
            shell_kind: request.shell_kind.proto_value(),
            host_executable_path: path_text(&host_executable_path)?,
            renderer_origin,
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
    let bound = RuntimeDevelopmentServiceClient::new(channel)
        .bind_local_development_host_process(BindLocalDevelopmentHostProcessRequest {
            launch_id: launch_id.to_vec(),
            child_process_id: process.id(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    require_success_reason(bound.reason_code)?;
    if required_identifier(bound.launch_id)? != launch_id {
        return Err(untrusted());
    }
    let bind_deadline_unix_ms = required_timestamp_ms(bound.bind_deadline)?;
    if bind_deadline_unix_ms != prepare_deadline {
        return Err(untrusted());
    }
    process.resume()?;
    Ok((
        LocalDevelopmentLaunchOutcome {
            process_id: process.id(),
            bind_deadline_unix_ms,
        },
        process,
    ))
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
    let capability_fingerprint = required_identifier(project.capability_fingerprint)
        .map_err(|error| projection_error("project-capability-fingerprint", error))?;
    let mut previous: Option<&str> = None;
    for capability in &project.requested_capabilities {
        if capability.is_empty()
            || capability.trim() != capability
            || previous.is_some_and(|value| value >= capability.as_str())
        {
            return Err(projection_error("project-capability-order", untrusted()));
        }
        previous = Some(capability);
    }
    if project.requested_capabilities.is_empty() {
        return Err(projection_error("project-capabilities-empty", untrusted()));
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
        requested_capabilities: project.requested_capabilities,
        capability_fingerprint,
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
        3 => Ok(LocalDevelopmentDecision::AllowRememberProject),
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
}
