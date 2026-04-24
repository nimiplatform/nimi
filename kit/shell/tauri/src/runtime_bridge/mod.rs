mod channel_pool;
mod codec;
mod daemon_manager;
mod error_map;
mod metadata;
mod stream;
mod unary;

use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tauri::AppHandle;

pub use daemon_manager::http_addr;
pub use daemon_manager::RuntimeBridgeDaemonStatus;
pub use error_map::bridge_error;
pub use metadata::RuntimeBridgeMetadata;
pub use stream::RuntimeBridgeStreamOpenResult;
pub use unary::RuntimeBridgeUnaryResult;

#[allow(clippy::all, dead_code)]
pub mod generated {
    include!("generated/nimi.runtime.v1.rs");
}

pub mod generated_method_ids {
    include!("generated/method_ids.rs");
}

const DEFAULT_EVENT_NAMESPACE: &str = "runtime_bridge";

type StatusOverrideHook =
    Arc<dyn Fn() -> Result<Option<RuntimeBridgeDaemonStatus>, String> + Send + Sync>;
type StatusSyncHook = Arc<dyn Fn(&AppHandle, RuntimeBridgeDaemonStatus) + Send + Sync>;
type ActionInFlightHook = Arc<dyn Fn(&AppHandle, Option<&'static str>) + Send + Sync>;
type OptionalPathHook = Arc<dyn Fn() -> Option<PathBuf> + Send + Sync>;
type OptionalStringHook = Arc<dyn Fn() -> Option<String> + Send + Sync>;
type ResultPathHook = Arc<dyn Fn() -> Result<PathBuf, String> + Send + Sync>;

#[derive(Clone, Default)]
pub struct RuntimeBridgeHostHooks {
    pub status_override: Option<StatusOverrideHook>,
    pub sync_daemon_status: Option<StatusSyncHook>,
    pub set_action_in_flight: Option<ActionInFlightHook>,
    pub staged_runtime_binary_path: Option<OptionalPathHook>,
    pub runtime_last_error: Option<OptionalStringHook>,
    pub current_release_version: Option<OptionalStringHook>,
    pub resolve_nimi_dir: Option<ResultPathHook>,
    pub resolve_nimi_data_dir: Option<ResultPathHook>,
}

static HOST_HOOKS: OnceLock<RuntimeBridgeHostHooks> = OnceLock::new();

pub fn set_runtime_bridge_host_hooks(hooks: RuntimeBridgeHostHooks) -> Result<(), String> {
    HOST_HOOKS
        .set(hooks)
        .map_err(|_| "RUNTIME_BRIDGE_HOST_HOOKS_ALREADY_SET".to_string())
}

fn host_hooks() -> Option<&'static RuntimeBridgeHostHooks> {
    HOST_HOOKS.get()
}

fn call_status_override_hook() -> Result<Option<RuntimeBridgeDaemonStatus>, String> {
    match host_hooks().and_then(|hooks| hooks.status_override.as_ref()) {
        Some(hook) => hook(),
        None => Ok(None),
    }
}

fn sync_daemon_status_hook(app: &AppHandle, status: RuntimeBridgeDaemonStatus) {
    if let Some(hook) = host_hooks().and_then(|hooks| hooks.sync_daemon_status.as_ref()) {
        hook(app, status);
    }
}

fn set_action_in_flight_hook(app: &AppHandle, action: Option<&'static str>) {
    if let Some(hook) = host_hooks().and_then(|hooks| hooks.set_action_in_flight.as_ref()) {
        hook(app, action);
    }
}

pub(crate) fn staged_runtime_binary_path_hook_result() -> Option<Option<PathBuf>> {
    host_hooks()
        .and_then(|hooks| hooks.staged_runtime_binary_path.as_ref())
        .map(|hook| hook())
}

pub(crate) fn runtime_last_error_hook() -> Option<String> {
    host_hooks()
        .and_then(|hooks| hooks.runtime_last_error.as_ref())
        .and_then(|hook| hook())
}

pub(crate) fn current_release_version_hook() -> Option<String> {
    host_hooks()
        .and_then(|hooks| hooks.current_release_version.as_ref())
        .and_then(|hook| hook())
}

pub(crate) fn resolve_nimi_dir_hook() -> Option<Result<PathBuf, String>> {
    host_hooks()
        .and_then(|hooks| hooks.resolve_nimi_dir.as_ref())
        .map(|hook| hook())
}

pub(crate) fn resolve_nimi_data_dir_hook() -> Option<Result<PathBuf, String>> {
    host_hooks()
        .and_then(|hooks| hooks.resolve_nimi_data_dir.as_ref())
        .map(|hook| hook())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeProtectedAccessToken {
    pub token_id: String,
    pub secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeAppSession {
    pub session_id: String,
    pub session_token: String,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeConfigSetPayload {
    pub config_json: String,
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

#[tauri::command]
pub async fn runtime_bridge_unary(
    payload: RuntimeBridgeUnaryPayload,
) -> Result<RuntimeBridgeUnaryResult, String> {
    unary::invoke_unary(&payload).await
}

#[tauri::command]
pub async fn runtime_bridge_stream_open(
    app: AppHandle,
    payload: RuntimeBridgeStreamOpenPayload,
) -> Result<RuntimeBridgeStreamOpenResult, String> {
    stream::open_stream(&app, &payload).await
}

#[tauri::command]
pub fn runtime_bridge_stream_close(payload: RuntimeBridgeStreamClosePayload) {
    stream::close_stream(&payload)
}

#[tauri::command]
pub async fn runtime_bridge_status(app: AppHandle) -> RuntimeBridgeDaemonStatus {
    let status = current_daemon_status_async().await;
    sync_daemon_status_hook(&app, status.clone());
    status
}

#[tauri::command]
pub async fn runtime_bridge_start(app: AppHandle) -> Result<RuntimeBridgeDaemonStatus, String> {
    set_action_in_flight_hook(&app, Some("start"));
    let result = start_daemon_async().await;
    set_action_in_flight_hook(&app, None);
    sync_menu_bar_daemon_status(&app, &result).await;
    result
}

#[tauri::command]
pub async fn runtime_bridge_stop(app: AppHandle) -> Result<RuntimeBridgeDaemonStatus, String> {
    set_action_in_flight_hook(&app, Some("stop"));
    let result = stop_daemon_async().await;
    set_action_in_flight_hook(&app, None);
    sync_menu_bar_daemon_status(&app, &result).await;
    result
}

#[tauri::command]
pub async fn runtime_bridge_restart(app: AppHandle) -> Result<RuntimeBridgeDaemonStatus, String> {
    set_action_in_flight_hook(&app, Some("restart"));
    let result = restart_daemon_async().await;
    set_action_in_flight_hook(&app, None);
    sync_menu_bar_daemon_status(&app, &result).await;
    result
}

#[tauri::command]
pub async fn runtime_bridge_config_get() -> Result<Value, String> {
    daemon_manager::config_get_async().await
}

#[tauri::command]
pub async fn runtime_bridge_config_set(
    payload: RuntimeBridgeConfigSetPayload,
) -> Result<Value, String> {
    daemon_manager::config_set_async(payload.config_json).await
}

pub fn current_daemon_status() -> RuntimeBridgeDaemonStatus {
    daemon_manager::status()
}

pub async fn current_daemon_status_async() -> RuntimeBridgeDaemonStatus {
    if let Some(override_status) = call_status_override_hook().ok().flatten() {
        return override_status;
    }
    daemon_manager::status_async().await
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

pub fn stop_daemon() -> Result<RuntimeBridgeDaemonStatus, String> {
    let result = daemon_manager::stop();
    channel_pool::invalidate_channel();
    result
}

pub async fn start_daemon_async() -> Result<RuntimeBridgeDaemonStatus, String> {
    let result = daemon_manager::start_async().await;
    if result.is_ok() {
        channel_pool::invalidate_channel();
    }
    result
}

pub async fn stop_daemon_async() -> Result<RuntimeBridgeDaemonStatus, String> {
    let result = daemon_manager::stop_async().await;
    channel_pool::invalidate_channel();
    result
}

pub async fn restart_daemon_async() -> Result<RuntimeBridgeDaemonStatus, String> {
    let result = daemon_manager::restart_async().await;
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
    use super::{
        is_allowlisted_method, is_stream_method, stream_event_name_with_namespace,
        DEFAULT_EVENT_NAMESPACE,
    };

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
}
