#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::Manager;

use nimi_shell_tauri::auth_session_commands;
use nimi_shell_tauri::desktop_paths;
use nimi_shell_tauri::oauth_commands;
use nimi_shell_tauri::runtime_bridge;
use nimi_shell_tauri::runtime_defaults as defaults;
use nimi_shell_tauri::session_logging;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealmAgentStudioStorageDirs {
    nimi_dir: String,
    nimi_data_dir: String,
}

#[tauri::command]
fn realm_agent_studio_storage_dirs() -> Result<RealmAgentStudioStorageDirs, String> {
    let nimi_dir = desktop_paths::resolve_nimi_dir()?;
    let nimi_data_dir = desktop_paths::resolve_nimi_data_dir()?;
    Ok(RealmAgentStudioStorageDirs {
        nimi_dir: nimi_dir.display().to_string(),
        nimi_data_dir: nimi_data_dir.display().to_string(),
    })
}

#[tauri::command]
fn realm_agent_studio_start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }

    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        window.start_dragging().map_err(|error| error.to_string())
    })) {
        Ok(result) => result,
        Err(_) => Err("window drag unavailable".to_string()),
    }
}

fn load_dotenv_files() {
    let root_env_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.env");
    if !root_env_path.exists() {
        return;
    }

    match dotenvy::from_path_iter(&root_env_path) {
        Ok(iter) => {
            for item in iter.flatten() {
                let (key, value) = item;
                let should_override = key.starts_with("NIMI_") || key.starts_with("VITE_NIMI_");
                if should_override || std::env::var_os(&key).is_none() {
                    std::env::set_var(&key, &value);
                }
            }
            eprintln!("[realm-agent-studio] dotenv loaded path={}", root_env_path.display());
        }
        Err(error) => {
            eprintln!(
                "[realm-agent-studio] dotenv load failed path={} error={error}",
                root_env_path.display()
            );
        }
    }
}

fn configure_runtime_bridge_env() {
    if cfg!(debug_assertions) && std::env::var_os("NIMI_RUNTIME_BRIDGE_MODE").is_none() {
        std::env::set_var("NIMI_RUNTIME_BRIDGE_MODE", "RUNTIME");
    }
}

fn main() {
    load_dotenv_files();
    configure_runtime_bridge_env();
    session_logging::set_app_session_prefix("realm-agent-studio");
    session_logging::install_panic_hook();
    session_logging::log_boot_marker("realm-agent-studio main() entered");

    tauri::Builder::default()
        .setup(|app| {
            let nimi_data_dir = desktop_paths::resolve_nimi_data_dir()?;
            app.state::<tauri::Scopes>()
                .allow_directory(&nimi_data_dir, true)
                .map_err(|error| {
                    format!(
                        "failed to allow nimi_data_dir in asset scope ({}): {error}",
                        nimi_data_dir.display()
                    )
                })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            realm_agent_studio_storage_dirs,
            realm_agent_studio_start_window_drag,
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
            session_logging::log_renderer_event,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Realm Agent Studio");
}
