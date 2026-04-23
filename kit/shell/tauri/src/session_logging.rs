use std::env;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;

const DIAG_LOG_MESSAGE_PREVIEW_BYTES: usize = 4000;
static APP_RUN_SESSION_ID: OnceLock<String> = OnceLock::new();
static APP_SESSION_PREFIX: OnceLock<String> = OnceLock::new();

/// Set the app identity prefix used in session IDs and log entries.
/// Must be called once before any logging. Example: "forge", "desktop", "parentos".
pub fn set_app_session_prefix(prefix: &str) {
    let _ = APP_SESSION_PREFIX.set(prefix.to_string());
}

fn app_session_prefix() -> &'static str {
    APP_SESSION_PREFIX
        .get()
        .map(|s| s.as_str())
        .unwrap_or("nimi-app")
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererLogPayload {
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

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn app_run_session_id() -> &'static str {
    APP_RUN_SESSION_ID
        .get_or_init(|| {
            format!(
                "{}-run-{}-{}",
                app_session_prefix(),
                now_ms(),
                std::process::id()
            )
        })
        .as_str()
}

fn normalize_session_trace_id(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return app_run_session_id().to_string();
    }
    let mut normalized = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            normalized.push(ch);
        } else {
            normalized.push('_');
        }
    }
    let compact = normalized.trim_matches('_');
    if compact.is_empty() {
        app_run_session_id().to_string()
    } else if compact.len() > 140 {
        compact[..140].to_string()
    } else {
        compact.to_string()
    }
}

fn preview_text_utf8_safe(input: &str, max_bytes: usize) -> String {
    if input.len() <= max_bytes {
        return input.to_string();
    }

    let mut end = max_bytes.min(input.len());
    while end > 0 && !input.is_char_boundary(end) {
        end -= 1;
    }

    let head = &input[..end];
    format!("{head}... (截断, 共 {} 字节)", input.len())
}

fn append_diag_log_entry(
    source: &str,
    level: &str,
    area: &str,
    message: &str,
    session_trace_id: Option<&str>,
    trace_id: Option<&str>,
    flow_id: Option<&str>,
    details: serde_json::Value,
) {
    let session = normalize_session_trace_id(session_trace_id.unwrap_or_default());
    let trace = trace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let flow = flow_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let entry = DiagLogEntry {
        ts: now_iso(),
        source: source.trim().to_string(),
        level: level.trim().to_string(),
        area: area.trim().to_string(),
        message: preview_text_utf8_safe(message, DIAG_LOG_MESSAGE_PREVIEW_BYTES),
        session_trace_id: session.clone(),
        trace_id: trace,
        flow_id: flow,
        details,
    };
    if !should_echo_diag_log(source, level) {
        return;
    }
    let line = match serde_json::to_string(&entry) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("[diag-log] serialize failed: {}", error);
            return;
        }
    };
    eprintln!("[diag-log] {line}");
}

fn session_trace_id_from_details(details: &Option<serde_json::Value>) -> Option<String> {
    details
        .as_ref()
        .and_then(|value| value.as_object())
        .and_then(|object| object.get("sessionTraceId"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn env_flag(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref(),
        Some("1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON")
    )
}

fn debug_boot_enabled() -> bool {
    env_flag("NIMI_DEBUG_BOOT") || env_flag("VITE_NIMI_DEBUG_BOOT")
}

fn verbose_renderer_logs_enabled() -> bool {
    debug_boot_enabled()
        || env_flag("NIMI_VERBOSE_RENDERER_LOGS")
        || env_flag("VITE_NIMI_VERBOSE_RENDERER_LOGS")
}

fn should_echo_renderer_log(level: &str) -> bool {
    match level.trim().to_ascii_lowercase().as_str() {
        "warn" | "error" => true,
        "debug" | "info" => verbose_renderer_logs_enabled(),
        _ => verbose_renderer_logs_enabled(),
    }
}

fn should_echo_diag_log(source: &str, level: &str) -> bool {
    let normalized_source = source.trim().to_ascii_lowercase();
    if normalized_source == "renderer-log" {
        return should_echo_renderer_log(level);
    }
    if normalized_source == "boot" {
        return verbose_renderer_logs_enabled();
    }
    match level.trim().to_ascii_lowercase().as_str() {
        "warn" | "error" => true,
        _ => verbose_renderer_logs_enabled(),
    }
}

pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|panic_info| {
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .map(|value| (*value).to_string())
            .or_else(|| panic_info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic payload".to_string());

        let location = panic_info
            .location()
            .map(|value| format!("{}:{}:{}", value.file(), value.line(), value.column()))
            .unwrap_or_else(|| "-".to_string());

        let thread_name = std::thread::current()
            .name()
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unnamed".to_string());

        eprintln!(
            "[panic:{}] thread={} location={} payload={}",
            now_ms(),
            thread_name,
            location,
            payload,
        );
    }));
}

pub fn log_boot_marker(message: &str) {
    let boot_ms = now_ms();
    let trace_id = format!("boot-{boot_ms}");
    eprintln!("[boot:{boot_ms}] {}", message);
    append_diag_log_entry(
        "boot",
        "info",
        "boot",
        message,
        Some(app_run_session_id()),
        Some(trace_id.as_str()),
        None,
        json!({ "bootMs": boot_ms }),
    );
}

#[tauri::command]
pub fn log_renderer_event(payload: RendererLogPayload) {
    let area = payload.area.trim();
    if area.is_empty() {
        return;
    }
    let level = payload.level.to_lowercase();
    if level == "debug" && !debug_boot_enabled() {
        return;
    }
    let should_echo = should_echo_renderer_log(level.as_str());
    let flow_id = payload.flow_id.clone().unwrap_or_else(|| "-".to_string());
    let trace_id = payload.trace_id.unwrap_or_else(|| flow_id.clone());
    let source = payload.source.unwrap_or_else(|| "-".to_string());
    let cost_ms = payload
        .cost_ms
        .map(|value| format!(" {value}ms"))
        .unwrap_or_default();
    let detail_text_raw = payload
        .details
        .as_ref()
        .map(serde_json::to_string)
        .and_then(Result::ok)
        .unwrap_or_else(|| "-".to_string());
    let detail_text = preview_text_utf8_safe(&detail_text_raw, 1000);
    if should_echo {
        eprintln!(
            "[renderer-log][{}] {} flow_id={} source={}{} message={} details={}",
            level, area, flow_id, source, cost_ms, payload.message, detail_text,
        );
        if trace_id != flow_id {
            eprintln!(
                "[renderer-log][{}] {} trace_id={} (flow_id={}) source={}{} message={} details={}",
                level, area, trace_id, flow_id, source, cost_ms, payload.message, detail_text,
            );
        }
    }

    let session_trace_id = session_trace_id_from_details(&payload.details)
        .unwrap_or_else(|| app_run_session_id().to_string());
    let details = payload.details.unwrap_or_else(|| json!({}));
    let trace_id_for_diag = if trace_id.trim().is_empty() || trace_id == "-" {
        None
    } else {
        Some(trace_id.as_str())
    };
    let flow_id_for_diag = if flow_id.trim().is_empty() || flow_id == "-" {
        None
    } else {
        Some(flow_id.as_str())
    };
    if should_echo_diag_log("renderer-log", level.as_str()) {
        append_diag_log_entry(
            "renderer-log",
            level.as_str(),
            area,
            payload.message.as_str(),
            Some(session_trace_id.as_str()),
            trace_id_for_diag,
            flow_id_for_diag,
            details,
        );
    }
}
