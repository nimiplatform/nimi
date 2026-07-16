#![deny(unsafe_code)]

use napi_derive::napi;
use nimi_shell_protected_local::{
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse, DesktopAccountProjection,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse,
    DesktopAccountSessionStatusRequest, DesktopProductControlError, DesktopProductControlMethod,
    DesktopProductControlRequest, DesktopRuntimeConsumerMethod, DesktopRuntimeConsumerRequest,
    FixedRuntimeServiceControl, LocalAppAgentConversationSnapshotRequest,
    LocalAppAgentInventoryRequest, LocalAppAgentOpenConversationRequest,
    LocalAppAgentSendTurnRequest, LocalAppAgentSubscribeTurnRequest,
    LocalAppAgentSubscribeVoiceStreamRequest, LocalAppAgentTranscribeVoiceRequest,
    LocalAppAgentVoiceStreamPage, LocalAppArtifactBytes, LocalAppArtifactReadRequest,
    LocalAppGrantControlDecisionRequest, LocalAppGrantControlPending,
    LocalAppGrantControlProjection, LocalAppGrantControlState, LocalAppOperationError,
    LocalAppPermissionPosture, LocalAppPermissionPostureRequest, LocalAppPermissionRequest,
    LocalAppReasonCode, LocalAppSessionStatus, LocalAppStorageReadRequest,
    LocalAppStorageRemoveRequest, LocalAppStorageWriteRequest, LocalDevelopmentAuthorization,
    LocalDevelopmentDecision, LocalDevelopmentDecisionRequest, LocalDevelopmentEndRunRequest,
    LocalDevelopmentEvaluation, LocalDevelopmentEvaluationRequest, LocalDevelopmentLaunchRequest,
    LocalDevelopmentReactivationRequest, LocalDevelopmentShellKind, NimiDesktopControl,
    NimiHostError, NimiLocalAppCarrier, NimiLocalAppSession, NimiProtectedLocalHostCarrier,
    ProtectedCarrierError, RuntimeServiceActionOutcome, WindowsLocalAppCarrier,
    WindowsNamedPipeCarrier,
};
use serde_json::{json, Value as JsonValue};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::Mutex;

static LOCAL_APP_SESSION: Mutex<Option<Arc<dyn NimiLocalAppSession>>> = Mutex::const_new(None);
static DESKTOP_CONTROL: Mutex<Option<Arc<dyn NimiDesktopControl>>> = Mutex::const_new(None);

mod local_app;
mod native_types;
mod projection;
pub use local_app::*;
pub use native_types::*;
use projection::*;

#[napi(js_name = "desktopProductControlUnary")]
pub async fn desktop_product_control_unary(
    input: NativeDesktopProductControlInput,
) -> NativeBytesOutcome {
    let Some(method) = DesktopProductControlMethod::from_method_id(input.method_id.trim()) else {
        return NativeBytesOutcome::error("runtime-service-untrusted", false);
    };
    let timeout = input
        .timeout_ms
        .map(u64::from)
        .map(std::time::Duration::from_millis);
    if !desktop_product_control_timeout_allowed(method, timeout) {
        return NativeBytesOutcome::error("runtime-service-untrusted", false);
    }
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeBytesOutcome::host_error(error),
    };
    match control
        .invoke_product_control(DesktopProductControlRequest {
            method,
            request_bytes: input.request_bytes.to_vec(),
            timeout,
        })
        .await
    {
        Ok(response) => NativeBytesOutcome::success(response.response_bytes),
        Err(error) => {
            clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
            NativeBytesOutcome::product_control_error(error)
        }
    }
}

#[napi(js_name = "desktopRuntimeConsumerUnary")]
pub async fn desktop_runtime_consumer_unary(
    input: NativeDesktopRuntimeConsumerInput,
) -> NativeBytesOutcome {
    let Some(method) = DesktopRuntimeConsumerMethod::from_method_id(input.method_id.trim()) else {
        return NativeBytesOutcome::error("runtime-service-untrusted", false);
    };
    let timeout = input
        .timeout_ms
        .map(u64::from)
        .map(std::time::Duration::from_millis);
    if timeout.is_some_and(|value| value.is_zero() || value > std::time::Duration::from_secs(300)) {
        return NativeBytesOutcome::error("runtime-service-untrusted", false);
    }
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeBytesOutcome::host_error(error),
    };
    match control
        .invoke_runtime_consumer(DesktopRuntimeConsumerRequest {
            method,
            request_bytes: input.request_bytes.to_vec(),
            timeout,
        })
        .await
    {
        Ok(response) => NativeBytesOutcome::success(response.response_bytes),
        Err(error) => {
            clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
            NativeBytesOutcome::error(error.reason_code(), error.retryable())
        }
    }
}

fn desktop_product_control_timeout_allowed(
    method: DesktopProductControlMethod,
    timeout: Option<std::time::Duration>,
) -> bool {
    let maximum = if method == DesktopProductControlMethod::MintFirstRunExecutionEvidence {
        // One First Run mint performs the admitted text, STT, and TTS
        // executions serially. Their Runtime budgets total 255 seconds before
        // cold activation and carrier overhead, so the Desktop host's bounded
        // ten-minute deadline must remain admissible end to end.
        std::time::Duration::from_secs(600)
    } else {
        std::time::Duration::from_secs(300)
    };
    timeout.is_none_or(|value| !value.is_zero() && value <= maximum)
}

#[cfg(test)]
mod desktop_product_control_timeout_tests {
    use super::*;

    #[test]
    fn first_run_execution_mint_accepts_the_host_ten_minute_deadline() {
        assert!(desktop_product_control_timeout_allowed(
            DesktopProductControlMethod::MintFirstRunExecutionEvidence,
            Some(std::time::Duration::from_secs(600)),
        ));
    }

    #[test]
    fn ordinary_product_control_methods_keep_the_five_minute_bound() {
        assert!(!desktop_product_control_timeout_allowed(
            DesktopProductControlMethod::GetProductControlRecord,
            Some(std::time::Duration::from_secs(301)),
        ));
        assert!(!desktop_product_control_timeout_allowed(
            DesktopProductControlMethod::MintFirstRunExecutionEvidence,
            Some(std::time::Duration::from_secs(601)),
        ));
        assert!(!desktop_product_control_timeout_allowed(
            DesktopProductControlMethod::MintFirstRunExecutionEvidence,
            Some(std::time::Duration::ZERO),
        ));
    }
}

#[napi(js_name = "desktopAccountSessionStatus")]
pub async fn desktop_account_session_status() -> NativeJsonOutcome {
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeJsonOutcome::host_error(error),
    };
    match control
        .get_account_session_status(DesktopAccountSessionStatusRequest {
            app_id: "nimi.desktop".to_string(),
            app_instance_id: "nimi.desktop.local-first-party".to_string(),
            device_id: "desktop-shell".to_string(),
        })
        .await
    {
        Ok(status) => NativeJsonOutcome::success(json!({
            "state": status.state.as_str(),
            "accountProjection": status.account_projection.map(project_account_projection),
        })),
        Err(error) => {
            clear_desktop_control_on_host_failure(&control, &error).await;
            NativeJsonOutcome::host_error(error)
        }
    }
}

#[napi(js_name = "desktopAccountBeginLogin")]
pub async fn desktop_account_begin_login(
    input: NativeDesktopAccountBeginLoginInput,
) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .begin_account_login(DesktopAccountBeginLoginRequest {
                redirect_uri: input.redirect_uri,
                callback_origin: input.callback_origin,
                requested_scopes: input.requested_scopes,
                ttl_seconds: input.ttl_seconds,
            })
            .await
            .map(project_account_begin_login)
    })
    .await
}

#[napi(js_name = "desktopAccountCompleteLogin")]
pub async fn desktop_account_complete_login(
    input: NativeDesktopAccountCompleteLoginInput,
) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .complete_account_login(DesktopAccountCompleteLoginRequest {
                login_attempt_id: input.login_attempt_id,
                code: input.code,
                state: input.state,
                nonce: input.nonce,
                redirect_uri: input.redirect_uri,
                callback_origin: input.callback_origin,
            })
            .await
            .map(project_account_mutation)
    })
    .await
}

#[napi(js_name = "desktopAccountInvokeRealmUnary")]
pub async fn desktop_account_invoke_realm_unary(
    input: NativeDesktopAccountRealmUnaryInput,
) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .invoke_account_realm_unary(DesktopAccountRealmUnaryRequest {
                method_id: input.method_id,
                request_json: input.request_json,
                timeout_ms: input.timeout_ms,
                idempotency_key: input.idempotency_key,
            })
            .await
            .map(project_account_realm_unary)
    })
    .await
}

#[napi(js_name = "desktopAccountLogout")]
pub async fn desktop_account_logout(input: NativeDesktopAccountActionInput) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .logout_account(DesktopAccountActionRequest {
                reason: input.reason,
            })
            .await
            .map(project_account_mutation)
    })
    .await
}

#[napi(js_name = "desktopAccountSwitchAccount")]
pub async fn desktop_account_switch_account(
    input: NativeDesktopAccountActionInput,
) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .switch_account(DesktopAccountActionRequest {
                reason: input.reason,
            })
            .await
            .map(project_account_mutation)
    })
    .await
}

#[napi(js_name = "fixedRuntimeServiceStatus")]
pub async fn fixed_runtime_service_status() -> NativeJsonOutcome {
    match current_or_open_desktop_control().await {
        Ok(_) => NativeJsonOutcome::success(project_verified_runtime_service_running()),
        Err(error) => NativeJsonOutcome::host_error(error),
    }
}

#[napi(js_name = "fixedRuntimeServiceStart")]
pub async fn fixed_runtime_service_start() -> NativeJsonOutcome {
    if current_or_open_desktop_control().await.is_ok() {
        return NativeJsonOutcome::success(project_verified_runtime_service_running());
    }
    match WindowsNamedPipeCarrier.request_runtime_service_start() {
        Ok(outcome) => NativeJsonOutcome::success(project_runtime_service_action(outcome)),
        Err(error) => NativeJsonOutcome::protected_error(error),
    }
}

#[napi(js_name = "fixedRuntimeServiceRestart")]
pub async fn fixed_runtime_service_restart() -> NativeJsonOutcome {
    // Runtime admits one mutually verified Desktop pipe connection at a time.
    // Keep the owner slot locked across the restart so a concurrent renderer
    // status/product-control call cannot observe the old transport failure,
    // clear the slot, and win the replacement pipe before the restart verifier.
    let mut current = DESKTOP_CONTROL.lock().await;
    let control = match current.as_ref() {
        Some(control) => control.clone(),
        None => {
            let opened = match WindowsNamedPipeCarrier.open_desktop_control().await {
                Ok(opened) => opened,
                Err(error) => return NativeJsonOutcome::host_error(NimiHostError::from(error)),
            };
            let control = Arc::<dyn NimiDesktopControl>::from(opened);
            *current = Some(control.clone());
            control
        }
    };
    let result = control.request_runtime_service_restart().await;
    if current
        .as_ref()
        .is_some_and(|candidate| Arc::ptr_eq(candidate, &control))
    {
        *current = None;
    }
    drop(current);
    nimi_shell_protected_local::invalidate_verified_desktop_runtime_channel().await;
    match result {
        Ok(outcome) => NativeJsonOutcome::success(project_runtime_service_action(outcome)),
        Err(error) => NativeJsonOutcome::protected_error(error),
    }
}

#[napi(js_name = "desktopDeveloperModeStatus")]
pub async fn desktop_developer_mode_status() -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .get_developer_mode_status()
            .await
            .map(project_developer_mode_status)
    })
    .await
}

#[napi(js_name = "desktopDeveloperModeSet")]
pub async fn desktop_developer_mode_set(input: NativeDeveloperModeSetInput) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .set_developer_mode(input.enabled)
            .await
            .map(project_developer_mode_status)
    })
    .await
}

#[napi(js_name = "desktopPendingLocalAppGrant")]
pub async fn desktop_pending_local_app_grant() -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control.pending_local_app_grant().await.map(|pending| {
            pending
                .map(project_pending_local_app_grant)
                .unwrap_or(JsonValue::Null)
        })
    })
    .await
}

#[napi(js_name = "desktopDecideLocalAppGrant")]
pub async fn desktop_decide_local_app_grant(
    input: NativeLocalAppGrantDecisionInput,
) -> NativeJsonOutcome {
    let request_id = match decode_identifier(&input.request_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let presence_challenge_id = match decode_identifier(&input.presence_challenge_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .decide_local_app_grant(LocalAppGrantControlDecisionRequest {
                request_id,
                presence_challenge_id,
                approved: input.approved,
            })
            .await
            .map(project_local_app_grant)
    })
    .await
}

#[napi(js_name = "desktopRevokeLocalAppGrant")]
pub async fn desktop_revoke_local_app_grant(
    input: NativeLocalAppGrantRevokeInput,
) -> NativeJsonOutcome {
    let grant_id = match decode_identifier(&input.grant_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .revoke_local_app_grant(grant_id)
            .await
            .map(project_local_app_grant)
    })
    .await
}

#[napi(js_name = "desktopEvaluateLocalDevelopmentProject")]
pub async fn desktop_evaluate_local_development_project(
    input: NativeLocalDevelopmentEvaluateInput,
) -> NativeJsonOutcome {
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let shell_kind = match local_development_shell(&input.shell) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .evaluate_local_development_project(LocalDevelopmentEvaluationRequest {
                expected_app_id: input.expected_app_id,
                project_root: PathBuf::from(input.project_root),
                shell_kind,
                supervisor_run_id,
            })
            .await
            .map(project_local_development_evaluation)
    })
    .await
}

#[napi(js_name = "desktopDecideLocalDevelopmentProject")]
pub async fn desktop_decide_local_development_project(
    input: NativeLocalDevelopmentDecisionInput,
) -> NativeJsonOutcome {
    let evaluation_id = match decode_identifier(&input.evaluation_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let decision = match local_development_decision(&input.decision) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .decide_local_development_project(LocalDevelopmentDecisionRequest {
                evaluation_id,
                decision,
                risk_disclosure_acknowledged: input.risk_disclosure_acknowledged,
            })
            .await
            .map(project_local_development_authorization)
    })
    .await
}

#[napi(js_name = "desktopReactivateLocalDevelopmentProject")]
pub async fn desktop_reactivate_local_development_project(
    input: NativeLocalDevelopmentReactivationInput,
) -> NativeJsonOutcome {
    let authorization_id = match decode_identifier(&input.authorization_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .reactivate_local_development_project(LocalDevelopmentReactivationRequest {
                authorization_id,
                risk_disclosure_acknowledged: input.risk_disclosure_acknowledged,
            })
            .await
            .map(project_local_development_authorization)
    })
    .await
}

#[napi(js_name = "desktopListLocalDevelopmentAuthorizations")]
pub async fn desktop_list_local_development_authorizations() -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .list_local_development_authorizations()
            .await
            .map(|rows| {
                JsonValue::Array(
                    rows.into_iter()
                        .map(project_local_development_authorization)
                        .collect(),
                )
            })
    })
    .await
}

#[napi(js_name = "desktopRevokeLocalDevelopmentAuthorization")]
pub async fn desktop_revoke_local_development_authorization(
    input: NativeLocalDevelopmentAuthorizationInput,
) -> NativeJsonOutcome {
    let authorization_id = match decode_identifier(&input.authorization_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .revoke_local_development_authorization(authorization_id)
            .await
            .map(project_local_development_authorization)
    })
    .await
}

#[napi(js_name = "desktopLaunchLocalDevelopmentHost")]
pub async fn desktop_launch_local_development_host(
    input: NativeLocalDevelopmentLaunchInput,
) -> NativeJsonOutcome {
    let authorization_id = match decode_identifier(&input.authorization_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let shell_kind = match local_development_shell(&input.shell) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .launch_local_development_host(LocalDevelopmentLaunchRequest {
                authorization_id,
                supervisor_run_id,
                shell_kind,
                host_executable_path: PathBuf::from(input.host_executable_path),
                renderer_origin: input.renderer_origin,
                host_arguments: input.host_arguments,
                working_directory: PathBuf::from(input.working_directory),
            })
            .await
            .map(|outcome| {
                json!({
                    "processId": outcome.process_id,
                    "bindDeadlineUnixMs": outcome.bind_deadline_unix_ms,
                })
            })
    })
    .await
}

#[napi(js_name = "desktopLocalDevelopmentHostRunning")]
pub async fn desktop_local_development_host_running(
    input: NativeLocalDevelopmentRunInput,
) -> NativeJsonOutcome {
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeJsonOutcome::host_error(error),
    };
    match control.local_development_host_running(supervisor_run_id) {
        Ok(running) => NativeJsonOutcome::success(json!({ "running": running })),
        Err(error) => NativeJsonOutcome::host_error(error),
    }
}

#[napi(js_name = "desktopTerminateLocalDevelopmentHost")]
pub async fn desktop_terminate_local_development_host(
    input: NativeLocalDevelopmentRunInput,
) -> NativeJsonOutcome {
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeJsonOutcome::host_error(error),
    };
    match control.terminate_local_development_host(supervisor_run_id) {
        Ok(()) => NativeJsonOutcome::success(json!({ "terminated": true })),
        Err(error) => NativeJsonOutcome::host_error(error),
    }
}

#[napi(js_name = "desktopEndLocalDevelopmentRun")]
pub async fn desktop_end_local_development_run(
    input: NativeLocalDevelopmentEndRunInput,
) -> NativeJsonOutcome {
    let authorization_id = match decode_identifier(&input.authorization_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .end_local_development_run(LocalDevelopmentEndRunRequest {
                authorization_id,
                supervisor_run_id,
            })
            .await
            .map(|()| json!({ "ended": true }))
    })
    .await
}

async fn invoke_desktop_json<F, Fut>(operation: F) -> NativeJsonOutcome
where
    F: FnOnce(Arc<dyn NimiDesktopControl>) -> Fut,
    Fut: std::future::Future<Output = Result<JsonValue, NimiHostError>>,
{
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeJsonOutcome::host_error(error),
    };
    match operation(control.clone()).await {
        Ok(value) => NativeJsonOutcome::success(value),
        Err(error) => {
            clear_desktop_control_on_host_failure(&control, &error).await;
            NativeJsonOutcome::host_error(error)
        }
    }
}

async fn current_or_open_desktop_control() -> Result<Arc<dyn NimiDesktopControl>, NimiHostError> {
    let mut current = DESKTOP_CONTROL.lock().await;
    if let Some(control) = current.as_ref() {
        return Ok(control.clone());
    }
    let opened = WindowsNamedPipeCarrier
        .open_desktop_control()
        .await
        .map_err(NimiHostError::from)?;
    let control = Arc::<dyn NimiDesktopControl>::from(opened);
    *current = Some(control.clone());
    Ok(control)
}

async fn clear_desktop_control_on_transport_reason(
    control: &Arc<dyn NimiDesktopControl>,
    reason_code: &str,
) {
    if !matches!(
        reason_code,
        "runtime-service-unavailable"
            | "runtime-service-untrusted"
            | "runtime-service-repair-required"
            | "PRINCIPAL_UNAUTHORIZED"
            | "PROTECTED_ORIGIN_ROLE_MISMATCH"
    ) {
        return;
    }
    clear_desktop_control(control).await;
}

async fn clear_desktop_control_on_host_failure(
    control: &Arc<dyn NimiDesktopControl>,
    error: &NimiHostError,
) {
    if !matches!(
        error.reason_code().as_str(),
        "runtime-service-unavailable"
            | "runtime-service-untrusted"
            | "runtime-service-repair-required"
            | "principal-unauthorized"
    ) {
        return;
    }
    clear_desktop_control(control).await;
}

async fn clear_desktop_control(control: &Arc<dyn NimiDesktopControl>) {
    let removed = {
        let mut current = DESKTOP_CONTROL.lock().await;
        if current
            .as_ref()
            .is_some_and(|candidate| Arc::ptr_eq(candidate, control))
        {
            *current = None;
            true
        } else {
            false
        }
    };
    // A delayed failure from a stale pre-restart control must not invalidate a
    // newer verified session already installed by another caller.
    if removed {
        nimi_shell_protected_local::invalidate_verified_desktop_runtime_channel().await;
    }
}
