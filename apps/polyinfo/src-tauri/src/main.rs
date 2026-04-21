#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use serde_json::Value;
use reqwest::Url;

use nimi_kit_shell_tauri::auth_session_commands;
use nimi_kit_shell_tauri::desktop_paths;
use nimi_kit_shell_tauri::runtime_bridge;
use nimi_kit_shell_tauri::runtime_defaults as defaults;
use nimi_kit_shell_tauri::session_logging;

const GAMMA_API_BASE: &str = "https://gamma-api.polymarket.com";
const CLOB_API_BASE: &str = "https://clob.polymarket.com";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolyinfoStorageDirs {
    nimi_dir: String,
    nimi_data_dir: String,
}

#[tauri::command]
fn get_storage_dirs() -> Result<PolyinfoStorageDirs, String> {
    let nimi_dir = desktop_paths::resolve_nimi_dir()?;
    let nimi_data_dir = desktop_paths::resolve_nimi_data_dir()?;
    Ok(PolyinfoStorageDirs {
        nimi_dir: nimi_dir.display().to_string(),
        nimi_data_dir: nimi_data_dir.display().to_string(),
    })
}

async fn fetch_json(url: String, method: &str, body: Option<Value>) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let response = if method == "POST" {
        let builder = client
            .post(url)
            .header("user-agent", "Mozilla/5.0")
            .header("content-type", "application/json");
        match body {
            Some(payload) => builder.json(&payload).send().await,
            None => builder.send().await,
        }
    } else {
        client
            .get(url)
            .header("user-agent", "Mozilla/5.0")
            .send()
            .await
    }
    .map_err(|error| format!("request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("upstream status {}: {}", status.as_u16(), body));
    }

    response
        .json::<Value>()
        .await
        .map_err(|error| format!("invalid json: {error}"))
}

#[tauri::command]
async fn polymarket_frontend_homepage_html() -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://polymarket.com/")
        .header("user-agent", "Mozilla/5.0")
        .header("accept", "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("upstream status {}: {}", status.as_u16(), body));
    }

    response
        .text()
        .await
        .map_err(|error| format!("invalid text: {error}"))
}

#[tauri::command]
async fn polymarket_frontend_filtered_tags_by_slug(slug: String) -> Result<Value, String> {
    let mut url = Url::parse("https://polymarket.com/api/tags/filteredBySlug")
        .map_err(|error| format!("invalid url: {error}"))?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("tag", &slug);
        query.append_pair("status", "active");
    }
    fetch_json(url.to_string(), "GET", None).await
}

#[tauri::command]
async fn polymarket_events_by_tag_slug(
    tag_slug: String,
    limit: Option<u32>,
    after_cursor: Option<String>,
) -> Result<Value, String> {
    let mut url = Url::parse(&format!("{GAMMA_API_BASE}/events/keyset"))
        .map_err(|error| format!("invalid url: {error}"))?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("limit", &limit.unwrap_or(100).to_string());
        query.append_pair("tag_slug", &tag_slug);
        query.append_pair("closed", "false");
        query.append_pair("order", "volume_24hr");
        query.append_pair("ascending", "false");
        if let Some(after_cursor) = after_cursor {
            if !after_cursor.is_empty() {
                query.append_pair("after_cursor", &after_cursor);
            }
        }
    }
    fetch_json(url.to_string(), "GET", None).await
}

#[tauri::command]
async fn polymarket_batch_prices_history(
    markets: Vec<String>,
    interval: Option<String>,
    fidelity: Option<u32>,
    start_ts: i64,
    end_ts: i64,
) -> Result<Value, String> {
    let payload = serde_json::json!({
        "markets": markets,
        "interval": interval.unwrap_or_else(|| "max".to_string()),
        "fidelity": fidelity.unwrap_or(60),
        "start_ts": start_ts,
        "end_ts": end_ts,
    });

    fetch_json(
        format!("{CLOB_API_BASE}/batch-prices-history"),
        "POST",
        Some(payload),
    )
    .await
}

fn main() {
    session_logging::set_app_session_prefix("polyinfo");
    session_logging::install_panic_hook();
    session_logging::log_boot_marker("polyinfo main() entered");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_storage_dirs,
            polymarket_frontend_homepage_html,
            polymarket_frontend_filtered_tags_by_slug,
            polymarket_events_by_tag_slug,
            polymarket_batch_prices_history,
            defaults::runtime_defaults,
            auth_session_commands::auth_session_load,
            auth_session_commands::auth_session_save,
            auth_session_commands::auth_session_clear,
            runtime_bridge::runtime_bridge_unary,
            runtime_bridge::runtime_bridge_stream_open,
            runtime_bridge::runtime_bridge_stream_close,
            runtime_bridge::runtime_bridge_status,
            runtime_bridge::runtime_bridge_start,
            runtime_bridge::runtime_bridge_stop,
            runtime_bridge::runtime_bridge_restart,
            runtime_bridge::runtime_bridge_config_get,
            runtime_bridge::runtime_bridge_config_set,
            session_logging::log_renderer_event,
        ])
        .run(tauri::generate_context!())
        .expect("error running polyinfo");
}
