#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

mod defaults;
mod desktop_paths;
#[path = "../../../shared-tauri/oauth_commands.rs"]
mod oauth_commands;
mod runtime_bridge;
mod session_logging;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForgeStorageDirs {
    nimi_dir: String,
    nimi_data_dir: String,
}

#[tauri::command]
fn get_storage_dirs() -> Result<ForgeStorageDirs, String> {
    let nimi_dir = desktop_paths::resolve_nimi_dir()?;
    let nimi_data_dir = desktop_paths::resolve_nimi_data_dir()?;
    Ok(ForgeStorageDirs {
        nimi_dir: nimi_dir.display().to_string(),
        nimi_data_dir: nimi_data_dir.display().to_string(),
    })
}

fn main() {
    session_logging::install_panic_hook();
    session_logging::log_boot_marker("forge main() entered");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_storage_dirs,
            defaults::runtime_defaults,
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
        .expect("error running forge");
}
