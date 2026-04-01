#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

mod defaults;
mod desktop_paths;
#[path = "../../../shared-tauri/oauth_commands.rs"]
mod oauth_commands;
mod session_logging;
mod sqlite;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShiJiStorageDirs {
    nimi_dir: String,
    nimi_data_dir: String,
    shiji_db_path: String,
}

#[tauri::command]
fn get_storage_dirs() -> Result<ShiJiStorageDirs, String> {
    let nimi_dir = desktop_paths::resolve_nimi_dir()?;
    let nimi_data_dir = desktop_paths::resolve_nimi_data_dir()?;
    let shiji_db_path = sqlite::resolve_db_path()?;
    Ok(ShiJiStorageDirs {
        nimi_dir: nimi_dir.display().to_string(),
        nimi_data_dir: nimi_data_dir.display().to_string(),
        shiji_db_path: shiji_db_path.display().to_string(),
    })
}

// ── Runtime Bridge Stubs ──────────────────────────────────────────────────
// Phase 0: stub commands that return errors. The TypeScript bootstrap handles
// runtime unavailability non-blockingly (SJ-SHELL-001:5-6).
// Full gRPC bridge follows in Phase 3 when TTS/STT/image generation is needed.

#[tauri::command]
async fn runtime_bridge_unary(_payload: serde_json::Value) -> Result<serde_json::Value, String> {
    Err("shiji: runtime bridge not yet configured".to_string())
}

#[tauri::command]
async fn runtime_bridge_stream_open(
    _app: tauri::AppHandle,
    _payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Err("shiji: runtime bridge not yet configured".to_string())
}

#[tauri::command]
fn runtime_bridge_stream_close(_payload: serde_json::Value) {}

#[tauri::command]
fn runtime_bridge_status(_app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "running": false,
        "managed": false,
        "launchMode": "INVALID",
        "grpcAddr": ""
    })
}

#[tauri::command]
fn runtime_bridge_start(
    _app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    Err("shiji: runtime bridge not yet configured".to_string())
}

#[tauri::command]
fn runtime_bridge_stop(
    _app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    Err("shiji: runtime bridge not yet configured".to_string())
}

#[tauri::command]
fn runtime_bridge_restart(
    _app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    Err("shiji: runtime bridge not yet configured".to_string())
}

#[tauri::command]
fn runtime_bridge_config_get() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({}))
}

#[tauri::command]
fn runtime_bridge_config_set(
    _payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({}))
}

fn main() {
    session_logging::install_panic_hook();
    session_logging::log_boot_marker("shiji main() entered");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_storage_dirs,
            defaults::runtime_defaults,
            oauth_commands::open_external_url,
            oauth_commands::oauth_token_exchange,
            oauth_commands::oauth_listen_for_code,
            runtime_bridge_unary,
            runtime_bridge_stream_open,
            runtime_bridge_stream_close,
            runtime_bridge_status,
            runtime_bridge_start,
            runtime_bridge_stop,
            runtime_bridge_restart,
            runtime_bridge_config_get,
            runtime_bridge_config_set,
            session_logging::log_renderer_event,
            sqlite::queries::create_learner_profile,
            sqlite::queries::get_learner_profiles,
            sqlite::queries::update_learner_profile,
            sqlite::queries::set_active_profile,
            sqlite::queries::create_session,
            sqlite::queries::get_session,
            sqlite::queries::update_session,
            sqlite::queries::get_sessions_for_learner,
            sqlite::queries::insert_dialogue_turn,
            sqlite::queries::get_dialogue_turns,
            sqlite::queries::insert_choice,
            sqlite::queries::get_choices_for_session,
            sqlite::queries::upsert_knowledge_entry,
            sqlite::queries::get_knowledge_entries,
            sqlite::queries::upsert_chapter_progress,
            sqlite::queries::get_chapter_progress,
            sqlite::queries::unlock_achievement,
            sqlite::queries::get_achievements,
            sqlite::queries::insert_learner_context_note,
            sqlite::queries::get_learner_context_notes,
            sqlite::db_init,
        ])
        .run(tauri::generate_context!())
        .expect("error running shiji");
}
