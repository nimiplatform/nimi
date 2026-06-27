#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use nimi_shell_tauri::capabilities::runtime as runtime_bridge;
mod account_apps_projection;
mod account_profile_library;
mod account_profile_library_commands;
mod account_profile_library_files;
mod apps_bridge_projection;
mod apps_local_app_commands;
mod apps_packages_projection;
mod apps_registry_projection;
mod chat_ai_store;
mod desktop_agent_center_store;
mod desktop_agent_memory_export;
mod desktop_ai_config_library;
mod desktop_avatar_instance_registry;
mod desktop_e2e_fixture;
mod desktop_logs_export;
mod desktop_paths;
mod desktop_product_control;
mod desktop_product_control_admission;
mod desktop_release;
mod desktop_updates;
#[cfg(test)]
mod factory_profile_index;
mod local_runtime;
mod main_parts;
mod menu_bar_shell;
mod nimi_data_directory;
#[cfg(test)]
mod test_support;

pub(crate) use main_parts::RuntimeDefaults;

fn main() {
    main_parts::run();
}
