use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{env, path::Path, path::PathBuf};

use reqwest::{header::HeaderMap, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::Manager;

mod app_bootstrap;
mod defaults_and_commands;
mod env_http;
mod session_logging;
#[cfg(test)]
mod tests;

pub(crate) use app_bootstrap::run;

#[cfg(test)]
use app_bootstrap::normalize_runtime_config_page_id;
#[cfg(test)]
use defaults_and_commands::{
    allow_http_request_origin_with_history, runtime_defaults, HTTP_REQUEST_RATE_LIMIT_BURST,
    HTTP_REQUEST_RATE_LIMIT_WINDOW,
};
use env_http::{
    allowed_http_origins, is_private_lan_http_origin, is_sensitive_key, load_dotenv_files,
    normalize_http_method, normalize_origin, preview_text_utf8_safe, redact_body_preview,
    sanitize_headers,
};
use session_logging::{
    append_diag_log_entry, debug_boot_enabled, env_value, install_panic_hook, log_boot_marker,
    now_ms, verbose_renderer_logs_enabled,
};
#[cfg(target_os = "macos")]
use session_logging::{apply_macos_traffic_light_position, schedule_macos_traffic_light_reapply};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RealmDefaults {
    pub(crate) realm_base_url: String,
    pub(crate) realtime_url: String,
    pub(crate) access_token: String,
    pub(crate) jwks_url: String,
    pub(crate) revocation_url: String,
    pub(crate) jwt_issuer: String,
    pub(crate) jwt_audience: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeExecutionDefaults {
    pub(crate) target_type: String,
    pub(crate) target_account_id: String,
    pub(crate) agent_id: String,
    pub(crate) world_id: String,
    pub(crate) user_confirmed_upload: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeDefaults {
    pub(crate) realm: RealmDefaults,
    pub(crate) runtime: RuntimeExecutionDefaults,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemResourceSnapshot {
    cpu_percent: f64,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
    disk_used_bytes: u64,
    disk_total_bytes: u64,
    temperature_celsius: Option<f64>,
    captured_at_ms: u64,
    source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestPayload {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    #[serde(default)]
    authorization: Option<String>,
    body: Option<String>,
    #[serde(default)]
    diagnostic_session_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponsePayload {
    status: u16,
    ok: bool,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmPrivateSyncPayload {
    agent_id: Option<String>,
    session_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmPrivateSyncResult {
    confirmed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmDialogPayload {
    title: String,
    description: String,
    level: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmDialogResult {
    confirmed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMacosSmokeContextResult {
    enabled: bool,
    scenario_id: Option<String>,
    report_path: Option<String>,
    artifacts_dir: Option<String>,
    disable_runtime_bootstrap: bool,
    bootstrap_timeout_ms: Option<u64>,
    avatar_product_local_asset_fault: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMacosSmokeReportPayload {
    ok: bool,
    failed_step: Option<String>,
    steps: Vec<String>,
    error_message: Option<String>,
    error_name: Option<String>,
    error_stack: Option<String>,
    error_cause: Option<String>,
    route: Option<String>,
    html_snapshot: Option<String>,
    details: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMacosSmokePingPayload {
    stage: String,
    details: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMacosSmokeAvatarEvidenceReadPayload {
    avatar_instance_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMacosSmokeAvatarProductLocalAssetFaultApplyPayload {
    fault_kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMacosSmokeAvatarProductLocalAssetFaultApplyResult {
    fault_kind: String,
    manifest_path: String,
    removed_entry_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMacosSmokeAvatarEvidenceReadResult {
    evidence_path: String,
    evidence: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMacosSmokeReportResult {
    report_path: String,
    html_snapshot_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAvatarLaunchHandoffPayload {
    agent_id: String,
    avatar_instance_id: Option<String>,
    launch_source: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAvatarLaunchHandoffResult {
    opened: bool,
    handoff_uri: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAvatarCloseHandoffPayload {
    avatar_instance_id: String,
    closed_by: Option<String>,
    source_surface: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopAvatarCloseHandoffResult {
    opened: bool,
    handoff_uri: String,
}

const DIAG_LOG_MESSAGE_PREVIEW_BYTES: usize = 4000;
static APP_RUN_SESSION_ID: OnceLock<String> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagLogEntry {
    ts: String,
    source: String,
    level: String,
    area: String,
    message: String,
    session_trace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    flow_id: Option<String>,
    details: serde_json::Value,
}
