#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use nimi_shell_protected_local::LinuxUnixSocketCarrier;
#[cfg(target_os = "macos")]
use nimi_shell_protected_local::MacOsPrivilegedXpcCarrier;
#[cfg(target_os = "windows")]
use nimi_shell_protected_local::WindowsNamedPipeCarrier;
use nimi_shell_protected_local::{
    FixedRuntimeServiceControl, ProtectedCarrierError, ProtectedCarrierReasonCode,
    RuntimeServiceAction, RuntimeServiceActionOutcome, RuntimeServiceState, RuntimeServiceStatus,
};

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

pub(super) fn status() -> RuntimeBridgeDaemonStatus {
    let carrier = PlatformCarrier::default();
    carrier
        .runtime_service_status()
        .map(status_projection)
        .unwrap_or_else(unavailable_status)
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
