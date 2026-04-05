#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

mod defaults;
mod desktop_paths;
#[path = "../../../shared-tauri/auth_session_commands.rs"]
mod auth_session_commands;
#[path = "../../../shared-tauri/oauth_commands.rs"]
mod oauth_commands;
#[path = "../../../forge/src-tauri/src/runtime_bridge/mod.rs"]
mod runtime_bridge;
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

fn configure_runtime_bridge_env() {
    if cfg!(debug_assertions) && std::env::var_os("NIMI_RUNTIME_BRIDGE_MODE").is_none() {
        std::env::set_var("NIMI_RUNTIME_BRIDGE_MODE", "RUNTIME");
    }
}

fn main() {
    configure_runtime_bridge_env();
    session_logging::install_panic_hook();
    session_logging::log_boot_marker("shiji main() entered");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_storage_dirs,
            defaults::runtime_defaults,
            auth_session_commands::auth_session_load,
            auth_session_commands::auth_session_save,
            auth_session_commands::auth_session_clear,
            oauth_commands::open_external_url,
            oauth_commands::oauth_token_exchange,
            oauth_commands::oauth_listen_for_code,
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
