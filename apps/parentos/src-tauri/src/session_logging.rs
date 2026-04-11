use serde::Deserialize;
use std::sync::Once;

static PANIC_HOOK: Once = Once::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererLogPayload {
    pub level: String,
    pub area: String,
    pub message: String,
    pub trace_id: Option<String>,
    #[serde(rename = "flowId")]
    pub flow_id: Option<String>,
    pub source: Option<String>,
    #[serde(rename = "costMs")]
    pub cost_ms: Option<f64>,
    pub details: Option<serde_json::Value>,
}

pub fn install_panic_hook() {
    PANIC_HOOK.call_once(|| {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            eprintln!("[parentos:panic] {info}");
            default_hook(info);
        }));
    });
}

pub fn log_boot_marker(label: &str) {
    eprintln!("[parentos:boot] {label}");
}

#[tauri::command]
pub fn log_renderer_event(payload: RendererLogPayload) {
    let level = payload.level.trim().to_ascii_lowercase();
    let area = payload.area.trim();
    if area.is_empty() {
        return;
    }

    let trace_id = payload.trace_id.unwrap_or_default();
    let flow_id = payload.flow_id.unwrap_or_default();
    let source = payload.source.unwrap_or_default();
    let cost_ms = payload
        .cost_ms
        .map(|value| format!(" cost_ms={value}"))
        .unwrap_or_default();
    let details = payload
        .details
        .as_ref()
        .and_then(|value| serde_json::to_string(value).ok())
        .unwrap_or_else(|| "{}".to_string());

    eprintln!(
        "[parentos:renderer:{level}] area={area} trace_id={trace_id} flow_id={flow_id} source={source}{cost_ms} message={} details={details}",
        payload.message
    );
}
