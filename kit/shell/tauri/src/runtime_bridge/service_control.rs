#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use nimi_shell_protected_local::LinuxUnixSocketCarrier;
#[cfg(target_os = "macos")]
use nimi_shell_protected_local::MacOsPrivilegedXpcCarrier;
#[cfg(target_os = "windows")]
use nimi_shell_protected_local::WindowsNamedPipeCarrier;
use nimi_shell_protected_local::{
    FixedRuntimeServiceControl, InstalledAppLaunchOutcome, InstalledAppLaunchRequest,
    NimiDesktopControl, NimiProtectedLocalHostCarrier, ProtectedCarrierError,
    ProtectedCarrierReasonCode, RuntimeServiceAction, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};
use std::sync::{Arc, Mutex, OnceLock};

use super::{error_map::bridge_error, RuntimeBridgeDaemonStatus};

const PROTECTED_LOCAL_TRANSPORT_LABEL: &str = "protected-local";
const PROTECTED_LOCAL_LAUNCH_MODE: &str = "PROTECTED_LOCAL";
const UNAVAILABLE_LAUNCH_MODE: &str = "INVALID";

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

pub(super) fn request(action: RuntimeServiceAction) -> Result<RuntimeBridgeDaemonStatus, String> {
    let carrier = PlatformCarrier::default();
    let outcome = match action {
        RuntimeServiceAction::Start => carrier.request_runtime_service_start(),
        RuntimeServiceAction::Restart => carrier.request_runtime_service_restart(),
    }
    .map_err(carrier_error)?;
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

pub(super) async fn launch_installed_app(
    request: InstalledAppLaunchRequest,
) -> Result<InstalledAppLaunchOutcome, ProtectedCarrierError> {
    let control = DESKTOP_CONTROL
        .get()
        .and_then(|slot| slot.lock().ok())
        .and_then(|slot| slot.clone())
        .ok_or_else(|| {
            ProtectedCarrierError::new(ProtectedCarrierReasonCode::ProtectedCarrierRequired, false)
        })?;
    control.launch_installed_app(request).await
}
