#[test]
fn product_control_account_resolution_uses_admitted_desktop_caller() {
    let caller = super::product_control_runtime_account_caller();
    assert_eq!(caller.app_id, "nimi.desktop");
    assert_eq!(caller.app_instance_id, "nimi.desktop.local-first-party");
    assert_eq!(caller.device_id, "desktop-shell");
    assert_eq!(
        caller.mode,
        crate::runtime_bridge::generated::AccountCallerMode::DesktopShell as i32
    );
}

#[test]
fn product_control_account_registration_uses_same_admitted_desktop_caller() {
    let caller = super::product_control_runtime_account_caller();
    let request = super::product_control_runtime_app_registration_request(&caller);

    assert_eq!(request.app_id, "nimi.desktop");
    assert_eq!(request.app_instance_id, "nimi.desktop.local-first-party");
    assert_eq!(request.device_id, "desktop-shell");
    assert_eq!(request.app_version, "1");
    assert!(request.capabilities.is_empty());

    let mode = request.mode_manifest.expect("mode manifest");
    assert_eq!(
        mode.app_mode,
        crate::runtime_bridge::generated::AppMode::Full as i32
    );
    assert!(mode.runtime_required);
    assert!(mode.realm_required);
    assert_eq!(
        mode.world_relation,
        crate::runtime_bridge::generated::WorldRelation::None as i32
    );
}

#[test]
fn account_status_rejection_reports_runtime_reason_codes() {
    let caller = super::product_control_runtime_account_caller();
    let response = crate::runtime_bridge::generated::GetAccountSessionStatusResponse {
        state: crate::runtime_bridge::generated::AccountSessionState::Authenticated as i32,
        account_projection: None,
        reason_code: crate::runtime_bridge::generated::ReasonCode::PrincipalUnauthorized as i32,
        account_reason_code: crate::runtime_bridge::generated::AccountReasonCode::CallerUnauthorized
            as i32,
        production_inert: false,
    };

    let message =
        super::runtime_account_status_rejection_error(&response, &caller).expect("rejection");

    assert!(message.contains("app_id=nimi.desktop"));
    assert!(message.contains("app_instance_id=nimi.desktop.local-first-party"));
    assert!(message.contains("reason_code=PRINCIPAL_UNAUTHORIZED"));
    assert!(message.contains("account_reason_code=ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED"));
}

#[test]
fn account_status_action_executed_is_not_rejection() {
    let caller = super::product_control_runtime_account_caller();
    let response = crate::runtime_bridge::generated::GetAccountSessionStatusResponse {
        state: crate::runtime_bridge::generated::AccountSessionState::Anonymous as i32,
        account_projection: None,
        reason_code: crate::runtime_bridge::generated::ReasonCode::ActionExecuted as i32,
        account_reason_code: crate::runtime_bridge::generated::AccountReasonCode::ActionExecuted
            as i32,
        production_inert: false,
    };

    assert!(super::runtime_account_status_rejection_error(&response, &caller).is_none());
}

#[test]
fn stale_first_run_evidence_refs_are_reminted_during_prepare() {
    assert!(super::should_remint_runtime_baseline_ref(
        "local_ai_profile_selected_environment_not_ready",
        "RUNTIME_BASELINE_READINESS_REF_BINDING_MISMATCH",
    ));
    assert!(super::should_remint_execution_evidence_ref(
        "blocked",
        "FIRST_RUN_EXECUTION_EVIDENCE_REF_BINDING_MISMATCH",
    ));
    assert!(super::should_remint_execution_evidence_ref(
        "blocked",
        "FIRST_RUN_EXECUTION_EVIDENCE_BASELINE_NOT_READY",
    ));
}

#[test]
fn non_stale_first_run_evidence_failures_still_fail_closed() {
    assert!(!super::should_remint_runtime_baseline_ref(
        "repair_required",
        "RUNTIME_BASELINE_READINESS_REPAIR_REQUIRED",
    ));
    assert!(!super::should_remint_execution_evidence_ref(
        "blocked",
        "FIRST_RUN_EXECUTION_EVIDENCE_EXECUTION_FAILED",
    ));
    assert!(!super::should_remint_runtime_baseline_ref(
        "ready",
        "RUNTIME_BASELINE_READINESS_READY",
    ));
}
