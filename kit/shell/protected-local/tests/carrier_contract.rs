#[cfg(target_os = "macos")]
use nimi_shell_protected_local::MacOsUnixSocketCarrier;
#[cfg(not(target_os = "windows"))]
use nimi_shell_protected_local::WindowsLocalAppCarrier;
use nimi_shell_protected_local::{
    LinuxLocalAppCarrier, LinuxUnixSocketCarrier, LocalAppReasonCode, MacOsLocalAppCarrier,
    NimiLocalAppCarrier, NimiProtectedLocalHostCarrier, ProtectedCarrierReasonCode,
    RuntimeServiceAction, RuntimeServiceActionOutcome, RuntimeServiceState, RuntimeServiceStatus,
    WindowsNamedPipeCarrier,
};

async fn assert_unbound<C: NimiProtectedLocalHostCarrier>(carrier: C) {
    for error in [
        carrier.runtime_service_status().unwrap_err(),
        carrier.request_runtime_service_start().unwrap_err(),
        carrier.request_runtime_service_restart().await.unwrap_err(),
        match carrier.open_desktop_control().await {
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

async fn assert_local_app_unbound<C: NimiLocalAppCarrier>(carrier: C) {
    let error = match carrier.open_local_app_session().await {
        Ok(_) => panic!("unbound local-app carrier must not open a session"),
        Err(error) => error,
    };
    assert_eq!(
        error.reason_code(),
        LocalAppReasonCode::ProtectedCarrierRequired
    );
    assert!(!error.retryable());
}

#[tokio::test]
async fn compile_only_os_adapters_fail_closed_when_unbound() {
    assert_unbound(LinuxUnixSocketCarrier).await;
    #[cfg(not(target_os = "windows"))]
    assert_unbound(WindowsNamedPipeCarrier).await;

    assert_local_app_unbound(LinuxLocalAppCarrier).await;
    #[cfg(not(target_os = "macos"))]
    assert_local_app_unbound(MacOsLocalAppCarrier).await;
    #[cfg(not(target_os = "windows"))]
    assert_local_app_unbound(WindowsLocalAppCarrier).await;
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn macos_carrier_fails_closed_without_the_installed_signed_service() {
    let carrier = MacOsUnixSocketCarrier;
    let status = carrier.runtime_service_status();
    assert!(
        status.is_err() || status.is_ok_and(|value| value.state != RuntimeServiceState::Running)
    );
    let error = match carrier.open_desktop_control().await {
        Ok(_) => panic!("uninstalled macOS carrier must not open a Desktop session"),
        Err(error) => error,
    };
    assert!(matches!(
        error.reason_code(),
        ProtectedCarrierReasonCode::RuntimeServiceUnavailable
            | ProtectedCarrierReasonCode::RuntimeServiceUntrusted
            | ProtectedCarrierReasonCode::RuntimeServiceRepairRequired
    ));

    let local_error = match MacOsLocalAppCarrier.open_local_app_session().await {
        Ok(_) => panic!("uninstalled macOS local-app carrier must not open a session"),
        Err(error) => error,
    };
    assert!(matches!(
        local_error.reason_code(),
        LocalAppReasonCode::RuntimeServiceUnavailable
            | LocalAppReasonCode::RuntimeServiceUntrusted
            | LocalAppReasonCode::RuntimeServiceRepairRequired
    ));
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn windows_carrier_keeps_desktop_control_closed_until_peer_trust_is_bound() {
    let carrier = WindowsNamedPipeCarrier;
    let error = match carrier.open_desktop_control().await {
        Ok(_) => panic!("native peer verification is required"),
        Err(error) => error,
    };
    assert!(matches!(
        error.reason_code(),
        ProtectedCarrierReasonCode::RuntimeServiceUnavailable
            | ProtectedCarrierReasonCode::RuntimeServiceUntrusted
    ));
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
