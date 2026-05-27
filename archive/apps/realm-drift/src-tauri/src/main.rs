#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

mod marble_commands;

// Shared modules from kit/shell/tauri crate.
// RD-SHELL-010: Realm Drift MUST NOT expose the kit shared desktop auth-session
// bridge (`auth_session_load/save/clear`). RuntimeAccountService owns token
// custody; the bridge import is intentionally absent. RD-SHELL-009 wires the
// kit OAuth commands so the renderer's `driftTauriOAuthBridge` can drive the
// desktop-browser broker login flow (PKCE S256 via runtime BeginLogin).
use nimi_shell_tauri::desktop_paths;
use nimi_shell_tauri::oauth_commands;
use nimi_shell_tauri::runtime_bridge;
use nimi_shell_tauri::runtime_defaults as defaults;
use nimi_shell_tauri::session_logging;

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
    session_logging::set_app_session_prefix("realm-drift");
    session_logging::install_panic_hook();
    session_logging::log_boot_marker("realm-drift main() entered");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_storage_dirs,
            defaults::runtime_defaults,
            marble_commands::realm_drift_marble_generate,
            marble_commands::realm_drift_marble_poll,
            oauth_commands::open_external_url,
            oauth_commands::oauth_token_exchange,
            oauth_commands::oauth_listen_for_code,
            runtime_bridge::runtime_bridge_unary,
            runtime_bridge::runtime_bridge_stream_open,
            runtime_bridge::runtime_bridge_stream_close,
            runtime_bridge::runtime_bridge_status,
            session_logging::log_renderer_event,
        ])
        .run(tauri::generate_context!())
        .expect("error running realm-drift");
}
