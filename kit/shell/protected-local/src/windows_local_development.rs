use std::collections::HashSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use prost_types::Timestamp;
use tonic::transport::Channel;
use url::Url;

use crate::generated::runtime_app_service_client::RuntimeAppServiceClient;
use crate::generated::runtime_development_service_client::RuntimeDevelopmentServiceClient;
#[cfg(any(
    all(target_os = "macos", feature = "macos-source-local-development"),
    all(target_os = "windows", feature = "windows-source-local-development")
))]
use crate::generated::RebindLocalAppProcessRequest;
use crate::generated::{
    BindLocalAppProcessRequest, EndLocalDevelopmentRunRequest, GetDeveloperModeStatusRequest,
    ListLocalDevelopmentRegistrationsRequest, LocalDevelopmentProjectProjection,
    LocalDevelopmentRegistrationProjection, PrepareLocalAppLaunchRequest,
    RegisterLocalDevelopmentProjectRequest, RemoveLocalDevelopmentRegistrationRequest,
    SetDeveloperModeRequest,
};
use crate::grpc_status::host_error_from_status;
#[cfg(target_os = "macos")]
use crate::macos_supervised_process::SupervisedDevelopmentProcess;
#[cfg(target_os = "windows")]
use crate::windows_supervised_process::SupervisedDevelopmentProcess;
use crate::{
    DeveloperModeState, DeveloperModeStatus, LocalDevelopmentEndRunRequest as NativeEndRunRequest,
    LocalDevelopmentLaunchOutcome, LocalDevelopmentLaunchRequest, LocalDevelopmentProject,
    LocalDevelopmentRegistration, LocalDevelopmentRegistrationRequest as NativeRegistrationRequest,
    LocalDevelopmentShellKind, NimiHostError, NimiHostErrorReasonCode,
    LOCAL_DEVELOPMENT_TRUST_CLASS,
};

const ACTION_EXECUTED: i32 = 1;
const DEVELOPER_MODE_STATUS_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) async fn get_developer_mode_status(
    channel: Channel,
) -> Result<DeveloperModeStatus, NimiHostError> {
    // grpc-timeout lets Runtime cancel accepted work; the local timeout also
    // bounds a half-open channel before the request can reach Runtime.
    let mut client = RuntimeDevelopmentServiceClient::new(channel);
    let response = await_developer_mode_status(
        DEVELOPER_MODE_STATUS_TIMEOUT,
        client.get_developer_mode_status(developer_mode_status_request()),
    )
    .await?
    .into_inner();
    developer_mode_projection(response.state, response.revision, response.reason_code)
}

fn developer_mode_status_request() -> tonic::Request<GetDeveloperModeStatusRequest> {
    let mut request = tonic::Request::new(GetDeveloperModeStatusRequest {});
    request.set_timeout(DEVELOPER_MODE_STATUS_TIMEOUT);
    request
}

async fn await_developer_mode_status<T, F>(timeout: Duration, future: F) -> Result<T, NimiHostError>
where
    F: Future<Output = Result<T, tonic::Status>>,
{
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUnavailable, true))?
        .map_err(host_error_from_status)
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
    let projection =
        developer_mode_projection(response.state, response.revision, response.reason_code)?;
    if (projection.state == DeveloperModeState::Enabled) != enabled {
        return Err(untrusted());
    }
    Ok(projection)
}

fn developer_mode_projection(
    state: i32,
    revision: u64,
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
    } else if reason_code != ACTION_EXECUTED || revision == 0 {
        return Err(untrusted());
    }
    Ok(DeveloperModeStatus { state, revision })
}

pub(crate) async fn register_project(
    channel: Channel,
    request: NativeRegistrationRequest,
) -> Result<LocalDevelopmentRegistration, NimiHostError> {
    validate_identifier(request.supervisor_run_id)?;
    let expected_app_id = required_text(request.expected_app_id)?;
    let project_root = canonical_directory(&request.project_root)?;
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .register_local_development_project(RegisterLocalDevelopmentProjectRequest {
            expected_app_id,
            project_root: path_text(&project_root)?,
            shell_kind: request.shell_kind.proto_value(),
            supervisor_run_id: request.supervisor_run_id.to_vec(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    require_success_reason(response.reason_code)?;
    registration_projection(
        response.registration.ok_or_else(untrusted)?,
        Some(request.shell_kind),
    )
}

pub(crate) async fn list_registrations(
    channel: Channel,
) -> Result<Vec<LocalDevelopmentRegistration>, NimiHostError> {
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .list_local_development_registrations(ListLocalDevelopmentRegistrationsRequest {})
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    require_success_reason(response.reason_code)?;
    response
        .registrations
        .into_iter()
        .map(|registration| registration_projection(registration, None))
        .collect()
}

pub(crate) async fn remove_registration(
    channel: Channel,
    registration_handle: [u8; 32],
) -> Result<(), NimiHostError> {
    validate_identifier(registration_handle)?;
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .remove_local_development_registration(RemoveLocalDevelopmentRegistrationRequest {
            registration_handle: registration_handle.to_vec(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    require_success_reason(response.reason_code)
}

pub(crate) async fn launch_host(
    channel: Channel,
    request: LocalDevelopmentLaunchRequest,
) -> Result<(LocalDevelopmentLaunchOutcome, SupervisedDevelopmentProcess), NimiHostError> {
    validate_identifier(request.registration_handle)?;
    validate_identifier(request.supervisor_run_id)?;
    let host_executable_path = canonical_file(&request.host_executable_path)?;
    let working_directory = canonical_directory(&request.working_directory)?;
    let _renderer_origin = controlled_renderer_origin(&request.renderer_origin)?;
    let response = RuntimeAppServiceClient::new(channel.clone())
        .prepare_local_app_launch(PrepareLocalAppLaunchRequest {
            local_app_handle: request.registration_handle.to_vec(),
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
    let bound = RuntimeAppServiceClient::new(channel)
        .bind_local_app_process(BindLocalAppProcessRequest {
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
    process.resume()?;
    Ok((
        LocalDevelopmentLaunchOutcome {
            process_id: process.id(),
            bind_deadline_unix_ms,
        },
        process,
    ))
}

#[cfg(any(
    all(target_os = "macos", feature = "macos-source-local-development"),
    all(target_os = "windows", feature = "windows-source-local-development")
))]
pub(crate) async fn rebind_host(
    channel: Channel,
    request: LocalDevelopmentLaunchRequest,
    process_id: u32,
) -> Result<LocalDevelopmentLaunchOutcome, NimiHostError> {
    validate_identifier(request.registration_handle)?;
    validate_identifier(request.supervisor_run_id)?;
    if process_id == 0 {
        return Err(untrusted());
    }
    let _host_executable_path = canonical_file(&request.host_executable_path)?;
    let _working_directory = canonical_directory(&request.working_directory)?;
    let _renderer_origin = controlled_renderer_origin(&request.renderer_origin)?;
    let response = RuntimeAppServiceClient::new(channel.clone())
        .prepare_local_app_launch(PrepareLocalAppLaunchRequest {
            local_app_handle: request.registration_handle.to_vec(),
            supervisor_run_id: request.supervisor_run_id.to_vec(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    require_success_reason(response.reason_code)?;
    let launch_id = required_identifier(response.launch_id)?;
    let prepare_deadline = required_timestamp_ms(response.bind_deadline)?;
    let rebound = RuntimeAppServiceClient::new(channel)
        .rebind_local_app_process(RebindLocalAppProcessRequest {
            launch_id: launch_id.to_vec(),
            child_process_id: process_id,
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    require_success_reason(rebound.reason_code)?;
    if required_identifier(rebound.launch_id)? != launch_id {
        return Err(untrusted());
    }
    let bind_deadline_unix_ms = required_timestamp_ms(rebound.bind_deadline)?;
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
    Ok(LocalDevelopmentLaunchOutcome {
        process_id,
        bind_deadline_unix_ms,
    })
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
    validate_identifier(request.registration_handle)?;
    validate_identifier(request.supervisor_run_id)?;
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .end_local_development_run(EndLocalDevelopmentRunRequest {
            registration_handle: request.registration_handle.to_vec(),
            supervisor_run_id: request.supervisor_run_id.to_vec(),
        })
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    require_success_reason(response.reason_code)
}

fn registration_projection(
    registration: LocalDevelopmentRegistrationProjection,
    expected_shell: Option<LocalDevelopmentShellKind>,
) -> Result<LocalDevelopmentRegistration, NimiHostError> {
    require_success_reason(registration.reason_code)?;
    let registered_at_unix_ms = required_timestamp_ms(registration.registered_at)?;
    let updated_at_unix_ms = required_timestamp_ms(registration.updated_at)?;
    if updated_at_unix_ms < registered_at_unix_ms {
        return Err(untrusted());
    }
    Ok(LocalDevelopmentRegistration {
        registration_handle: required_identifier(registration.registration_handle)?,
        project: project_projection(registration.project, expected_shell)?,
        registered_at_unix_ms,
        updated_at_unix_ms,
    })
}

fn project_projection(
    project: Option<LocalDevelopmentProjectProjection>,
    expected_shell: Option<LocalDevelopmentShellKind>,
) -> Result<LocalDevelopmentProject, NimiHostError> {
    let project = project.ok_or_else(untrusted)?;
    if project.trust_class != LOCAL_DEVELOPMENT_TRUST_CLASS
        || project.source_generation == 0
        || project.declaration_generation == 0
    {
        return Err(untrusted());
    }
    let shell_kind = shell_kind(project.shell_kind)?;
    if expected_shell.is_some_and(|expected| expected != shell_kind) {
        return Err(untrusted());
    }
    let canonical_project_root = canonical_directory(Path::new(&project.canonical_project_root))?;
    let canonical_manifest_path = canonical_file(Path::new(&project.canonical_manifest_path))?;
    if !canonical_manifest_path.starts_with(&canonical_project_root) {
        return Err(untrusted());
    }
    let mut seen = HashSet::new();
    for item in &project.app_access {
        if item.is_empty() || item.trim() != item || item.len() > 128 || !seen.insert(item.as_str())
        {
            return Err(untrusted());
        }
    }
    Ok(LocalDevelopmentProject {
        app_id: required_text(project.app_id)?,
        display_name: required_text(project.display_name)?,
        canonical_project_root,
        canonical_manifest_path,
        shell_kind,
        app_access: project.app_access,
        source_generation: project.source_generation,
        declaration_generation: project.declaration_generation,
    })
}

fn shell_kind(value: i32) -> Result<LocalDevelopmentShellKind, NimiHostError> {
    match value {
        1 => Ok(LocalDevelopmentShellKind::Electron),
        2 => Ok(LocalDevelopmentShellKind::Tauri),
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

fn required_timestamp_ms(value: Option<Timestamp>) -> Result<i64, NimiHostError> {
    let value = value.ok_or_else(untrusted)?;
    if value.seconds <= 0 || !(0..1_000_000_000).contains(&value.nanos) {
        return Err(untrusted());
    }
    value
        .seconds
        .checked_mul(1_000)
        .and_then(|millis| millis.checked_add(i64::from(value.nanos / 1_000_000)))
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
    fn developer_mode_status_request_carries_a_runtime_deadline() {
        assert_eq!(
            developer_mode_status_request()
                .metadata()
                .get("grpc-timeout")
                .expect("developer-mode status deadline"),
            "5000000u"
        );
    }

    #[tokio::test]
    async fn pending_developer_mode_status_is_bounded_locally() {
        let error = await_developer_mode_status(
            Duration::ZERO,
            std::future::pending::<Result<(), tonic::Status>>(),
        )
        .await
        .expect_err("pending status call must time out");
        assert_eq!(
            error.reason_code(),
            NimiHostErrorReasonCode::RuntimeServiceUnavailable
        );
        assert!(error.retryable());
    }

    #[test]
    fn developer_mode_is_account_independent() {
        assert_eq!(
            developer_mode_projection(2, 2, ACTION_EXECUTED).unwrap(),
            DeveloperModeStatus {
                state: DeveloperModeState::Enabled,
                revision: 2
            }
        );
    }

    #[test]
    fn renderer_origin_accepts_only_explicit_loopback_http_ports() {
        assert!(controlled_renderer_origin("http://127.0.0.1:5173").is_ok());
        assert!(controlled_renderer_origin("https://localhost:5173").is_err());
    }
}
