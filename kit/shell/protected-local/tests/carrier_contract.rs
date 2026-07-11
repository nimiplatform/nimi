use nimi_shell_protected_local::{
    LinuxUnixSocketCarrier, MacOsPrivilegedXpcCarrier, NimiProtectedLocalHostCarrier,
    ProtectedCarrierReasonCode, RuntimeServiceAction, RuntimeServiceActionOutcome,
    RuntimeServiceState, RuntimeServiceStatus, WindowsNamedPipeCarrier,
};

fn assert_unbound<C: NimiProtectedLocalHostCarrier>(carrier: C) {
    for error in [
        carrier.runtime_service_status().unwrap_err(),
        carrier.request_runtime_service_start().unwrap_err(),
        carrier.request_runtime_service_restart().unwrap_err(),
        match carrier.open_desktop_control() {
            Ok(_) => panic!("unbound protected carrier must not open a desktop session"),
            Err(error) => error,
        },
    ] {
        assert_eq!(
            error.reason_code(),
            ProtectedCarrierReasonCode::ProtectedCarrierRequired
        );
        assert!(!error.retryable());
        assert_eq!(error.to_string(), "protected-carrier-required");
    }
}

#[test]
fn compile_only_os_adapters_fail_closed_when_unbound() {
    assert_unbound(WindowsNamedPipeCarrier);
    assert_unbound(LinuxUnixSocketCarrier);
    assert_unbound(MacOsPrivilegedXpcCarrier);
}

#[test]
fn service_control_vocabulary_has_no_stop_or_configuration_action() {
    assert_eq!(RuntimeServiceAction::Start.as_str(), "start");
    assert_eq!(RuntimeServiceAction::Restart.as_str(), "restart");
    assert_eq!(RuntimeServiceState::Stopped.as_str(), "stopped");
    assert_eq!(RuntimeServiceState::StartPending.as_str(), "start_pending");
    assert_eq!(RuntimeServiceState::Running.as_str(), "running");
    assert_eq!(
        RuntimeServiceState::RestartPending.as_str(),
        "restart_pending"
    );
    assert_eq!(RuntimeServiceState::Unavailable.as_str(), "unavailable");
}

#[test]
fn protected_service_reason_codes_are_stable_and_sanitized() {
    assert_eq!(
        ProtectedCarrierReasonCode::ProtectedCarrierRequired.as_str(),
        "protected-carrier-required"
    );
    assert_eq!(
        ProtectedCarrierReasonCode::RuntimeServiceUnavailable.as_str(),
        "runtime-service-unavailable"
    );
    assert_eq!(
        ProtectedCarrierReasonCode::RuntimeServiceUntrusted.as_str(),
        "runtime-service-untrusted"
    );
    assert_eq!(
        ProtectedCarrierReasonCode::RuntimeServiceRepairRequired.as_str(),
        "runtime-service-repair-required"
    );

    let status = RuntimeServiceStatus {
        state: RuntimeServiceState::Unavailable,
        release_id: None,
        reason_code: Some(ProtectedCarrierReasonCode::RuntimeServiceUnavailable),
        retryable: true,
    };
    let outcome = RuntimeServiceActionOutcome {
        state: RuntimeServiceState::Unavailable,
        release_id: None,
        reason_code: Some(ProtectedCarrierReasonCode::RuntimeServiceRepairRequired),
        retryable: false,
    };
    assert_eq!(
        status.reason_code,
        Some(ProtectedCarrierReasonCode::RuntimeServiceUnavailable)
    );
    assert_eq!(
        outcome.reason_code,
        Some(ProtectedCarrierReasonCode::RuntimeServiceRepairRequired)
    );
}
