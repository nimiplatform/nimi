mod channel_pool;
mod codec;
mod daemon_manager;
mod error_map;
mod host_app_session;
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

pub use daemon_manager::http_addr;
pub use error_map::bridge_error;
pub use host_app_session::{
    RuntimeBridgeHostAppSessionConfig, RuntimeBridgeHostAppSessionProvider,
    RUNTIME_BRIDGE_DESKTOP_TAURI_ACCOUNT_SOURCE_HOST,
    RUNTIME_BRIDGE_TAURI_STANDARD_SHELL_SOURCE_HOST,
};
pub use metadata::{RuntimeBridgeMetadata, RuntimeBridgeTrustedMetadata};
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
pub const RUNTIME_APP_LIST_LOCAL_APP_ADOPTIONS_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAppService/ListLocalAppAdoptions";
pub const RUNTIME_APP_LIST_APP_INSTALL_JOBS_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeAppService/ListAppInstallJobs";
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
type OptionalPathHook = Arc<dyn Fn() -> Option<PathBuf> + Send + Sync>;
type OptionalStringHook = Arc<dyn Fn() -> Option<String> + Send + Sync>;
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
    pub staged_runtime_binary_path: Option<OptionalPathHook>,
    pub runtime_last_error: Option<OptionalStringHook>,
    pub current_release_version: Option<OptionalStringHook>,
    pub resolve_nimi_dir: Option<ResultPathHook>,
    pub resolve_nimi_data_dir: Option<ResultPathHook>,
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

#[cfg(test)]
pub(crate) fn staged_runtime_binary_path_hook_result() -> Option<Option<PathBuf>> {
    host_hooks()
        .and_then(|hooks| hooks.staged_runtime_binary_path.clone())
        .map(|hook| hook())
}

#[cfg(test)]
pub(crate) fn runtime_last_error_hook() -> Option<String> {
    host_hooks()
        .and_then(|hooks| hooks.runtime_last_error.clone())
        .and_then(|hook| hook())
}

#[cfg(test)]
pub(crate) fn current_release_version_hook() -> Option<String> {
    host_hooks()
        .and_then(|hooks| hooks.current_release_version.clone())
        .and_then(|hook| hook())
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

/// Host-only installed launch continuation. Registering a Tauri command or
/// exposing this function to renderer IPC requires a separate typed Desktop
/// owner; launch correlation and executable paths are never parsed here from
/// argv, env, or renderer metadata.
pub async fn launch_installed_app_host(
    launch_id: [u8; 32],
    executable_path: PathBuf,
) -> Result<u32, String> {
    service_control::launch_installed_app(nimi_shell_protected_local::InstalledAppLaunchRequest {
        launch_id,
        executable_path,
    })
    .await
    .map(|outcome| outcome.process_id)
    .map_err(|error| {
        bridge_error(
            "RUNTIME_BRIDGE_INSTALLED_LAUNCH_FAILED",
            error.reason_code().as_str(),
        )
    })
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
    let result = service_control::request(nimi_shell_protected_local::RuntimeServiceAction::Start);
    if result.is_ok() {
        channel_pool::invalidate_channel();
    }
    result
}

pub async fn restart_daemon_async() -> Result<RuntimeBridgeDaemonStatus, String> {
    let result =
        service_control::request(nimi_shell_protected_local::RuntimeServiceAction::Restart);
    if result.is_ok() {
        channel_pool::invalidate_channel();
    }
    result
}

pub fn reset_channel_invalidation_count() {
    channel_pool::reset_invalidation_count();
}

pub fn channel_invalidation_count() -> usize {
    channel_pool::invalidation_count()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use base64::Engine;
    use prost::Message;

    use super::{
        channel_invalidation_count, current_daemon_status, invoke_unary_typed_with_metadata,
        is_allowlisted_method, is_stream_method, launch_installed_app_host,
        reset_channel_invalidation_count, restart_daemon_async, runtime_bridge_unary,
        start_daemon_async, stream_event_name_with_namespace, with_runtime_bridge_host_hooks,
        RuntimeBridgeAppSession, RuntimeBridgeHostHooks, RuntimeBridgeMetadata,
        RuntimeBridgeProtectedAccessToken, RuntimeBridgeTrustedMetadata,
        RuntimeBridgeTrustedMetadataBridgeKind, RuntimeBridgeUnaryPayload,
        RuntimeBridgeUnaryResult, DEFAULT_EVENT_NAMESPACE, RUNTIME_APP_GET_APP_STORAGE_METHOD_ID,
    };

    #[test]
    fn public_lifecycle_routes_do_not_delegate_to_legacy_daemon_manager() {
        let source = include_str!("mod.rs");
        let legacy_prefix = ["daemon_manager", "::"].concat();
        for operation in [
            "status()",
            "status_async().await",
            "start_async().await",
            "restart_async().await",
            "stop()",
            "stop_async().await",
        ] {
            assert!(
                !source.contains(&[legacy_prefix.as_str(), operation].concat()),
                "public Runtime lifecycle must use the protected-local service carrier, not {operation}",
            );
        }
    }

    #[test]
    fn public_lifecycle_controls_fail_closed_without_a_verified_runtime() {
        reset_channel_invalidation_count();

        for result in [
            tauri::async_runtime::block_on(start_daemon_async()),
            tauri::async_runtime::block_on(restart_daemon_async()),
        ] {
            let error = result.expect_err("unbound protected carrier must fail closed");
            assert!(error.contains("RUNTIME_BRIDGE_DAEMON_UNAVAILABLE"));
            assert!(
                error.contains("protected-carrier-required")
                    || error.contains("runtime-service-unavailable")
                    || error.contains("runtime-service-untrusted")
            );
        }

        assert_eq!(channel_invalidation_count(), 0);
        let status = current_daemon_status();
        assert!(!status.running);
        assert!(!status.managed);
        assert_eq!(status.launch_mode, "INVALID");
        let last_error = status.last_error.as_deref().unwrap_or_default();
        assert!(
            last_error.contains("protected-carrier-required")
                || last_error.contains("runtime-service-unavailable")
                || last_error.contains("runtime-service-untrusted")
        );
    }

    #[tokio::test]
    async fn installed_launch_host_requires_retained_protected_control() {
        let error = launch_installed_app_host(
            [0x41; 32],
            std::path::PathBuf::from(r"C:\Program Files\Nimi\missing-app.exe"),
        )
        .await
        .expect_err("unbound Desktop control must fail closed");
        assert!(error.contains("protected-carrier-required"));
    }

    #[test]
    fn stream_event_name_uses_fixed_namespace() {
        assert_eq!(
            stream_event_name_with_namespace(DEFAULT_EVENT_NAMESPACE, "stream-1"),
            "runtime_bridge:stream:stream-1"
        );
    }

    #[test]
    fn stream_event_name_uses_custom_namespace_when_provided() {
        assert_eq!(
            stream_event_name_with_namespace("custom_runtime", "stream-2"),
            "custom_runtime:stream:stream-2"
        );
    }

    #[test]
    fn stream_methods_are_allowlisted() {
        let stream_method = "/nimi.runtime.v1.RuntimeAiService/StreamScenario";
        assert!(is_stream_method(stream_method));
        assert!(is_allowlisted_method(stream_method));
    }

    #[test]
    fn custom_agent_anchor_methods_are_allowlisted() {
        let open_method = "/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor";
        let get_method = "/nimi.runtime.v1.RuntimeAgentService/GetConversationAnchorSnapshot";
        assert!(!is_stream_method(open_method));
        assert!(!is_stream_method(get_method));
        assert!(is_allowlisted_method(open_method));
        assert!(is_allowlisted_method(get_method));
    }

    #[test]
    fn unknown_method_is_rejected() {
        let unknown = "/nimi.runtime.v1.RuntimeAiService/NotExists";
        assert!(!is_stream_method(unknown));
        assert!(!is_allowlisted_method(unknown));
    }

    #[test]
    fn runtime_bridge_unary_applies_trusted_metadata_before_override() {
        let payload = RuntimeBridgeUnaryPayload {
            method_id: RUNTIME_APP_GET_APP_STORAGE_METHOD_ID.to_string(),
            request_bytes_base64: String::new(),
            metadata: Some(RuntimeBridgeMetadata {
                surface_id: Some("renderer.surface".to_string()),
                ..RuntimeBridgeMetadata::default()
            }),
            authorization: None,
            protected_access_token: None,
            app_session: None,
            timeout_ms: None,
        };
        let hooks = RuntimeBridgeHostHooks {
            trusted_metadata: Some(Arc::new(|request| {
                Box::pin(async move {
                    assert_eq!(request.method_id, RUNTIME_APP_GET_APP_STORAGE_METHOD_ID);
                    assert_eq!(
                        request.bridge_kind,
                        RuntimeBridgeTrustedMetadataBridgeKind::Unary
                    );
                    Ok(Some(RuntimeBridgeTrustedMetadata {
                        metadata: Some(RuntimeBridgeMetadata {
                            app_id: Some("nimi.parentos".to_string()),
                            participant_id: Some("nimi.parentos".to_string()),
                            caller_kind: Some("local-developer-app".to_string()),
                            caller_id: Some("nimi.parentos.local-developer".to_string()),
                            surface_id: Some("host.surface".to_string()),
                            ..RuntimeBridgeMetadata::default()
                        }),
                        authorization: Some("Bearer host-token".to_string()),
                        protected_access_token: Some(RuntimeBridgeProtectedAccessToken {
                            token_id: "host-token-id".to_string(),
                            secret: "host-token-secret".to_string(),
                        }),
                        app_session: Some(RuntimeBridgeAppSession {
                            session_id: "host-session-id".to_string(),
                            session_token: "host-session-token".to_string(),
                        }),
                    }))
                })
            })),
            unary_override: Some(Arc::new(|payload| {
                let metadata = payload.metadata.as_ref().expect("trusted metadata");
                assert_eq!(metadata.app_id.as_deref(), Some("nimi.parentos"));
                assert_eq!(
                    metadata.caller_id.as_deref(),
                    Some("nimi.parentos.local-developer")
                );
                assert_eq!(metadata.surface_id.as_deref(), Some("host.surface"));
                assert_eq!(payload.authorization.as_deref(), Some("Bearer host-token"));
                assert_eq!(
                    payload
                        .protected_access_token
                        .as_ref()
                        .map(|token| token.token_id.as_str()),
                    Some("host-token-id")
                );
                assert_eq!(
                    payload
                        .app_session
                        .as_ref()
                        .map(|session| session.session_id.as_str()),
                    Some("host-session-id")
                );
                Ok(Some(RuntimeBridgeUnaryResult {
                    response_bytes_base64: String::new(),
                    response_metadata: None,
                }))
            })),
            ..RuntimeBridgeHostHooks::default()
        };

        let result = with_runtime_bridge_host_hooks(hooks, || {
            tauri::async_runtime::block_on(runtime_bridge_unary(payload))
        })
        .expect("runtime bridge should return override result");

        assert_eq!(result.response_bytes_base64, "");
    }

    #[test]
    fn host_typed_unary_metadata_bypasses_renderer_trusted_metadata_hook_before_override() {
        let response = super::generated::GetAppStorageResponse::default();
        let response_bytes_base64 =
            base64::engine::general_purpose::STANDARD.encode(response.encode_to_vec());
        let hooks = RuntimeBridgeHostHooks {
            trusted_metadata: Some(Arc::new(|_| {
                Box::pin(async {
                    Err(
                        "renderer trusted metadata hook must not run for a Rust host-internal call"
                            .to_string(),
                    )
                })
            })),
            unary_override: Some(Arc::new(move |payload| {
                let metadata = payload.metadata.as_ref().expect("host metadata");
                assert_eq!(metadata.app_id.as_deref(), Some("nimi.desktop"));
                assert_eq!(metadata.caller_kind.as_deref(), Some("desktop-shell"));
                Ok(Some(RuntimeBridgeUnaryResult {
                    response_bytes_base64: response_bytes_base64.clone(),
                    response_metadata: None,
                }))
            })),
            ..RuntimeBridgeHostHooks::default()
        };

        let result = with_runtime_bridge_host_hooks(hooks, || {
            tauri::async_runtime::block_on(invoke_unary_typed_with_metadata::<
                super::generated::GetAppStorageRequest,
                super::generated::GetAppStorageResponse,
            >(
                RUNTIME_APP_GET_APP_STORAGE_METHOD_ID,
                super::generated::GetAppStorageRequest::default(),
                RuntimeBridgeMetadata {
                    app_id: Some("nimi.desktop".to_string()),
                    caller_kind: Some("desktop-shell".to_string()),
                    caller_id: Some("nimi.desktop.product-control".to_string()),
                    ..RuntimeBridgeMetadata::default()
                },
                None,
            ))
        });

        assert!(result.is_ok(), "host typed call failed: {result:?}");
    }

    #[test]
    fn first_run_ready_admission_resolve_methods_are_allowlisted() {
        // P-COLD-016 product ready admission steps 5 and 7 consume these two
        // RuntimeLocalService resolve RPCs through the desktop runtime bridge.
        // They must pass the allowlist or the bridge fails them closed with
        // RUNTIME_BRIDGE_METHOD_FORBIDDEN.
        let baseline = "/nimi.runtime.v1.RuntimeLocalService/ResolveRuntimeBaselineReadiness";
        let execution = "/nimi.runtime.v1.RuntimeLocalService/ResolveFirstRunExecutionEvidence";
        assert!(is_allowlisted_method(baseline));
        assert!(is_allowlisted_method(execution));
        // Both are unary resolve calls, not streams.
        assert!(!is_stream_method(baseline));
        assert!(!is_stream_method(execution));
    }

    #[test]
    fn account_presence_verification_is_not_exposed_through_generic_bridge() {
        let method = "/nimi.runtime.v1.RuntimeAccountService/RequestPresenceVerification";

        assert!(!is_allowlisted_method(method));
        assert!(!is_stream_method(method));
    }
}
