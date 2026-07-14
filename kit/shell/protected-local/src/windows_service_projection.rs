use super::*;

pub(super) fn project_status(
    state: ServiceState,
) -> Result<RuntimeServiceStatus, ProtectedCarrierError> {
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
            // SCM/PID binding alone is insufficient; OpenDesktopSession must also succeed.
            Err(untrusted())
        }
        _ => Err(repair_required()),
    }
}

pub(super) fn project_start_outcome(
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
