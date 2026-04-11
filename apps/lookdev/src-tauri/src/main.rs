#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

// Shared modules from kit/shell/tauri crate
use nimi_kit_shell_tauri::auth_session_commands;
use nimi_kit_shell_tauri::desktop_paths;
use nimi_kit_shell_tauri::oauth_commands;
use nimi_kit_shell_tauri::runtime_bridge;
use nimi_kit_shell_tauri::runtime_defaults as defaults;
use nimi_kit_shell_tauri::session_logging;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LookdevStorageDirs {
    nimi_dir: String,
    nimi_data_dir: String,
}

#[tauri::command]
fn get_storage_dirs() -> Result<LookdevStorageDirs, String> {
    let nimi_dir = desktop_paths::resolve_nimi_dir()?;
    let nimi_data_dir = desktop_paths::resolve_nimi_data_dir()?;
    Ok(LookdevStorageDirs {
        nimi_dir: nimi_dir.display().to_string(),
        nimi_data_dir: nimi_data_dir.display().to_string(),
    })
}

fn main() {
    session_logging::set_app_session_prefix("lookdev");
    session_logging::install_panic_hook();
    session_logging::log_boot_marker("lookdev main() entered");

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
        ])
        .run(tauri::generate_context!())
        .expect("error running lookdev");
}
