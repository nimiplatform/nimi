use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Read, Write};
use std::net::TcpListener;
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
    sanitize_headers, validate_external_url,
};
use session_logging::{
    append_diag_log_entry, app_run_session_id, debug_boot_enabled, env_value, install_panic_hook,
    log_boot_marker, now_ms, session_trace_id_from_details, should_echo_diag_log,
    should_echo_renderer_log, verbose_renderer_logs_enabled,
};
#[cfg(target_os = "macos")]
use session_logging::{
    apply_macos_traffic_light_position, schedule_macos_traffic_light_reapply,
};

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
    pub(crate) local_provider_endpoint: String,
    pub(crate) local_provider_model: String,
    pub(crate) local_open_ai_endpoint: String,
    pub(crate) connector_id: String,
    pub(crate) target_type: String,
    pub(crate) target_account_id: String,
    pub(crate) agent_id: String,
    pub(crate) world_id: String,
    pub(crate) provider: String,
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
struct OpenExternalUrlPayload {
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenExternalUrlResult {
    opened: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OauthTokenExchangePayload {
    token_url: String,
    client_id: String,
    code: String,
    code_verifier: Option<String>,
    redirect_uri: Option<String>,
    client_secret: Option<String>,
    extra: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OauthTokenExchangeResult {
    access_token: String,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
    raw: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OauthListenForCodePayload {
    redirect_uri: String,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OauthListenForCodeResult {
    callback_url: String,
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RendererLogPayload {
    level: String,
    area: String,
    message: String,
    trace_id: Option<String>,
    #[serde(rename = "flowId")]
    flow_id: Option<String>,
    source: Option<String>,
    #[serde(rename = "costMs")]
    cost_ms: Option<f64>,
    details: Option<serde_json::Value>,
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
