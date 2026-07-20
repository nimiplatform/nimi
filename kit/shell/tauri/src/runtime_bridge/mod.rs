mod account_events;
mod channel_pool;
mod codec;
mod daemon_manager;
mod desktop_account;
mod error_map;
mod host_app_session;
mod local_app;
mod metadata;
mod service_control;
mod stream;
mod unary;

use serde::{Deserialize, Serialize};
use std::fmt;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::AppHandle;

pub use account_events::{
    RuntimeBridgeAccountEventsClosePayload, RuntimeBridgeAccountEventsCloseResult,
    RuntimeBridgeAccountEventsOpenPayload, RuntimeBridgeAccountEventsOpenResult,
};
pub use daemon_manager::http_addr;
pub use desktop_account::{
    begin_login as begin_desktop_account_login, complete_login as complete_desktop_account_login,
    invoke_realm_unary as invoke_desktop_account_realm_unary, logout as logout_desktop_account,
    switch_account as switch_desktop_account, RuntimeBridgeDesktopAccountActionRequest,
    RuntimeBridgeDesktopAccountBeginLoginRequest, RuntimeBridgeDesktopAccountBeginLoginResponse,
    RuntimeBridgeDesktopAccountCompleteLoginRequest, RuntimeBridgeDesktopAccountMutationResponse,
    RuntimeBridgeDesktopAccountRealmUnaryRequest, RuntimeBridgeDesktopAccountRealmUnaryResponse,
};
pub use error_map::bridge_error;
pub use host_app_session::{
    RuntimeBridgeHostAppSessionConfig, RuntimeBridgeHostAppSessionProvider,
    RUNTIME_BRIDGE_TAURI_STANDARD_SHELL_SOURCE_HOST,
};
pub use local_app::RuntimeBridgeLocalAppHost;
pub use metadata::{RuntimeBridgeMetadata, RuntimeBridgeTrustedMetadata};
pub use nimi_shell_protected_local::{
    DesktopAccountSessionStatusRequest, DeveloperModeState, DeveloperModeStatus,
    LocalDevelopmentAuthoritySummary, LocalDevelopmentAuthorization,
    LocalDevelopmentAuthorizationState, LocalDevelopmentDecision, LocalDevelopmentDecisionRequest,
    LocalDevelopmentDeveloperModeSummary, LocalDevelopmentEndRunRequest,
    LocalDevelopmentEvaluation, LocalDevelopmentEvaluationRequest, LocalDevelopmentLaunchOutcome,
    LocalDevelopmentLaunchRequest, LocalDevelopmentProject,
    LocalDevelopmentProjectAuthorizationSummary, LocalDevelopmentShellKind,
    LocalDevelopmentSummaryAvailability, NimiHostError, NimiHostErrorReasonCode,
};
pub use stream::RuntimeBridgeStreamOpenResult;
pub use unary::{
    build_unary_payload, build_unary_payload_with_metadata, decode_unary_result,
    invoke_unary_typed, invoke_unary_typed_with_metadata, RuntimeBridgeUnaryResult,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeDaemonStatus {
    pub running: bool,
    pub managed: bool,
    pub launch_mode: String,
    pub grpc_addr: String,
    pub pid: Option<u32>,
    pub version: Option<String>,
    pub last_error: Option<String>,
    pub debug_log_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeDesktopAccountProjection {
    pub account_id: String,
    pub display_name: String,
    pub realm_environment_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeDesktopAccountSessionStatus {
    pub sequence: String,
    pub state: String,
    pub reason_code: i32,
    pub account_reason_code: i32,
    pub account_projection: Option<RuntimeBridgeDesktopAccountProjection>,
}

#[allow(clippy::all, dead_code)]
pub mod generated {
    include!("generated/nimi.runtime.v1.rs");
}

pub mod generated_method_ids {
    include!("generated/method_ids.rs");
}

pub const RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus";
pub const RUNTIME_AUTH_REGISTER_APP_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAuthService/RegisterApp";
pub const RUNTIME_LOCAL_COLLECT_DEVICE_PROFILE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/CollectDeviceProfile";
pub const RUNTIME_LOCAL_RESOLVE_LOCAL_ENVIRONMENT_PLAN_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/ResolveLocalEnvironmentPlan";
pub const RUNTIME_LOCAL_LIST_LOCAL_ENVIRONMENT_DEPENDENCY_JOBS_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/ListLocalEnvironmentDependencyJobs";
pub const RUNTIME_LOCAL_START_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/StartLocalEnvironmentDependencyJob";
pub const RUNTIME_LOCAL_CANCEL_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/CancelLocalEnvironmentDependencyJob";
pub const RUNTIME_LOCAL_RETRY_LOCAL_ENVIRONMENT_DEPENDENCY_JOB_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/RetryLocalEnvironmentDependencyJob";
pub const RUNTIME_LOCAL_REPAIR_LOCAL_ENVIRONMENT_DEPENDENCY_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/RepairLocalEnvironmentDependency";
pub const RUNTIME_LOCAL_RESOLVE_RUNTIME_BASELINE_READINESS_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/ResolveRuntimeBaselineReadiness";
pub const RUNTIME_LOCAL_MINT_RUNTIME_BASELINE_READINESS_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/MintRuntimeBaselineReadiness";
pub const RUNTIME_LOCAL_RESOLVE_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/ResolveFirstRunExecutionEvidence";
pub const RUNTIME_LOCAL_MINT_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/MintFirstRunExecutionEvidence";
pub const RUNTIME_LOCAL_GET_PRODUCT_CONTROL_RECORD_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord";
pub const RUNTIME_LOCAL_GET_PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot";
pub const RUNTIME_LOCAL_ENSURE_PRODUCT_CONTROL_RECORD_CREATED_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated";
pub const RUNTIME_LOCAL_SELECT_PRODUCT_CONTROL_DATA_ROOT_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot";
pub const RUNTIME_LOCAL_SET_PRODUCT_CONTROL_FIRST_RUN_INSTALL_LEVEL_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/SetProductControlFirstRunInstallLevel";
pub const RUNTIME_LOCAL_COMPLETE_PRODUCT_CONTROL_FIRST_RUN_DEVICE_ENVIRONMENT_SCAN_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/CompleteProductControlFirstRunDeviceEnvironmentScan";
pub const RUNTIME_LOCAL_ADMIT_PRODUCT_CONTROL_READY_FOR_USE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/AdmitProductControlReadyForUse";
pub const RUNTIME_LOCAL_RECORD_PRODUCT_CONTROL_ACCOUNT_DEFAULT_PROFILE_EVIDENCE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/RecordProductControlAccountDefaultProfileEvidence";
pub const RUNTIME_LOCAL_RECORD_PRODUCT_CONTROL_FIRST_RUN_LOCAL_AI_READY_EVIDENCE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/RecordProductControlFirstRunLocalAiReadyEvidence";
pub const RUNTIME_LOCAL_RECONCILE_PRODUCT_CONTROL_FIRST_RUN_SETUP_STATE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState";
pub const RUNTIME_APP_GET_APP_STORAGE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAppService/GetAppStorage";
pub const RUNTIME_APP_GET_ACCOUNT_APP_INVENTORY_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAppService/GetAccountAppInventory";
pub const RUNTIME_APP_GET_APP_PACKAGE_READINESS_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAppService/GetAppPackageReadiness";
pub const RUNTIME_AGENT_GET_AGENT_METHOD_ID: &str = "/nimi.runtime.v1.RuntimeAgentService/GetAgent";
pub const RUNTIME_AGENT_INITIALIZE_AGENT_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAgentService/InitializeAgent";
pub const RUNTIME_AGENT_SET_AGENT_PRESENTATION_PROFILE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAgentService/SetAgentPresentationProfile";
pub const RUNTIME_AGENT_OPEN_CONVERSATION_ANCHOR_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor";
pub const RUNTIME_AGENT_GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAgentService/GetConversationAnchorSnapshot";
pub const RUNTIME_AGENT_LIST_AGENT_CONVERSATION_SUMMARIES_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAgentService/ListAgentConversationSummaries";

const DEFAULT_EVENT_NAMESPACE: &str = "runtime_bridge";

type StatusOverrideHook =
    Arc<dyn Fn() -> Result<Option<RuntimeBridgeDaemonStatus>, String> + Send + Sync>;
type StatusSyncHook = Arc<dyn Fn(&AppHandle, RuntimeBridgeDaemonStatus) + Send + Sync>;
type ActionInFlightHook = Arc<dyn Fn(&AppHandle, Option<&'static str>) + Send + Sync>;
type UnaryOverrideHook = Arc<
    dyn Fn(&RuntimeBridgeUnaryPayload) -> Result<Option<RuntimeBridgeUnaryResult>, String>
        + Send
        + Sync,
>;
type TrustedMetadataFuture =
    Pin<Box<dyn Future<Output = Result<Option<RuntimeBridgeTrustedMetadata>, String>> + Send>>;
type TrustedMetadataHook =
    Arc<dyn Fn(RuntimeBridgeTrustedMetadataRequest) -> TrustedMetadataFuture + Send + Sync>;
type ResultPathHook = Arc<dyn Fn() -> Result<PathBuf, String> + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeBridgeTrustedMetadataBridgeKind {
    Unary,
    Stream,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeBridgeTrustedMetadataRequest {
    pub method_id: String,
    pub bridge_kind: RuntimeBridgeTrustedMetadataBridgeKind,
}

#[derive(Clone, Default)]
pub struct RuntimeBridgeHostHooks {
    pub status_override: Option<StatusOverrideHook>,
    pub unary_override: Option<UnaryOverrideHook>,
    pub trusted_metadata: Option<TrustedMetadataHook>,
    pub sync_daemon_status: Option<StatusSyncHook>,
    pub set_action_in_flight: Option<ActionInFlightHook>,
    pub resolve_nimi_dir: Option<ResultPathHook>,
    pub resolve_nimi_data_dir: Option<ResultPathHook>,
    pub desktop_account_status_request: Option<DesktopAccountSessionStatusRequest>,
}

static HOST_HOOKS: OnceLock<Mutex<RuntimeBridgeHostHooks>> = OnceLock::new();
#[cfg(test)]
static TEST_HOST_HOOKS_LOCK: Mutex<()> = Mutex::new(());

pub fn set_runtime_bridge_host_hooks(hooks: RuntimeBridgeHostHooks) -> Result<(), String> {
    if HOST_HOOKS.get().is_some() {
        #[cfg(test)]
        {
            let existing = HOST_HOOKS
                .get()
                .ok_or_else(|| "RUNTIME_BRIDGE_HOST_HOOKS_MISSING".to_string())?;
            *existing
                .lock()
                .map_err(|_| "RUNTIME_BRIDGE_HOST_HOOKS_LOCK_POISONED".to_string())? = hooks;
            return Ok(());
        }
        #[cfg(not(test))]
        {
            return Err("RUNTIME_BRIDGE_HOST_HOOKS_ALREADY_SET".to_string());
        }
    }
    HOST_HOOKS
        .set(Mutex::new(hooks))
        .map_err(|_| "RUNTIME_BRIDGE_HOST_HOOKS_ALREADY_SET".to_string())
}

#[cfg(test)]
pub(crate) fn with_runtime_bridge_host_hooks<R>(
    hooks: RuntimeBridgeHostHooks,
    run: impl FnOnce() -> R,
) -> R {
    let _guard = TEST_HOST_HOOKS_LOCK
        .lock()
        .expect("runtime bridge test host hooks lock");
    let previous = host_hooks().unwrap_or_default();
    set_runtime_bridge_host_hooks(hooks).expect("set temporary runtime bridge host hooks");
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(run));
    set_runtime_bridge_host_hooks(previous).expect("restore runtime bridge host hooks");
    match result {
        Ok(value) => value,
        Err(payload) => std::panic::resume_unwind(payload),
    }
}

#[cfg(test)]
pub(crate) async fn with_runtime_bridge_host_hooks_async<R, Fut>(
    hooks: RuntimeBridgeHostHooks,
    run: impl FnOnce() -> Fut,
) -> R
where
    Fut: std::future::Future<Output = R>,
{
    use futures_util::FutureExt;

    let _guard = TEST_HOST_HOOKS_LOCK
        .lock()
        .expect("runtime bridge test host hooks lock");
    let previous = host_hooks().unwrap_or_default();
    set_runtime_bridge_host_hooks(hooks).expect("set temporary runtime bridge host hooks");
    let result = std::panic::AssertUnwindSafe(run()).catch_unwind().await;
    set_runtime_bridge_host_hooks(previous).expect("restore runtime bridge host hooks");
    match result {
        Ok(value) => value,
        Err(payload) => std::panic::resume_unwind(payload),
    }
}

fn host_hooks() -> Option<RuntimeBridgeHostHooks> {
    HOST_HOOKS
        .get()
        .and_then(|hooks| hooks.lock().ok().map(|hooks| hooks.clone()))
}

fn desktop_account_status_request() -> Result<DesktopAccountSessionStatusRequest, String> {
    host_hooks()
        .and_then(|hooks| hooks.desktop_account_status_request)
        .ok_or_else(|| {
            bridge_error(
                "RUNTIME_ACCOUNT_SESSION_STATUS_UNAVAILABLE",
                NimiHostErrorReasonCode::ProtectedCarrierRequired.as_str(),
            )
        })
}

fn call_status_override_hook() -> Result<Option<RuntimeBridgeDaemonStatus>, String> {
    match host_hooks().and_then(|hooks| hooks.status_override.clone()) {
        Some(hook) => hook(),
        None => Ok(None),
    }
}

fn sync_daemon_status_hook(app: &AppHandle, status: RuntimeBridgeDaemonStatus) {
    if let Some(hook) = host_hooks().and_then(|hooks| hooks.sync_daemon_status.clone()) {
        hook(app, status);
    }
}

fn call_unary_override_hook(
    payload: &RuntimeBridgeUnaryPayload,
) -> Result<Option<RuntimeBridgeUnaryResult>, String> {
    match host_hooks().and_then(|hooks| hooks.unary_override.clone()) {
        Some(hook) => hook(payload),
        None => Ok(None),
    }
}

fn trusted_metadata_hook() -> Option<TrustedMetadataHook> {
    host_hooks().and_then(|hooks| hooks.trusted_metadata.clone())
}

async fn apply_trusted_metadata_hook(
    method_id: &str,
    bridge_kind: RuntimeBridgeTrustedMetadataBridgeKind,
    payload_metadata: &mut Option<RuntimeBridgeMetadata>,
    authorization: &mut Option<String>,
    protected_access_token: &mut Option<RuntimeBridgeProtectedAccessToken>,
    app_session: &mut Option<RuntimeBridgeAppSession>,
) -> Result<(), String> {
    let Some(hook) = trusted_metadata_hook() else {
        return Ok(());
    };
    let trusted = hook(RuntimeBridgeTrustedMetadataRequest {
        method_id: method_id.to_string(),
        bridge_kind,
    })
    .await?;
    let Some(trusted) = trusted else {
        return Ok(());
    };
    let resolved = metadata::resolve_trusted_runtime_bridge_metadata(
        payload_metadata.as_ref(),
        authorization.as_deref(),
        protected_access_token.as_ref(),
        app_session.as_ref(),
        Some(trusted),
    )?;
    *payload_metadata = resolved.metadata;
    *authorization = resolved.authorization;
    *protected_access_token = resolved.protected_access_token;
    *app_session = resolved.app_session;
    Ok(())
}

fn set_action_in_flight_hook(app: &AppHandle, action: Option<&'static str>) {
    if let Some(hook) = host_hooks().and_then(|hooks| hooks.set_action_in_flight.clone()) {
        hook(app, action);
    }
}

pub(crate) fn resolve_nimi_dir_hook() -> Option<Result<PathBuf, String>> {
    host_hooks()
        .and_then(|hooks| hooks.resolve_nimi_dir.clone())
        .map(|hook| hook())
}

pub(crate) fn resolve_nimi_data_dir_hook() -> Option<Result<PathBuf, String>> {
    host_hooks()
        .and_then(|hooks| hooks.resolve_nimi_data_dir.clone())
        .map(|hook| hook())
}

fn redact_runtime_secret(value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        "***REDACTED***".to_string()
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeProtectedAccessToken {
    pub token_id: String,
    pub secret: String,
}

impl fmt::Debug for RuntimeBridgeProtectedAccessToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RuntimeBridgeProtectedAccessToken")
            .field("token_id", &self.token_id)
            .field("secret", &redact_runtime_secret(self.secret.as_str()))
            .finish()
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeAppSession {
    pub session_id: String,
    pub session_token: String,
}

impl fmt::Debug for RuntimeBridgeAppSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RuntimeBridgeAppSession")
            .field("session_id", &self.session_id)
            .field(
                "session_token",
                &redact_runtime_secret(self.session_token.as_str()),
            )
            .finish()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeUnaryPayload {
    pub method_id: String,
    pub request_bytes_base64: String,
    pub metadata: Option<RuntimeBridgeMetadata>,
    pub authorization: Option<String>,
    pub protected_access_token: Option<RuntimeBridgeProtectedAccessToken>,
    pub app_session: Option<RuntimeBridgeAppSession>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeStreamOpenPayload {
    pub method_id: String,
    pub stream_id: Option<String>,
    pub request_bytes_base64: String,
    pub metadata: Option<RuntimeBridgeMetadata>,
    pub authorization: Option<String>,
    pub protected_access_token: Option<RuntimeBridgeProtectedAccessToken>,
    pub app_session: Option<RuntimeBridgeAppSession>,
    pub timeout_ms: Option<u64>,
    pub event_namespace: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeStreamClosePayload {
    pub stream_id: String,
}

pub fn stream_event_name_with_namespace(namespace: &str, stream_id: &str) -> String {
    let normalized = namespace.trim();
    let resolved = if normalized.is_empty() {
        DEFAULT_EVENT_NAMESPACE
    } else {
        normalized
    };
    format!("{}:stream:{}", resolved, stream_id)
}

pub fn is_stream_method(method_id: &str) -> bool {
    generated_method_ids::is_stream_method(method_id)
}

pub fn is_allowlisted_method(method_id: &str) -> bool {
    generated_method_ids::is_allowlisted_method(method_id)
}

async fn runtime_bridge_unary_host_trusted(
    payload: RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let method_id = payload.method_id.clone();
    if is_allowlisted_method(method_id.as_str()) && !is_stream_method(method_id.as_str()) {
        if let Some(result) = call_unary_override_hook(&payload)? {
            return Ok(result);
        }
    }
    unary::invoke_unary(&payload).await
}

pub async fn runtime_bridge_unary(
    mut payload: RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    let method_id = payload.method_id.clone();
    if is_allowlisted_method(method_id.as_str()) && !is_stream_method(method_id.as_str()) {
        apply_trusted_metadata_hook(
            method_id.as_str(),
            RuntimeBridgeTrustedMetadataBridgeKind::Unary,
            &mut payload.metadata,
            &mut payload.authorization,
            &mut payload.protected_access_token,
            &mut payload.app_session,
        )
        .await?;
        if let Some(result) = call_unary_override_hook(&payload)? {
            return Ok(result);
        }
    }
    unary::invoke_unary(&payload).await
}

pub async fn runtime_bridge_stream_open(
    app: AppHandle,
    mut payload: RuntimeBridgeStreamOpenPayload,
) -> Result<RuntimeBridgeStreamOpenResult, String> {
    let method_id = payload.method_id.clone();
    if is_allowlisted_method(method_id.as_str()) && is_stream_method(method_id.as_str()) {
        apply_trusted_metadata_hook(
            method_id.as_str(),
            RuntimeBridgeTrustedMetadataBridgeKind::Stream,
            &mut payload.metadata,
            &mut payload.authorization,
            &mut payload.protected_access_token,
            &mut payload.app_session,
        )
        .await?;
    }
    stream::open_stream(&app, &payload).await
}

pub fn runtime_bridge_stream_close(payload: RuntimeBridgeStreamClosePayload) -> Result<(), String> {
    stream::close_stream(&payload)
}

pub async fn runtime_bridge_status(app: AppHandle) -> RuntimeBridgeDaemonStatus {
    let status = current_daemon_status_async().await;
    sync_daemon_status_hook(&app, status.clone());
    status
}

pub async fn runtime_account_session_status(
) -> Result<RuntimeBridgeDesktopAccountSessionStatus, String> {
    let request = desktop_account_status_request()?;
    let status = service_control::get_account_session_status(request)
        .await
        .map_err(|error| {
            bridge_error(
                "RUNTIME_ACCOUNT_SESSION_STATUS_UNAVAILABLE",
                error.reason_code().as_str(),
            )
        })?;
    Ok(RuntimeBridgeDesktopAccountSessionStatus {
        sequence: status.sequence.to_string(),
        state: status.state.as_str().to_string(),
        reason_code: status.reason_code,
        account_reason_code: status.account_reason_code,
        account_projection: status.account_projection.map(|projection| {
            RuntimeBridgeDesktopAccountProjection {
                account_id: projection.account_id,
                display_name: projection.display_name,
                realm_environment_id: projection.realm_environment_id,
            }
        }),
    })
}

pub async fn runtime_account_session_events_open(
    app: AppHandle,
    payload: RuntimeBridgeAccountEventsOpenPayload,
) -> Result<RuntimeBridgeAccountEventsOpenResult, String> {
    account_events::open(app, payload).await
}

pub fn runtime_account_session_events_close(
    payload: RuntimeBridgeAccountEventsClosePayload,
) -> Result<RuntimeBridgeAccountEventsCloseResult, String> {
    account_events::close(payload)
}

pub async fn runtime_bridge_start(app: AppHandle) -> Result<RuntimeBridgeDaemonStatus, String> {
    set_action_in_flight_hook(&app, Some("start"));
    let result = start_daemon_async().await;
    set_action_in_flight_hook(&app, None);
    sync_menu_bar_daemon_status(&app, &result).await;
    result
}

pub async fn runtime_bridge_restart(app: AppHandle) -> Result<RuntimeBridgeDaemonStatus, String> {
    set_action_in_flight_hook(&app, Some("restart"));
    let result = restart_daemon_async().await;
    set_action_in_flight_hook(&app, None);
    sync_menu_bar_daemon_status(&app, &result).await;
    result
}

pub fn current_daemon_status() -> RuntimeBridgeDaemonStatus {
    service_control::status()
}

pub async fn current_daemon_status_async() -> RuntimeBridgeDaemonStatus {
    if let Some(override_status) = call_status_override_hook().ok().flatten() {
        return override_status;
    }
    service_control::status_async().await
}

pub async fn evaluate_local_development_project(
    request: LocalDevelopmentEvaluationRequest,
) -> Result<LocalDevelopmentEvaluation, NimiHostError> {
    service_control::evaluate_local_development_project(request).await
}

pub async fn get_developer_mode_status() -> Result<DeveloperModeStatus, NimiHostError> {
    service_control::get_developer_mode_status().await
}

pub async fn get_local_development_authority_summary(
) -> Result<LocalDevelopmentAuthoritySummary, NimiHostError> {
    service_control::get_local_development_authority_summary().await
}

pub async fn set_developer_mode(enabled: bool) -> Result<DeveloperModeStatus, NimiHostError> {
    service_control::set_developer_mode(enabled).await
}

pub async fn decide_local_development_project(
    request: LocalDevelopmentDecisionRequest,
) -> Result<LocalDevelopmentAuthorization, NimiHostError> {
    service_control::decide_local_development_project(request).await
}

pub async fn list_local_development_authorizations(
) -> Result<Vec<LocalDevelopmentAuthorization>, NimiHostError> {
    service_control::list_local_development_authorizations().await
}

pub async fn revoke_local_development_authorization(
    authorization_id: [u8; 32],
) -> Result<LocalDevelopmentAuthorization, NimiHostError> {
    service_control::revoke_local_development_authorization(authorization_id).await
}

pub async fn launch_local_development_host(
    request: LocalDevelopmentLaunchRequest,
) -> Result<LocalDevelopmentLaunchOutcome, NimiHostError> {
    service_control::launch_local_development_host(request).await
}

pub fn local_development_host_running(supervisor_run_id: [u8; 32]) -> Result<bool, NimiHostError> {
    service_control::local_development_host_running(supervisor_run_id)
}

pub fn terminate_local_development_host(supervisor_run_id: [u8; 32]) -> Result<(), NimiHostError> {
    service_control::terminate_local_development_host(supervisor_run_id)
}

pub async fn end_local_development_run(
    request: LocalDevelopmentEndRunRequest,
) -> Result<(), NimiHostError> {
    service_control::end_local_development_run(request).await
}

async fn sync_menu_bar_daemon_status(
    app: &AppHandle,
    result: &Result<RuntimeBridgeDaemonStatus, String>,
) {
    let status = match result {
        Ok(status) => status.clone(),
        Err(_) => current_daemon_status_async().await,
    };
    sync_daemon_status_hook(app, status);
}

pub async fn start_daemon_async() -> Result<RuntimeBridgeDaemonStatus, String> {
    let result =
        service_control::request(nimi_shell_protected_local::RuntimeServiceAction::Start).await;
    if result.is_ok() {
        channel_pool::invalidate_channel();
    }
    result
}

pub async fn restart_daemon_async() -> Result<RuntimeBridgeDaemonStatus, String> {
    let result =
        service_control::request(nimi_shell_protected_local::RuntimeServiceAction::Restart).await;
    if result.is_ok() {
        channel_pool::invalidate_channel();
    }
    result
}

#[cfg(any(test, feature = "test-observability"))]
pub fn reset_channel_invalidation_count() {
    channel_pool::reset_invalidation_count();
}

#[cfg(any(test, feature = "test-observability"))]
pub fn channel_invalidation_count() -> usize {
    channel_pool::invalidation_count()
}

#[cfg(test)]
mod tests;
