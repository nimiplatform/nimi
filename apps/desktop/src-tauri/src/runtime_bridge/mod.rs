mod channel_pool;
mod codec;
mod daemon_manager;
mod error_map;
mod metadata;
mod stream;
mod unary;

use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

pub(crate) use daemon_manager::http_addr;
pub use daemon_manager::RuntimeBridgeDaemonStatus;
pub(crate) use error_map::bridge_error;
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeProtectedAccessToken {
    pub token_id: String,
    pub secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeUnaryPayload {
    pub method_id: String,
    pub request_bytes_base64: String,
    pub metadata: Option<RuntimeBridgeMetadata>,
    pub authorization: Option<String>,
    pub protected_access_token: Option<RuntimeBridgeProtectedAccessToken>,
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
pub fn runtime_bridge_status(app: AppHandle) -> RuntimeBridgeDaemonStatus {
    let status = crate::desktop_e2e_fixture::runtime_bridge_status_override()
        .ok()
        .flatten()
        .unwrap_or_else(current_daemon_status);
    crate::menu_bar_shell::refresh_from_daemon(&app);
    status
}

#[tauri::command]
pub fn runtime_bridge_start(app: AppHandle) -> Result<RuntimeBridgeDaemonStatus, String> {
    crate::menu_bar_shell::set_action_in_flight(&app, Some("start"));
    let result = start_daemon();
    crate::menu_bar_shell::set_action_in_flight(&app, None);
    crate::menu_bar_shell::refresh_from_daemon(&app);
    result
}

#[tauri::command]
pub fn runtime_bridge_stop(app: AppHandle) -> Result<RuntimeBridgeDaemonStatus, String> {
    crate::menu_bar_shell::set_action_in_flight(&app, Some("stop"));
    let result = stop_daemon();
    crate::menu_bar_shell::set_action_in_flight(&app, None);
    crate::menu_bar_shell::refresh_from_daemon(&app);
    result
}

#[tauri::command]
pub fn runtime_bridge_restart(app: AppHandle) -> Result<RuntimeBridgeDaemonStatus, String> {
    crate::menu_bar_shell::set_action_in_flight(&app, Some("restart"));
    let result = restart_daemon();
    crate::menu_bar_shell::set_action_in_flight(&app, None);
    crate::menu_bar_shell::refresh_from_daemon(&app);
    result
}

#[tauri::command]
pub fn runtime_bridge_config_get() -> Result<Value, String> {
    daemon_manager::config_get()
}

#[tauri::command]
pub fn runtime_bridge_config_set(payload: RuntimeBridgeConfigSetPayload) -> Result<Value, String> {
    daemon_manager::config_set(payload.config_json.as_str())
}

pub fn current_daemon_status() -> RuntimeBridgeDaemonStatus {
    daemon_manager::status()
}

pub fn start_daemon() -> Result<RuntimeBridgeDaemonStatus, String> {
    let result = daemon_manager::start();
    if result.is_ok() {
        channel_pool::invalidate_channel();
    }
    result
}

pub fn stop_daemon() -> Result<RuntimeBridgeDaemonStatus, String> {
    let result = daemon_manager::stop();
    channel_pool::invalidate_channel();
    result
}

pub fn restart_daemon() -> Result<RuntimeBridgeDaemonStatus, String> {
    let result = daemon_manager::restart();
    if result.is_ok() {
        channel_pool::invalidate_channel();
    }
    result
}

#[cfg(test)]
pub(crate) fn reset_channel_invalidation_count() {
    channel_pool::reset_invalidation_count();
}

#[cfg(test)]
pub(crate) fn channel_invalidation_count() -> usize {
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
    fn unknown_method_is_rejected() {
        let unknown = "/nimi.runtime.v1.RuntimeAiService/NotExists";
        assert!(!is_stream_method(unknown));
        assert!(!is_allowlisted_method(unknown));
    }
}
