#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use nimi_shell_protected_local::LinuxUnixSocketCarrier;
#[cfg(target_os = "macos")]
use nimi_shell_protected_local::MacOsPrivilegedXpcCarrier;
#[cfg(target_os = "windows")]
use nimi_shell_protected_local::{
    invalidate_verified_desktop_runtime_channel, WindowsNamedPipeCarrier,
};
use nimi_shell_protected_local::{
    DesktopAccountSessionStatus, DesktopAccountSessionStatusRequest, DeveloperModeStatus,
    FixedRuntimeServiceControl, LocalAppGrantControlDecisionRequest, LocalAppGrantControlPending,
    LocalAppGrantControlProjection, LocalDevelopmentAuthorization, LocalDevelopmentDecisionRequest,
    LocalDevelopmentEndRunRequest, LocalDevelopmentEvaluation, LocalDevelopmentEvaluationRequest,
    LocalDevelopmentLaunchOutcome, LocalDevelopmentLaunchRequest,
    LocalDevelopmentReactivationRequest, NimiDesktopControl, NimiHostError,
    NimiHostErrorReasonCode, NimiProtectedLocalHostCarrier, ProtectedCarrierError,
    ProtectedCarrierReasonCode, RuntimeServiceAction, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};
use std::sync::{Arc, Mutex, OnceLock};

use super::{error_map::bridge_error, RuntimeBridgeDaemonStatus};

const PROTECTED_LOCAL_TRANSPORT_LABEL: &str = "protected-local";
const PROTECTED_LOCAL_LAUNCH_MODE: &str = "PROTECTED_LOCAL";
const UNAVAILABLE_LAUNCH_MODE: &str = "INVALID";

#[cfg(feature = "windows-e2e-fixture")]
fn report_windows_e2e_service_control(stage: &str, reason_code: Option<&str>) {
    eprintln!(
        "[tauri runtime-bridge windows-e2e-fixture] stage={} reason_code={}",
        stage,
        reason_code.unwrap_or("none")
    );
}

#[cfg(not(feature = "windows-e2e-fixture"))]
fn report_windows_e2e_service_control(_: &str, _: Option<&str>) {}

#[cfg(target_os = "windows")]
type PlatformCarrier = WindowsNamedPipeCarrier;
#[cfg(target_os = "macos")]
type PlatformCarrier = MacOsPrivilegedXpcCarrier;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
type PlatformCarrier = LinuxUnixSocketCarrier;

static DESKTOP_CONTROL: OnceLock<Mutex<Option<Arc<dyn NimiDesktopControl>>>> = OnceLock::new();

pub(super) fn status() -> RuntimeBridgeDaemonStatus {
    let carrier = PlatformCarrier::default();
    carrier
        .runtime_service_status()
        .map(status_projection)
        .unwrap_or_else(unavailable_status)
}

pub(super) async fn status_async() -> RuntimeBridgeDaemonStatus {
    if desktop_control_is_open() {
        return service_projection(RuntimeServiceState::Running, None, None, false);
    }
    let carrier = PlatformCarrier::default();
    match carrier.open_desktop_control().await {
        Ok(control) => match retain_desktop_control(control) {
            Ok(()) => service_projection(RuntimeServiceState::Running, None, None, false),
            Err(error) => unavailable_status(error),
        },
        Err(error) => unavailable_status(error),
    }
}

pub(super) async fn request(
    action: RuntimeServiceAction,
) -> Result<RuntimeBridgeDaemonStatus, String> {
    let carrier = PlatformCarrier::default();
    let outcome = match action {
        RuntimeServiceAction::Start => carrier.request_runtime_service_start(),
        RuntimeServiceAction::Restart => {
            let control = match control_for_call().await {
                Ok(control) => control,
                Err(error) => return Err(carrier_error(host_service_control_error(error))),
            };
            control.request_runtime_service_restart().await
        }
    }
    .map_err(carrier_error)?;
    if matches!(
        action,
        RuntimeServiceAction::Start | RuntimeServiceAction::Restart
    ) {
        clear_desktop_control().await;
    }
    Ok(action_projection(outcome))
}

fn status_projection(status: RuntimeServiceStatus) -> RuntimeBridgeDaemonStatus {
    service_projection(
        status.state,
        status.release_id,
        status.reason_code,
        status.retryable,
    )
}

fn action_projection(outcome: RuntimeServiceActionOutcome) -> RuntimeBridgeDaemonStatus {
    service_projection(
        outcome.state,
        outcome.release_id,
        outcome.reason_code,
        outcome.retryable,
    )
}

fn unavailable_status(error: ProtectedCarrierError) -> RuntimeBridgeDaemonStatus {
    service_projection(
        RuntimeServiceState::Unavailable,
        None,
        Some(error.reason_code()),
        error.retryable(),
    )
}

fn service_projection(
    state: RuntimeServiceState,
    release_id: Option<String>,
    reason_code: Option<ProtectedCarrierReasonCode>,
    _retryable: bool,
) -> RuntimeBridgeDaemonStatus {
    let (running, managed, launch_mode) = match state {
        RuntimeServiceState::Stopped => (false, true, PROTECTED_LOCAL_LAUNCH_MODE),
        RuntimeServiceState::StartPending => (false, true, PROTECTED_LOCAL_LAUNCH_MODE),
        RuntimeServiceState::Running => (true, true, PROTECTED_LOCAL_LAUNCH_MODE),
        RuntimeServiceState::RestartPending => (true, true, PROTECTED_LOCAL_LAUNCH_MODE),
        RuntimeServiceState::Unavailable => (false, false, UNAVAILABLE_LAUNCH_MODE),
    };
    let last_error = reason_code
        .map(|reason| bridge_error("RUNTIME_BRIDGE_DAEMON_UNAVAILABLE", reason.as_str()));

    RuntimeBridgeDaemonStatus {
        running,
        managed,
        launch_mode: launch_mode.to_string(),
        grpc_addr: PROTECTED_LOCAL_TRANSPORT_LABEL.to_string(),
        pid: None,
        version: release_id,
        last_error,
        debug_log_path: None,
    }
}

fn carrier_error(error: ProtectedCarrierError) -> String {
    bridge_error(
        "RUNTIME_BRIDGE_DAEMON_UNAVAILABLE",
        error.reason_code().as_str(),
    )
}

fn host_service_control_error(error: NimiHostError) -> ProtectedCarrierError {
    let reason = match error.reason_code() {
        NimiHostErrorReasonCode::RuntimeServiceUnavailable => {
            ProtectedCarrierReasonCode::RuntimeServiceUnavailable
        }
        NimiHostErrorReasonCode::RuntimeServiceUntrusted => {
            ProtectedCarrierReasonCode::RuntimeServiceUntrusted
        }
        NimiHostErrorReasonCode::RuntimeServiceRepairRequired => {
            ProtectedCarrierReasonCode::RuntimeServiceRepairRequired
        }
        _ => ProtectedCarrierReasonCode::ProtectedCarrierRequired,
    };
    ProtectedCarrierError::new(reason, error.retryable())
}

fn desktop_control_is_open() -> bool {
    DESKTOP_CONTROL
        .get()
        .and_then(|control| control.lock().ok())
        .is_some_and(|control| control.is_some())
}

fn retain_desktop_control(
    control: Box<dyn NimiDesktopControl>,
) -> Result<(), ProtectedCarrierError> {
    let slot = DESKTOP_CONTROL.get_or_init(|| Mutex::new(None));
    let mut slot = slot.lock().map_err(|_| {
        ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
    })?;
    if slot.is_none() {
        *slot = Some(Arc::from(control));
    }
    Ok(())
}

pub(super) async fn get_account_session_status(
    request: DesktopAccountSessionStatusRequest,
) -> Result<DesktopAccountSessionStatus, NimiHostError> {
    let control = control_for_call().await?;
    match control.get_account_session_status(request.clone()).await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await?
                .get_account_session_status(request)
                .await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn evaluate_local_development_project(
    request: LocalDevelopmentEvaluationRequest,
) -> Result<LocalDevelopmentEvaluation, NimiHostError> {
    let control = match control_for_call().await {
        Ok(control) => control,
        Err(error) => {
            report_windows_e2e_service_control(
                "evaluation-initial-control-error",
                Some(error.reason_code().as_str()),
            );
            return Err(error);
        }
    };
    let first_attempt = control
        .evaluate_local_development_project(request.clone())
        .await;
    match first_attempt {
        Ok(value) => {
            report_windows_e2e_service_control("evaluation-initial-succeeded", None);
            Ok(value)
        }
        Err(error) if !should_reconnect(error) => {
            report_windows_e2e_service_control(
                "evaluation-initial-terminal-error",
                Some(error.reason_code().as_str()),
            );
            Err(error)
        }
        Err(error) => {
            report_windows_e2e_service_control(
                "evaluation-initial-reconnect",
                Some(error.reason_code().as_str()),
            );
            clear_desktop_control_if_same(control).await;
            let reconnected = match control_for_call().await {
                Ok(control) => control,
                Err(error) => {
                    report_windows_e2e_service_control(
                        "evaluation-reconnect-control-error",
                        Some(error.reason_code().as_str()),
                    );
                    return Err(error);
                }
            };
            let result = reconnected
                .evaluate_local_development_project(request)
                .await;
            match &result {
                Ok(_) => report_windows_e2e_service_control("evaluation-retry-succeeded", None),
                Err(error) => report_windows_e2e_service_control(
                    "evaluation-retry-error",
                    Some(error.reason_code().as_str()),
                ),
            }
            result
        }
    }
}

pub(super) async fn get_developer_mode_status() -> Result<DeveloperModeStatus, NimiHostError> {
    let control = control_for_call().await?;
    match control.get_developer_mode_status().await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call().await?.get_developer_mode_status().await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn set_developer_mode(
    enabled: bool,
) -> Result<DeveloperModeStatus, NimiHostError> {
    let control = control_for_call().await?;
    match control.set_developer_mode(enabled).await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call().await?.set_developer_mode(enabled).await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn pending_local_app_grant(
) -> Result<Option<LocalAppGrantControlPending>, NimiHostError> {
    let control = control_for_call().await?;
    match control.pending_local_app_grant().await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call().await?.pending_local_app_grant().await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn decide_local_app_grant(
    request: LocalAppGrantControlDecisionRequest,
) -> Result<LocalAppGrantControlProjection, NimiHostError> {
    control_for_call()
        .await?
        .decide_local_app_grant(request)
        .await
}

pub(super) async fn revoke_local_app_grant(
    grant_id: [u8; 32],
) -> Result<LocalAppGrantControlProjection, NimiHostError> {
    let control = control_for_call().await?;
    match control.revoke_local_app_grant(grant_id).await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await?
                .revoke_local_app_grant(grant_id)
                .await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn decide_local_development_project(
    request: LocalDevelopmentDecisionRequest,
) -> Result<LocalDevelopmentAuthorization, NimiHostError> {
    let control = control_for_call().await?;
    match control
        .decide_local_development_project(request.clone())
        .await
    {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await?
                .decide_local_development_project(request)
                .await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn reactivate_local_development_project(
    request: LocalDevelopmentReactivationRequest,
) -> Result<LocalDevelopmentAuthorization, NimiHostError> {
    let control = control_for_call().await?;
    control.reactivate_local_development_project(request).await
}

pub(super) async fn list_local_development_authorizations(
) -> Result<Vec<LocalDevelopmentAuthorization>, NimiHostError> {
    let control = control_for_call().await?;
    match control.list_local_development_authorizations().await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await?
                .list_local_development_authorizations()
                .await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn revoke_local_development_authorization(
    authorization_id: [u8; 32],
) -> Result<LocalDevelopmentAuthorization, NimiHostError> {
    let control = control_for_call().await?;
    match control
        .revoke_local_development_authorization(authorization_id)
        .await
    {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await?
                .revoke_local_development_authorization(authorization_id)
                .await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn launch_local_development_host(
    request: LocalDevelopmentLaunchRequest,
) -> Result<LocalDevelopmentLaunchOutcome, NimiHostError> {
    let control = control_for_call().await?;
    match control.launch_local_development_host(request.clone()).await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await?
                .launch_local_development_host(request)
                .await
        }
        Err(error) => Err(error),
    }
}

pub(super) fn local_development_host_running(
    supervisor_run_id: [u8; 32],
) -> Result<bool, NimiHostError> {
    desktop_control()?.local_development_host_running(supervisor_run_id)
}

pub(super) fn terminate_local_development_host(
    supervisor_run_id: [u8; 32],
) -> Result<(), NimiHostError> {
    desktop_control()?.terminate_local_development_host(supervisor_run_id)
}

pub(super) async fn end_local_development_run(
    request: LocalDevelopmentEndRunRequest,
) -> Result<(), NimiHostError> {
    let control = control_for_call().await?;
    match control.end_local_development_run(request.clone()).await {
        Ok(()) => Ok(()),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await?
                .end_local_development_run(request)
                .await
        }
        Err(error) => Err(error),
    }
}

async fn control_for_call() -> Result<Arc<dyn NimiDesktopControl>, NimiHostError> {
    if let Ok(control) = desktop_control() {
        return Ok(control);
    }
    let control = PlatformCarrier::default()
        .open_desktop_control()
        .await
        .map_err(NimiHostError::from)?;
    retain_desktop_control(control).map_err(NimiHostError::from)?;
    desktop_control()
}

fn should_reconnect(error: NimiHostError) -> bool {
    matches!(
        error.reason_code(),
        nimi_shell_protected_local::NimiHostErrorReasonCode::RuntimeServiceUnavailable
            | nimi_shell_protected_local::NimiHostErrorReasonCode::RuntimeServiceUntrusted
            | nimi_shell_protected_local::NimiHostErrorReasonCode::ProtectedCarrierRequired
    )
}

async fn clear_desktop_control_if_same(control: Arc<dyn NimiDesktopControl>) {
    let cleared = DESKTOP_CONTROL.get().is_some_and(|slot| {
        let Ok(mut slot) = slot.lock() else {
            return false;
        };
        if slot
            .as_ref()
            .is_some_and(|candidate| Arc::ptr_eq(candidate, &control))
        {
            *slot = None;
            true
        } else {
            false
        }
    });
    if cleared {
        super::channel_pool::invalidate_channel();
        invalidate_platform_desktop_runtime_channel().await;
    }
    drop(control);
}

async fn clear_desktop_control() {
    let removed = DESKTOP_CONTROL
        .get()
        .and_then(|slot| slot.lock().ok())
        .and_then(|mut slot| slot.take());
    invalidate_platform_desktop_runtime_channel().await;
    drop(removed);
}

#[cfg(target_os = "windows")]
async fn invalidate_platform_desktop_runtime_channel() {
    invalidate_verified_desktop_runtime_channel().await;
}

#[cfg(not(target_os = "windows"))]
async fn invalidate_platform_desktop_runtime_channel() {}

fn desktop_control() -> Result<Arc<dyn NimiDesktopControl>, NimiHostError> {
    DESKTOP_CONTROL
        .get()
        .and_then(|slot| slot.lock().ok())
        .and_then(|slot| slot.clone())
        .ok_or_else(|| {
            NimiHostError::new(
                nimi_shell_protected_local::NimiHostErrorReasonCode::ProtectedCarrierRequired,
                false,
            )
        })
}
