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

pub use daemon_manager::RuntimeBridgeDaemonStatus;
pub use metadata::RuntimeBridgeMetadata;
pub use stream::RuntimeBridgeStreamOpenResult;
pub use unary::RuntimeBridgeUnaryResult;

#[allow(clippy::all)]
pub mod generated {
    include!("generated/nimi.runtime.v1.rs");
}

pub mod generated_method_ids {
    include!("generated/method_ids.rs");
}

const DEFAULT_EVENT_NAMESPACE: &str = "runtime_bridge";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeUnaryPayload {
    pub method_id: String,
    pub request_bytes_base64: String,
    pub metadata: Option<RuntimeBridgeMetadata>,
    pub authorization: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeStreamOpenPayload {
    pub method_id: String,
    pub request_bytes_base64: String,
    pub metadata: Option<RuntimeBridgeMetadata>,
    pub authorization: Option<String>,
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
pub fn runtime_bridge_status(_app: AppHandle) -> RuntimeBridgeDaemonStatus {
    current_daemon_status()
}

#[tauri::command]
pub fn runtime_bridge_start(_app: AppHandle) -> Result<RuntimeBridgeDaemonStatus, String> {
    start_daemon()
}

#[tauri::command]
pub fn runtime_bridge_stop(_app: AppHandle) -> Result<RuntimeBridgeDaemonStatus, String> {
    stop_daemon()
}

#[tauri::command]
pub fn runtime_bridge_restart(_app: AppHandle) -> Result<RuntimeBridgeDaemonStatus, String> {
    restart_daemon()
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
