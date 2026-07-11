use std::ffi::OsStr;

use windows_service::service::{ServiceAccess, ServiceState};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

use crate::{
    FixedRuntimeServiceControl, NimiDesktopControl, NimiProtectedLocalHostCarrier,
    ProtectedCarrierError, ProtectedCarrierReasonCode, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus,
};

const RUNTIME_SERVICE_NAME: &str = "NimiRuntime";

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
        ServiceState::Running => Err(untrusted()),
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
        ServiceState::Running => Err(untrusted()),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scm_running_never_claims_protected_runtime_success() {
        let error = project_status(ServiceState::Running).expect_err("trust verification required");
        assert_eq!(
            error.reason_code(),
            ProtectedCarrierReasonCode::RuntimeServiceUntrusted
        );
        assert!(!error.retryable());
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
}
