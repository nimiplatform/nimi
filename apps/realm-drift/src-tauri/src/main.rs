#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

mod defaults;
mod desktop_paths;
mod runtime_bridge;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DriftStorageDirs {
    nimi_dir: String,
    nimi_data_dir: String,
}

#[tauri::command]
fn get_storage_dirs() -> Result<DriftStorageDirs, String> {
    let nimi_dir = desktop_paths::resolve_nimi_dir()?;
    let nimi_data_dir = desktop_paths::resolve_nimi_data_dir()?;
    Ok(DriftStorageDirs {
        nimi_dir: nimi_dir.display().to_string(),
        nimi_data_dir: nimi_data_dir.display().to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_storage_dirs,
            defaults::runtime_defaults,
            runtime_bridge::runtime_bridge_unary,
            runtime_bridge::runtime_bridge_stream_open,
            runtime_bridge::runtime_bridge_stream_close,
            runtime_bridge::runtime_bridge_status,
            runtime_bridge::runtime_bridge_start,
            runtime_bridge::runtime_bridge_stop,
            runtime_bridge::runtime_bridge_restart,
            runtime_bridge::runtime_bridge_config_get,
            runtime_bridge::runtime_bridge_config_set,
        ])
        .run(tauri::generate_context!())
        .expect("error running realm-drift");
}
