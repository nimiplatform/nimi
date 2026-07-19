#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use nimi_shell_protected_local::LinuxUnixSocketCarrier;
#[cfg(target_os = "macos")]
use nimi_shell_protected_local::{
    invalidate_verified_desktop_runtime_channel, MacOsUnixSocketCarrier,
};
#[cfg(target_os = "windows")]
use nimi_shell_protected_local::{
    invalidate_verified_desktop_runtime_channel, WindowsNamedPipeCarrier,
};
use nimi_shell_protected_local::{
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse,
    DesktopAccountSessionEventReceiver, DesktopAccountSessionEventsRequest,
    DesktopAccountSessionStatus, DesktopAccountSessionStatusRequest, DesktopProductControlMethod,
    DesktopProductControlRequest, DesktopRuntimeConsumerMethod, DesktopRuntimeConsumerRequest,
    DeveloperModeStatus, FixedRuntimeServiceControl, LocalDevelopmentAuthoritySummary,
    LocalDevelopmentAuthorization, LocalDevelopmentDecisionRequest, LocalDevelopmentEndRunRequest,
    LocalDevelopmentEvaluation, LocalDevelopmentEvaluationRequest, LocalDevelopmentLaunchOutcome,
    LocalDevelopmentLaunchRequest, NimiDesktopControl, NimiHostError, NimiHostErrorReasonCode,
    NimiProtectedLocalHostCarrier, ProtectedCarrierError, ProtectedCarrierReasonCode,
    RuntimeServiceAction, RuntimeServiceActionOutcome, RuntimeServiceState, RuntimeServiceStatus,
};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::Mutex as AsyncMutex;

use super::{error_map::bridge_error, RuntimeBridgeDaemonStatus};

const PROTECTED_LOCAL_TRANSPORT_LABEL: &str = "protected-local";
const PROTECTED_LOCAL_LAUNCH_MODE: &str = "PROTECTED_LOCAL";
const UNAVAILABLE_LAUNCH_MODE: &str = "INVALID";
const INITIAL_CONTROL_OPEN_RETRY_DELAYS: [Duration; 2] =
    [Duration::from_millis(50), Duration::from_millis(150)];

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
type PlatformCarrier = MacOsUnixSocketCarrier;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
type PlatformCarrier = LinuxUnixSocketCarrier;

static DESKTOP_CONTROL: OnceLock<Mutex<Option<Arc<dyn NimiDesktopControl>>>> = OnceLock::new();
static DESKTOP_CONTROL_OPEN: OnceLock<AsyncMutex<()>> = OnceLock::new();

pub(super) fn status() -> RuntimeBridgeDaemonStatus {
    let carrier = PlatformCarrier::default();
    carrier
        .runtime_service_status()
        .map(status_projection)
        .unwrap_or_else(unavailable_status)
}

pub(super) async fn status_async() -> RuntimeBridgeDaemonStatus {
    match control_for_call().await {
        Ok(_) => service_projection(RuntimeServiceState::Running, None, None, false),
        Err(error) => unavailable_status(host_service_control_error(error)),
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

pub(super) async fn open_account_session_events(
    request: DesktopAccountSessionEventsRequest,
) -> Result<DesktopAccountSessionEventReceiver, NimiHostError> {
    let control = control_for_call().await?;
    match control.open_account_session_events(request.clone()).await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await?
                .open_account_session_events(request)
                .await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn begin_account_login(
    request: DesktopAccountBeginLoginRequest,
) -> Result<DesktopAccountBeginLoginResponse, NimiHostError> {
    let control = control_for_call().await?;
    match control.begin_account_login(request.clone()).await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call().await?.begin_account_login(request).await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn complete_account_login(
    request: DesktopAccountCompleteLoginRequest,
) -> Result<DesktopAccountMutationResponse, NimiHostError> {
    let control = control_for_call().await?;
    match control.complete_account_login(request.clone()).await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await?
                .complete_account_login(request)
                .await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn invoke_account_realm_unary(
    request: DesktopAccountRealmUnaryRequest,
) -> Result<DesktopAccountRealmUnaryResponse, NimiHostError> {
    let control = control_for_call().await?;
    match control.invoke_account_realm_unary(request.clone()).await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await?
                .invoke_account_realm_unary(request)
                .await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn logout_account(
    request: DesktopAccountActionRequest,
) -> Result<DesktopAccountMutationResponse, NimiHostError> {
    let control = control_for_call().await?;
    match control.logout_account(request.clone()).await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call().await?.logout_account(request).await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn switch_account(
    request: DesktopAccountActionRequest,
) -> Result<DesktopAccountMutationResponse, NimiHostError> {
    let control = control_for_call().await?;
    match control.switch_account(request.clone()).await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call().await?.switch_account(request).await
        }
        Err(error) => Err(error),
    }
}

pub(super) async fn invoke_protected_desktop_unary(
    method_id: &str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, String> {
    if let Some(method) = DesktopProductControlMethod::from_method_id(method_id) {
        return invoke_product_control(method, request_bytes, timeout).await;
    }
    if let Some(method) = DesktopRuntimeConsumerMethod::from_method_id(method_id) {
        return invoke_runtime_consumer(method, request_bytes, timeout).await;
    }
    Err(bridge_error(
        "RUNTIME_BRIDGE_PROTECTED_METHOD_FORBIDDEN",
        method_id,
    ))
}

async fn invoke_product_control(
    method: DesktopProductControlMethod,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, String> {
    let control = control_for_call().await.map_err(host_call_error)?;
    let request = DesktopProductControlRequest {
        method,
        request_bytes: request_bytes.clone(),
        timeout,
    };
    match control.invoke_product_control(request).await {
        Ok(response) => Ok(response.response_bytes),
        Err(error) if should_reconnect_reason(error.reason_code()) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await
                .map_err(host_call_error)?
                .invoke_product_control(DesktopProductControlRequest {
                    method,
                    request_bytes,
                    timeout,
                })
                .await
                .map(|response| response.response_bytes)
                .map_err(|error| protected_unary_error(error.reason_code()))
        }
        Err(error) => Err(protected_unary_error(error.reason_code())),
    }
}

async fn invoke_runtime_consumer(
    method: DesktopRuntimeConsumerMethod,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, String> {
    let control = control_for_call().await.map_err(host_call_error)?;
    let request = DesktopRuntimeConsumerRequest {
        method,
        request_bytes: request_bytes.clone(),
        timeout,
    };
    match control.invoke_runtime_consumer(request).await {
        Ok(response) => Ok(response.response_bytes),
        Err(error) if should_reconnect_reason(error.reason_code()) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await
                .map_err(host_call_error)?
                .invoke_runtime_consumer(DesktopRuntimeConsumerRequest {
                    method,
                    request_bytes,
                    timeout,
                })
                .await
                .map(|response| response.response_bytes)
                .map_err(|error| protected_unary_error(error.reason_code()))
        }
        Err(error) => Err(protected_unary_error(error.reason_code())),
    }
}

fn host_call_error(error: NimiHostError) -> String {
    protected_unary_error(error.reason_code().as_str())
}

fn protected_unary_error(reason_code: &str) -> String {
    bridge_error("RUNTIME_BRIDGE_TRANSPORT_UNAVAILABLE", reason_code)
}

fn should_reconnect_reason(reason_code: &str) -> bool {
    matches!(
        reason_code,
        "runtime-service-unavailable"
            | "runtime-service-untrusted"
            | "runtime-restarted"
            | "process-replaced"
            | "protected-carrier-required"
    )
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

pub(super) async fn get_local_development_authority_summary(
) -> Result<LocalDevelopmentAuthoritySummary, NimiHostError> {
    let control = control_for_call().await?;
    match control.get_local_development_authority_summary().await {
        Ok(value) => Ok(value),
        Err(error) if should_reconnect(error) => {
            clear_desktop_control_if_same(control).await;
            control_for_call()
                .await?
                .get_local_development_authority_summary()
                .await
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
    let _open_guard = DESKTOP_CONTROL_OPEN
        .get_or_init(|| AsyncMutex::new(()))
        .lock()
        .await;
    if let Ok(control) = desktop_control() {
        return Ok(control);
    }
    for attempt in 0..=INITIAL_CONTROL_OPEN_RETRY_DELAYS.len() {
        match PlatformCarrier::default().open_desktop_control().await {
            Ok(control) => {
                retain_desktop_control(control).map_err(NimiHostError::from)?;
                return desktop_control();
            }
            Err(error) => {
                let error = NimiHostError::from(error);
                let Some(delay) = INITIAL_CONTROL_OPEN_RETRY_DELAYS.get(attempt) else {
                    return Err(error);
                };
                if !should_retry_initial_control_open(error) {
                    return Err(error);
                }
                tokio::time::sleep(*delay).await;
            }
        }
    }
    unreachable!("initial control open retry loop always returns")
}

fn should_retry_initial_control_open(error: NimiHostError) -> bool {
    error.retryable()
        && error.reason_code()
            == nimi_shell_protected_local::NimiHostErrorReasonCode::RuntimeServiceUnavailable
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

#[cfg(any(target_os = "windows", target_os = "macos"))]
async fn invalidate_platform_desktop_runtime_channel() {
    invalidate_verified_desktop_runtime_channel().await;
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_control_open_retries_only_retryable_service_unavailable() {
        assert!(should_retry_initial_control_open(NimiHostError::new(
            NimiHostErrorReasonCode::RuntimeServiceUnavailable,
            true,
        )));
        assert!(!should_retry_initial_control_open(NimiHostError::new(
            NimiHostErrorReasonCode::RuntimeServiceUnavailable,
            false,
        )));
        assert!(!should_retry_initial_control_open(NimiHostError::new(
            NimiHostErrorReasonCode::RuntimeServiceUntrusted,
            true,
        )));
        assert!(!should_retry_initial_control_open(NimiHostError::new(
            NimiHostErrorReasonCode::ProtectedCarrierRequired,
            true,
        )));
    }
}
