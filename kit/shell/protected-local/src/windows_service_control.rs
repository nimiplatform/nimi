use std::ffi::OsStr;
use std::fs::{File, OpenOptions};
use std::os::windows::io::AsRawHandle;

use windows_service::service::{ServiceAccess, ServiceState};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;

use crate::{
    FixedRuntimeServiceControl, NimiDesktopControl, NimiProtectedLocalHostCarrier,
    ProtectedCarrierError, ProtectedCarrierReasonCode, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};

const RUNTIME_SERVICE_NAME: &str = "NimiRuntime";
const RUNTIME_PROTECTED_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-protected-v1";

#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsNamedPipeCarrier;

impl FixedRuntimeServiceControl for WindowsNamedPipeCarrier {
    fn runtime_service_status(&self) -> Result<RuntimeServiceStatus, ProtectedCarrierError> {
        let state = query_service_state(ServiceAccess::QUERY_STATUS)?;
        project_status(state)
    }

    fn request_runtime_service_start(
        &self,
    ) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
        let manager = service_manager()?;
        let service = manager
            .open_service(
                RUNTIME_SERVICE_NAME,
                ServiceAccess::QUERY_STATUS | ServiceAccess::START,
            )
            .map_err(|_| unavailable())?;
        let before = service.query_status().map_err(|_| unavailable())?;
        match before.current_state {
            ServiceState::Stopped => {
                service.start(&[] as &[&OsStr]).map_err(|_| unavailable())?;
                let after = service.query_status().map_err(|_| unavailable())?;
                project_start_outcome(after.current_state)
            }
            state => project_start_outcome(state),
        }
    }

    fn request_runtime_service_restart(
        &self,
    ) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
        // Restart is never SCM stop/start. It requires an already verified
        // protected Runtime connection to request self-exit, followed by SCM
        // recovery and a new PID/boot-epoch handshake.
        Err(ProtectedCarrierError::new(
            ProtectedCarrierReasonCode::ProtectedCarrierRequired,
            false,
        ))
    }
}

impl NimiProtectedLocalHostCarrier for WindowsNamedPipeCarrier {
    fn open_desktop_control(&self) -> Result<Box<dyn NimiDesktopControl>, ProtectedCarrierError> {
        // An SCM observation is not transport authority. Named-pipe peer and
        // release verification plus OpenDesktopSession are the next slice.
        Err(ProtectedCarrierError::new(
            ProtectedCarrierReasonCode::ProtectedCarrierRequired,
            false,
        ))
    }
}

fn service_manager() -> Result<ServiceManager, ProtectedCarrierError> {
    ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .map_err(|_| unavailable())
}

fn query_service_state(access: ServiceAccess) -> Result<ServiceState, ProtectedCarrierError> {
    let manager = service_manager()?;
    let service = manager
        .open_service(RUNTIME_SERVICE_NAME, access)
        .map_err(|_| unavailable())?;
    service
        .query_status()
        .map(|status| status.current_state)
        .map_err(|_| unavailable())
}

fn project_status(state: ServiceState) -> Result<RuntimeServiceStatus, ProtectedCarrierError> {
    match state {
        ServiceState::Stopped => Ok(RuntimeServiceStatus {
            state: RuntimeServiceState::Stopped,
            release_id: None,
            reason_code: None,
            retryable: false,
        }),
        ServiceState::StartPending => Ok(RuntimeServiceStatus {
            state: RuntimeServiceState::StartPending,
            release_id: None,
            reason_code: None,
            retryable: true,
        }),
        ServiceState::Running => {
            verify_fixed_pipe_scm_binding()?;
            // PID/service binding alone is insufficient. Exact locked-file,
            // Authenticode, signed release-record and OpenDesktopSession
            // verification must all succeed before Running is projected.
            Err(untrusted())
        }
        _ => Err(repair_required()),
    }
}

fn project_start_outcome(
    state: ServiceState,
) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
    match state {
        ServiceState::StartPending => Ok(RuntimeServiceActionOutcome {
            state: RuntimeServiceState::StartPending,
            release_id: None,
            reason_code: None,
            retryable: true,
        }),
        ServiceState::Running => {
            verify_fixed_pipe_scm_binding()?;
            Err(untrusted())
        }
        ServiceState::Stopped => Err(unavailable()),
        _ => Err(repair_required()),
    }
}

fn unavailable() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUnavailable, true)
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}

fn repair_required() -> ProtectedCarrierError {
    ProtectedCarrierError::new(
        ProtectedCarrierReasonCode::RuntimeServiceRepairRequired,
        false,
    )
}

fn verify_fixed_pipe_scm_binding() -> Result<(), ProtectedCarrierError> {
    let before = query_service_status()?;
    let expected_pid = running_service_pid(&before)?;
    let pipe = open_fixed_runtime_pipe()?;
    let pipe_server_pid = named_pipe_server_pid(&pipe)?;
    let after = query_service_status()?;
    let observed_pid = running_service_pid(&after)?;
    validate_stable_server_binding(expected_pid, observed_pid, pipe_server_pid)
}

fn query_service_status() -> Result<windows_service::service::ServiceStatus, ProtectedCarrierError>
{
    let manager = service_manager()?;
    let service = manager
        .open_service(RUNTIME_SERVICE_NAME, ServiceAccess::QUERY_STATUS)
        .map_err(|_| unavailable())?;
    service.query_status().map_err(|_| unavailable())
}

fn running_service_pid(
    status: &windows_service::service::ServiceStatus,
) -> Result<u32, ProtectedCarrierError> {
    if status.current_state != ServiceState::Running {
        return Err(unavailable());
    }
    status
        .process_id
        .filter(|pid| *pid != 0)
        .ok_or_else(untrusted)
}

fn open_fixed_runtime_pipe() -> Result<File, ProtectedCarrierError> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(RUNTIME_PROTECTED_PIPE_NAME)
        .map_err(|_| unavailable())
}

fn named_pipe_server_pid(pipe: &File) -> Result<u32, ProtectedCarrierError> {
    let handle = pipe.as_raw_handle() as HANDLE;
    if handle.is_null() {
        return Err(untrusted());
    }
    let mut pid = 0u32;
    // SAFETY: `handle` is borrowed from a live `File`, the output pointer is
    // valid for one u32, and neither value escapes this call.
    let succeeded = unsafe { GetNamedPipeServerProcessId(handle, &mut pid) };
    if succeeded == 0 || pid == 0 {
        return Err(untrusted());
    }
    Ok(pid)
}

fn validate_stable_server_binding(
    before_pid: u32,
    after_pid: u32,
    pipe_server_pid: u32,
) -> Result<(), ProtectedCarrierError> {
    if before_pid == 0
        || after_pid == 0
        || pipe_server_pid == 0
        || before_pid != after_pid
        || before_pid != pipe_server_pid
    {
        return Err(untrusted());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scm_running_never_claims_protected_runtime_success() {
        let error = project_status(ServiceState::Running).expect_err("trust verification required");
        assert!(matches!(
            error.reason_code(),
            ProtectedCarrierReasonCode::RuntimeServiceUnavailable
                | ProtectedCarrierReasonCode::RuntimeServiceUntrusted
        ));
    }

    #[test]
    fn scm_start_pending_is_an_honest_retryable_projection() {
        let status = project_status(ServiceState::StartPending).expect("start pending");
        assert_eq!(status.state, RuntimeServiceState::StartPending);
        assert!(status.retryable);

        let outcome = project_start_outcome(ServiceState::StartPending).expect("start pending");
        assert_eq!(outcome.state, RuntimeServiceState::StartPending);
        assert!(outcome.retryable);
    }

    #[test]
    fn scm_stop_or_pause_states_require_repair() {
        for state in [
            ServiceState::StopPending,
            ServiceState::PausePending,
            ServiceState::Paused,
            ServiceState::ContinuePending,
        ] {
            let error = project_status(state).expect_err("repair required");
            assert_eq!(
                error.reason_code(),
                ProtectedCarrierReasonCode::RuntimeServiceRepairRequired
            );
        }
    }

    #[test]
    fn pipe_server_pid_must_match_two_stable_scm_snapshots() {
        assert!(validate_stable_server_binding(41, 41, 41).is_ok());
        for (before, after, pipe) in [(0, 41, 41), (41, 0, 41), (41, 42, 41), (41, 41, 42)] {
            let error = validate_stable_server_binding(before, after, pipe)
                .expect_err("unstable or mismatched service binding");
            assert_eq!(
                error.reason_code(),
                ProtectedCarrierReasonCode::RuntimeServiceUntrusted
            );
        }
    }
}
