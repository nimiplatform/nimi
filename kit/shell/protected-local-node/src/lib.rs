#![deny(unsafe_code)]

use napi_derive::napi;
use nimi_shell_protected_local::{
    BundledAvatarRuntimeRequest, DesktopAccountActionRequest, DesktopAccountBeginLoginRequest,
    DesktopAccountBeginLoginResponse, DesktopAccountCompleteLoginRequest,
    DesktopAccountMutationResponse, DesktopAccountProductUnaryMethod,
    DesktopAccountProductUnaryRequest, DesktopAccountProjection, DesktopAccountRealmUnaryRequest,
    DesktopAccountRealmUnaryResponse, DesktopAccountSessionEvent,
    DesktopAccountSessionStatusRequest, DesktopMachineProductUnaryMethod,
    DesktopMachineProductUnaryRequest, FixedRuntimeServiceControl,
    LocalAppAIConfigOverwriteRequest, LocalAppAgentCommitPresentationRequest,
    LocalAppAgentHandleRequest, LocalAppAgentUpdateAutonomyRequest, LocalAppArtifactPutRequest,
    LocalAppArtifactReadRequest, LocalAppConversationEvent, LocalAppConversationInterruptRequest,
    LocalAppConversationOpenRequest, LocalAppConversationSendRequest,
    LocalAppConversationSnapshotRequest, LocalAppConversationSubscribeRequest,
    LocalAppConversationSubscriptionReceiver, LocalAppOperationError, LocalAppReasonCode,
    LocalAppSessionStatus, LocalAppSharedAgentAIConfigOverwriteRequest,
    LocalAppSharedAgentAIProfileRequest, LocalAppStorageReadRequest, LocalAppStorageRemoveRequest,
    LocalAppStorageWriteRequest, LocalAppTextCandidateMessage, LocalAppTextCandidateRequest,
    LocalAppWorldCoreCreateRequest, LocalAppWorldCoreListRequest, LocalDevelopmentEndRunRequest,
    LocalDevelopmentLaunchRequest, LocalDevelopmentRegistration,
    LocalDevelopmentRegistrationRequest, LocalDevelopmentShellKind, NimiDesktopControl,
    NimiHostError, NimiLocalAppCarrier, NimiLocalAppSession, NimiProtectedLocalHostCarrier,
    ProtectedCarrierError, RuntimeServiceActionOutcome,
};
#[cfg(target_os = "macos")]
use nimi_shell_protected_local::{MacOsLocalAppCarrier, MacOsUnixSocketCarrier};
#[cfg(target_os = "windows")]
use nimi_shell_protected_local::{WindowsLocalAppCarrier, WindowsNamedPipeCarrier};
use serde_json::{json, Value as JsonValue};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::Mutex;

static LOCAL_APP_SESSION: Mutex<Option<Arc<dyn NimiLocalAppSession>>> = Mutex::const_new(None);
static DESKTOP_CONTROL: Mutex<Option<Arc<dyn NimiDesktopControl>>> = Mutex::const_new(None);

#[cfg(target_os = "macos")]
type PlatformDesktopCarrier = MacOsUnixSocketCarrier;
#[cfg(target_os = "windows")]
type PlatformDesktopCarrier = WindowsNamedPipeCarrier;
#[cfg(target_os = "macos")]
type PlatformLocalAppCarrier = MacOsLocalAppCarrier;
#[cfg(target_os = "windows")]
type PlatformLocalAppCarrier = WindowsLocalAppCarrier;

mod account_events;
mod bundled_avatar_streams;
mod first_party_streams;
mod local_app;
mod native_types;
mod projection;
pub use account_events::*;
pub use bundled_avatar_streams::*;
pub use first_party_streams::*;
pub use local_app::*;
pub use native_types::*;
use projection::*;

#[napi(js_name = "desktopMachineProductUnary")]
pub async fn desktop_machine_product_unary(
    input: NativeFirstPartyProductInput,
) -> NativeBytesOutcome {
    let Some(method) = DesktopMachineProductUnaryMethod::from_method_id(input.method_id.trim())
    else {
        return NativeBytesOutcome::error("runtime-service-untrusted", false);
    };
    let timeout = input
        .timeout_ms
        .map(u64::from)
        .map(std::time::Duration::from_millis);
    if !machine_product_timeout_allowed(method, timeout) {
        return NativeBytesOutcome::error("runtime-service-untrusted", false);
    }
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeBytesOutcome::host_error(error),
    };
    match control
        .invoke_machine_product_unary(DesktopMachineProductUnaryRequest {
            method,
            request_bytes: input.request_bytes.to_vec(),
            timeout,
        })
        .await
    {
        Ok(response) => NativeBytesOutcome::success(response.response_bytes),
        Err(error) => {
            clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
            NativeBytesOutcome::error_with_metadata(
                error.reason_code(),
                error.retryable(),
                error.reason_metadata(),
            )
        }
    }
}

#[napi(js_name = "desktopAccountProductUnary")]
pub async fn desktop_account_product_unary(
    input: NativeFirstPartyProductInput,
) -> NativeBytesOutcome {
    let Some(method) = DesktopAccountProductUnaryMethod::from_method_id(input.method_id.trim())
    else {
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
        .invoke_account_product_unary(DesktopAccountProductUnaryRequest {
            method,
            request_bytes: input.request_bytes.to_vec(),
            timeout,
        })
        .await
    {
        Ok(response) => NativeBytesOutcome::success(response.response_bytes),
        Err(error) => {
            clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
            NativeBytesOutcome::error_with_metadata(
                error.reason_code(),
                error.retryable(),
                error.reason_metadata(),
            )
        }
    }
}

#[napi(js_name = "desktopBundledAvatarUnary")]
pub async fn desktop_bundled_avatar_unary(
    input: NativeBundledAvatarRuntimeInput,
) -> NativeBytesOutcome {
    let timeout = input
        .timeout_ms
        .map(u64::from)
        .map(std::time::Duration::from_millis);
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeBytesOutcome::host_error(error),
    };
    match control
        .invoke_bundled_avatar(BundledAvatarRuntimeRequest {
            method_id: input.method_id,
            request_bytes: input.request_bytes.to_vec(),
            timeout,
        })
        .await
    {
        Ok(response) => NativeBytesOutcome::success(response.response_bytes),
        Err(error) => {
            clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
            NativeBytesOutcome::error_with_metadata(
                error.reason_code(),
                error.retryable(),
                error.reason_metadata(),
            )
        }
    }
}

fn machine_product_timeout_allowed(
    _method: DesktopMachineProductUnaryMethod,
    timeout: Option<std::time::Duration>,
) -> bool {
    let maximum = std::time::Duration::from_secs(300);
    timeout.is_none_or(|value| !value.is_zero() && value <= maximum)
}

#[cfg(test)]
mod first_party_product_timeout_tests {
    use super::*;

    #[test]
    fn machine_product_methods_keep_the_five_minute_bound() {
        assert!(machine_product_timeout_allowed(
            DesktopMachineProductUnaryMethod::GetProductControlRecord,
            Some(std::time::Duration::from_secs(300)),
        ));
        assert!(!machine_product_timeout_allowed(
            DesktopMachineProductUnaryMethod::GetProductControlRecord,
            Some(std::time::Duration::from_secs(301)),
        ));
        assert!(!machine_product_timeout_allowed(
            DesktopMachineProductUnaryMethod::GetProductControlRecord,
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
            "sequence": status.sequence.to_string(),
            "state": status.state.as_str(),
            "reasonCode": status.reason_code,
            "accountReasonCode": status.account_reason_code,
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
    match PlatformDesktopCarrier::default().request_runtime_service_start() {
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
            let opened = match PlatformDesktopCarrier::default()
                .open_desktop_control()
                .await
            {
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
    account_events::close_all_account_event_streams().await;
    bundled_avatar_streams::close_all_bundled_avatar_streams().await;
    first_party_streams::close_all_first_party_product_streams().await;
    #[cfg(target_os = "windows")]
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

#[napi(js_name = "desktopRegisterLocalDevelopmentProject")]
pub async fn desktop_register_local_development_project(
    input: NativeLocalDevelopmentRegisterInput,
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
            .register_local_development_project(LocalDevelopmentRegistrationRequest {
                expected_app_id: input.expected_app_id,
                project_root: PathBuf::from(input.project_root),
                shell_kind,
                supervisor_run_id,
            })
            .await
            .map(project_local_development_registration)
    })
    .await
}

#[napi(js_name = "desktopListLocalDevelopmentRegistrations")]
pub async fn desktop_list_local_development_registrations() -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .list_local_development_registrations()
            .await
            .map(|rows| {
                JsonValue::Array(
                    rows.into_iter()
                        .map(project_local_development_registration)
                        .collect(),
                )
            })
    })
    .await
}

#[napi(js_name = "desktopRemoveLocalDevelopmentRegistration")]
pub async fn desktop_remove_local_development_registration(
    input: NativeLocalDevelopmentRegistrationInput,
) -> NativeJsonOutcome {
    let registration_handle = match decode_identifier(&input.registration_handle) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .remove_local_development_registration(registration_handle)
            .await
            .map(|()| json!({ "removed": true }))
    })
    .await
}

#[napi(js_name = "desktopLaunchLocalDevelopmentHost")]
pub async fn desktop_launch_local_development_host(
    input: NativeLocalDevelopmentLaunchInput,
) -> NativeJsonOutcome {
    let registration_handle = match decode_identifier(&input.registration_handle) {
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
                registration_handle,
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
        Err(error) => {
            clear_desktop_control_on_host_failure(&control, &error).await;
            NativeJsonOutcome::host_error(error)
        }
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
    let registration_handle = match decode_identifier(&input.registration_handle) {
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
                registration_handle,
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
    let opened = PlatformDesktopCarrier::default()
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
    if !invalidates_desktop_transport(reason_code) {
        return;
    }
    clear_desktop_control(control).await;
}

async fn clear_desktop_control_on_host_failure(
    control: &Arc<dyn NimiDesktopControl>,
    error: &NimiHostError,
) {
    if !invalidates_desktop_transport(error.reason_code().as_str()) {
        return;
    }
    clear_desktop_control(control).await;
}

fn invalidates_desktop_transport(reason_code: &str) -> bool {
    matches!(
        reason_code,
        "runtime-service-unavailable"
            | "runtime-service-untrusted"
            | "runtime-service-repair-required"
            | "runtime-restarted"
            | "process-replaced"
            | "PROTECTED_ORIGIN_ROLE_MISMATCH"
    )
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
        account_events::close_all_account_event_streams().await;
        bundled_avatar_streams::close_all_bundled_avatar_streams().await;
        first_party_streams::close_all_first_party_product_streams().await;
        #[cfg(target_os = "windows")]
        nimi_shell_protected_local::invalidate_verified_desktop_runtime_channel().await;
    }
}

#[cfg(test)]
mod desktop_transport_invalidation_tests {
    use super::invalidates_desktop_transport;

    #[test]
    fn invalidates_only_transport_or_verified_origin_failures() {
        for reason in [
            "runtime-service-unavailable",
            "runtime-service-untrusted",
            "runtime-service-repair-required",
            "runtime-restarted",
            "process-replaced",
            "PROTECTED_ORIGIN_ROLE_MISMATCH",
        ] {
            assert!(invalidates_desktop_transport(reason), "{reason}");
        }
    }

    #[test]
    fn account_and_local_development_results_never_poison_the_verified_channel() {
        for reason in [
            "principal-unauthorized",
            "account-changed",
            "local-development-project-changed",
            "local-development-supervisor-required",
            "local-development-session-revoked",
            "local-app-developer-mode-disabled",
            "local-app-presence-required",
            "local-app-presence-expired",
            "local-app-operation-unavailable",
            "PRINCIPAL_UNAUTHORIZED",
            "AUTH_TOKEN_INVALID",
            "BROKER_FORBIDDEN",
            "REALM_UNAVAILABLE",
        ] {
            assert!(!invalidates_desktop_transport(reason), "{reason}");
        }
    }
}
